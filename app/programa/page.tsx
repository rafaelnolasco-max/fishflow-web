"use client";

/**
 * La app de la persona inscrita al programa.
 *
 * Todo lo que se pinta aquí viene de /api/programa/paso: el navegador NUNCA
 * consulta las tablas del motor directo, porque la persona no tiene acceso al
 * cliente — ver lib/programa.ts.
 *
 * Identidad visual de Mario, no de FishFlow: esto lo ve su público.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const C = {
  ink: "#0F1A24", ink2: "#283845", paper: "#F4F7FA", paper2: "#E7EEF4", white: "#FFFFFF",
  blue: "#3E86CF", blueDeep: "#2A6AAE", blueSoft: "#E8F0F9", muted: "#7B8794",
  rule: "#DCE4EC", green: "#4B9A62", amber: "#B96A1E",
};
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const BODY = '"Inter", system-ui, sans-serif';
const FONTS =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

type Avance = {
  step_number: number; status: string; started_at: string | null;
  completed_at: string | null; reflection: string | null;
  session_ids: string[] | null; therapist_note: string | null;
};
type Paso = {
  step_number: number; title: string; objective: string | null;
  content_md: string | null; exercise_md: string | null; completion_criteria: string | null;
};
type Sesion = {
  id: string; session_number: number | null; session_date: string | null;
  session_title: string | null; patient_summary: string | null;
};
type Datos = {
  inscripcion: { id: string; status: string; current_step: number } | null;
  programa: { name: string; subtitle: string | null; steps_count: number; step_approval_required: boolean } | null;
  avance: Avance[]; pasos: Paso[]; sesiones: Sesion[];
};

type Tab = "paso" | "proceso" | "cuenta";

/** Markdown mínimo: párrafos, viñetas y **negritas**. No hace falta más. */
function Texto({ md }: { md: string }) {
  const bloques = md.split(/\n{2,}/).filter((b) => b.trim());
  return (
    <>
      {bloques.map((b, i) => {
        const lineas = b.split("\n").map((l) => l.trim()).filter(Boolean);
        const esLista = lineas.every((l) => /^[-*•]\s+/.test(l));
        if (esLista) {
          return (
            <ul key={i} style={{ margin: "0 0 12px", paddingLeft: 20, lineHeight: 1.7 }}>
              {lineas.map((l, j) => <li key={j} style={{ marginBottom: 4 }}>{negritas(l.replace(/^[-*•]\s+/, ""))}</li>)}
            </ul>
          );
        }
        return <p key={i} style={{ margin: "0 0 12px", lineHeight: 1.7 }}>{negritas(b)}</p>;
      })}
    </>
  );
}
function negritas(t: string) {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>);
}

