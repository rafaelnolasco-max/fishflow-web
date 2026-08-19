"use client";

// components/reviews/TouchpointsPanel.tsx
// Módulo Reputación — vista del canal QR (inbound) dentro de la pestaña ⭐ Reseñas.
//
// Se monta desde ReviewsTab con la prop showTouchpoints. Vive en su propio
// archivo a propósito: ReviewsTab ya opera en producción para CANE, Belange,
// Lukon y Enlace, y no vale la pena arriesgar esos cuatro tableros por una vista
// que hoy solo usa un café.
//
// Lee de review_responses / review_touchpoints vía RLS (user_has_access_to_client),
// así que el dueño ve solo lo suyo. No usa service role.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  Section as DSection,
  StatGrid,
  StatCard,
  Empty,
  Chip,
  type DashTheme,
} from "@/components/dashboard";

const U = {
  green: "#16A34A",
  yellow: "#CA8A04",
  red: "#DC2626",
  warnBg: "#FEF9C3",
  warnBorder: "#FDE68A",
  warnText: "#854D0E",
};

type Touchpoint = {
  id: string;
  slug: string;
  label: string;
  kind: string;
  active: boolean;
};

type Respuesta = {
  id: string;
  touchpoint_id: string | null;
  csat: number | null;
  comment: string | null;
  attribution: string | null;
  product_ref: string | null;
  contact_phone: string | null;
  consent: boolean;
  google_cta_shown: boolean;
  google_cta_clicked: boolean;
  outcome: string | null;
  handled: boolean;
  started_at: string;
  completed_at: string | null;
};

const KIND_LABEL: Record<string, string> = {
  mesa: "Mesa",
  mostrador: "Mostrador",
  empaque: "Empaque",
  ticket: "Ticket",
  sucursal: "Sucursal",
  otro: "Otro",
};

const CARITAS = ["", "\u{1F620}", "\u{1F615}", "\u{1F610}", "\u{1F642}", "\u{1F929}"];

