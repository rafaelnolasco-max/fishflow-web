"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import Image from "next/image";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");

  // ── Mapa email → ruta de destino (fallback cuando no hay ?next) ─────────────
  const EMAIL_TO_ROUTE: Record<string, string> = {
    "andres@telecomba.com":       "/app/tba",
    "carlosnolascocas@gmail.com": "/app/tba",
    "belangestudio@gmail.com":    "/app/belange",
    "mariocitalan@gmail.com":     "/app/therapyos",
    "rafaelnolasco@gmail.com":    "/admin",
  };

  // ── Contexto visual por ruta de destino ──────────────────────────────────────
  const APP_CONTEXT: Record<string, { label: string; color: string }> = {
    "/app/therapyos": { label: "TherapyOS", color: "#1a6b4a" },
    "/app/tba":       { label: "TBA Telecom CRM", color: "#1a4a6b" },
    "/app/belange":   { label: "Belange Studio", color: "#6b1a4a" },
    "/admin":         { label: "FishFlow Admin", color: "#333" },
  };

  const appCtx = nextParam
    ? Object.entries(APP_CONTEXT).find(([route]) => nextParam.startsWith(route))?.[1]
    : null;

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Correo o contraseña incorrectos.");
      setLoading(false);
      return;
    }

    // Si hay ?next explícito, usarlo; si no, derivar la ruta del email del usuario
    const destination =
      nextParam && nextParam !== "/"
        ? nextParam
        : (EMAIL_TO_ROUTE[data.user?.email ?? ""] ?? "/");

    router.push(destination);
    router.refresh();
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f8f8f6",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-outfit, system-ui, sans-serif)",
      padding: "1rem",
    }}>
      <div style={{
        background: "#fff",
        border: "0.5px solid #e5e4df",
        borderRadius: 16,
        padding: "2.5rem 2rem",
        width: "100%",
        maxWidth: 380,
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <Image
              src="/logo-horizontal.svg"
              alt="FishFlow"
              width={140}
              height={36}
              priority
            />
          </div>
          {appCtx ? (
            <div style={{
              display: "inline-block",
              background: appCtx.color + "18",
              border: `1px solid ${appCtx.color}44`,
              borderRadius: 20,
              padding: "3px 12px",
              fontSize: 12,
              fontWeight: 600,
              color: appCtx.color,
              marginTop: 4,
            }}>
              {appCtx.label}
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "#999", margin: 0 }}>
              Acceso privado
            </p>
          )}
        </div>

        <form onSubmit={handleLogin}>
          {/* Email */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#777", marginBottom: 6 }}>
              Correo electrónico
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              required
              autoFocus
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "0.5px solid #ddd",
                borderRadius: 8,
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
                color: "#1a1a1a",
              }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#777", marginBottom: 6 }}>
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "0.5px solid #ddd",
                borderRadius: 8,
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
                boxSizing: "border-box",
                color: "#1a1a1a",
              }}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              background: "#fff0f0",
              border: "0.5px solid #ffb3b3",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 13,
              color: "#c0392b",
              marginBottom: 14,
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px 0",
              background: loading ? "#aaa" : "#00B8CC",
              border: "none",
              borderRadius: 8,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {loading ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        {/* Footer */}
        <p style={{ textAlign: "center", fontSize: 11, color: "#ccc", marginTop: "1.5rem", marginBottom: 0 }}>
          Solo usuarios autorizados por FishFlow
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
