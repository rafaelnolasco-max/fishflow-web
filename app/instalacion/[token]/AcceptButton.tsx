"use client";
// Botón "Acepto la instalación" del reporte público. Se acepta con un clic en la
// página (no desde la liga del correo) para que los antivirus que abren ligas
// no la acepten solos.
import { useState } from "react";

const C = { navy: "#10336B", azul: "#0084F9", verde: "#1F8A4C", suave: "#E9F2FF", gris: "#5A6B8C" };

export default function AcceptButton({ token, accepted, acceptedAt, auto, days }: {
  token: string; accepted: boolean; acceptedAt: string | null; auto: boolean; days: number;
}) {
  const [ok, setOk] = useState(accepted);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (ok) return (
    <div style={{ background: "#E7F6EC", border: `1px solid ${C.verde}55`, borderRadius: 12, padding: "14px 16px", color: C.verde, fontWeight: 600, fontSize: 15 }}>
      ✓ Instalación aceptada{acceptedAt ? ` el ${acceptedAt}` : ""}{auto ? " (automáticamente)" : ""}. ¡Gracias por confiar en LUKON!
    </div>
  );

  async function accept() {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/instalacion/${token}/aceptar`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No se pudo registrar");
      setOk(true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div style={{ background: C.suave, borderRadius: 12, padding: "16px 18px" }}>
      <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.5, color: "#0B1A3A" }}>
        Revisa las fotos y los datos. Si todo está bien, confírmanoslo:
      </p>
      <button onClick={accept} disabled={busy} style={{
        background: C.azul, color: "#fff", border: "none", borderRadius: 8, padding: "14px 22px",
        fontWeight: 700, fontSize: 16, cursor: busy ? "default" : "pointer", width: "100%", maxWidth: 360, opacity: busy ? 0.6 : 1,
      }}>{busy ? "Registrando…" : "Acepto la instalación"}</button>
      {err && <p style={{ color: "#C0392B", fontSize: 14, margin: "10px 0 0" }}>{err}</p>}
      <p style={{ margin: "10px 0 0", fontSize: 13 }}><a href="#problema" style={{ color: "#C0392B", fontWeight: 600 }}>¿Algo no quedó bien? Repórtalo aquí ↓</a></p>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: C.gris }}>Si no recibimos respuesta en {days} días, la instalación se da por aceptada.</p>
    </div>
  );
}
