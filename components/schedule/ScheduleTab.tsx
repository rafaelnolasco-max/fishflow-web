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
 * Dentro de esta ventana hay dos vistas: "Programadas" (lo que va a salir, que
 * se puede editar o cancelar) y "Publicadas" (lo que ya salió, con sus números).
 * Son cosas distintas y por eso no se mezclan en una sola lista: en lo
 * programado la pregunta es "¿está bien y a qué hora sale?", y en lo publicado
 * es "¿cómo le fue?". Ninguna de las dos se contesta bien en una lista mixta.
 *
 * Uso:
 *   <ScheduleTab clientId={CANE_CLIENT_ID} theme={T} suggestFormat="psicoeducacion" />
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Section, Empty, Chip, StatGrid, StatCard, TabBar, Toast, type DashTheme,
} from "@/components/dashboard";
import PublishedList from "@/components/schedule/PublishedList";
import ScheduleComposer, {
  type ComposerInitial, type TakenSlots,
} from "@/components/schedule/ScheduleComposer";
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
 * Separa el bloque de hashtags del final del texto, para pintarlos aparte en la
 * tarjeta y para devolverlos a su propio campo al editar.
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

/**
 * Convierte una publicación del calendario en los valores iniciales del editor.
 *
 * Las imágenes entran con `path: null` porque viven en Blotato y no en nuestro
 * bucket: la mayoría se cargaron allá antes de que existiera este tablero. El
 * editor las respeta tal cual y solo sube al bucket las que se agreguen ahora.
 */
function toInitial(post: ScheduledPost): ComposerInitial {
  const { body, tags } = splitTextAndTags(post.text);
  const cuando = utcIsoToCdmxFields(post.scheduledAt);
  return {
    scheduleId: post.id,
    targetKey: post.targetKey,
    caption: body,
    hashtags: tags,
    items: post.mediaUrls.map((url, i) => ({
      url,
      path: null,
      name: `Imagen ${i + 1}`,
      width: null,
      height: null,
    })),
    date: cuando.date,
    time: cuando.time,
  };
}

