"use client";
// "No acepto / algo no quedó bien": el cliente escribe el motivo, queda registrado como
// incidencia en la orden (se detiene la auto-aceptación) y luego puede seguir por WhatsApp.
import { useState } from "react";
import { useRouter } from "next/navigation";

const C = { navy: "#10336B", azul: "#0084F9", rojo: "#C0392B", gris: "#5A6B8C", linea: "#DCE5F3", wa: "#25D366" };
const WA = "525513285555";

export default function IncidentBox({ token, folio, initialReason, closed }: {
  token: string; folio: string; initialReason: string | null; closed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState<string | null>(initialReason);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const wa = (txt: string) => `https://wa.me/${WA}?text=${encodeURIComponent(txt)}`;

  async function send() {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/instalacion/${token}/incidencia`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No se pudo registrar");
      setSent(reason.trim()); setOpen(false); router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const btn = (bg: string, fg = "#fff", border = bg): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, background: bg, color: fg,
    border: `1.5px solid ${border}`, borderRadius: 8, padding: "12px 18px", fontWeight: 700, fontSize: 15,
    textDecoration: "none", cursor: "pointer", flex: "1 1 220px",
  });

  return (
    <div id="problema" style={{ marginTop: 28, border: `1px solid ${C.linea}`, borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ fontWeight: 700, color: C.navy, fontSize: 16 }}>¿Algo no quedó bien?</div>

      {sent ? (
        <>
          <p style={{ margin: "8px 0 12px", fontSize: 14, lineHeight: 1.55, color: "#0B1A3A" }}>
            Recibimos tu reporte y lo estamos revisando. Te contactamos a la brevedad para resolverlo.
          </p>
          <div style={{ background: "#FFF6EF", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: "#7A3E12", marginBottom: 12 }}>“{sent}”</div>
          <a href={wa(`Hola LUKON, reporté un problema con mi instalación ${folio}: ${sent}`)} target="_blank" rel="noopener noreferrer" style={btn(C.wa)}>
            Seguir por WhatsApp
          </a>
        </>
      ) : closed ? (
        <>
          <p style={{ margin: "8px 0 12px", fontSize: 14, color: C.gris, lineHeight: 1.55 }}>
            Si notas cualquier falla con tu equipo, escríbenos por WhatsApp con tu folio {folio} y lo revisamos.
          </p>
          <a href={wa(`Hola LUKON, tengo un problema con mi instalación ${folio}.`)} target="_blank" rel="noopener noreferrer" style={btn(C.wa)}>
            WhatsApp 55 1328 5555
          </a>
        </>
      ) : open ? (
        <>
          <p style={{ margin: "8px 0 10px", fontSize: 14, color: C.gris }}>Cuéntanos qué pasó. Queda registrado en tu folio {folio} y te contactamos.</p>
          <textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={1000} rows={4}
            placeholder="Ej. el tablero marca un testigo que antes no salía, o la app no muestra el vehículo"
            style={{ width: "100%", boxSizing: "border-box", border: `1.5px solid ${C.linea}`, borderRadius: 8, padding: 12, fontSize: 16, fontFamily: "inherit" }} />
          {err && <p style={{ color: C.rojo, fontSize: 14, margin: "8px 0 0" }}>{err}</p>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <button onClick={send} disabled={busy || reason.trim().length < 5} style={{ ...btn(C.rojo), opacity: busy || reason.trim().length < 5 ? 0.5 : 1 }}>
              {busy ? "Enviando…" : "Enviar reporte"}
            </button>
            <button onClick={() => setOpen(false)} style={btn("#fff", C.navy, C.linea)}>Cancelar</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: "8px 0 12px", fontSize: 14, color: C.gris, lineHeight: 1.55 }}>
            Si no estás conforme con la instalación, dinos por qué y lo resolvemos antes de darla por aceptada.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setOpen(true)} style={btn("#fff", C.rojo, C.rojo)}>No acepto, reportar un problema</button>
            <a href={wa(`Hola LUKON, tengo una duda sobre mi instalación ${folio}.`)} target="_blank" rel="noopener noreferrer" style={btn(C.wa)}>WhatsApp 55 1328 5555</a>
          </div>
        </>
      )}
    </div>
  );
}
