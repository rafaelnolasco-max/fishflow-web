"use client";

// Solicitud de factura desde la orden de compra pública (RMZ).

import React, { useState } from "react";

const ACCENT = "#C0923A";

const inputStyle: React.CSSProperties = {
  width: "100%", border: "1px solid #EAE0D5", borderRadius: 10,
  padding: "11px 13px", fontSize: 14, fontFamily: "inherit", background: "#fff",
  boxSizing: "border-box",
};
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, margin: "10px 0 5px" };

const CFDI_USES = [
  ["G03", "G03 — Gastos en general"],
  ["G01", "G01 — Adquisición de mercancías"],
  ["P01", "P01 — Por definir"],
] as const;

export default function InvoiceForm({ token, requested, paid }: {
  token: string; requested: boolean; paid: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(requested);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ rfc: "", razon_social: "", cp: "", cfdi_use: "G03", email: "" });

  if (done) {
    return (
      <div style={{ background: "#EAF6F0", border: "1px solid #BFE6D4", borderRadius: 12, padding: "12px 16px", fontSize: 14, color: "#1E5E44" }}>
        🧾 Factura solicitada. Te la enviaremos por correo en cuanto se emita.
      </div>
    );
  }

  if (!paid) {
    return (
      <div style={{ fontSize: 13, color: "#6E645C" }}>
        🧾 ¿Necesitas factura? Podrás solicitarla aquí mismo en cuanto se confirme tu pago.
      </div>
    );
  }

  async function submit() {
    setErr(null);
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(f.rfc.trim())) {
      setErr("Escribe un RFC válido (12 o 13 caracteres).");
      return;
    }
    if (!f.razon_social.trim()) { setErr("Escribe la razón social."); return; }
    setSending(true);
    try {
      const res = await fetch("/api/store/rmz/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...f, rfc: f.rfc.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al solicitar la factura");
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al solicitar la factura");
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "#fff", border: `1px solid ${ACCENT}`, color: "#9E7328",
          borderRadius: 11, padding: "12px 20px", fontWeight: 700, fontSize: 14,
          cursor: "pointer", fontFamily: "inherit", width: "100%",
        }}
      >
        🧾 Solicitar factura (CFDI)
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid #EAE0D5", borderRadius: 14, padding: "16px 18px", background: "#FAF7F2" }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>Datos de facturación</div>
      <label style={labelStyle}>RFC</label>
      <input style={inputStyle} value={f.rfc} onChange={(e) => setF({ ...f, rfc: e.target.value })} placeholder="XAXX010101000" />
      <label style={labelStyle}>Razón social</label>
      <input style={inputStyle} value={f.razon_social} onChange={(e) => setF({ ...f, razon_social: e.target.value })} placeholder="Como aparece en tu constancia fiscal" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>CP fiscal</label>
          <input style={inputStyle} value={f.cp} onChange={(e) => setF({ ...f, cp: e.target.value })} placeholder="06600" inputMode="numeric" />
        </div>
        <div>
          <label style={labelStyle}>Uso CFDI</label>
          <select style={inputStyle} value={f.cfdi_use} onChange={(e) => setF({ ...f, cfdi_use: e.target.value })}>
            {CFDI_USES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <label style={labelStyle}>Correo para recibir la factura (opcional)</label>
      <input style={inputStyle} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="Si es distinto al de tu pedido" inputMode="email" />
      {err && (
        <div style={{ background: "#FDECEA", border: "1px solid #F5C6C0", color: "#B3261E", borderRadius: 10, padding: "9px 13px", fontSize: 13, marginTop: 10 }}>
          {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button onClick={submit} disabled={sending} style={{
          flex: 1, background: ACCENT, border: 0, color: "#fff", borderRadius: 11,
          padding: "12px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
          opacity: sending ? 0.6 : 1,
        }}>
          {sending ? "Enviando…" : "Solicitar factura"}
        </button>
        <button onClick={() => setOpen(false)} disabled={sending} style={{
          background: "#fff", border: "1px solid #EAE0D5", color: "#241C16", borderRadius: 11,
          padding: "12px 18px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
        }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