export default function ProgramaPage() {
  const router = useRouter();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState<Tab>("paso");
  const [reflexion, setReflexion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [correo, setCorreo] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.push("/login?next=/programa"); return; }
      setCorreo(data.session.user.email ?? "");
      await cargar();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    setCargando(true);
    try {
      const r = await fetch("/api/programa/paso");
      const j = await r.json();
      if (r.ok) {
        setDatos(j as Datos);
        const actual = (j as Datos).inscripcion?.current_step ?? 0;
        const reng = ((j as Datos).avance ?? []).find((a) => a.step_number === actual);
        setReflexion(reng?.reflection ?? "");
      }
    } finally {
      setCargando(false);
    }
  }

  const actual = datos?.inscripcion?.current_step ?? 0;
  const pasoActual = useMemo(() => datos?.pasos.find((p) => p.step_number === actual) ?? null, [datos, actual]);
  const rengActual = useMemo(() => datos?.avance.find((a) => a.step_number === actual) ?? null, [datos, actual]);
  const total = datos?.programa?.steps_count ?? 0;
  const completados = (datos?.avance ?? []).filter((a) => a.status === "completado").length;

  async function guardarReflexion(cerrar: boolean) {
    if (!datos?.inscripcion) return;
    cerrar ? setCerrando(true) : setGuardando(true);
    setAviso("");
    try {
      const r = await fetch("/api/programa/paso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_number: actual, reflection: reflexion, cerrar }),
      });
      const j = await r.json();
      if (!r.ok) { setAviso(j.error ?? "No se pudo guardar."); return; }
      if (cerrar) {
        if (j.programaCompletado) setAviso("Terminaste el programa.");
        else if (j.esperaAprobacion) setAviso("Paso cerrado. Mario lo va a revisar antes de abrir el siguiente.");
        await cargar();
      } else {
        setAviso("Guardado.");
        setTimeout(() => setAviso(""), 2200);
      }
    } finally {
      setGuardando(false); setCerrando(false);
    }
  }

  async function salir() {
    await supabase.auth.signOut();
    router.push("/login?next=/programa");
  }

  const card: React.CSSProperties = {
    background: C.white, border: `1px solid ${C.rule}`, borderRadius: 12, padding: 20,
  };

  if (cargando) {
    return <Marco><p style={{ color: C.muted }}>Cargando tu proceso…</p></Marco>;
  }

  // Sesión válida pero sin inscripción: no es un error, es alguien que aún no acepta.
  if (!datos?.inscripcion) {
    return (
      <Marco>
        <div style={card}>
          <h1 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 24, margin: "0 0 10px" }}>
            Todavía no tienes un programa activo
          </h1>
          <p style={{ fontSize: 14.5, color: C.ink2, lineHeight: 1.65, margin: 0 }}>
            Si Mario te mandó una invitación, ábrela desde ese link para activar tu proceso.
          </p>
          <button onClick={salir} style={{ marginTop: 18, background: "transparent", color: C.muted,
            border: `1px solid ${C.rule}`, borderRadius: 9, padding: "9px 16px", fontSize: 13,
            cursor: "pointer", fontFamily: "inherit" }}>Salir</button>
        </div>
      </Marco>
    );
  }

  return (
    <Marco>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".24em",
          textTransform: "uppercase", color: C.blueDeep }}>Mi programa</div>
        <h1 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: "clamp(22px,4vw,30px)",
          lineHeight: 1.2, margin: "10px 0 0" }}>{datos.programa?.name ?? "Mi proceso"}</h1>

        <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px", minWidth: 140, height: 6, background: C.paper2,
            borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${total ? (completados / total) * 100 : 0}%`, height: "100%",
              background: C.blue }} />
          </div>
          <span style={{ fontFamily: MONO, fontSize: 12, color: C.ink2 }}>
            {completados} de {total} pasos
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        {([["paso", "Mi paso"], ["proceso", "Mi proceso"], ["cuenta", "Cuenta"]] as [Tab, string][])
          .map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ background: tab === id ? C.blueDeep : C.white, color: tab === id ? "#fff" : C.ink2,
                border: `1px solid ${tab === id ? C.blueDeep : C.rule}`, borderRadius: 999,
                padding: "8px 16px", fontSize: 13.5, fontWeight: tab === id ? 600 : 500,
                cursor: "pointer", fontFamily: "inherit" }}>{label}</button>
          ))}
      </div>

      {tab === "paso" && (
        <div style={card}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".2em",
            textTransform: "uppercase", color: C.muted }}>
            Paso {actual} de {total}
          </div>
          <h2 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 22, margin: "8px 0 4px", lineHeight: 1.25 }}>
            {pasoActual?.title ?? "Tu paso actual"}
          </h2>
          {pasoActual?.objective && (
            <p style={{ fontSize: 14, color: C.ink2, lineHeight: 1.6, margin: "0 0 16px" }}>{pasoActual.objective}</p>
          )}

          {pasoActual?.content_md ? (
            <div style={{ fontSize: 15, color: C.ink2, marginTop: 14 }}>
              <Texto md={pasoActual.content_md} />
            </div>
          ) : (
            // Estado real, no error: Mario todavía no carga el contenido.
            <div style={{ background: C.blueSoft, border: `1px solid ${C.blue}`, borderRadius: 9,
              padding: "13px 16px", margin: "14px 0", fontSize: 14, color: C.ink2, lineHeight: 1.6 }}>
              El contenido de este paso todavía no está disponible. Mario lo está preparando;
              en cuanto lo suba, aparece aquí.
            </div>
          )}

          {pasoActual?.exercise_md && (
            <div style={{ background: C.paper, borderLeft: `3px solid ${C.blue}`, padding: "14px 18px",
              margin: "16px 0", fontSize: 14.5, color: C.ink2 }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".2em",
                textTransform: "uppercase", color: C.blueDeep, marginBottom: 8 }}>Ejercicio</div>
              <Texto md={pasoActual.exercise_md} />
            </div>
          )}

          <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.rule}` }}>
            <label style={{ display: "block", fontSize: 13, color: C.muted, marginBottom: 7 }}>
              Lo que vayas notando en este paso
            </label>
            <textarea value={reflexion} onChange={(e) => setReflexion(e.target.value)} rows={6}
              placeholder="Escribe aquí. Se guarda para ti y para tu proceso; puedes volver cuando quieras."
              style={{ width: "100%", padding: "12px 14px", borderRadius: 9, border: `1px solid ${C.rule}`,
                fontSize: 15, fontFamily: "inherit", lineHeight: 1.6, color: C.ink,
                resize: "vertical", boxSizing: "border-box" }} />

            {pasoActual?.completion_criteria && (
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, margin: "12px 0 0" }}>
                <b style={{ color: C.ink2 }}>Sabes que ya puedes avanzar cuando:</b> {pasoActual.completion_criteria}
              </p>
            )}

            {aviso && <p style={{ fontSize: 13.5, color: C.blueDeep, margin: "12px 0 0" }}>{aviso}</p>}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
              <button onClick={() => guardarReflexion(false)} disabled={guardando}
                style={{ background: C.white, color: C.blueDeep, border: `1px solid ${C.blue}`,
                  borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit" }}>
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              {rengActual?.status !== "completado" && (
                <button onClick={() => guardarReflexion(true)} disabled={cerrando}
                  style={{ background: cerrando ? C.muted : C.blue, color: "#fff", border: "none",
                    borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 600,
                    cursor: cerrando ? "default" : "pointer", fontFamily: "inherit" }}>
                  {cerrando ? "Cerrando…" : "Ya trabajé este paso"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "proceso" && (
        <div style={{ display: "grid", gap: 10 }}>
          {datos.avance.map((a) => {
            const def = datos.pasos.find((p) => p.step_number === a.step_number);
            const hecho = a.status === "completado";
            const enCurso = a.status === "en_curso";
            const sesiones = datos.sesiones.filter((s) => (a.session_ids ?? []).includes(s.id));
            return (
              <div key={a.step_number} style={{ ...card, padding: 16,
                borderColor: enCurso ? C.blue : C.rule, opacity: a.status === "bloqueado" ? 0.6 : 1 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                    background: hecho ? C.green : enCurso ? C.blue : C.paper2,
                    color: hecho || enCurso ? "#fff" : C.muted, fontFamily: MONO, fontSize: 11,
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {hecho ? "✓" : a.step_number}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: SERIF, fontSize: 16.5, color: C.ink, lineHeight: 1.3 }}>
                      {def?.title ?? `Paso ${a.step_number}`}
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 10.5, color: C.muted, marginTop: 3 }}>
                      {hecho ? "Completado" : enCurso ? "En curso" : "Aún no se abre"}
                    </div>
                    {a.therapist_note && (
                      <p style={{ fontSize: 13.5, color: C.ink2, lineHeight: 1.6, margin: "8px 0 0",
                        paddingLeft: 10, borderLeft: `2px solid ${C.blue}` }}>{a.therapist_note}</p>
                    )}
                    {sesiones.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        {sesiones.map((s) => (
                          <div key={s.id} style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
                            {s.session_title ?? `Sesión ${s.session_number ?? ""}`}
                            {s.session_date ? ` · ${new Date(s.session_date).toLocaleDateString("es-MX",
                              { day: "2-digit", month: "short" })}` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "cuenta" && (
        <div style={card}>
          <div style={{ fontSize: 13, color: C.muted }}>Tu cuenta</div>
          <div style={{ fontSize: 15.5, color: C.ink, marginTop: 4 }}>{correo}</div>
          <p style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.65, margin: "16px 0 0",
            paddingTop: 14, borderTop: `1px solid ${C.rule}` }}>
            Lo que escribes en cada paso es tuyo. Mario puede verlo como parte de tu
            acompañamiento. Si quieres darte de baja del programa, escríbele directamente.
          </p>
          <button onClick={salir} style={{ marginTop: 18, background: "transparent", color: C.muted,
            border: `1px solid ${C.rule}`, borderRadius: 9, padding: "10px 18px", fontSize: 13.5,
            cursor: "pointer", fontFamily: "inherit" }}>Salir</button>
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
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 18px 60px" }}>{children}</div>
    </div>
  );
}
