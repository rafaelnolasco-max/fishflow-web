"use client";

/**
 * Vista "Publicadas": el historial de lo que ya salió, con sus números.
 *
 * Qué NO es: un tablero de analítica en vivo. Blotato mide en checkpoints fijos
 * contados desde que el post se publica —en el plan Starter, al día 1 y al día
 * 7— y sus endpoints devuelven la última foto tomada, nunca un dato del momento.
 * Por eso cada tarjeta lleva su "medido el …": sin esa fecha, un número de hace
 * tres semanas se lee como si fuera de hoy, y eso es peor que no poner número.
 *
 * Tampoco se pintan cajas en cero de métricas que la red no reportó. Cada
 * plataforma llena unos campos distintos según el tipo de publicación; el
 * servidor manda solo las que vinieron con dato y aquí se dibuja lo que llegue.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Section, Empty, Chip, StatGrid, StatCard, type DashTheme } from "@/components/dashboard";
import { formatCdmx } from "@/lib/socialTargets";

type Metric = { key: string; label: string; value: number };

type PublishedPost = {
  id: string;
  platform: string;
  targetLabel: string | null;
  postUrl: string | null;
  text: string;
  mediaUrls: string[];
  publishedAt: string;
  metrics: Metric[];
  metricsFetchedAt: string | null;
};

const NOMBRE_RED: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
};

/** Fecha corta y legible: "18 de agosto". El año solo si no es el actual. */
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  const esteAno = d.getUTCFullYear() === new Date().getUTCFullYear();
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    ...(esteAno ? {} : { year: "numeric" }),
    timeZone: "America/Mexico_City",
  }).format(d);
}

function preview(texto: string, max = 200): string {
  const limpio = texto.replace(/\s*\n\s*\n\s*/g, "\n").trim();
  return limpio.length > max ? `${limpio.slice(0, max).trimEnd()}…` : limpio;
}

export default function PublishedList({
  clientId, theme: t,
}: {
  clientId: string;
  theme: DashTheme;
}) {
  const [posts, setPosts] = useState<PublishedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forzar = false) => {
    if (forzar) setRefrescando(true);
    try {
      const res = await fetch(
        `/api/content/published?clientId=${encodeURIComponent(clientId)}${forzar ? "&sync=1" : ""}`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "No se pudo cargar tu historial.");
      setPosts(json.posts ?? []);
      setError(null);
    } catch (e: unknown) {
      console.error("[PublishedList] load error:", e);
      setError(e instanceof Error ? e.message : "No se pudo cargar tu historial.");
    } finally {
      setLoading(false);
      setRefrescando(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const resumen = useMemo(() => {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const delMes = posts.filter((p) => new Date(p.publishedAt) >= inicioMes);

    // Vistas del mes, sumando solo lo que tiene medición. Si nadie la tiene
    // todavía, la tarjeta dice "—" en vez de un cero que parece un fracaso.
    let vistas = 0;
    let conVistas = 0;
    for (const p of delMes) {
      const v = p.metrics.find((m) => m.key === "viewsCount");
      if (v) { vistas += v.value; conVistas++; }
    }

    const comentarios = posts.reduce((acc, p) => {
      const c = p.metrics.find((m) => m.key === "commentsCount");
      return acc + (c?.value ?? 0);
    }, 0);

    return {
      total: posts.length,
      mes: delMes.length,
      vistas: conVistas > 0 ? vistas : null,
      comentarios,
    };
  }, [posts]);

  if (loading) return <Empty msg="Cargando tu historial…" theme={t} />;

  const nombreMes = new Intl.DateTimeFormat("es-MX", {
    month: "long", timeZone: "America/Mexico_City",
  }).format(new Date());

  return (
    <>
      <StatGrid>
        <StatCard theme={t} label="Publicadas en total" value={resumen.total} icon="📣" accent={t.accent} />
        <StatCard theme={t} label={`Publicadas en ${nombreMes}`} value={resumen.mes} icon="🗓️" />
        <StatCard
          theme={t}
          label={`Vistas en ${nombreMes}`}
          value={resumen.vistas === null ? "—" : resumen.vistas.toLocaleString("es-MX")}
          icon="👀"
          sub={resumen.vistas === null ? "Todavía sin medición" : undefined}
        />
        <StatCard
          theme={t}
          label="Comentarios recibidos"
          value={resumen.comentarios}
          icon="💬"
          sub={resumen.comentarios > 0 ? "Vale la pena contestarlos" : undefined}
        />
      </StatGrid>

      {error && (
        <div style={{
          background: "#FEF2F2", border: `1px solid ${t.danger}`, color: t.danger,
          borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16, lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      <Section
        title="Lo que ya se publicó"
        theme={t}
        action={{
          label: refrescando ? "Actualizando…" : "↻ Actualizar",
          onClick: () => { if (!refrescando) load(true); },
        }}
      >
        {posts.length === 0 ? (
          <Empty
            msg="Todavía no hay publicaciones en tu historial. En cuanto salga la primera, aparece aquí con sus números."
            theme={t}
          />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {posts.map((post) => (
              <article
                key={post.id}
                style={{
                  background: t.surface, border: `1px solid ${t.border}`,
                  borderRadius: 14, padding: 14,
                  display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap",
                }}
              >
                {/* Portada. En un carrusel es la primera lámina. */}
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
                    <Chip label={`✅ ${fechaCorta(post.publishedAt)}`} bg={t.accentSoft} fg={t.accentDark} />
                    <Chip
                      label={[NOMBRE_RED[post.platform] ?? post.platform, post.targetLabel]
                        .filter(Boolean)
                        .join(" · ")}
                      bg="#F9FAFB"
                      fg={t.muted}
                    />
                  </div>

                  {post.text && (
                    <div style={{
                      fontSize: 13.5, color: t.text, lineHeight: 1.6,
                      whiteSpace: "pre-wrap", marginBottom: 10,
                    }}>
                      {preview(post.text)}
                    </div>
                  )}

                  {/* Los números. Solo los que la red reportó. */}
                  {post.metrics.length > 0 ? (
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
                      {post.metrics.map((m) => (
                        <div key={m.key}>
                          <div style={{
                            fontSize: 18, fontWeight: 800, color: t.text, lineHeight: 1.2,
                          }}>
                            {m.value.toLocaleString("es-MX")}
                          </div>
                          <div style={{ fontSize: 11, color: t.muted }}>{m.label}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: t.muted, marginBottom: 8, lineHeight: 1.5 }}>
                      {/* Ni error ni cero: todavía no le toca. La primera medición
                          llega al día siguiente de publicar. */}
                      Los números aparecen al día siguiente de publicar.
                    </div>
                  )}

                  <div style={{
                    display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center",
                    fontSize: 11.5, color: t.muted,
                  }}>
                    {post.metricsFetchedAt && (
                      <span>Medido el {formatCdmx(post.metricsFetchedAt)}</span>
                    )}
                    {post.postUrl && (
                      <a
                        href={post.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: t.accentDark, textDecoration: "none", fontWeight: 600 }}
                      >
                        Ver publicación ↗
                      </a>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>

      <p style={{
        fontSize: 11.5, color: t.muted, lineHeight: 1.6, marginTop: 18, maxWidth: 620,
      }}>
        Los números no son en vivo: la red social los mide un día después de que
        publicas y otra vez a la semana. Después de esa segunda medición ya no
        cambian.
      </p>
    </>
  );
}