export default function ScheduleTab({
  clientId, theme: t, suggestFormat,
}: {
  clientId: string;
  theme: DashTheme;
  /** Formato con el que la IA redacta al usar "Sugerir texto". */
  suggestFormat?: string;
}) {
  /** Cuál de las dos vistas se está mirando. */
  const [vista, setVista] = useState<"programadas" | "publicadas">("programadas");

  const [targets, setTargets] = useState<SocialTarget[]>([]);
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [configured, setConfigured] = useState(true);
  // Mensaje del servidor cuando la falla es de configuración y no del cliente.
  const [setupError, setSetupError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  /** null = cerrado · "nueva" = alta · ComposerInitial = edición. */
  const [composer, setComposer] = useState<null | "nueva" | ComposerInitial>(null);
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
      setSetupError(json.setupError ?? null);
      setError(null);
    } catch (e: unknown) {
      console.error("[ScheduleTab] load error:", e);
      setError(e instanceof Error ? e.message : "No se pudo cargar el calendario.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  // ── Cancelar una programada ─────────────────────────────────────────────────
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
  const barra = (
    <TabBar
      tabs={[
        { id: "programadas", label: "Programadas", icon: "🗓️" },
        { id: "publicadas", label: "Publicadas", icon: "✅" },
      ]}
      active={vista}
      onChange={setVista}
      theme={t}
    />
  );

  // El historial se pinta solo. No espera a que cargue el calendario ni comparte
  // su estado: son dos fuentes distintas y una lenta no debe tapar a la otra.
  if (vista === "publicadas") {
    return (
      <>
        {barra}
        <PublishedList clientId={clientId} theme={t} />
      </>
    );
  }

  if (loading) {
    return (
      <>
        {barra}
        <Empty msg="Cargando tu calendario…" theme={t} />
      </>
    );
  }

  const puedeProgramar = configured && targets.length > 0;

  const accionBtn: React.CSSProperties = {
    background: "none", color: t.muted, border: `1px solid ${t.border}`,
    borderRadius: 8, padding: "7px 13px", fontSize: 12.5,
    cursor: "pointer", whiteSpace: "nowrap",
  };

  return (
    <>
      {barra}

      <StatGrid>
        <StatCard theme={t} label="Programadas"   value={counts.total}      icon="🗓️" accent={t.accent} />
        <StatCard theme={t} label="Esta semana"   value={counts.semana}     icon="📆" />
        <StatCard theme={t} label="Carruseles"    value={counts.carruseles} icon="🖼️" />
      </StatGrid>

      {error && (
        <div style={{
          background: t.dangerBg ?? "#FEF2F2", border: `1px solid ${t.danger}`, color: t.danger,
          borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16, lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      {!configured && (
        <div style={{
          background: t.warnBg ?? "#FFFBEB", border: `1px solid ${t.warnBorder ?? "#FDE68A"}`, color: t.warnText ?? "#92400E",
          borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16, lineHeight: 1.55,
        }}>
          ⚠️ La publicación automática todavía no está encendida en esta cuenta. Avísale a FishFlow.
        </div>
      )}

      {configured && targets.length === 0 && (
        <div style={{
          background: t.warnBg ?? "#FFFBEB", border: `1px solid ${t.warnBorder ?? "#FDE68A"}`, color: t.warnText ?? "#92400E",
          borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16, lineHeight: 1.55,
        }}>
          {/* Si el servidor supo POR QUÉ no hay destinos, se dice eso y no la
              suposición: "no hay cuentas conectadas" cuando en realidad falta
              la migración manda a buscar el problema al lugar equivocado. */}
          ⚠️ {setupError ?? "Todavía no hay cuentas de redes conectadas a este tablero. Avísale a FishFlow."}
        </div>
      )}

      <Section
        title="Tus publicaciones programadas"
        theme={t}
        action={
          puedeProgramar
            ? { label: "🗓 Nueva publicación programada", onClick: () => { setComposer("nueva"); setError(null); } }
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
                {/* Sin textTransform: la mayúscula inicial la pone formatCdmxDay.
                    "capitalize" en CSS escribiría "Martes, 18 De Agosto". */}
                <div style={{
                  fontSize: 13, fontWeight: 700, color: t.accentDark, marginBottom: 10,
                }}>
                  {formatCdmxDay(delDia[0].scheduledAt)}
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  {delDia.map((post) => {
                    const { body, tags } = splitTextAndTags(post.text);
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
                              bg={t.chipBg ?? "#F9FAFB"}
                              fg={t.muted}
                            />
                            {post.mediaUrls.length > 1 && (
                              <Chip label={`Carrusel de ${post.mediaUrls.length}`} bg={t.infoBg ?? "#EEF2FF"} fg={t.infoText ?? "#4338CA"} />
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

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                            <button
                              onClick={() => { setComposer(toInitial(post)); setError(null); }}
                              disabled={ocupado}
                              style={accionBtn}
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => cancelar(post)}
                              disabled={ocupado}
                              style={{
                                ...accionBtn,
                                color: t.danger,
                                borderColor: t.danger,
                                cursor: ocupado ? "wait" : "pointer",
                              }}
                            >
                              {ocupado ? "…" : "Cancelar"}
                            </button>
                          </div>
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

      {composer && (
        <ScheduleComposer
          clientId={clientId}
          targets={targets}
          taken={taken}
          theme={t}
          suggestFormat={suggestFormat}
          initial={composer === "nueva" ? undefined : composer}
          onDone={(msg) => { setComposer(null); flash(msg); load(); }}
          onClose={() => setComposer(null)}
        />
      )}

      <Toast msg={toast} theme={t} />
    </>
  );
}
