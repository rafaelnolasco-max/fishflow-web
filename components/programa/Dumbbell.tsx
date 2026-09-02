"use client";

/**
 * Comparación de las 6 dimensiones entre dos mediciones.
 *
 * ⚠️ Es un DUMBBELL, no un radar, y fue una decisión deliberada. El trabajo que
 * tiene que hacer quien lo ve es "antes → después por dimensión", y para eso la
 * forma correcta es un dumbbell: cada dimensión es un renglón, dos puntos y la
 * distancia entre ellos ES el cambio. Un radar se ve más vistoso y miente más:
 * el área crece con el cuadrado del valor, el orden de los ejes sugiere una
 * vecindad entre dimensiones que no existe, y comparar dos polígonos encimados
 * es justo lo que el ojo hace peor.
 *
 * Color: un solo tono en dos pasos (#3E86CF → #14375A, los azules de Mario).
 * Validados con el script de la guía contra el fondo #F4F7FA: separación CVD
 * 27.8, visión normal 28.4 y contraste ≥3:1 los dos. Además van etiquetados
 * directo, así que la identidad nunca depende del color solo.
 */

export type Medicion = {
  taken_at: string;
  total_score: number | null;
  dimensions: Record<string, { score: number; max: number }> | null;
};

const ANTES = "#3E86CF";
const AHORA = "#14375A";
const RULE = "#DCE4EC";
const MUTED = "#7B8794";
const INK = "#0F1A24";
const MONO = '"JetBrains Mono", ui-monospace, monospace';

function fecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export default function Dumbbell({
  antes, ahora, cortas,
}: {
  antes: Medicion;
  ahora: Medicion;
  /** nombre largo → etiqueta corta */
  cortas: Record<string, string>;
}) {
  const nombres = Object.keys(ahora.dimensions ?? {});
  if (!nombres.length) return null;

  const max = Math.max(
    ...nombres.map((n) => ahora.dimensions?.[n]?.max ?? 25),
    ...nombres.map((n) => antes.dimensions?.[n]?.max ?? 25),
  );

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center",
        fontSize: 12.5, color: MUTED, marginBottom: 14 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: ANTES,
            boxShadow: "0 0 0 2px #F4F7FA" }} />
          Al empezar · {fecha(antes.taken_at)}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: AHORA,
            boxShadow: "0 0 0 2px #F4F7FA" }} />
          Ahora · {fecha(ahora.taken_at)}
        </span>
      </figcaption>

      <div style={{ display: "grid", gap: 14 }}>
        {nombres.map((n) => {
          const a = antes.dimensions?.[n]?.score ?? null;
          const b = ahora.dimensions?.[n]?.score ?? null;
          if (b == null) return null;
          const pa = a == null ? null : (a / max) * 100;
          const pb = (b / max) * 100;
          const delta = a == null ? null : b - a;

          return (
            <div key={n}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                marginBottom: 6, gap: 10 }}>
                <span style={{ fontSize: 13, color: INK }} title={n}>{cortas[n] ?? n}</span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: MUTED }}>
                  {a != null ? `${a} → ` : ""}<span style={{ color: INK }}>{b}</span>
                  <span style={{ color: MUTED }}>/{max}</span>
                  {delta != null && delta !== 0 && (
                    <span style={{ color: delta > 0 ? AHORA : "#B96A1E", marginLeft: 7 }}>
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  )}
                </span>
              </div>

              <div style={{ position: "relative", height: 14 }}>
                {/* Riel: el rango completo de la dimensión, recesivo */}
                <div style={{ position: "absolute", top: 6, left: 0, right: 0, height: 2,
                  background: RULE, borderRadius: 1 }} />
                {/* El tramo recorrido entre las dos mediciones */}
                {pa != null && (
                  <div style={{ position: "absolute", top: 6, height: 2, borderRadius: 1,
                    background: AHORA, opacity: 0.35,
                    left: `${Math.min(pa, pb)}%`, width: `${Math.abs(pb - pa)}%` }} />
                )}
                {pa != null && (
                  <span style={{ position: "absolute", top: 1, left: `calc(${pa}% - 6px)`,
                    width: 12, height: 12, borderRadius: "50%", background: ANTES,
                    boxShadow: "0 0 0 2px #FFFFFF" }} />
                )}
                <span style={{ position: "absolute", top: 1, left: `calc(${pb}% - 6px)`,
                  width: 12, height: 12, borderRadius: "50%", background: AHORA,
                  boxShadow: "0 0 0 2px #FFFFFF" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* La tabla no es un extra: es el respaldo accesible de la gráfica. */}
      <details style={{ marginTop: 16 }}>
        <summary style={{ fontSize: 12.5, color: MUTED, cursor: "pointer" }}>Ver los números</summary>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: MUTED, fontSize: 11.5 }}>
              <th style={{ padding: "4px 0", fontWeight: 500 }}>Dimensión</th>
              <th style={{ padding: "4px 0", fontWeight: 500 }}>Al empezar</th>
              <th style={{ padding: "4px 0", fontWeight: 500 }}>Ahora</th>
              <th style={{ padding: "4px 0", fontWeight: 500 }}>Cambio</th>
            </tr>
          </thead>
          <tbody>
            {nombres.map((n) => {
              const a = antes.dimensions?.[n]?.score ?? null;
              const b = ahora.dimensions?.[n]?.score ?? null;
              const d = a != null && b != null ? b - a : null;
              return (
                <tr key={n} style={{ borderTop: `1px solid ${RULE}` }}>
                  <td style={{ padding: "6px 0", color: INK }}>{cortas[n] ?? n}</td>
                  <td style={{ padding: "6px 0", fontFamily: MONO }}>{a ?? "—"}</td>
                  <td style={{ padding: "6px 0", fontFamily: MONO }}>{b ?? "—"}</td>
                  <td style={{ padding: "6px 0", fontFamily: MONO }}>
                    {d == null ? "—" : d > 0 ? `+${d}` : d}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
