"use client";

// ─── Lukon · Instalaciones de GPS / dashcam (fase 1, 12-nov-2026) ────────────
// Alex crea la orden y la asigna a un instalador (por número). En sitio, desde
// el celular: "Empezar" (hora + ubicación), fotos guiadas de antes y después,
// IMEI/SIM y "Terminar": se manda al cliente el reporte con marca LUKON desde
// instalaciones@gpslukon.com y el cliente lo acepta con un clic (o se acepta
// solo a los 3 días). Los instaladores todavía no tienen acceso propio.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LukonTheme } from "./ProspectosTab";
import {
  INSTALLERS, STATUS_LABEL, SERVICE_LABEL, AUTO_ACCEPT_DAYS, stepsFor, missingPhotos, folioTxt,
  type Status, type Service, type Stage,
} from "@/lib/installations";

interface Inst {
  id: string; folio: number; status: Status; installer_no: number | null;
  customer_name: string; customer_email: string | null; customer_phone: string | null;
  vehicle_brand: string | null; vehicle_model: string | null; vehicle_year: number | null; vehicle_plate: string | null; vehicle_color: string | null;
  service: Service; address: string | null; scheduled_at: string | null; notes: string | null;
  started_at: string | null; finished_at: string | null; device_imei: string | null; sim_iccid: string | null; dashcam_serial: string | null;
  hidden_location: string | null; tech_notes: string | null; remote_cutoff_test: string | null; report_token: string; report_sent_at: string | null; report_sent_to: string | null;
  accepted_at: string | null; accepted_auto: boolean; cancel_reason: string | null; incident_reason: string | null; incident_at: string | null; photos?: number;
}
interface Photo { id: string; stage: Stage; kind: string; url: string | null; created_at: string }
interface Ev { type: string; detail: string | null; by: string | null; at: string }

const EV_LABEL: Record<string, string> = {
  creada: "Orden creada", editada: "Datos editados", reprogramada: "Reprogramada", inicio: "Inicio de la instalación",
  fin: "Instalación terminada", reporte_enviado: "Reporte enviado", aceptada_cliente: "Aceptada por el cliente",
  aceptada_auto: "Aceptada automáticamente", aceptada_lukon: "Aceptada (registrada por LUKON)", cancelada: "Cancelada", incidencia_cliente: "El cliente NO aceptó (incidencia)",
};
const fmt = (iso: string | null, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) =>
  iso ? new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", ...opts }) : "—";
const vehicle = (i: Inst) => [i.vehicle_brand, i.vehicle_model, i.vehicle_year].filter(Boolean).join(" ") || "Vehículo sin datos";
/** datetime-local (hora del navegador) ↔ ISO */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso); const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};
const cdmxDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

function getPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise(res => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}

/** Reduce la foto a ~1600 px JPEG antes de subir (señal mala, límite de 4.5 MB de Vercel). */
async function compress(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(r => c.toBlob(r, "image/jpeg", 0.82));
    return blob ?? file;
  } catch { return file; }
}

