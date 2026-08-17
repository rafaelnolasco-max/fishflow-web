"use client";

/**
 * Ventana "Programar" (multi-tenant).
 *
 * Qué es y qué NO es: esto NO es la pestaña de Contenido. Contenido existe para
 * el cliente que quiere que la IA le escriba y que produce su arte en Canva por
 * tandas. Esta ventana existe para la clienta que ya tiene su imagen y su texto
 * hechos por ella y lo único que quiere es soltarlos con fecha — hoy eso se
 * resuelve mandándoselos por WhatsApp a Rafa para que él los suba a mano, y ese
 * es justo el paso que aquí desaparece.
 *
 * Las dos ventanas conviven sin tocarse: distinta tabla, distintos componentes,
 * distinto flujo.
 *
 * Uso:
 *   <ScheduleTab clientId={CANE_CLIENT_ID} theme={T} suggestFormat="psicoeducacion" />
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Section, Empty, Chip, StatGrid, StatCard, Toast,
  inputStyle as mkInput, type DashTheme,
} from "@/components/dashboard";
import ScheduleComposer, { type TakenSlots } from "@/components/schedule/ScheduleComposer";
import {
  cdmxDayKey, formatCdmxDay, formatCdmxTime, utcIsoToCdmxFields,
  type SocialTarget,
} from "@/lib/socialTargets";

type ScheduledPost = {
  id: string;
  scheduledAt: string;
  targetKey: string;
  targetLabel: string;
  platform: "instagram" | "facebook";
  text: string;
  mediaUrls: string[];
};

/**
 * Separa el bloque de hashtags del final del texto para poder pintarlos aparte.
 *
 * Trabaja desde el final hacia atrás y solo se lleva las líneas que son
 * únicamente hashtags: así un "#ansiedad" suelto en medio de un párrafo se
 * queda donde está, que es donde la clienta lo escribió.
 */
