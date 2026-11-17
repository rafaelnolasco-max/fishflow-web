"use client";

// Vista del cliente: pantalla de NIP y, ya dentro, el reporte de su flotilla en solo lectura
// (Reporte mensual, Flotilla, Mapa por unidad). Marca LUKON, no FishFlow.

import { useRef, useState } from "react";
import RecorridosTab from "@/components/telematica/RecorridosTab";

const L = {
  ink: "#000D32", ink2: "#06143F", ink3: "#0E2150", paper: "#F6F9FE", paper2: "#E9F2FF",
  line: "#1E3A70", lineL: "#D6E0F0", muted: "#8DA2C8", mutedL: "#5A6B8C", signal: "#3BA4FF",
  crimson: "#E04E2A",
  fBody: "'Inter', system-ui, sans-serif", fMono: "'Inter', system-ui, sans-serif",
  fDisplay: "'Bebas Neue', Impact, 'Arial Narrow', sans-serif",
};

// Breakpoints estándar FishFlow: ≤600 móvil · 601–900 iPad · >900 PC
const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap");
html,body{ margin:0; background:${L.paper}; }
.lk-header{ padding:16px 32px; }
.lk-main{ padding:40px 32px; max-width:1280px; margin:0 auto; min-width:0; overflow-wrap:anywhere; box-sizing:border-box; }
.lk-tablewrap{ overflow-x:auto; -webkit-overflow-scrolling:touch; }
.lk-tablewrap .lk-stick{ position:sticky; right:0; background:#FFFFFF; box-shadow:-10px 0 10px -10px rgba(0,13,50,.22); }
.lk-main img, .lk-main video, .lk-main canvas{ max-width:100%; }
.lk-pin input{ font-size:28px; }
@media (max-width: 900px){
  .lk-header{ padding:14px 20px; }
  .lk-main{ padding:28px 20px; }
  .lk-main input, .lk-main select, .lk-main textarea{ font-size:16px !important; }
}
@media (max-width: 600px){
  .lk-header{ padding:12px 16px; gap:10px; }
  .lk-header-sub{ display:none; }
  .lk-main{ padding:24px 16px; }
}
`;

function Logo({ h = 26 }: { h?: number }) {
  return (
    <svg viewBox="0 -2 606 187" role="img" aria-label="LUKON" style={{ height: h, width: "auto", display: "block" }}>
      <g fill="#FFFFFF">
        <path d="M0 0h28.7v106h71.6v28H0z"/><path d="M104 0h28.5v78a27.5 27.5 0 0 0 55 0V0H216v78a56 56 0 0 1-112 0z"/>
        <path d="M237.5 0h28.3v56.4L316.2 0H350l-55.1 62.8 57 71.2h-36.7l-49.4-61.75V134h-28.3z"/><circle cx="416.75" cy="66.5" r="17.75"/>
      </g>
      <g fill="#0084F9">
        <path fillRule="evenodd" d="M416.75 0.7a66.3 66.3 0 1 0 0.001 0zm0 28.45a37.85 37.85 0 1 1-0.001 0z"/>
        <path d="M393 146.8h47.8l-23.9 36.2z"/><path d="M498.8 0H518l60.2 75.25V0H606v134h-18.4l-61.1-76.4V134h-27.7z"/>
      </g>
    </svg>
  );
}

export default function FlotillaView({ slug, fleetName, authed: authed0, expired }: {
  slug: string; fleetName: string; authed: boolean; expired: boolean;
}) {
  const [authed, setAuthed] = useState(authed0);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(expired ? "Este acceso temporal ya venció. Pide uno nuevo a LUKON." : "");
  const inputRef = useRef<HTMLInputElement>(null);

  async function enter(e?: React.FormEvent) {
    e?.preventDefault();
    if (pin.length !== 6 || busy) return;
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/telematica/pin/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, pin }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error ?? "No se pudo entrar");
      setAuthed(true);
    } catch (e) {
      setErr((e as Error).message); setPin(""); inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  async function salir() {
    await fetch("/api/telematica/pin/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
    setAuthed(false); setPin("");
  }

  return (
    <div style={{ minHeight: "100vh", background: L.paper, fontFamily: L.fBody, color: L.ink }}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="lk-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: L.ink, borderBottom: `1px solid ${L.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Logo />
          <span className="lk-header-sub" style={{ fontSize: 10, letterSpacing: "0.2em", color: L.muted, textTransform: "uppercase", paddingLeft: 12, borderLeft: `1px solid ${L.line}` }}>
            {fleetName} · Reporte de flotilla
          </span>
        </div>
        {authed && (
          <button onClick={salir} style={{ background: "transparent", border: `1px solid ${L.line}`, color: L.muted, borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 11, letterSpacing: "0.08em" }}>
            SALIR
          </button>
        )}
      </header>

      {authed ? (
        <main className="lk-main">
          <RecorridosTab t={L} readOnly fleetsUrl={`/api/telematica/pin/fleet?slug=${slug}`} title={fleetName} />
        </main>
      ) : (
        <main className="lk-main" style={{ display: "flex", justifyContent: "center", paddingTop: 64 }}>
          <form onSubmit={enter} className="lk-pin" style={{ width: "100%", maxWidth: 380, background: "#FFFFFF", border: `1px solid ${L.lineL}`, borderRadius: 14, padding: "32px 28px", boxSizing: "border-box", textAlign: "center" }}>
            <div style={{ fontFamily: L.fDisplay, fontSize: 34, letterSpacing: "0.02em", lineHeight: 1 }}>{fleetName}</div>
            <div style={{ fontSize: 15, color: L.mutedL, margin: "8px 0 24px" }}>Reporte de flotilla · escribe tu NIP de 6 dígitos</div>
            <input
              ref={inputRef} autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6}
              aria-label="NIP de 6 dígitos" type="password" value={pin} disabled={expired || busy}
              onChange={e => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setPin(v); if (err && !expired) setErr(""); }}
              style={{ width: "100%", boxSizing: "border-box", textAlign: "center", letterSpacing: "0.5em", padding: "14px 10px", border: `1.5px solid ${err ? L.crimson : L.lineL}`, borderRadius: 10, fontFamily: L.fBody, fontWeight: 700, color: L.ink, outline: "none" }}
            />
            {err && <div role="alert" style={{ color: L.crimson, fontSize: 14, marginTop: 12 }}>{err}</div>}
            <button type="submit" disabled={pin.length !== 6 || busy || expired} style={{
              marginTop: 20, width: "100%", background: L.ink, color: L.signal, border: "none", borderRadius: 8, padding: "14px 0",
              fontWeight: 700, fontSize: 16, cursor: pin.length === 6 && !busy ? "pointer" : "not-allowed", opacity: pin.length === 6 && !busy ? 1 : 0.55,
            }}>{busy ? "Entrando…" : "Entrar"}</button>
            <div style={{ fontSize: 12, color: L.mutedL, marginTop: 18 }}>Siempre Inteligente. Siempre Seguro.</div>
          </form>
        </main>
      )}
    </div>
  );
}
