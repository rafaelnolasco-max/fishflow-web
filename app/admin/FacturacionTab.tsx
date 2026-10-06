"use client";

/**
 * Pestaña "Facturación" del /admin — CFDI 4.0 vía Facturapi, multi-emisor.
 *
 * - Estado de cada emisor (activo, prueba/productivo, llave cargada, auto).
 * - Factura manual con varios conceptos, con o sin IVA incluido (contabilidad
 *   cotiza antes de IVA; un pago con tarjeta ya lo trae).
 * - Historial con PDF, XML y cancelación con motivo del SAT.
 *
 * Toda la lógica fiscal vive en lib/cfdi.ts; aquí solo se captura y se muestra.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";

const C = {
  surface: "#0C2232", panel: "#11313f", text: "#e8f4f8", muted: "#5a8a9e",
  border: "rgba(255,255,255,0.08)", accent: "#1FA9D6", orange: "#FF8C35",
  ok: "#22c55e", danger: "#ef4444", warn: "#eab308",
};

const REGIMENES: Array<[string, string]> = [
  ["601", "General de Ley Personas Morales"],
  ["603", "Personas Morales con Fines no Lucrativos"],
  ["605", "Sueldos y Salarios"],
  ["606", "Arrendamiento"],
  ["612", "Actividades Empresariales y Profesionales"],
  ["616", "Sin obligaciones fiscales"],
  ["621", "Incorporación Fiscal"],
  ["625", "Plataformas Tecnológicas"],
  ["626", "Régimen Simplificado de Confianza (RESICO)"],
];
const USOS: Array<[string, string]> = [
  ["G03", "Gastos en general"],
  ["G01", "Adquisición de mercancías"],
  ["I04", "Equipo de cómputo y accesorios"],
  ["S01", "Sin efectos fiscales"],
];
const FORMAS: Array<[string, string]> = [
  ["03", "Transferencia"],
  ["04", "Tarjeta de crédito"],
  ["28", "Tarjeta de débito"],
  ["01", "Efectivo"],
  ["02", "Cheque nominativo"],
  ["06", "Dinero electrónico"],
  ["99", "Por definir"],
];
const MOTIVOS: Array<[string, string]> = [
  ["02", "02 · Errores sin relación"],
  ["03", "03 · No se llevó a cabo la operación"],
  ["01", "01 · Errores con relación (requiere UUID sustituto)"],
  ["04", "04 · Nominativa en factura global"],
];

interface Org {
  id: string; client_id: string; active: boolean; modo: "test" | "live";
  emisor_rfc: string | null; emisor_razon: string | null; serie: string | null;
  auto_al_pagar: boolean; tiene_llave_test: boolean; tiene_llave_live: boolean;
  clients: { name: string; slug: string } | null;
}
interface Inv {
  id: string; created_at: string; status: string; modo: string | null; origen: string | null;
  emisor_org_id: string | null; receptor_rfc: string | null; receptor_razon: string | null;
  concepto: string | null; amount: number | null; total: number | null;
  serie: string | null; folio: string | null; uuid_sat: string | null;
  email_sent_at: string | null; email_to: string | null; error_message: string | null;
  cancel_status: string | null;
}
interface Cli {
  id: string; name: string; slug: string; rfc: string | null; razon_social: string | null;
  regimen_fiscal: string | null; cp: string | null; email_factura: string | null;
}
type Linea = { descripcion: string; cantidad: string; importe: string };

const mxn = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n || 0);

const input: React.CSSProperties = {
  width: "100%", background: C.panel, color: C.text, border: `1px solid ${C.border}`,
  borderRadius: 8, padding: "9px 11px", fontSize: 14, boxSizing: "border-box",
};
const label: React.CSSProperties = { display: "block", fontSize: 11, color: C.muted, margin: "0 0 4px", letterSpacing: 0.5, textTransform: "uppercase" };
const card: React.CSSProperties = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 };

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: `${color}22`, color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export default function FacturacionTab() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [invs, setInvs] = useState<Inv[]>([]);
  const [clis, setClis] = useState<Cli[]>([]);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Formulario
  const [emisor, setEmisor] = useState("");
  const [receptorCli, setReceptorCli] = useState("");
  const [rfc, setRfc] = useState("");
  const [razon, setRazon] = useState("");
  const [regimen, setRegimen] = useState("601");
  const [cp, setCp] = useState("");
  const [email, setEmail] = useState("");
  const [uso, setUso] = useState("G03");
  const [forma, setForma] = useState("03");
  const [ivaIncluido, setIvaIncluido] = useState(false);
  const [enviarCorreo, setEnviarCorreo] = useState(true);
  const [lineas, setLineas] = useState<Linea[]>([{ descripcion: "", cantidad: "1", importe: "" }]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetch("/api/invoices/admin");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Error al cargar");
      setOrgs(d.orgs); setInvs(d.invoices); setClis(d.clients);
      setEmisor((e) => e || d.orgs.find((o: Org) => o.clients?.slug === "fishflow")?.client_id || d.orgs[0]?.client_id || "");
    } catch (e) {
      setMsg({ ok: false, t: String((e as Error).message) });
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const orgPorId = useMemo(() => Object.fromEntries(orgs.map((o) => [o.id, o])), [orgs]);
  const orgSel = orgs.find((o) => o.client_id === emisor);
  const esFishflow = orgSel?.clients?.slug === "fishflow";

  function elegirCliente(id: string) {
    setReceptorCli(id);
    const c = clis.find((x) => x.id === id);
    if (!c) return;
    setRfc(c.rfc ?? ""); setRazon(c.razon_social ?? ""); setRegimen(c.regimen_fiscal ?? "601");
    setCp(c.cp ?? ""); setEmail(c.email_factura ?? "");
  }

  const totales = useMemo(() => {
    const base = lineas.reduce((s, l) => s + (Number(l.importe) || 0) * (Number(l.cantidad) || 0), 0);
    const subtotal = ivaIncluido ? base / 1.16 : base;
    return { subtotal, iva: subtotal * 0.16, total: subtotal * 1.16 };
  }, [lineas, ivaIncluido]);

  async function timbrar(e: React.FormEvent) {
    e.preventDefault();
    if (!orgSel) return;
    const prod = orgSel.modo === "live";
    if (prod && !confirm(`Vas a timbrar un CFDI REAL ante el SAT por ${mxn(totales.total)} a ${razon || rfc}. ¿Continuar?`)) return;
    setEnviando(true); setMsg(null);
    try {
      const r = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emisor_client_id: emisor,
          receptor_client_id: esFishflow && receptorCli ? receptorCli : null,
          rfc, razon_social: razon, regimen_fiscal: regimen, cp, email: email || null,
          cfdi_use: uso, payment_form: forma, enviar_correo: enviarCorreo,
          conceptos: lineas
            .filter((l) => l.descripcion.trim() && Number(l.importe) > 0)
            .map((l) => ({ descripcion: l.descripcion, cantidad: Number(l.cantidad) || 1, importe: Number(l.importe), iva_incluido: ivaIncluido })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Error al timbrar");
      const correo = d.email?.enviado ? ` y enviado a ${d.email.destinatario}` : d.email?.motivo && d.email.motivo !== "omitido" ? ` — correo no enviado (${d.email.motivo})` : "";
      setMsg({ ok: true, t: `${d.modo === "test" ? "Prueba timbrada" : "CFDI timbrado"} por ${mxn(d.total)}${correo}.` });
      setLineas([{ descripcion: "", cantidad: "1", importe: "" }]);
      cargar();
    } catch (e) {
      setMsg({ ok: false, t: String((e as Error).message) });
    } finally {
      setEnviando(false);
    }
  }

  async function cancelar(inv: Inv) {
    const motivo = prompt(`Motivo de cancelación del SAT:\n${MOTIVOS.map((m) => m[1]).join("\n")}\n\nEscribe el número (01-04):`, "02");
    if (!motivo) return;
    let sustitucion: string | null = null;
    if (motivo === "01") {
      sustitucion = prompt("UUID de la factura que sustituye a esta:");
      if (!sustitucion) return;
    }
    const r = await fetch(`/api/invoices/${inv.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ motivo, sustitucion_uuid: sustitucion }),
    });
    const d = await r.json();
    setMsg(r.ok
      ? { ok: true, t: d.status === "cancelled" ? "Factura cancelada." : `Cancelación solicitada — el receptor debe aceptarla (${d.cancel_status}).` }
      : { ok: false, t: d.error ?? "No se pudo cancelar" });
    cargar();
  }

  if (cargando && !orgs.length) return <div style={{ color: C.muted, padding: 24 }}>Cargando facturación…</div>;

  return (
    <div style={{ display: "grid", gap: 16, color: C.text, gridTemplateColumns: "minmax(0, 1fr)" }}>
      {/* Emisores */}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))" }}>
        {orgs.map((o) => {
          const llave = o.modo === "live" ? o.tiene_llave_live : o.tiene_llave_test;
          return (
            <div key={o.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <strong>{o.clients?.name ?? "Emisor"}</strong>
                {o.modo === "live" ? <Badge color={C.ok}>PRODUCTIVO</Badge> : <Badge color={C.warn}>PRUEBA</Badge>}
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
                {o.emisor_rfc ?? "RFC pendiente"} · serie {o.serie ?? "—"}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {o.active ? <Badge color={C.ok}>Activo</Badge> : <Badge color={C.danger}>Inactivo</Badge>}
                {llave ? <Badge color={C.accent}>Llave cargada</Badge> : <Badge color={C.danger}>Sin llave</Badge>}
                {o.auto_al_pagar && <Badge color={C.orange}>Auto al pagar</Badge>}
              </div>
            </div>
          );
        })}
      </div>

      {msg && (
        <div style={{ ...card, borderColor: msg.ok ? C.ok : C.danger, color: msg.ok ? C.ok : C.danger, padding: 12 }}>{msg.t}</div>
      )}

      {/* Nueva factura */}
      <form onSubmit={timbrar} style={card}>
        <h3 style={{ margin: "0 0 14px", fontSize: 16 }}>Nueva factura</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))" }}>
          <div>
            <span style={label}>Emisor</span>
            <select style={input} value={emisor} onChange={(e) => setEmisor(e.target.value)}>
              {orgs.map((o) => <option key={o.id} value={o.client_id}>{o.clients?.name}{o.modo === "test" ? " (prueba)" : ""}</option>)}
            </select>
          </div>
          {esFishflow && (
            <div>
              <span style={label}>Cliente FishFlow (prellenar)</span>
              <select style={input} value={receptorCli} onChange={(e) => elegirCliente(e.target.value)}>
                <option value="">— Captura manual —</option>
                {clis.filter((c) => c.slug !== "fishflow").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div><span style={label}>RFC receptor</span><input style={input} value={rfc} onChange={(e) => setRfc(e.target.value.toUpperCase())} maxLength={13} required /></div>
          <div><span style={label}>Razón social (sin "SA de CV")</span><input style={input} value={razon} onChange={(e) => setRazon(e.target.value)} required /></div>
          <div>
            <span style={label}>Régimen fiscal</span>
            <select style={input} value={regimen} onChange={(e) => setRegimen(e.target.value)}>
              {REGIMENES.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
            </select>
          </div>
          <div><span style={label}>CP fiscal</span><input style={input} value={cp} onChange={(e) => setCp(e.target.value)} maxLength={5} required /></div>
          <div><span style={label}>Correo del receptor</span><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div>
            <span style={label}>Uso CFDI</span>
            <select style={input} value={uso} onChange={(e) => setUso(e.target.value)}>
              {USOS.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
            </select>
          </div>
          <div>
            <span style={label}>Forma de pago</span>
            <select style={input} value={forma} onChange={(e) => setForma(e.target.value)}>
              {FORMAS.map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <span style={label}>Conceptos</span>
          {lineas.map((l, i) => (
            <div key={i} className="ff-cfdi-line">
              <input style={input} placeholder="Descripción" value={l.descripcion}
                onChange={(e) => setLineas((ls) => ls.map((x, j) => j === i ? { ...x, descripcion: e.target.value } : x))} />
              <input style={input} placeholder="Cant." inputMode="decimal" value={l.cantidad}
                onChange={(e) => setLineas((ls) => ls.map((x, j) => j === i ? { ...x, cantidad: e.target.value } : x))} />
              <input style={input} placeholder="Precio" inputMode="decimal" value={l.importe}
                onChange={(e) => setLineas((ls) => ls.map((x, j) => j === i ? { ...x, importe: e.target.value } : x))} />
              <button type="button" aria-label="Quitar concepto" disabled={lineas.length === 1}
                onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}
                style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, cursor: "pointer" }}>×</button>
            </div>
          ))}
          <button type="button" onClick={() => setLineas((ls) => [...ls, { descripcion: "", cantidad: "1", importe: "" }])}
            style={{ background: "transparent", color: C.accent, border: "none", cursor: "pointer", padding: 0, fontSize: 13 }}>
            + Agregar concepto
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", marginTop: 16, fontSize: 13 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={ivaIncluido} onChange={(e) => setIvaIncluido(e.target.checked)} />
            Los precios ya incluyen IVA
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={enviarCorreo} onChange={(e) => setEnviarCorreo(e.target.checked)} />
            Enviar por correo {orgSel?.modo === "test" && "(en prueba solo llega a la copia interna)"}
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 13, color: C.muted }}>
            Subtotal {mxn(totales.subtotal)} · IVA {mxn(totales.iva)} · <strong style={{ color: C.text, fontSize: 16 }}>Total {mxn(totales.total)}</strong>
          </div>
          <button type="submit" disabled={enviando || !orgSel?.active}
            style={{ background: C.orange, color: "#0D1B2A", fontWeight: 800, border: "none", borderRadius: 8, padding: "11px 22px", cursor: "pointer", opacity: enviando || !orgSel?.active ? 0.5 : 1 }}>
            {enviando ? "Timbrando…" : !orgSel?.active ? "Emisor inactivo" : orgSel.modo === "test" ? "Timbrar prueba" : "Timbrar CFDI"}
          </button>
        </div>
      </form>

      {/* Historial */}
      <div style={card}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Facturas</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 760 }}>
            <thead>
              <tr style={{ color: C.muted, textAlign: "left" }}>
                {["Fecha", "Emisor", "Receptor", "Folio", "Total", "Estado", "Correo", ""].map((h) => (
                  <th key={h} style={{ padding: "8px 6px", borderBottom: `1px solid ${C.border}`, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invs.map((i) => {
                const org = i.emisor_org_id ? orgPorId[i.emisor_org_id] : null;
                const color = i.status === "valid" ? C.ok : i.status === "cancelled" ? C.muted : i.status === "pending" ? C.warn : C.danger;
                return (
                  <tr key={i.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{new Date(i.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                    <td style={{ padding: "8px 6px" }}>{org?.clients?.name ?? <span style={{ color: C.muted }}>Llave global</span>}</td>
                    <td style={{ padding: "8px 6px" }}>
                      <div>{i.receptor_razon}</div>
                      <div style={{ color: C.muted, fontSize: 11 }}>{i.receptor_rfc}</div>
                    </td>
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{[i.serie, i.folio].filter(Boolean).join("-") || "—"}</td>
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{mxn(Number(i.total ?? i.amount))}</td>
                    <td style={{ padding: "8px 6px" }}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <Badge color={color}>{i.status}</Badge>
                        {i.modo === "test" && <Badge color={C.warn}>prueba</Badge>}
                        {i.origen === "auto" && <Badge color={C.orange}>auto</Badge>}
                      </div>
                      {i.error_message && <div style={{ color: C.danger, fontSize: 11, marginTop: 4, maxWidth: 220 }}>{i.error_message}</div>}
                    </td>
                    <td style={{ padding: "8px 6px", color: i.email_sent_at ? C.ok : C.muted, fontSize: 12 }}>{i.email_sent_at ? i.email_to : "—"}</td>
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                      {i.uuid_sat && (
                        <>
                          <a href={`/api/invoices/${i.id}/pdf`} style={{ color: C.accent, marginRight: 10 }}>PDF</a>
                          <a href={`/api/invoices/${i.id}/xml`} style={{ color: C.accent, marginRight: 10 }}>XML</a>
                        </>
                      )}
                      {i.status === "valid" && i.emisor_org_id && (
                        <button onClick={() => cancelar(i)} style={{ background: "transparent", border: "none", color: C.danger, cursor: "pointer", padding: 0, fontSize: 13 }}>
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!invs.length && (
                <tr><td colSpan={8} style={{ padding: 18, color: C.muted, textAlign: "center" }}>Aún no hay facturas</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