export default function InstalacionesTab({ t, onToast }: { t: LukonTheme; onToast: (msg: string, ok: boolean) => void }) {
  const [list, setList] = useState<Inst[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<{ kind: "lista" } | { kind: "form"; inst?: Inst } | { kind: "detalle"; id: string }>({ kind: "lista" });
  const [fStatus, setFStatus] = useState<"activas" | Status | "todas">("activas");
  const [fInst, setFInst] = useState<"" | number>("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/lukon/instalaciones");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No se pudieron cargar las instalaciones");
      setList(d.installations ?? []);
    } catch (e) { onToast((e as Error).message, false); } finally { setLoading(false); }
  }, [onToast]);
  useEffect(() => { load(); }, [load]);

  // Abrir una orden directo desde el correo (?orden=<id>)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("orden");
    if (id) setView({ kind: "detalle", id });
  }, []);

  const S = styles(t);
  const today = cdmxDay(new Date().toISOString());
  const month = today.slice(0, 7);
  const counts = useMemo(() => ({
    hoy: list.filter(i => i.status === "programada" && i.scheduled_at && cdmxDay(i.scheduled_at) === today).length,
    sitio: list.filter(i => i.status === "en_sitio").length,
    aceptar: list.filter(i => i.status === "terminada").length,
    incid: list.filter(i => i.status === "incidencia").length,
    mes: list.filter(i => ["terminada", "aceptada"].includes(i.status) && i.finished_at && cdmxDay(i.finished_at).startsWith(month)).length,
  }), [list, today, month]);

  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return list.filter(i =>
      (fStatus === "todas" ? true : fStatus === "activas" ? ["programada", "en_sitio", "terminada", "incidencia"].includes(i.status) : i.status === fStatus) &&
      (fInst === "" || i.installer_no === fInst) &&
      (!qq || [i.customer_name, i.vehicle_plate, folioTxt(i.folio), i.vehicle_brand, i.vehicle_model].some(x => (x ?? "").toLowerCase().includes(qq)))
    ).sort((a, b) => {
      // En curso primero, luego programadas por fecha más próxima, luego el resto por fecha reciente
      const rank = (i: Inst) => (i.status === "incidencia" ? -1 : i.status === "en_sitio" ? 0 : i.status === "programada" ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      const ta = +new Date(a.scheduled_at ?? a.finished_at ?? 0), tb = +new Date(b.scheduled_at ?? b.finished_at ?? 0);
      return rank(a) === 1 ? ta - tb : tb - ta;
    });
  }, [list, fStatus, fInst, q]);

  if (view.kind === "form") return <OrderForm t={t} inst={view.inst} onToast={onToast}
    onCancel={() => setView(view.inst ? { kind: "detalle", id: view.inst.id } : { kind: "lista" })}
    onSaved={i => { load(); setView({ kind: "detalle", id: i.id }); }} />;
  if (view.kind === "detalle") return <OrderDetail t={t} id={view.id} onToast={onToast}
    onBack={() => { load(); setView({ kind: "lista" }); }} onEdit={inst => setView({ kind: "form", inst })} />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <h2 style={S.h2}>— Instalaciones</h2>
        <button style={S.btn} onClick={() => setView({ kind: "form" })}>+ Nueva instalación</button>
      </div>

      <div className="lk-grid-4" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", marginBottom: 18 }}>
        {([["Programadas hoy", counts.hoy], ["En sitio ahora", counts.sitio], ["Por aceptar", counts.aceptar], ...(counts.incid ? [["⚠️ Con incidencia", counts.incid]] : []), ["Terminadas este mes", counts.mes]] as [string, number][]).map(([k, v]) => (
          <div key={k} style={S.card}><div style={S.label}>{k}</div><div style={{ fontFamily: t.fDisplay, fontSize: 34, color: t.ink, lineHeight: 1.1, marginTop: 4 }}>{v}</div></div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select value={fStatus} onChange={e => setFStatus(e.target.value as typeof fStatus)} style={{ ...S.input, flex: "1 1 160px" }}>
          <option value="activas">Activas (programadas, en sitio, por aceptar, incidencias)</option>
          {(Object.keys(STATUS_LABEL) as Status[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          <option value="todas">Todas</option>
        </select>
        <select value={fInst} onChange={e => setFInst(e.target.value ? Number(e.target.value) : "")} style={{ ...S.input, flex: "1 1 140px" }}>
          <option value="">Todos los instaladores</option>
          {INSTALLERS.map(n => <option key={n} value={n}>Instalador {n}</option>)}
        </select>
        <input placeholder="Buscar cliente, placa o folio" value={q} onChange={e => setQ(e.target.value)} style={{ ...S.input, flex: "2 1 200px" }} />
      </div>

      {loading && !list.length && <p style={S.muted}>Cargando…</p>}
      {!loading && !shown.length && (
        <div style={{ ...S.card, textAlign: "center", padding: 28 }}>
          <p style={{ ...S.muted, margin: 0 }}>{list.length ? "No hay instalaciones con estos filtros." : "Todavía no hay instalaciones. Crea la primera con “Nueva instalación”."}</p>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map(i => (
          <button key={i.id} onClick={() => setView({ kind: "detalle", id: i.id })} style={{ ...S.card, textAlign: "left", cursor: "pointer", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontFamily: t.fMono, fontSize: 12, color: t.mutedL }}>{folioTxt(i.folio)}</span>
                <Badge t={t} s={i.status} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 16, color: t.ink, marginTop: 4 }}>{i.customer_name}</div>
              <div style={{ fontSize: 13, color: t.mutedL, marginTop: 2 }}>{vehicle(i)}{i.vehicle_plate ? ` · ${i.vehicle_plate}` : ""} · {SERVICE_LABEL[i.service]}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 13, color: t.ink3, minWidth: 130 }}>
              <div style={{ fontWeight: 600 }}>{i.status === "programada" ? fmt(i.scheduled_at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : i.finished_at ? `Terminó ${fmt(i.finished_at)}` : i.started_at ? `Empezó ${fmt(i.started_at)}` : "—"}</div>
              <div style={{ color: t.mutedL, marginTop: 2 }}>{i.installer_no ? `Instalador ${i.installer_no}` : "Sin instalador"}{i.photos ? ` · ${i.photos} fotos` : ""}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Badge({ t, s }: { t: LukonTheme; s: Status }) {
  const c: Record<Status, [string, string]> = {
    programada: ["#E9F2FF", "#0062C4"], en_sitio: ["#FFF1D6", "#B87500"], terminada: ["#F1E8FF", "#6B3FB8"], incidencia: ["#FDECEA", "#C0392B"],
    aceptada: ["#E7F6EC", "#1F8A4C"], cancelada: [t.paper2, t.mutedL],
  };
  return <span style={{ background: c[s][0], color: c[s][1], fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 10, whiteSpace: "nowrap" }}>{STATUS_LABEL[s]}</span>;
}

function styles(t: LukonTheme) {
  return {
    h2: { fontFamily: t.fMono, fontSize: 13, fontWeight: 500, color: t.mutedL, letterSpacing: "0.2em", textTransform: "uppercase" as const, margin: 0 },
    label: { fontFamily: t.fMono, fontSize: 10, color: t.mutedL, letterSpacing: "0.15em", textTransform: "uppercase" as const },
    card: { background: "#FFFFFF", border: `1px solid ${t.lineL}`, borderRadius: 10, padding: "14px 16px", font: "inherit", color: "inherit", width: "100%" } as React.CSSProperties,
    input: { padding: "11px 12px", border: `1px solid ${t.lineL}`, borderRadius: 6, background: "#fff", fontFamily: t.fBody, fontSize: 15, color: t.ink, width: "100%", boxSizing: "border-box" as const },
    btn: { background: t.ink, color: t.signal, border: "none", borderRadius: 6, padding: "12px 20px", fontFamily: t.fBody, fontWeight: 700, fontSize: 15, cursor: "pointer" },
    ghost: { background: "transparent", color: t.ink, border: `1px solid ${t.lineL}`, borderRadius: 6, padding: "10px 14px", fontFamily: t.fBody, fontWeight: 600, fontSize: 14, cursor: "pointer" },
    muted: { fontFamily: t.fBody, fontSize: 14, color: t.mutedL },
  };
}

// ─── Nueva / editar orden ────────────────────────────────────────────────────
function OrderForm({ t, inst, onCancel, onSaved, onToast }: {
  t: LukonTheme; inst?: Inst; onCancel: () => void; onSaved: (i: Inst) => void; onToast: (m: string, ok: boolean) => void;
}) {
  const S = styles(t);
  const [f, setF] = useState({
    customer_name: inst?.customer_name ?? "", customer_email: inst?.customer_email ?? "", customer_phone: inst?.customer_phone ?? "",
    vehicle_brand: inst?.vehicle_brand ?? "", vehicle_model: inst?.vehicle_model ?? "", vehicle_year: inst?.vehicle_year ? String(inst.vehicle_year) : "",
    vehicle_plate: inst?.vehicle_plate ?? "", vehicle_color: inst?.vehicle_color ?? "", service: inst?.service ?? "gps" as Service,
    address: inst?.address ?? "", scheduled_at: toLocalInput(inst?.scheduled_at ?? null), installer_no: inst?.installer_no ? String(inst.installer_no) : "",
    notes: inst?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF(p => ({ ...p, [k]: e.target.value }));

  async function save() {
    if (!f.customer_name.trim()) return onToast("Falta el nombre del cliente", false);
    setBusy(true);
    try {
      const body = { ...f, scheduled_at: f.scheduled_at ? new Date(f.scheduled_at).toISOString() : null, ...(inst ? { action: "update" } : {}) };
      const r = await fetch(inst ? `/api/lukon/instalaciones/${inst.id}` : "/api/lukon/instalaciones", {
        method: inst ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No se pudo guardar");
      onToast(inst ? "Orden actualizada" : `Orden ${folioTxt(d.installation.folio)} creada`, true);
      onSaved(d.installation);
    } catch (e) { onToast((e as Error).message, false); } finally { setBusy(false); }
  }

  const field = (label: string, el: React.ReactNode, wide = false) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: wide ? "1 / -1" : undefined }}>
      <span style={S.label}>{label}</span>{el}
    </label>
  );
  return (
    <div>
      <button style={{ ...S.ghost, marginBottom: 16 }} onClick={onCancel}>← {inst ? "Volver a la orden" : "Volver"}</button>
      <h2 style={{ ...S.h2, marginBottom: 18 }}>— {inst ? `Editar ${folioTxt(inst.folio)}` : "Nueva instalación"}</h2>
      <div style={{ ...S.card, display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div style={{ ...S.label, gridColumn: "1 / -1", color: t.ink }}>Cliente</div>
        {field("Nombre *", <input style={S.input} value={f.customer_name} onChange={set("customer_name")} />)}
        {field("Correo (recibe el reporte)", <input style={S.input} type="email" value={f.customer_email} onChange={set("customer_email")} />)}
        {field("Teléfono / WhatsApp", <input style={S.input} type="tel" value={f.customer_phone} onChange={set("customer_phone")} />)}
        <div style={{ ...S.label, gridColumn: "1 / -1", color: t.ink, marginTop: 6 }}>Vehículo</div>
        {field("Marca", <input style={S.input} value={f.vehicle_brand} onChange={set("vehicle_brand")} />)}
        {field("Modelo", <input style={S.input} value={f.vehicle_model} onChange={set("vehicle_model")} />)}
        {field("Año", <input style={S.input} inputMode="numeric" value={f.vehicle_year} onChange={set("vehicle_year")} />)}
        {field("Placa", <input style={{ ...S.input, textTransform: "uppercase" }} value={f.vehicle_plate} onChange={set("vehicle_plate")} />)}
        {field("Color", <input style={S.input} value={f.vehicle_color} onChange={set("vehicle_color")} />)}
        <div style={{ ...S.label, gridColumn: "1 / -1", color: t.ink, marginTop: 6 }}>Servicio y cita</div>
        {field("Servicio", <select style={S.input} value={f.service} onChange={set("service")}>
          {(Object.keys(SERVICE_LABEL) as Service[]).map(s => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}
        </select>)}
        {field("Fecha y hora", <input style={S.input} type="datetime-local" value={f.scheduled_at} onChange={set("scheduled_at")} />)}
        {field("Instalador", <select style={S.input} value={f.installer_no} onChange={set("installer_no")}>
          <option value="">Sin asignar</option>
          {INSTALLERS.map(n => <option key={n} value={n}>Instalador {n}</option>)}
        </select>)}
        {field("Dirección", <input style={S.input} value={f.address} onChange={set("address")} />, true)}
        {field("Notas para el instalador", <textarea style={{ ...S.input, minHeight: 70 }} value={f.notes} onChange={set("notes")} />, true)}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save}>{busy ? "Guardando…" : inst ? "Guardar cambios" : "Crear orden"}</button>
        <button style={S.ghost} onClick={onCancel} disabled={busy}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── Detalle / en sitio ──────────────────────────────────────────────────────
function OrderDetail({ t, id, onBack, onEdit, onToast }: {
  t: LukonTheme; id: string; onBack: () => void; onEdit: (i: Inst) => void; onToast: (m: string, ok: boolean) => void;
}) {
  const S = styles(t);
  const [inst, setInst] = useState<Inst | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [busy, setBusy] = useState("");
  const [dev, setDev] = useState({ device_imei: "", sim_iccid: "", dashcam_serial: "", hidden_location: "", tech_notes: "", customer_email: "", remote_cutoff_test: "" });
  const [resched, setResched] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/lukon/instalaciones/${id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No se pudo cargar la orden");
      setInst(d.installation); setPhotos(d.photos ?? []); setEvents(d.events ?? []);
      setDev(p => ({
        device_imei: p.device_imei || d.installation.device_imei || "", sim_iccid: p.sim_iccid || d.installation.sim_iccid || "",
        dashcam_serial: p.dashcam_serial || d.installation.dashcam_serial || "", hidden_location: p.hidden_location || d.installation.hidden_location || "",
        tech_notes: p.tech_notes || d.installation.tech_notes || "", customer_email: p.customer_email || d.installation.customer_email || "",
        remote_cutoff_test: p.remote_cutoff_test || d.installation.remote_cutoff_test || "",
      }));
    } catch (e) { onToast((e as Error).message, false); }
  }, [id, onToast]);
  useEffect(() => { load(); }, [load]);

  async function patch(body: Record<string, unknown>, label: string, okMsg: string) {
    setBusy(label);
    try {
      const r = await fetch(`/api/lukon/instalaciones/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "No se pudo guardar");
      onToast(d.report && !d.report.ok ? `${okMsg}. Ojo: ${d.report.error}` : okMsg, !(d.report && !d.report.ok));
      await load();
      return true;
    } catch (e) { onToast((e as Error).message, false); return false; } finally { setBusy(""); }
  }

  if (!inst) return <div><button style={S.ghost} onClick={onBack}>← Volver</button><p style={S.muted}>Cargando…</p></div>;

  const kinds = photos.map(p => p.kind);
  const steps = stepsFor(inst.service);
  const faltan = [...missingPhotos(inst.service, "antes", kinds), ...missingPhotos(inst.service, "despues", kinds)];
  const needImei = inst.service !== "dashcam";
  const pendientes = [...faltan, ...(needImei && !dev.device_imei.trim() ? ["IMEI"] : []), ...(needImei && !dev.remote_cutoff_test ? ["prueba de apagado remoto"] : [])];
  const live = inst.status === "en_sitio";
  const reportUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/instalacion/${inst.report_token}`;
  const daysLeft = inst.report_sent_at ? Math.max(0, Math.ceil(AUTO_ACCEPT_DAYS - (Date.now() - +new Date(inst.report_sent_at)) / 86400e3)) : null;
  const tel = (inst.customer_phone ?? "").replace(/\D/g, "").slice(-10);

  const info: [string, React.ReactNode][] = [
    ["Cliente", inst.customer_name],
    ["Contacto", <>{inst.customer_phone ? <a href={`https://wa.me/52${tel}`} style={{ color: t.ink }}>{inst.customer_phone}</a> : "—"}{inst.customer_email ? ` · ${inst.customer_email}` : ""}</>],
    ["Vehículo", `${vehicle(inst)}${inst.vehicle_color ? ` · ${inst.vehicle_color}` : ""}`],
    ["Placa", inst.vehicle_plate || "—"],
    ["Servicio", SERVICE_LABEL[inst.service]],
    ["Cita", fmt(inst.scheduled_at, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })],
    ["Instalador", inst.installer_no ? `Instalador ${inst.installer_no}` : "Sin asignar"],
    ["Dirección", inst.address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(inst.address)}`} target="_blank" rel="noopener noreferrer" style={{ color: t.ink }}>{inst.address}</a> : "—"],
    ...(inst.notes ? [["Notas", inst.notes] as [string, React.ReactNode]] : []),
    ...(inst.started_at ? [["Inicio", fmt(inst.started_at)] as [string, React.ReactNode]] : []),
    ...(inst.finished_at ? [["Término", fmt(inst.finished_at)] as [string, React.ReactNode]] : []),
    ...(inst.cancel_reason ? [["Motivo de cancelación", inst.cancel_reason] as [string, React.ReactNode]] : []),
  ];

  return (
    <div>
      <button style={{ ...S.ghost, marginBottom: 16 }} onClick={onBack}>← Instalaciones</button>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: t.fMono, fontSize: 13, color: t.mutedL }}>{folioTxt(inst.folio)}</span><Badge t={t} s={inst.status} />
          </div>
          <div style={{ fontFamily: t.fDisplay, fontSize: 32, color: t.ink, lineHeight: 1.1, marginTop: 4 }}>{inst.customer_name}</div>
          <div style={S.muted}>{vehicle(inst)}{inst.vehicle_plate ? ` · ${inst.vehicle_plate}` : ""}</div>
        </div>
        {["programada", "en_sitio"].includes(inst.status) && <button style={S.ghost} onClick={() => onEdit(inst)}>Editar datos</button>}
      </div>

      {/* Acciones según el estado */}
      {inst.status === "programada" && (
        <div style={{ ...S.card, marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <button style={{ ...S.btn, padding: "16px 20px", fontSize: 17 }} disabled={!!busy}
            onClick={async () => { setBusy("start"); const pos = await getPosition(); setBusy(""); await patch({ action: "start", ...(pos ?? {}) }, "start", pos ? "Instalación iniciada" : "Instalación iniciada (sin ubicación del celular)"); }}>
            {busy === "start" ? "Registrando llegada…" : "▶  Empezar instalación"}
          </button>
          <p style={{ ...S.muted, fontSize: 12, margin: 0 }}>Registra la hora y la ubicación del celular. Después toma las fotos de “antes”.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {resched === null
              ? <button style={S.ghost} onClick={() => setResched(toLocalInput(inst.scheduled_at))}>Reprogramar</button>
              : <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", width: "100%" }}>
                  <input type="datetime-local" style={{ ...S.input, flex: "1 1 200px" }} value={resched} onChange={e => setResched(e.target.value)} />
                  <button style={S.btn} disabled={!resched || !!busy} onClick={async () => { if (await patch({ action: "reschedule", scheduled_at: new Date(resched!).toISOString() }, "resched", "Cita reprogramada")) setResched(null); }}>Guardar</button>
                  <button style={S.ghost} onClick={() => setResched(null)}>×</button>
                </div>}
            {cancelReason === null
              ? <button style={{ ...S.ghost, color: t.crimson }} onClick={() => setCancelReason("")}>Cancelar orden</button>
              : <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", width: "100%" }}>
                  <input placeholder="Motivo de la cancelación" style={{ ...S.input, flex: "1 1 200px" }} value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
                  <button style={{ ...S.btn, background: t.crimson, color: "#fff" }} disabled={!cancelReason.trim() || !!busy}
                    onClick={async () => { if (await patch({ action: "cancel", reason: cancelReason }, "cancel", "Orden cancelada")) setCancelReason(null); }}>Cancelar orden</button>
                  <button style={S.ghost} onClick={() => setCancelReason(null)}>×</button>
                </div>}
          </div>
        </div>
      )}

      {inst.status === "incidencia" && (
        <div style={{ ...S.card, marginTop: 16, background: "#FDF1EF", borderColor: "#F2C4BD" }}>
          <div style={{ fontWeight: 700, color: "#C0392B" }}>⚠️ El cliente NO aceptó la instalación</div>
          <p style={{ ...S.muted, margin: "6px 0 4px" }}>Reportado el {fmt(inst.incident_at)}. La aceptación automática quedó detenida.</p>
          <div style={{ background: "#fff", border: "1px solid #F2C4BD", borderRadius: 8, padding: "10px 12px", fontSize: 14, color: t.ink, margin: "8px 0 12px" }}>“{inst.incident_reason}”</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {inst.customer_phone && <a href={`https://wa.me/52${tel}?text=${encodeURIComponent(`Hola ${inst.customer_name.split(/\s+/)[0]}, te escribo de LUKON por tu reporte de la instalación ${folioTxt(inst.folio)}.`)}`} target="_blank" rel="noopener noreferrer" style={{ ...S.btn, background: "#25D366", color: "#fff", textDecoration: "none" }}>WhatsApp al cliente</a>}
            <a href={reportUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.ghost, textDecoration: "none" }}>Ver reporte</a>
            <button style={S.ghost} disabled={!!busy || !inst.customer_email} onClick={async () => {
              setBusy("send");
              try {
                const r = await fetch(`/api/lukon/instalaciones/${id}/enviar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
                const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "No se pudo enviar");
                onToast("Resuelta: reporte reenviado, vuelve a esperar aceptación", true); await load();
              } catch (e) { onToast((e as Error).message, false); } finally { setBusy(""); }
            }}>{busy === "send" ? "Enviando…" : "Resuelta: reenviar reporte"}</button>
            <button style={S.ghost} disabled={!!busy} onClick={() => patch({ action: "accept", reason: "Incidencia resuelta; el cliente confirmó por otro medio" }, "accept", "Marcada como aceptada")}>Marcar aceptada</button>
          </div>
        </div>
      )}

      {inst.status === "terminada" && (
        <div style={{ ...S.card, marginTop: 16, background: "#F7F2FF", borderColor: "#D9C8F5" }}>
          <div style={{ fontWeight: 700, color: "#6B3FB8" }}>Esperando que el cliente acepte</div>
          <p style={{ ...S.muted, margin: "6px 0 12px" }}>
            {inst.report_sent_at ? <>Reporte enviado a <b>{inst.report_sent_to}</b> el {fmt(inst.report_sent_at)}. Se acepta solo en {daysLeft} {daysLeft === 1 ? "día" : "días"} si no responde.</>
              : <>El reporte no se ha enviado{inst.customer_email ? "" : ": la orden no tiene correo del cliente"}.</>}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <a href={reportUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.ghost, textDecoration: "none" }}>Ver reporte</a>
            <input type="email" placeholder="Correo del cliente" value={dev.customer_email} onChange={e => setDev(p => ({ ...p, customer_email: e.target.value }))} style={{ ...S.input, flex: "1 1 200px", width: "auto" }} />
            <button style={S.btn} disabled={!!busy || !dev.customer_email.trim()} onClick={async () => {
              setBusy("send");
              try {
                const r = await fetch(`/api/lukon/instalaciones/${id}/enviar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: dev.customer_email }) });
                const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "No se pudo enviar");
                onToast("Reporte enviado", true); await load();
              } catch (e) { onToast((e as Error).message, false); } finally { setBusy(""); }
            }}>{busy === "send" ? "Enviando…" : inst.report_sent_at ? "Reenviar reporte" : "Enviar reporte"}</button>
            <button style={S.ghost} disabled={!!busy} onClick={() => patch({ action: "accept", reason: "El cliente lo confirmó por otro medio" }, "accept", "Marcada como aceptada")}>Marcar aceptada</button>
          </div>
        </div>
      )}

      {inst.status === "aceptada" && (
        <div style={{ ...S.card, marginTop: 16, background: "#EEF9F1", borderColor: "#BFE5CC", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ color: "#1F8A4C", fontWeight: 700 }}>✓ Aceptada {inst.accepted_auto ? "automáticamente" : ""} el {fmt(inst.accepted_at)}</div>
          <a href={reportUrl} target="_blank" rel="noopener noreferrer" style={{ ...S.ghost, textDecoration: "none" }}>Ver reporte</a>
        </div>
      )}

      {/* Datos */}
      <div style={{ ...S.card, marginTop: 16, padding: 0, overflow: "hidden" }}>
        {info.map(([k, v], n) => (
          <div key={k} style={{ display: "flex", gap: 12, padding: "10px 16px", background: n % 2 ? "#fff" : t.paper, fontSize: 14 }}>
            <span style={{ flex: "0 0 110px", color: t.mutedL }}>{k}</span><span style={{ color: t.ink, wordBreak: "break-word" }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Fotos guiadas */}
      {(["antes", "despues"] as Stage[]).map(stage => (
        <div key={stage} style={{ marginTop: 22 }}>
          <div style={{ ...S.label, color: t.ink, marginBottom: 10 }}>{stage === "antes" ? "Fotos de antes · así recibimos el vehículo" : "Fotos de después · así lo entregamos"}</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {steps.filter(s => s.stage === stage).map(s => {
              const ps = photos.filter(p => p.stage === stage && p.kind === s.kind);
              if (!live && !ps.length) return null;
              return <PhotoStep key={s.kind} t={t} instId={id} step={s} photos={ps} editable={live || inst.status === "programada"}
                onChange={load} onToast={onToast} onOpen={setLightbox} />;
            })}
          </div>
          {!live && !photos.some(p => p.stage === stage) && <p style={S.muted}>Sin fotos.</p>}
        </div>
      ))}

      {/* Cierre */}
      {live && (
        <div style={{ ...S.card, marginTop: 22, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <div style={{ ...S.label, gridColumn: "1 / -1", color: t.ink }}>Datos del equipo</div>
          {needImei && <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={S.label}>IMEI del GPS *</span>
            <input style={S.input} inputMode="numeric" value={dev.device_imei} onChange={e => setDev(p => ({ ...p, device_imei: e.target.value }))} /></label>}
          {needImei && <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={S.label}>SIM (ICCID)</span>
            <input style={S.input} inputMode="numeric" value={dev.sim_iccid} onChange={e => setDev(p => ({ ...p, sim_iccid: e.target.value }))} /></label>}
          {inst.service !== "gps" && <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={S.label}>Serie de la dashcam</span>
            <input style={S.input} value={dev.dashcam_serial} onChange={e => setDev(p => ({ ...p, dashcam_serial: e.target.value }))} /></label>}
          {needImei && (
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ ...S.label, marginBottom: 6 }}>Prueba de apagado remoto *</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {([["exitosa", "✓ Probada y exitosa"], ["no_aplica", "No aplica (sin corte de motor)"]] as [string, string][]).map(([v, l]) => {
                  const on = dev.remote_cutoff_test === v;
                  return <button key={v} type="button" onClick={() => setDev(p => ({ ...p, remote_cutoff_test: v }))}
                    style={{ ...S.ghost, flex: "1 1 180px", background: on ? (v === "exitosa" ? "#E7F6EC" : t.paper2) : "#fff", borderColor: on ? (v === "exitosa" ? "#1F8A4C" : t.ink3) : t.lineL, color: on && v === "exitosa" ? "#1F8A4C" : t.ink, fontWeight: on ? 700 : 600 }}>{l}</button>;
                })}
              </div>
            </div>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={S.label}>Correo del cliente (recibe el reporte)</span>
            <input style={S.input} type="email" value={dev.customer_email} onChange={e => setDev(p => ({ ...p, customer_email: e.target.value }))} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}><span style={S.label}>🔒 Dónde quedó el equipo (interno, no va al cliente)</span>
            <input style={S.input} placeholder="Ej. detrás del tablero, lado copiloto" value={dev.hidden_location} onChange={e => setDev(p => ({ ...p, hidden_location: e.target.value }))} /></label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, gridColumn: "1 / -1" }}><span style={S.label}>🔒 Notas técnicas (internas)</span>
            <textarea style={{ ...S.input, minHeight: 60 }} value={dev.tech_notes} onChange={e => setDev(p => ({ ...p, tech_notes: e.target.value }))} /></label>
          <div style={{ gridColumn: "1 / -1" }}>
            {pendientes.length > 0 && (
              <p style={{ fontSize: 13, color: "#B87500", margin: "0 0 10px" }}>
                Para terminar falta: {pendientes.join(", ")}.
              </p>
            )}
            <button style={{ ...S.btn, padding: "16px 20px", fontSize: 17, width: "100%", opacity: pendientes.length || busy ? 0.5 : 1 }}
              disabled={!!busy || pendientes.length > 0}
              onClick={async () => {
                setBusy("finish"); const pos = await getPosition(); setBusy("");
                await patch({ action: "finish", ...dev, ...(pos ?? {}) }, "finish", dev.customer_email.trim() ? "Instalación terminada y reporte enviado" : "Instalación terminada (sin correo: el reporte no se envió)");
              }}>
              {busy === "finish" ? "Cerrando…" : "■  Terminar y enviar reporte"}
            </button>
          </div>
        </div>
      )}

      {/* Datos internos de una orden cerrada */}
      {!live && (inst.device_imei || inst.hidden_location || inst.tech_notes || inst.remote_cutoff_test) && (
        <div style={{ ...S.card, marginTop: 22, fontSize: 14 }}>
          <div style={{ ...S.label, color: t.ink, marginBottom: 8 }}>Equipo · 🔒 interno</div>
          {inst.device_imei && <div>IMEI: <b>{inst.device_imei}</b>{inst.sim_iccid ? ` · SIM ${inst.sim_iccid}` : ""}</div>}
          {inst.dashcam_serial && <div>Dashcam: <b>{inst.dashcam_serial}</b></div>}
          {inst.remote_cutoff_test && <div>Apagado remoto: <b>{inst.remote_cutoff_test === "exitosa" ? "✓ Exitosa" : "No aplica"}</b></div>}
          {inst.hidden_location && <div>Ubicación del equipo: <b>{inst.hidden_location}</b></div>}
          {inst.tech_notes && <div style={{ color: t.mutedL, marginTop: 4 }}>{inst.tech_notes}</div>}
        </div>
      )}

      {/* Línea de tiempo */}
      <div style={{ marginTop: 22 }}>
        <div style={{ ...S.label, color: t.ink, marginBottom: 10 }}>Línea de tiempo</div>
        <div style={{ borderLeft: `2px solid ${t.lineL}`, paddingLeft: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {events.map((e, n) => (
            <div key={n} style={{ fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: t.ink }}>{EV_LABEL[e.type] ?? e.type} <span style={{ fontWeight: 400, color: t.mutedL }}>· {fmt(e.at)}</span></div>
              {e.detail && <div style={{ color: t.mutedL }}>{e.detail}</div>}
            </div>
          ))}
        </div>
      </div>

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}

function PhotoStep({ t, instId, step, photos, editable, onChange, onToast, onOpen }: {
  t: LukonTheme; instId: string; step: ReturnType<typeof stepsFor>[number]; photos: Photo[]; editable: boolean;
  onChange: () => void; onToast: (m: string, ok: boolean) => void; onOpen: (url: string) => void;
}) {
  const S = styles(t);
  const ref = useRef<HTMLInputElement>(null);      // cámara
  const galRef = useRef<HTMLInputElement>(null);   // galería / archivos
  const [up, setUp] = useState(0);
  const done = photos.length > 0;
  const canAdd = editable && (step.multi || !done);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, step.multi ? 6 : 1);
    setUp(list.length);
    let fails = 0;
    for (const f of list) {
      try {
        const blob = await compress(f);
        const fd = new FormData();
        fd.append("file", blob, "foto.jpg"); fd.append("stage", step.stage); fd.append("kind", step.kind);
        const r = await fetch(`/api/lukon/instalaciones/${instId}/fotos`, { method: "POST", body: fd });
        if (!r.ok) { fails++; const d = await r.json().catch(() => ({})); onToast(d.error ?? "No se pudo subir la foto", false); }
      } catch { fails++; onToast("No se pudo subir la foto. Revisa la señal e intenta de nuevo.", false); }
      setUp(n => n - 1);
    }
    if (ref.current) ref.current.value = "";
    if (galRef.current) galRef.current.value = "";
    if (!fails) onToast(list.length > 1 ? `${list.length} fotos subidas` : "Foto subida", true);
    onChange();
  }

  async function remove(p: Photo) {
    const r = await fetch(`/api/lukon/instalaciones/${instId}/fotos?photo=${p.id}`, { method: "DELETE" });
    if (!r.ok) { const d = await r.json().catch(() => ({})); return onToast(d.error ?? "No se pudo borrar", false); }
    onChange();
  }

  return (
    <div style={{ ...S.card, borderColor: done ? "#BFE5CC" : step.need && editable ? "#F3D9A4" : t.lineL }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, color: t.ink, fontSize: 14 }}>{done ? "✓ " : ""}{step.label}{step.need ? "" : <span style={{ fontWeight: 400, color: t.mutedL }}> · opcional</span>}</div>
          {editable && <div style={{ fontSize: 12, color: t.mutedL, marginTop: 2 }}>{step.hint}</div>}
        </div>
      </div>
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {photos.map(p => (
            <div key={p.id} style={{ position: "relative" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url ?? ""} alt={step.label} onClick={() => p.url && onOpen(p.url)} style={{ width: 84, height: 64, objectFit: "cover", borderRadius: 6, cursor: "zoom-in", background: t.paper2 }} />
              {editable && <button aria-label="Borrar foto" onClick={() => remove(p)} style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, border: "none", background: t.crimson, color: "#fff", fontSize: 13, lineHeight: "22px", cursor: "pointer", padding: 0 }}>×</button>}
            </div>
          ))}
        </div>
      )}
      {canAdd && (
        <>
          {/* Cámara (capture abre directo la cámara en iOS/Android) y galería por separado:
              muchas veces toman todas las fotos de un jalón y las suben al final. */}
          <input ref={ref} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={e => onFiles(e.target.files)} />
          <input ref={galRef} type="file" accept="image/*" multiple={!!step.multi} style={{ display: "none" }} onChange={e => onFiles(e.target.files)} />
          {up > 0
            ? <div style={{ ...S.ghost, marginTop: 10, textAlign: "center", cursor: "default" }}>Subiendo{up > 1 ? ` (${up})` : ""}…</div>
            : <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button style={{ ...S.ghost, flex: 1, padding: "10px 8px" }} onClick={() => ref.current?.click()}>📷 {done ? "Otra" : "Tomar foto"}</button>
                <button style={{ ...S.ghost, flex: 1, padding: "10px 8px" }} onClick={() => galRef.current?.click()}>🖼 {step.multi ? "Adjuntar fotos" : "Adjuntar"}</button>
              </div>}
        </>
      )}
    </div>
  );
}
