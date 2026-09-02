"use client";

/**
 * La evaluación, aplicada DENTRO del programa.
 *
 * Es el mismo instrumento del sitio público (lib/instrumentoCriterio.ts, extraído
 * del HTML que ya corre), pero aquí se aplica varias veces: al empezar, a la
 * mitad y al cerrar. El `milestone` lo decide el servidor según el paso, no esta
 * pantalla.
 *
 * Un reactivo a la vez, a propósito: son 30 y en una sola lista la gente
 * abandona. Se puede regresar sin perder lo contestado.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { DIMENSIONES, ESCALA, REACTIVOS } from "@/lib/instrumentoCriterio";
import Dumbbell, { type Medicion } from "@/components/programa/Dumbbell";

const C = {
  ink: "#0F1A24", ink2: "#283845", paper: "#F4F7FA", paper2: "#E7EEF4", white: "#FFFFFF",
  blue: "#3E86CF", blueDeep: "#2A6AAE", blueSoft: "#E8F0F9", muted: "#7B8794", rule: "#DCE4EC",
};
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const BODY = '"Inter", system-ui, sans-serif';
const FONTS =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

const CORTAS: Record<string, string> = Object.fromEntries(
  DIMENSIONES.map((d) => [d.nombre, d.corta]),
);

export default function EvaluacionPage() {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [cur, setCur] = useState(0);
  const [resp, setResp] = useState<number[]>(() => new Array(REACTIVOS.length).fill(0));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [mediciones, setMediciones] = useState<Medicion[]>([]);
  const [terminada, setTerminada] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.push("/login?next=/programa/evaluacion"); return; }
      setListo(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enviar() {
    setEnviando(true); setError("");
    try {
      const r = await fetch("/api/programa/evaluacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respuestas: resp }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo guardar tu evaluación."); return; }
      const g = await fetch("/api/programa/evaluacion");
      const gj = await g.json();
      setMediciones((gj.mediciones ?? []) as Medicion[]);
      setTerminada(true);
    } finally {
      setEnviando(false);
    }
  }

  if (!listo) return <Marco><p style={{ color: C.muted }}>Un momento…</p></Marco>;

  if (terminada) {
    const ult = mediciones[mediciones.length - 1];
    const primera = mediciones[0];
    const hayComparacion = mediciones.length >= 2 && primera && ult;
    return (
      <Marco>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".24em",
          textTransform: "uppercase", color: C.blueDeep }}>Tu resultado</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: "clamp(22px,4vw,30px)",
          lineHeight: 1.2, margin: "12px 0 8px" }}>
          {ult?.total_score != null ? "Listo, quedó registrado" : "Gracias"}
        </h1>
        <p style={{ fontSize: 14.5, color: C.ink2, lineHeight: 1.65, maxWidth: "62ch" }}>
          {hayComparacion
            ? "Esta es la comparación entre cómo estabas al empezar y cómo estás ahora, dimensión por dimensión."
            : "Esta es tu medición de arranque. Cuando la vuelvas a contestar más adelante en el proceso, vas a poder ver aquí mismo qué se movió."}
        </p>

        <div style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 12,
          padding: 20, marginTop: 20 }}>
          {hayComparacion ? (
            <Dumbbell antes={primera} ahora={ult} cortas={CORTAS} />
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {Object.entries(ult?.dimensions ?? {}).map(([n, d]) => (
                <div key={n}>
                  <div style={{ display: "flex", justifyContent: "space-between",
                    fontSize: 13, marginBottom: 5 }}>
                    <span style={{ color: C.ink }}>{CORTAS[n] ?? n}</span>
                    <span style={{ fontFamily: MONO, color: C.muted }}>{d.score}/{d.max}</span>
                  </div>
                  <div style={{ height: 6, background: C.paper2, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${(d.score / d.max) * 100}%`, height: "100%", background: C.blue }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => router.push("/programa")}
          style={{ marginTop: 22, background: C.blue, color: "#fff", border: "none", borderRadius: 10,
            padding: "12px 22px", fontSize: 14.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          Continuar con mi programa
        </button>
      </Marco>
    );
  }

  const enCaptura = cur < REACTIVOS.length;
  const reactivo = REACTIVOS[cur];
  const contestados = resp.filter((v) => v > 0).length;

  return (
    <Marco>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".24em",
        textTransform: "uppercase", color: C.blueDeep }}>Evaluación</div>
      <h1 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: "clamp(20px,3.6vw,26px)",
        lineHeight: 1.25, margin: "10px 0 4px" }}>
        Arquitectura Mental y del Criterio
      </h1>
      <p style={{ fontSize: 13.5, color: C.muted, margin: "0 0 20px" }}>
        No hay respuestas correctas. Contesta con lo que haces normalmente, no con lo que te gustaría hacer.
      </p>

      <div style={{ height: 5, background: C.paper2, borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
        <div style={{ width: `${(contestados / REACTIVOS.length) * 100}%`, height: "100%",
          background: C.blue, transition: "width .2s" }} />
      </div>
      <div style={{ fontFamily: MONO, fontSize: 11, color: C.muted, marginBottom: 20 }}>
        {Math.min(cur + 1, REACTIVOS.length)} de {REACTIVOS.length}
      </div>

      {enCaptura ? (
        <div style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 12, padding: 22 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".2em",
            textTransform: "uppercase", color: C.muted, marginBottom: 10 }}>
            {CORTAS[reactivo.dimension] ?? reactivo.dimension}
          </div>
          <p style={{ fontFamily: SERIF, fontSize: 19, lineHeight: 1.4, color: C.ink, margin: "0 0 20px" }}>
            {reactivo.texto}
          </p>

          <div style={{ display: "grid", gap: 8 }}>
            {ESCALA.map((op, i) => {
              const val = i + 1;
              const activo = resp[cur] === val;
              return (
                <button key={op}
                  onClick={() => {
                    const n = [...resp]; n[cur] = val; setResp(n);
                    setTimeout(() => setCur((c) => c + 1), 140);
                  }}
                  style={{ textAlign: "left", padding: "13px 16px", borderRadius: 9,
                    border: `1px solid ${activo ? C.blue : C.rule}`,
                    background: activo ? C.blueSoft : C.white,
                    color: activo ? C.blueDeep : C.ink2, fontSize: 15, fontFamily: "inherit",
                    fontWeight: activo ? 600 : 400, cursor: "pointer" }}>
                  {op}
                </button>
              );
            })}
          </div>

          {cur > 0 && (
            <button onClick={() => setCur((c) => Math.max(0, c - 1))}
              style={{ marginTop: 16, background: "transparent", border: "none", color: C.muted,
                fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
              ← Regresar
            </button>
          )}
        </div>
      ) : (
        <div style={{ background: C.white, border: `1px solid ${C.rule}`, borderRadius: 12, padding: 22 }}>
          <p style={{ fontSize: 15.5, color: C.ink2, lineHeight: 1.65, margin: "0 0 16px" }}>
            Contestaste las {REACTIVOS.length}. Al guardar queda registrada como tu medición
            de este momento del proceso.
          </p>
          {error && <p style={{ fontSize: 13.5, color: "#C0392B", margin: "0 0 14px" }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={enviar} disabled={enviando}
              style={{ background: enviando ? C.muted : C.blue, color: "#fff", border: "none",
                borderRadius: 10, padding: "12px 22px", fontSize: 14.5, fontWeight: 600,
                cursor: enviando ? "default" : "pointer", fontFamily: "inherit" }}>
              {enviando ? "Guardando…" : "Guardar mi evaluación"}
            </button>
            <button onClick={() => setCur(REACTIVOS.length - 1)}
              style={{ background: "transparent", border: `1px solid ${C.rule}`, color: C.ink2,
                borderRadius: 10, padding: "12px 18px", fontSize: 14, cursor: "pointer",
                fontFamily: "inherit" }}>
              Revisar la última
            </button>
          </div>
        </div>
      )}
    </Marco>
  );
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: BODY }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href={FONTS} />
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "28px 18px 60px" }}>{children}</div>
    </div>
  );
}
