"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─── Therapy Flow — registro / login self-service ─────────────────────────────
// Mismo patrón que /finanzas/registro. Diferencia deliberada: aquí SÍ se
// detecta el caso del correo que ya existe en la plataforma. Supabase responde
// `user_repeated_signup` y NO manda correo de confirmación (data.user llega con
// identities vacío), así que el usuario se quedaba esperando un correo que
// nunca iba a llegar. Es el pendiente de UX que arrastraba Finanzas.

const FF_ORANGE = "#FF8C35";
const FF_CYAN   = "#67D4E8";
const FF_DARK   = "#0D1B2A";
const SURFACE   = "#14283E";
const BORDER    = "#24405E";
const MUTED     = "#7E93A8";
const TEXT      = "#F1F5F9";

const inp: React.CSSProperties = {
  width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${BORDER}`,
  fontSize: 15, fontFamily: "inherit", background: FF_DARK, color: TEXT, colorScheme: "dark",
};

export default function TerapiaRegistro() {
  const router = useRouter();
  const [mode, setMode] = useState<"signup" | "login" | "reset">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // true cuando el usuario llegó desde un link de recuperación de contraseña
  const recoveryRef = useRef(false);

  // Si ya hay sesión (p.ej. al volver del link de confirmación de correo,
  // que llega con ?code= y el cliente lo intercambia solo), entrar directo.
  useEffect(() => {
    let done = false;
    async function tryEnter() {
      if (done || recoveryRef.current) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session && !recoveryRef.current) { done = true; await provisionAndGo(); }
    }
    const hasCode = typeof window !== "undefined" && window.location.search.includes("code=");
    const timer = window.setTimeout(tryEnter, hasCode ? 1200 : 0);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryRef.current = true;
        setMode("reset");
        setNotice("Elige tu nueva contraseña.");
        return;
      }
      if (event === "SIGNED_IN") tryEnter();
    });
    return () => { window.clearTimeout(timer); sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendRecovery() {
    setError(""); setNotice("");
    if (!email.trim()) { setError("Escribe tu correo arriba y vuelve a dar clic."); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/terapia/registro`,
    });
    setBusy(false);
    if (error) { setError("No se pudo enviar el correo. Intenta de nuevo."); return; }
    setNotice("Te enviamos un correo para restablecer tu contraseña. Ábrelo desde este mismo dispositivo.");
  }

  async function saveNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError("No se pudo guardar. La contraseña debe tener mínimo 6 caracteres.");
      return;
    }
    recoveryRef.current = false;
    setNotice("");
    await provisionAndGo();
  }

  async function provisionAndGo() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    const res = await fetch("/api/terapia/provision", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) { setError("No se pudo crear tu cuenta. Intenta de nuevo."); return false; }
    router.push("/terapia");
    return true;
  }

  function cuentaYaExiste() {
    setMode("login");
    setNotice("Ese correo ya tiene cuenta en FishFlow. Entra con tu contraseña, o usa ¿Olvidaste tu contraseña? si no la recuerdas.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/terapia/registro` },
        });
        if (error) {
          if (error.message.toLowerCase().includes("already registered")) { cuentaYaExiste(); return; }
          setError("No se pudo registrar. Revisa correo y contraseña (mínimo 6 caracteres).");
          return;
        }
        // Correo ya confirmado en la plataforma: Supabase responde sin error,
        // sin sesión y con identities vacío, y NO manda ningún correo.
        if (!data.session && (data.user?.identities?.length ?? 0) === 0) { cuentaYaExiste(); return; }
        if (!data.session) {
          setNotice("Te enviamos un correo de confirmación. Ábrelo y luego entra aquí con tu contraseña.");
          setMode("login");
          return;
        }
        await provisionAndGo();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError("Correo o contraseña incorrectos."); return; }
        await provisionAndGo();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: FF_DARK, color: TEXT, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "Inter, -apple-system, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <img src="/icons/icon-therapyflow-192.png" alt="Therapy Flow"
            style={{ width: 62, height: 62, borderRadius: 15, marginBottom: 12 }} />
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0,
            fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
            Therapy <span style={{ color: FF_ORANGE }}>Flow</span>
          </h1>
          <p style={{ fontSize: 14, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            Que tu terapia fluya. Sube el audio de tu sesión y quédate con lo que se trabajó,
            en tus palabras y en las del proceso.
          </p>
        </div>

        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 22 }}>
          {mode === "reset" ? (
            <form onSubmit={saveNewPassword}>
              <h2 style={{ fontSize: 16, fontWeight: 800, marginTop: 0, marginBottom: 14 }}>Nueva contraseña</h2>
              <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: "block", marginBottom: 6 }}>Contraseña nueva</label>
              <input style={{ ...inp, marginBottom: 18 }} type="password" required minLength={6}
                autoComplete="new-password" autoFocus
                value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />
              {error && <div style={{ color: "#F87171", fontSize: 13, marginBottom: 12 }}>{error}</div>}
              {notice && <div style={{ color: FF_CYAN, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>{notice}</div>}
              <button type="submit" disabled={busy}
                style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
                  background: busy ? "#41586F" : `linear-gradient(90deg, ${FF_CYAN}, ${FF_ORANGE})`,
                  color: "#0D1B2A", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                {busy ? "Un momento…" : "Guardar y entrar"}
              </button>
            </form>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
                {(["signup", "login"] as const).map(m => (
                  <button key={m} onClick={() => { setMode(m); setError(""); }}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 9, fontSize: 14, fontWeight: 700,
                      cursor: "pointer", border: `1.5px solid ${mode === m ? FF_ORANGE : BORDER}`,
                      background: mode === m ? "rgba(255,140,53,.14)" : "transparent",
                      color: mode === m ? FF_ORANGE : MUTED }}>
                    {m === "signup" ? "Crear cuenta" : "Entrar"}
                  </button>
                ))}
              </div>

              <form onSubmit={submit}>
                <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: "block", marginBottom: 6 }}>Correo</label>
                <input style={{ ...inp, marginBottom: 14 }} type="email" required autoComplete="email"
                  value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" />
                <label style={{ fontSize: 12, fontWeight: 600, color: MUTED, display: "block", marginBottom: 6 }}>Contraseña</label>
                <input style={{ ...inp, marginBottom: 18 }} type="password" required minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" />

                {error && <div style={{ color: "#F87171", fontSize: 13, marginBottom: 12 }}>{error}</div>}
                {notice && <div style={{ color: FF_CYAN, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>{notice}</div>}

                <button type="submit" disabled={busy}
                  style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
                    background: busy ? "#41586F" : `linear-gradient(90deg, ${FF_CYAN}, ${FF_ORANGE})`,
                    color: "#0D1B2A", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                  {busy ? "Un momento…" : mode === "signup" ? "Empezar gratis" : "Entrar"}
                </button>
              </form>

              {mode === "login" && (
                <button onClick={sendRecovery} disabled={busy}
                  style={{ width: "100%", marginTop: 14, background: "none", border: "none",
                    color: MUTED, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
                  ¿Olvidaste tu contraseña?
                </button>
              )}
            </>
          )}
        </div>

        <p style={{ fontSize: 12, color: MUTED, textAlign: "center", marginTop: 16, lineHeight: 1.6 }}>
          Tu expediente es tuyo y solo tú lo ves. El audio se borra en cuanto se transcribe.
        </p>
      </div>
    </div>
  );
}