function splitTextAndTags(text: string): { body: string; tags: string } {
  const lines = text.split("\n");
  const tags: string[] = [];
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (last === "") { lines.pop(); continue; }
    if (/^(#[^\s#]+\s*)+$/.test(last)) { tags.unshift(last); lines.pop(); continue; }
    break;
  }
  return { body: lines.join("\n").trim(), tags: tags.join(" ") };
}

/** Las primeras líneas del pie: lo suficiente para reconocer la publicación. */
function preview(body: string, max = 220): string {
  const limpio = body.trim();
  return limpio.length > max ? `${limpio.slice(0, max).trimEnd()}…` : limpio;
}

export default function ScheduleTab({
  clientId, theme: t, suggestFormat,
}: {
  clientId: string;
  theme: DashTheme;
  /** Formato con el que la IA redacta al usar "Sugerir texto". */
  suggestFormat?: string;
}) {
  const input = useMemo(() => mkInput(t), [t]);

  const [targets, setTargets] = useState<SocialTarget[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [showComposer, setShowComposer] = useState(false);
  const [editing, setEditing] = useState<{ id: string; date: string; time: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  }, []);

  // ── Carga ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/schedule?clientId=${encodeURIComponent(clientId)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "No se pudo cargar el calendario.");
      setTargets(json.targets ?? []);
      setPosts(json.schedules ?? []);
      setConfigured(Boolean(json.configured));
      setError(null);
    } catch (e: unknown) {
      console.error("[ScheduleTab] load error:", e);
      setError(e instanceof Error ? e.message : "No se pudo cargar el calendario.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // ── Acciones sobre lo ya programado ─────────────────────────────────────────
  async function guardarHora() {
    if (!editing) return;
    setBusy(editing.id);
    setError(null);
    try {
      const res = await fetch(`/api/content/schedule/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, date: editing.date, time: editing.time }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "No se pudo mover la publicación.");
      setEditing(null);
      flash("Cambiada de hora");
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo mover la publicación.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelar(post: ScheduledPost) {
    if (!confirm("¿Cancelar esta publicación? Ya no va a salir y no se puede deshacer.")) return;
    setBusy(post.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/content/schedule/${encodeURIComponent(post.id)}?clientId=${encodeURIComponent(clientId)}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "No se pudo cancelar.");
      flash("Publicación cancelada");
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo cancelar.");
    } finally {
      setBusy(null);
    }
  }

  // ── Derivados ───────────────────────────────────────────────────────────────
  /** Huecos ya ocupados por destino, para que el compositor no proponga uno repetido. */
  const taken: TakenSlots = useMemo(() => {
    const out: TakenSlots = {};
    for (const p of posts) (out[p.targetKey] ??= []).push(p.scheduledAt);
    return out;
  }, [posts]);

  /** Agrupadas por día de CDMX — no por día UTC, que a las 20:30 ya va en el día siguiente. */
  const porDia = useMemo(() => {
    const mapa = new Map<string, ScheduledPost[]>();
    for (const p of posts) {
      const k = cdmxDayKey(p.scheduledAt);
      const lista = mapa.get(k);
      if (lista) lista.push(p);
      else mapa.set(k, [p]);
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [posts]);

  const counts = useMemo(() => {
    const ahora = Date.now();
    const semana = ahora + 7 * 24 * 60 * 60 * 1000;
    return {
      total: posts.length,
      semana: posts.filter((p) => {
        const ts = new Date(p.scheduledAt).getTime();
        return ts >= ahora && ts <= semana;
      }).length,
      carruseles: posts.filter((p) => p.mediaUrls.length > 1).length,
    };
  }, [posts]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <Empty msg="Cargando tu calendario…" theme={t} />;

  const puedeProgramar = configured && targets.length > 0;

  return (
    <>
      <StatGrid>
        <StatCard theme={t} label="Programadas"   value={counts.total}      icon="🗓️" accent={t.accent} />
        <StatCard theme={t} label="Esta semana"   value={counts.semana}     icon="📆" />
        <StatCard theme={t} label="Carruseles"    value={counts.carruseles} icon="🖼️" />
      </StatGrid>

      {error && (
        <div style={{
          background: "#FEF2F2", border: `1px solid ${t.danger}`, color: t.danger,
          borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16, lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      {!configured && (
        <div style={{
          background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E",
          borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16, lineHeight: 1.55,
        }}>
          ⚠️ La publicación automática todavía no está encendida en esta cuenta. Avísale a FishFlow.
        </div>
      )}

      {configured && targets.length === 0 && (
        <div style={{
          background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E",
          borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16, lineHeight: 1.55,
        }}>
          ⚠️ Todavía no hay cuentas de redes conectadas a este tablero. Avísale a FishFlow.
        </div>
      )}

      <Section
        title="Tus publicaciones programadas"
        theme={t}
        action={
          puedeProgramar
            ? { label: "🗓 Nueva publicación programada", onClick: () => { setShowComposer(true); setError(null); } }
            : undefined
        }
      >
        {posts.length === 0 ? (
          <Empty
            msg={
              puedeProgramar
                ? "Todavía no tienes nada programado. Sube tu imagen y tu texto y escoge el día."
                : "Aquí van a aparecer tus publicaciones programadas."
            }
            theme={t}
          />
        ) : (
          <div style={{ display: "grid", gap: 22 }}>
            {porDia.map(([dia, delDia]) => (
              <div key={dia}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: t.accentDark,
                  textTransform: "capitalize", marginBottom: 10,
                }}>
                  {formatCdmxDay(delDia[0].scheduledAt)}
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {delDia.map((post) => {
                    const { body, tags } = splitTextAndTags(post.text);
                    const editando = editing?.id === post.id;
                    const ocupado = busy === post.id;

                    return (
                      <article
                        key={post.id}
                        style={{
                          background: t.surface, border: `1px solid ${t.border}`,
                          borderRadius: 14, padding: 14,
                          display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap",
                        }}
                      >
                        {/* Miniatura: la primera lámina, que es la portada del carrusel. */}
                        <div style={{
                          width: 62, height: 62, minWidth: 62, borderRadius: 10,
                          overflow: "hidden", background: t.panel ?? "#F3F4F6", position: "relative",
                        }}>
                          {post.mediaUrls[0] ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={post.mediaUrls[0]}
                              alt=""
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          ) : (
                            <div style={{
                              width: "100%", height: "100%", display: "grid",
                              placeItems: "center", fontSize: 20, color: t.muted,
                            }}>
                              📝
                            </div>
                          )}
                          {post.mediaUrls.length > 1 && (
                            <span style={{
                              position: "absolute", right: 3, bottom: 3,
                              background: "rgba(0,0,0,.72)", color: "#fff",
                              fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "1px 5px",
                            }}>
                              {post.mediaUrls.length}
                            </span>
                          )}
                        </div>

                        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                          <div style={{
                            display: "flex", gap: 8, alignItems: "center",
                            flexWrap: "wrap", marginBottom: 7,
                          }}>
                            <Chip label={`🕗 ${formatCdmxTime(post.scheduledAt)}`} bg={t.accentSoft} fg={t.accentDark} />
                            <Chip
                              label={`${post.platform === "instagram" ? "Instagram" : "Facebook"} · ${post.targetLabel}`}
                              bg="#F9FAFB"
                              fg={t.muted}
                            />
                            {post.mediaUrls.length > 1 && (
                              <Chip label={`Carrusel de ${post.mediaUrls.length}`} bg="#EEF2FF" fg="#4338CA" />
                            )}
                          </div>

                          {body && (
                            <div style={{
                              fontSize: 13.5, color: t.text, lineHeight: 1.6,
                              whiteSpace: "pre-wrap", marginBottom: tags ? 6 : 0,
                            }}>
                              {preview(body)}
                            </div>
                          )}

                          {tags && (
                            <div style={{ fontSize: 12.5, color: t.accentDark, lineHeight: 1.5 }}>
                              {tags}
                            </div>
                          )}

                          {editando ? (
                            <div style={{
                              display: "flex", gap: 8, flexWrap: "wrap",
                              alignItems: "center", marginTop: 10,
                            }}>
                              <input
                                type="date"
                                value={editing.date}
                                onChange={(e) => setEditing({ ...editing, date: e.target.value })}
                                style={{ ...input, width: "auto", flex: "1 1 145px" }}
                              />
                              <input
                                type="time"
                                value={editing.time}
                                onChange={(e) => setEditing({ ...editing, time: e.target.value })}
                                style={{ ...input, width: "auto", flex: "0 1 110px" }}
                              />
                              <button
                                onClick={guardarHora}
                                disabled={ocupado}
                                style={{
                                  background: ocupado ? t.disabled : t.accent, color: "#fff",
                                  border: "none", borderRadius: 8, padding: "8px 14px",
                                  fontSize: 12.5, fontWeight: 600, cursor: ocupado ? "wait" : "pointer",
                                }}
                              >
                                {ocupado ? "Moviendo…" : "Guardar"}
                              </button>
                              <button
                                onClick={() => setEditing(null)}
                                style={{
                                  background: "none", color: t.muted, border: `1px solid ${t.border}`,
                                  borderRadius: 8, padding: "8px 14px", fontSize: 12.5, cursor: "pointer",
                                }}
                              >
                                Dejar así
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                              <button
                                onClick={() => {
                                  const f = utcIsoToCdmxFields(post.scheduledAt);
                                  setEditing({ id: post.id, date: f.date, time: f.time });
                                  setError(null);
                                }}
                                disabled={ocupado}
                                style={{
                                  background: "none", color: t.muted, border: `1px solid ${t.border}`,
                                  borderRadius: 8, padding: "7px 13px", fontSize: 12.5,
                                  cursor: "pointer", whiteSpace: "nowrap",
                                }}
                              >
                                Cambiar hora
                              </button>
                              <button
                                onClick={() => cancelar(post)}
                                disabled={ocupado}
                                style={{
                                  background: "none", color: t.danger, border: `1px solid ${t.danger}`,
                                  borderRadius: 8, padding: "7px 13px", fontSize: 12.5,
                                  cursor: ocupado ? "wait" : "pointer", whiteSpace: "nowrap",
                                }}
                              >
                                {ocupado ? "…" : "Cancelar"}
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {showComposer && (
        <ScheduleComposer
          clientId={clientId}
          targets={targets}
          taken={taken}
          theme={t}
          suggestFormat={suggestFormat}
          onDone={(msg) => { setShowComposer(false); flash(msg); load(); }}
          onClose={() => setShowComposer(false)}
        />
      )}

      <Toast msg={toast} theme={t} />
    </>
  );
}
