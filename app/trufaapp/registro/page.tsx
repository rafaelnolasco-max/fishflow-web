"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─── Trufa — registro / login self-service ────────────────────────────────────
// Mismo flujo que /finanzas/registro (confirmación por correo + recuperación),
// con la paleta clara de Trufa. La provisión aquí NO crea cliente: solo reclama
// las invitaciones de co-dueño que llegaron al correo de quien entra.
const TERRACOTA = "#C2552E";
const SALVIA    = "#5F8A6A";
const CREMA     = "#F6F0E8";
const SURFACE   = "#FFFFFF";
const BORDER    = "#E3D7C7";
const MUTED     = "#8E7D6D";
const TEXT      = "#1F1714";

const inp: React.CSSProperties = {
  width: "100%", padding: "12px 14px", borderRadius: 10, border: `1px solid ${BORDER}`,
  fontSize: 15, fontFamily: "inherit", background: "#FFFFFF", color: TEXT,
};

export default function TrufaRegistro() {
  const router = useRouter();
  const [mode, setMode] = useState<"signup" | "login" | "reset">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const recoveryRef = useRef(false);

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
      redirectTo: `${window.location.origin}/trufaapp/registro`,
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
    if (error) { setError("No se pudo guardar. La contraseña debe tener mínimo 6 caracteres."); return; }
    recoveryRef.current = false;
    setNotice("");
    await provisionAndGo();
  }

  // Reclama invitaciones pendientes; si falla, entrar de todos modos: la RLS ya
  // resuelve el acceso por correo y no queremos dejar a nadie afuera por esto.
  async function provisionAndGo() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    try {
      await fetch("/api/trufa/provision", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    } catch { /* no bloquea la entrada */ }
    router.push("/trufaapp");
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/trufaapp/registro` },
        });
        if (error) {
          setError(error.message.includes("already registered")
            ? "Ese correo ya tiene cuenta — usa Entrar."
            : "No se pudo registrar. Revisa correo y contraseña (mínimo 6 caracteres).");
          return;
        }
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
    <div style={{ minHeight: "100vh", background: CREMA, color: TEXT, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "Inter, -apple-system, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <img src="/trufa-isotipo.svg" alt="Trufa" style={{ width: 52, height: 46, marginBottom: 12 }} />
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: "-0.02em",
            fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
            trufa
          </h1>
          <p style={{ fontSize: 14, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            Vacunas, tratamientos y peso de tu mascota en un solo lugar. Te avisamos antes de cada fecha.
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
              {error && <div style={{ color: "#B03A1C", fontSize: 13, marginBottom: 12 }}>{error}</div>}
              {notice && <div style={{ color: SALVIA, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>{notice}</div>}
              <button type="submit" disabled={busy}
                style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
                  background: busy ? "#C9BCA9" : TERRACOTA,
                  color: "#FFF4EC", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                {busy ? "Un momento…" : "Guardar y entrar"}
              </button>
            </form>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
                {(["signup", "login"] as const).map(m => (
                  <button key={m} onClick={() => { setMode(m); setError(""); }}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 9, fontSize: 14, fontWeight: 700,
                      cursor: "pointer", border: `1.5px solid ${mode === m ? TERRACOTA : BORDER}`,
                      background: mode === m ? "rgba(194,85,46,.12)" : "transparent",
                      color: mode === m ? TERRACOTA : MUTED }}>
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

                {error && <div style={{ color: "#B03A1C", fontSize: 13, marginBottom: 12 }}>{error}</div>}
                {notice && <div style={{ color: SALVIA, fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>{notice}</div>}

                <button type="submit" disabled={busy}
                  style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
                    background: busy ? "#C9BCA9" : TERRACOTA,
                    color: "#FFF4EC", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
                  {busy ? "Un momento…" : mode === "signup" ? "Crear mi carnet" : "Entrar"}
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
          El carnet se comparte solo con quien tú invites.
        </p>
      </div>
    </div>
  );
}
