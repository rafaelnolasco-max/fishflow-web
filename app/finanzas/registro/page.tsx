"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─── FishFlow Finanzas — registro / login self-service ────────────────────────
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

export default function FinanzasRegistro() {
  const router = useRouter();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Si ya hay sesión (p.ej. al volver del link de confirmación de correo,
  // que llega con ?code= y el cliente lo intercambia solo), entrar directo.
  useEffect(() => {
    let done = false;
    async function tryEnter() {
      if (done) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (session) { done = true; await provisionAndGo(); }
    }
    tryEnter();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") tryEnter();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function provisionAndGo() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    const res = await fetch("/api/finanzas/provision", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) { setError("No se pudo crear tu cuenta. Intenta de nuevo."); return false; }
    router.push("/finanzas");
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setNotice(""); setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/finanzas/registro` },
        });
        if (error) {
          setError(error.message.includes("already registered")
            ? "Ese correo ya tiene cuenta — usa Entrar." : "No se pudo registrar. Revisa correo y contraseña (mínimo 6 caracteres).");
          return;
        }
        if (!data.session) {
          // Confirmación por correo activada
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
          <img src="/isotipo.svg" alt="FishFlow" style={{ width: 46, height: 46, marginBottom: 12 }} />
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0,
            fontFamily: "'Plus Jakarta Sans', Inter, sans-serif" }}>
            FishFlow <span style={{ color: FF_ORANGE }}>Finanzas</span>
          </h1>
          <p style={{ fontSize: 14, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            Registra tus gastos del mes, ponte un límite y entiende a dónde se va tu dinero.
          </p>
        </div>

        <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 16, padding: 22 }}>
          {/* Toggle registro / login */}
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
        </div>

        <p style={{ fontSize: 12, color: MUTED, textAlign: "center", marginTop: 16, lineHeight: 1.6 }}>
          Tus datos son privados: solo tú los ves.
        </p>
      </div>
    </div>
  );
}
