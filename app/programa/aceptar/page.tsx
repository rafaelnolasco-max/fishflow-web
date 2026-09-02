"use client";

/**
 * Aceptar la invitación al programa.
 *
 * La persona llega con ?t=<token> desde el mensaje que le mandó Mario. Aquí
 * crea su cuenta (o entra con la que ya tiene) y hasta entonces se vuelve
 * paciente: haber contestado un cuestionario en internet no da de alta a nadie.
 *
 * El correo tiene que ser el mismo al que le llegó la invitación — lo valida el
 * servidor en /api/programa/aceptar. Aquí solo se le avisa con la pista.
 */

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const C = {
  ink: "#0F1A24", ink2: "#283845", paper: "#F4F7FA", white: "#FFFFFF",
  blue: "#3E86CF", blueDeep: "#2A6AAE", muted: "#7B8794", rule: "#DCE4EC",
  red: "#C0392B",
};
const SERIF = '"Fraunces", Georgia, serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
const BODY = '"Inter", system-ui, sans-serif';
const FONTS =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";

type Invitacion = {
  nombre: string; correoPista: string; programa: string;
  subtitulo: string; pasos: number; pasoUnoHecho: boolean;
};

/**
 * ⚠️ useSearchParams() obliga a una frontera de Suspense: sin ella `next build`
 * falla al prerenderizar la ruta y Vercel se queda sirviendo el deploy anterior
 * — la pagina nueva sale 404 sin que nada avise. No quitar el Suspense.
 */
export default function AceptarPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: C.paper, color: C.muted, fontFamily: BODY,
        display: "flex", alignItems: "center", justifyContent: "center" }}>
        Abriendo tu invitación…
      </div>
    }>
      <Aceptar />
    </Suspense>
  );
}