function colorCsat(n: number | null): string {
  if (!n) return "#64748B";
  if (n >= 4) return U.green;
  if (n === 3) return U.yellow;
  return U.red;
}

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TouchpointsPanel({
  clientId,
  theme: T,
  baseUrl = "https://fishflow.mx",
}: {
  clientId: string;
  theme: DashTheme;
  baseUrl?: string;
}) {
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([]);
  const [respuestas, setRespuestas] = useState<Respuesta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<"todas" | "criticas" | "sin_atender">("todas");
  // Los comentarios del mostrador y los de la bolsa de café hablan de cosas
  // distintas: mezclarlos en una sola lista no le sirve al dueño.
  const [punto, setPunto] = useState<string>("todos");
  const [copiado, setCopiado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const [tp, rs] = await Promise.all([
      supabase
        .from("review_touchpoints")
        .select("id, slug, label, kind, active")
        .eq("client_id", clientId)
        .order("label"),
      supabase
        .from("review_responses")
        .select(
          "id, touchpoint_id, csat, comment, attribution, product_ref, contact_phone, consent, google_cta_shown, google_cta_clicked, outcome, handled, started_at, completed_at",
        )
        .eq("client_id", clientId)
        .gte("started_at", desde)
        .order("started_at", { ascending: false })
        .limit(1000),
    ]);
    if (tp.error) console.error("[touchpoints] tp:", tp.error);
    if (rs.error) console.error("[touchpoints] respuestas:", rs.error);
    setTouchpoints((tp.data as Touchpoint[]) ?? []);
    setRespuestas((rs.data as Respuesta[]) ?? []);
    setCargando(false);
  }, [clientId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Solo cuentan las completadas: una respuesta abandonada en la primera
  // pantalla ensuciaría el promedio.
  const completadas = useMemo(() => respuestas.filter((r) => r.completed_at), [respuestas]);

  const csatPromedio = useMemo(() => {
    const con = completadas.filter((r) => r.csat != null);
    if (!con.length) return null;
    return (con.reduce((s, r) => s + (r.csat ?? 0), 0) / con.length).toFixed(1);
  }, [completadas]);

  const clicsGoogle = completadas.filter((r) => r.google_cta_clicked).length;
  const contactos = completadas.filter((r) => r.consent && r.contact_phone).length;
  const criticas = completadas.filter((r) => (r.csat ?? 5) <= 2);
  const sinAtender = criticas.filter((r) => !r.handled);

  // Bitácora anti-gating: si alguna completada no tiene el CTA registrado, algo
  // se rompió en el flujo y hay que saberlo antes de que lo note Google.
  const sinCta = completadas.filter((r) => !r.google_cta_shown).length;

  const porTouchpoint = useMemo(() => {
    return touchpoints.map((tp) => {
      const mias = completadas.filter((r) => r.touchpoint_id === tp.id);
      const con = mias.filter((r) => r.csat != null);
      return {
        tp,
        total: mias.length,
        csat: con.length
          ? (con.reduce((s, r) => s + (r.csat ?? 0), 0) / con.length).toFixed(1)
          : null,
        clics: mias.filter((r) => r.google_cta_clicked).length,
      };
    });
  }, [touchpoints, completadas]);

  const porAtribucion = useMemo(() => {
    const m = new Map<string, number>();
    completadas.forEach((r) => {
      const k = r.attribution ?? "Sin responder";
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [completadas]);

  const totalAtrib = porAtribucion.reduce((s, [, n]) => s + n, 0);

  /** Qué mezclas se llevaron. Solo lo contesta quien escanea el QR de la bolsa. */
  const porMezcla = useMemo(() => {
    const m = new Map<string, { n: number; suma: number; con: number }>();
    completadas.filter((r) => r.product_ref).forEach((r) => {
      const k = r.product_ref!;
      const a = m.get(k) ?? { n: 0, suma: 0, con: 0 };
      a.n++;
      if (r.csat != null) { a.suma += r.csat; a.con++; }
      m.set(k, a);
    });
    return [...m.entries()]
      .map(([nombre, a]) => ({ nombre, n: a.n, csat: a.con ? (a.suma / a.con).toFixed(1) : null }))
      .sort((x, y) => y.n - x.n);
  }, [completadas]);

  const bandeja = useMemo(() => {
    let conTexto = completadas.filter((r) => r.comment?.trim());
    if (punto !== "todos") conTexto = conTexto.filter((r) => r.touchpoint_id === punto);
    if (filtro === "criticas") return conTexto.filter((r) => (r.csat ?? 5) <= 2);
    if (filtro === "sin_atender") return conTexto.filter((r) => (r.csat ?? 5) <= 2 && !r.handled);
    return conTexto;
  }, [completadas, filtro, punto]);

  /** Cuántos comentarios tiene cada punto, para rotular las pestañas. */
  const comentariosPorPunto = useMemo(() => {
    const m = new Map<string, number>();
    completadas.filter((r) => r.comment?.trim()).forEach((r) => {
      if (r.touchpoint_id) m.set(r.touchpoint_id, (m.get(r.touchpoint_id) ?? 0) + 1);
    });
    return m;
  }, [completadas]);

  const nombrePunto = useMemo(() => {
    const m = new Map(touchpoints.map((t) => [t.id, t.label]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [touchpoints]);

  async function marcarAtendido(id: string, valor: boolean) {
    setRespuestas((rs) =>
      rs.map((r) => (r.id === id ? { ...r, handled: valor } : r)),
    );
    const { error } = await supabase
      .from("review_responses")
      .update({ handled: valor, handled_at: valor ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) {
      console.error("[touchpoints] marcar atendido:", error);
      void cargar(); // revertir al estado real
    }
  }

  async function copiar(slug: string) {
    try {
      await navigator.clipboard.writeText(`${baseUrl}/o/${slug}`);
      setCopiado(slug);
      setTimeout(() => setCopiado(null), 1800);
    } catch {
      /* el navegador puede negar el portapapeles sin gesto; no es crítico */
    }
  }

  if (cargando) {
    return <div style={{ padding: 24, color: T.muted, fontSize: 14 }}>Cargando el canal QR…</div>;
  }

  return (
    <>
      {/* Grid propio: el .rv-grid de ReviewsTab solo se monta cuando showVendors
          está activo, así que aquí no existiría. */}
      <style>{`
        .tp-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
        @media (max-width: 600px) { .tp-grid { grid-template-columns: 1fr; } }
      `}</style>

      <StatGrid>
        <StatCard
          theme={T}
          icon="⭐"
          label="Calificación promedio (30 días)"
          value={csatPromedio ?? "—"}
          sub={`${completadas.length} respuesta${completadas.length !== 1 ? "s" : ""}`}
          accent={csatPromedio ? colorCsat(Math.round(Number(csatPromedio))) : undefined}
        />
        <StatCard theme={T} icon="🔗" label="Clics a Google" value={clicsGoogle} />
        <StatCard
          theme={T}
          icon="📱"
          label="Contactos nuevos"
          value={contactos}
          sub="Con consentimiento"
          accent={U.green}
        />
        <StatCard
          theme={T}
          icon="🚨"
          label="Críticas sin atender"
          value={sinAtender.length}
          accent={sinAtender.length ? U.red : undefined}
        />
      </StatGrid>

      {sinCta > 0 && (
        <div
          style={{
            background: U.warnBg,
            border: `1px solid ${U.warnBorder}`,
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: U.warnText,
            marginBottom: 16,
          }}
        >
          ⚠️ {sinCta} respuesta{sinCta !== 1 ? "s" : ""} sin registro de que se mostró el botón de
          Google. El botón debe aparecer siempre, con cualquier calificación — avísale a FishFlow.
        </div>
      )}

      {/* ── Puntos de contacto ─────────────────────────────────────────────── */}
      <DSection theme={T} title={`Puntos de contacto (${touchpoints.length})`}>
        <p
          style={{
            fontSize: 12.5,
            color: T.muted,
            marginTop: 0,
            marginBottom: 14,
            lineHeight: 1.55,
          }}
        >
          Cada QR tiene su propio enlace. Así sabes si el problema es el mostrador o el turno,
          no solo &quot;el negocio&quot;.
        </p>

        {touchpoints.length === 0 ? (
          <Empty msg="Todavía no hay puntos de contacto dados de alta." theme={T} />
        ) : (
          <div className="tp-grid">
            {porTouchpoint.map(({ tp, total, csat, clics }) => (
              <div
                key={tp.id}
                style={{
                  border: `1px solid ${T.border}`,
                  borderRadius: 12,
                  background: T.surface,
                  padding: 14,
                  opacity: tp.active ? 1 : 0.55,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: T.text,
                      flex: 1,
                      minWidth: 0,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {tp.label}
                  </div>
                  <Chip label={KIND_LABEL[tp.kind] ?? tp.kind} bg={T.accentSoft} fg={T.accentDark} />
                </div>

                <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.8, marginBottom: 10 }}>
                  <div>
                    ⭐{" "}
                    <b style={{ color: colorCsat(csat ? Math.round(Number(csat)) : null) }}>
                      {csat ?? "—"}
                    </b>{" "}
                    · {total} respuesta{total !== 1 ? "s" : ""} · {clics} clic
                    {clics !== 1 ? "s" : ""} a Google
                  </div>
                </div>

                <div
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 11.5,
                    color: T.muted,
                    background: T.panel ?? T.bg,
                    borderRadius: 7,
                    padding: "7px 9px",
                    marginBottom: 8,
                    overflowWrap: "anywhere",
                  }}
                >
                  {baseUrl.replace(/^https?:\/\//, "")}/o/{tp.slug}
                </div>

                <button
                  onClick={() => void copiar(tp.slug)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${T.border}`,
                    background: "#fff",
                    color: T.text,
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {copiado === tp.slug ? "Copiado ✓" : "Copiar enlace"}
                </button>
              </div>
            ))}
          </div>
        )}
      </DSection>

      {/* ── Atribución ─────────────────────────────────────────────────────── */}
      <DSection theme={T} title="Cómo llegaron">
        <p
          style={{
            fontSize: 12.5,
            color: T.muted,
            marginTop: 0,
            marginBottom: 14,
            lineHeight: 1.55,
          }}
        >
          La única pregunta de la encuesta que te dice dónde vale la pena poner el dinero.
        </p>

        {totalAtrib === 0 ? (
          <Empty msg="Sin respuestas todavía." theme={T} />
        ) : (
          <div style={{ display: "grid", gap: 9 }}>
            {porAtribucion.map(([etiqueta, n]) => {
              const pct = Math.round((n / totalAtrib) * 100);
              return (
                <div key={etiqueta}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 13,
                      marginBottom: 4,
                      gap: 10,
                    }}
                  >
                    <span style={{ color: T.text, fontWeight: 600 }}>{etiqueta}</span>
                    <span style={{ color: T.muted, whiteSpace: "nowrap" }}>
                      {n} · {pct}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: 7,
                      borderRadius: 999,
                      background: T.border,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: etiqueta === "Sin responder" ? T.muted : T.accent,
                        transition: "width .3s",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DSection>

      {/* ── Mezclas ────────────────────────────────────────────────────────── */}
      {porMezcla.length > 0 && (
        <DSection theme={T} title="Mezclas que se llevaron">
          <p style={{ fontSize: 12.5, color: T.muted, marginTop: 0, marginBottom: 14, lineHeight: 1.55 }}>
            Viene del QR de la bolsa. Dice qué café seguir trayendo y, más adelante,
            a quién escribirle cuando se le esté acabando.
          </p>
          <div style={{ display: "grid", gap: 9 }}>
            {porMezcla.map((m) => (
              <div key={m.nombre} style={{
                display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center",
                padding: "11px 13px", background: T.panel ?? T.bg, borderRadius: 10,
              }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{m.nombre}</span>
                <span style={{ fontSize: 12.5, color: T.muted, whiteSpace: "nowrap" }}>
                  {m.n} · <b style={{ color: colorCsat(m.csat ? Math.round(Number(m.csat)) : null) }}>
                    {m.csat ?? "—"}
                  </b>
                </span>
              </div>
            ))}
          </div>
        </DSection>
      )}

      {/* ── Bandeja de comentarios ─────────────────────────────────────────── */}
      <DSection theme={T} title={`Comentarios (${bandeja.length})`}>
        {touchpoints.length > 1 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {[{ id: "todos", label: "Todos los puntos" }, ...touchpoints].map((t) => {
              const n = t.id === "todos"
                ? [...comentariosPorPunto.values()].reduce((a, b) => a + b, 0)
                : comentariosPorPunto.get(t.id) ?? 0;
              const activo = punto === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setPunto(t.id)}
                  style={{
                    padding: "8px 14px", borderRadius: 9,
                    border: `1px solid ${activo ? T.accent : T.border}`,
                    background: activo ? T.accentSoft : "#fff",
                    color: activo ? T.accentDark : T.muted,
                    fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {t.label} ({n})
                </button>
              );
            })}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {(
            [
              ["todas", "Todos"],
              ["criticas", `Críticas (${criticas.length})`],
              ["sin_atender", `Sin atender (${sinAtender.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFiltro(k)}
              style={{
                padding: "7px 13px",
                borderRadius: 999,
                border: `1px solid ${filtro === k ? T.accent : T.border}`,
                background: filtro === k ? T.accent : "#fff",
                color: filtro === k ? "#fff" : T.muted,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {bandeja.length === 0 ? (
          <Empty msg="Nada por aquí todavía." theme={T} />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {bandeja.map((r) => {
              const critica = (r.csat ?? 5) <= 2;
              return (
                <div
                  key={r.id}
                  style={{
                    border: `1px solid ${critica && !r.handled ? U.red : T.border}`,
                    borderRadius: 12,
                    background: T.surface,
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 9,
                      marginBottom: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 20 }}>{CARITAS[r.csat ?? 0] ?? ""}</span>
                    <b style={{ color: colorCsat(r.csat), fontSize: 14 }}>{r.csat ?? "—"}/5</b>
                    <span style={{ fontSize: 12, color: T.muted }}>{fechaCorta(r.started_at)}</span>
                    {punto === "todos" && nombrePunto(r.touchpoint_id) && (
                      <Chip label={nombrePunto(r.touchpoint_id)!} bg={T.border} fg={T.text} />
                    )}
                    {r.product_ref && (
                      <Chip label={`Mezcla: ${r.product_ref}`} bg="#FBEEE0" fg="#8A4E13" />
                    )}
                    {r.attribution && (
                      <Chip label={r.attribution} bg={T.accentSoft} fg={T.accentDark} />
                    )}
                    {r.outcome === "google" && <Chip label="Fue a Google" bg="#DCFCE7" fg="#166534" />}
                  </div>

                  <div
                    style={{
                      fontSize: 14,
                      color: T.text,
                      lineHeight: 1.55,
                      marginBottom: 10,
                      overflowWrap: "anywhere",
                    }}
                  >
                    &ldquo;{r.comment}&rdquo;
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      flexWrap: "wrap",
                      fontSize: 12.5,
                    }}
                  >
                    {r.contact_phone && r.consent ? (
                      <a
                        href={`https://wa.me/${r.contact_phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: U.green, fontWeight: 700, textDecoration: "none" }}
                      >
                        Escribir por WhatsApp →
                      </a>
                    ) : (
                      <span style={{ color: T.muted }}>Sin contacto</span>
                    )}

                    {critica && (
                      <button
                        onClick={() => void marcarAtendido(r.id, !r.handled)}
                        style={{
                          marginLeft: "auto",
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: `1px solid ${r.handled ? T.border : U.green}`,
                          background: r.handled ? "#fff" : U.green,
                          color: r.handled ? T.muted : "#fff",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {r.handled ? "Atendido ✓" : "Marcar atendido"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DSection>
    </>
  );
}