function Aceptar() {
  const router = useRouter();
  const params = useSearchParams();
  const token = (params.get("t") ?? "").trim();

  const [inv, setInv] = useState<Invitacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [invalida, setInvalida] = useState("");

  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!token) { setInvalida("Este link no trae invitación."); setCargando(false); return; }
      try {
        const r = await fetch(`/api/programa/invitacion?t=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (!vivo) return;
        if (!r.ok) setInvalida(j.error ?? "Esta invitación ya no está disponible.");
        else setInv(j as Invitacion);
      } catch {
        if (vivo) setInvalida("No se pudo abrir la invitación. Intenta de nuevo.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [token]);

  async function aceptar() {
    const r = await fetch("/api/programa/aceptar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const j = await r.json();
    if (!r.ok) { setError(j.error ?? "No se pudo completar tu alta."); return; }
    router.push("/programa");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setAviso(""); setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/programa/aceptar?t=${token}` },
        });
        if (error) {
          if (error.message.toLowerCase().includes("already registered")) {
            setMode("login");
            setAviso("Ese correo ya tiene cuenta. Entra con tu contraseña.");
            return;
          }
          setError("No se pudo crear la cuenta. La contraseña necesita al menos 6 caracteres.");
          return;
        }
        // Correo ya confirmado en la plataforma: Supabase responde sin sesión,
        // con identities vacío y sin mandar correo.
        if (!data.session && (data.user?.identities?.length ?? 0) === 0) {
          setMode("login");
          setAviso("Ese correo ya tiene cuenta. Entra con tu contraseña.");
          return;
        }
        if (!data.session) {
          setAviso("Te mandamos un correo de confirmación. Ábrelo y regresa a este mismo link.");
          setMode("login");
          return;
        }
        await aceptar();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError("Correo o contraseña incorrectos."); return; }
        await aceptar();
      }
    } finally {
      setBusy(false);
    }
  }

  const campo: React.CSSProperties = {
    width: "100%", padding: "12px 14px", borderRadius: 9, border: `1px solid ${C.rule}`,
    fontSize: 16, fontFamily: "inherit", color: C.ink, background: C.white, boxSizing: "border-box",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: BODY,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href={FONTS} />

      <div style={{ width: "100%", maxWidth: 460, background: C.white, borderRadius: 14,
        border: `1px solid ${C.rule}`, padding: "30px 26px" }}>

        {cargando ? (
          <p style={{ color: C.muted, margin: 0 }}>Abriendo tu invitación…</p>
        ) : invalida ? (
          <>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".24em",
              textTransform: "uppercase", color: C.muted }}>Invitación</div>
            <h1 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 25, margin: "12px 0 10px",
              lineHeight: 1.2 }}>{invalida}</h1>
            <p style={{ fontSize: 14.5, color: C.ink2, lineHeight: 1.6, margin: 0 }}>
              Puede que ya la hayas usado o que el link esté incompleto. Escríbele a Mario
              y con gusto te manda uno nuevo.
            </p>
          </>
        ) : inv ? (
          <>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: ".24em",
              textTransform: "uppercase", color: C.blueDeep }}>Te invitaron al programa</div>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 9, color: C.blueDeep }}>
              <span style={{ width: 46, height: 1, background: C.blueDeep }} />
              <span style={{ width: 6, height: 6, background: C.blueDeep, transform: "rotate(45deg)" }} />
            </div>

            <h1 style={{ fontFamily: SERIF, fontWeight: 500, fontSize: 27, lineHeight: 1.18,
              margin: "16px 0 6px" }}>
              {inv.nombre ? `${inv.nombre}, ` : ""}
              <span style={{ fontStyle: "italic", color: C.blueDeep }}>{inv.programa}</span>
            </h1>
            {inv.subtitulo && (
              <p style={{ fontSize: 14, color: C.ink2, lineHeight: 1.6, margin: "0 0 14px" }}>{inv.subtitulo}</p>
            )}

            <p style={{ fontSize: 14.5, color: C.ink2, lineHeight: 1.65, margin: "0 0 6px" }}>
              Es un proceso de {inv.pasos} pasos.{" "}
              {inv.pasoUnoHecho
                ? "La evaluación que ya contestaste cuenta como el primer paso: no la vuelves a llenar."
                : "Arranca contestando la evaluación, para tener un punto de partida con el que comparar más adelante."}
            </p>

            <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.55, margin: "14px 0 18px",
              paddingTop: 14, borderTop: `1px solid ${C.rule}` }}>
              Esto no es psicoterapia ni un tratamiento psicológico o psiquiátrico. Es un proceso
              de análisis y desarrollo de criterio, acompañado por Mario.
            </p>

            <form onSubmit={submit}>
              <label style={{ display: "block", fontSize: 12.5, color: C.muted, marginBottom: 5 }}>
                Tu correo{inv.correoPista ? ` — la invitación llegó a ${inv.correoPista}` : ""}
              </label>
              <input type="email" required value={email} autoComplete="email"
                onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" style={campo} />

              <label style={{ display: "block", fontSize: 12.5, color: C.muted, margin: "13px 0 5px" }}>
                {mode === "signup" ? "Crea una contraseña" : "Tu contraseña"}
              </label>
              <input type="password" required value={password} minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" style={campo} />

              {aviso && <p style={{ fontSize: 13, color: C.blueDeep, margin: "12px 0 0", lineHeight: 1.5 }}>{aviso}</p>}
              {error && <p style={{ fontSize: 13, color: C.red, margin: "12px 0 0", lineHeight: 1.5 }}>{error}</p>}

              <button type="submit" disabled={busy}
                style={{ width: "100%", marginTop: 18, padding: "13px 0", borderRadius: 10, border: "none",
                  background: busy ? C.muted : C.blue, color: "#fff", fontSize: 15, fontWeight: 600,
                  fontFamily: "inherit", cursor: busy ? "default" : "pointer" }}>
                {busy ? "Un momento…" : mode === "signup" ? "Crear mi cuenta y entrar" : "Entrar"}
              </button>

              <button type="button" onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setError(""); setAviso(""); }}
                style={{ width: "100%", marginTop: 10, padding: "10px 0", borderRadius: 10,
                  border: `1px solid ${C.rule}`, background: "transparent", color: C.ink2,
                  fontSize: 13.5, fontFamily: "inherit", cursor: "pointer" }}>
                {mode === "signup" ? "Ya tengo cuenta" : "Quiero crear una cuenta"}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
