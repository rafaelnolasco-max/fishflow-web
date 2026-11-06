"use client";

// ─── LUKON · Prospectos de la landing ─────────────────────────────────────────
// Lee `leads` (client_id de LUKON, source 'lukon_landing'). RLS ya limita a los
// prospectos del cliente; el filtro explícito es defensa en profundidad.
// Los registra /api/lukon/lead (formulario "Toma el control" de la landing).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase, LUKON_CLIENT_ID } from "@/lib/supabase";

export type LukonTheme = {
  ink: string; ink2: string; ink3: string; paper: string; paper2: string;
  line: string; lineL: string; muted: string; mutedL: string; signal: string;
  crimson: string; amber: string; fBody: string; fMono: string; fDisplay: string;
};

interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  problem: string | null;
  status: string | null;
  notes: string | null;
  answers: { vehiculo?: string; unidades?: string | null; plan?: string | null; cp?: string | null } | null;
  utm_source: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  created_at: string;
}

const ESTATUS: { id: string; label: string; bg: string; fg: string }[] = [
  { id: "nuevo",      label: "Nuevo",      bg: "#E9F2FF", fg: "#0062C4" },
  { id: "contactado", label: "Contactado", bg: "#FFF4E5", fg: "#B96A1E" },
  { id: "cotizado",   label: "Cotizado",   bg: "#F1EAFE", fg: "#6B3FD1" },
  { id: "ganado",     label: "Ganado",     bg: "#E6F7EE", fg: "#1A8A55" },
  { id: "perdido",    label: "Perdido",    bg: "#F2F4F7", fg: "#6B7280" },
];
const meta = (id: string | null) => ESTATUS.find((s) => s.id === (id || "nuevo")) ?? ESTATUS[0];
const VEHICULOS = ["Auto", "Moto", "Carga", "Flotilla"];

function campo(problem: string | null, etiqueta: string) {
  for (const part of (problem || "").split(" · ")) {
    const i = part.indexOf(":");
    if (i > -1 && part.slice(0, i).trim().toLowerCase() === etiqueta.toLowerCase()) return part.slice(i + 1).trim();
  }
  return "";
}
function datos(l: Lead) {
  const a = l.answers || {};
  const vehRaw = a.vehiculo || campo(l.problem, "Vehículo");
  const vehiculo = vehRaw.replace(/\s*\(.*\)$/, "") || "—";
  return {
    vehiculo,
    unidades: a.unidades || (vehRaw.match(/\(([^)]+)\)/)?.[1]?.replace(" unidades", "") ?? ""),
    plan: a.plan || campo(l.problem, "Paquete"),
    cp: a.cp || campo(l.problem, "C.P."),
  };
}
const correoReal = (e: string | null) => (e && !e.endsWith("@lukon.local") ? e : "");
const ult10 = (v: string | null) => (v || "").replace(/\D/g, "").slice(-10);
function hace(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "justo ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

export default function ProspectosTab({ t, onToast }: { t: LukonTheme; onToast: (msg: string, ok: boolean) => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [cargando, setCargando] = useState(true);
  const [fEstatus, setFEstatus] = useState("todos");
  const [fVeh, setFVeh] = useState("todos");
  const [q, setQ] = useState("");
  // onToast llega como función nueva en cada render del panel: se guarda en ref
  // para que `cargar` no cambie y el efecto no se dispare en bucle.
  const toast = useRef(onToast);
  toast.current = onToast;

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error } = await supabase
      .from("leads")
      .select("id,name,email,phone,problem,status,notes,answers,utm_source,utm_campaign,utm_content,created_at")
      .eq("client_id", LUKON_CLIENT_ID)
      .eq("source", "lukon_landing")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) toast.current("No se pudieron cargar los prospectos", false);
    setLeads((data as Lead[]) ?? []);
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function cambiarEstatus(id: string, status: string) {
    const previo = leads;
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) { setLeads(previo); toast.current("No se pudo guardar el estatus", false); }
    else toast.current(`Estatus: ${meta(status).label}`, true);
  }

  const lista = useMemo(() => {
    const s = q.trim().toLowerCase();
    return leads.filter((l) => {
      const d = datos(l);
      if (fEstatus !== "todos" && (l.status || "nuevo") !== fEstatus) return false;
      if (fVeh !== "todos" && d.vehiculo !== fVeh) return false;
      if (s && ![l.name, l.phone, l.email, l.utm_campaign, d.plan].some((v) => (v || "").toLowerCase().includes(s))) return false;
      return true;
    });
  }, [leads, fEstatus, fVeh, q]);

  const kpis = useMemo(() => {
    const semana = leads.filter((l) => Date.now() - new Date(l.created_at).getTime() < 7 * 864e5).length;
    const flot = leads.filter((l) => datos(l).vehiculo === "Flotilla").length;
    const nuevos = leads.filter((l) => (l.status || "nuevo") === "nuevo").length;
    const ganados = leads.filter((l) => l.status === "ganado").length;
    return [
      { label: "Prospectos", valor: leads.length, sub: "desde la página" },
      { label: "Últimos 7 días", valor: semana, sub: "nuevos esta semana" },
      { label: "Sin contactar", valor: nuevos, sub: "en estatus Nuevo", alerta: nuevos > 0 },
      { label: "Flotillas", valor: flot, sub: `${ganados} ganado${ganados === 1 ? "" : "s"} en total` },
    ];
  }, [leads]);

  const input: React.CSSProperties = {
    background: "#fff", border: `1.5px solid ${t.lineL}`, borderRadius: 10, padding: "10px 12px",
    fontFamily: t.fBody, fontSize: 14, color: t.ink, outline: "none",
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: t.fMono, fontSize: 12, fontWeight: 700, letterSpacing: "0.18em", color: "#0084F9", textTransform: "uppercase" }}>Landing · Toma el control</div>
          <h2 style={{ fontFamily: t.fDisplay, fontWeight: 400, fontSize: 44, lineHeight: 1, margin: "6px 0 0", color: t.ink, textTransform: "uppercase" }}>Prospectos</h2>
        </div>
        <button onClick={cargar} style={{ ...input, cursor: "pointer", fontWeight: 600 }}>↻ Actualizar</button>
      </div>

      <div className="lk-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))", gap: 12, marginBottom: 22 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: k.alerta ? t.ink : "#fff", color: k.alerta ? "#fff" : t.ink, border: `1px solid ${k.alerta ? t.ink : t.lineL}`, borderRadius: 16, padding: "16px 18px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: k.alerta ? t.signal : t.mutedL }}>{k.label}</div>
            <div style={{ fontFamily: t.fDisplay, fontSize: 46, lineHeight: 1, margin: "6px 0 2px" }}>{k.valor}</div>
            <div style={{ fontSize: 12, color: k.alerta ? "rgba(255,255,255,.7)" : t.mutedL }}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <input placeholder="Buscar nombre, teléfono, campaña…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...input, flex: "1 1 220px" }} />
        <select value={fVeh} onChange={(e) => setFVeh(e.target.value)} style={input}>
          <option value="todos">Todos los vehículos</option>
          {VEHICULOS.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={fEstatus} onChange={(e) => setFEstatus(e.target.value)} style={input}>
          <option value="todos">Todos los estatus</option>
          {ESTATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {cargando ? (
        <p style={{ color: t.mutedL }}>Cargando prospectos…</p>
      ) : lista.length === 0 ? (
        <div style={{ background: "#fff", border: `1px dashed ${t.lineL}`, borderRadius: 16, padding: "36px 20px", textAlign: "center", color: t.mutedL }}>
          {leads.length === 0
            ? "Aún no llegan prospectos. Cuando alguien llene el formulario de la página, aparece aquí y te llega un correo."
            : "Ningún prospecto coincide con los filtros."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {lista.map((l) => {
            const d = datos(l);
            const m = meta(l.status);
            const tel = ult10(l.phone);
            const mail = correoReal(l.email);
            const flot = d.vehiculo === "Flotilla";
            const reenvios = ((l.notes || "").match(/\[Reenvi[oó] #/g) ?? []).length;
            const wa = tel ? `https://wa.me/52${tel}?text=${encodeURIComponent(`Hola ${(l.name || "").split(/\s+/)[0]}, te escribo de LUKON por la cotización que pediste.`)}` : "";
            return (
              <article key={l.id} style={{ background: "#fff", border: `1px solid ${flot ? "#0084F9" : t.lineL}`, borderRadius: 16, padding: "16px 18px", boxShadow: flot ? "0 10px 30px -18px rgba(0,132,249,.6)" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <b style={{ fontSize: 17, color: t.ink }}>{l.name || "Sin nombre"}</b>
                      {flot && <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em", background: "#0084F9", color: "#fff", padding: "3px 8px", borderRadius: 99 }}>FLOTILLA{d.unidades ? ` · ${d.unidades}` : ""}</span>}
                      {reenvios > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: "#FFF4E5", color: "#B96A1E", padding: "3px 8px", borderRadius: 99 }}>Escribió {reenvios + 1} veces</span>}
                    </div>
                    <div style={{ fontSize: 13, color: t.mutedL, marginTop: 4 }}>
                      {hace(l.created_at)} · {new Date(l.created_at).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <select aria-label="Estatus" value={l.status || "nuevo"} onChange={(e) => cambiarEstatus(l.id, e.target.value)}
                    style={{ border: "none", borderRadius: 99, padding: "7px 12px", fontWeight: 700, fontSize: 13, background: m.bg, color: m.fg, cursor: "pointer", fontFamily: t.fBody }}>
                    {ESTATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,150px),1fr))", gap: "8px 16px", margin: "14px 0", fontSize: 14 }}>
                  <Dato t={t} k="Quiere proteger" v={d.vehiculo} />
                  <Dato t={t} k="Paquete" v={d.plan || "—"} />
                  <Dato t={t} k="WhatsApp" v={l.phone || "—"} />
                  <Dato t={t} k="Correo" v={mail || "—"} />
                  <Dato t={t} k="C.P." v={d.cp || "—"} />
                  <Dato t={t} k="Campaña" v={l.utm_campaign ? `${l.utm_campaign}${l.utm_content ? " · " + l.utm_content : ""}` : "Orgánico"} />
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {wa && <a href={wa} target="_blank" rel="noopener" style={{ background: "#25D366", color: "#fff", borderRadius: 10, padding: "9px 14px", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>WhatsApp</a>}
                  {tel && <a href={`tel:+52${tel}`} style={{ border: `1.5px solid ${t.lineL}`, color: t.ink, borderRadius: 10, padding: "8px 14px", fontWeight: 600, fontSize: 14, textDecoration: "none" }}>Llamar</a>}
                  {mail && <a href={`mailto:${mail}?subject=${encodeURIComponent("Tu cotización LUKON")}`} style={{ border: `1.5px solid ${t.lineL}`, color: t.ink, borderRadius: 10, padding: "8px 14px", fontWeight: 600, fontSize: 14, textDecoration: "none" }}>Correo</a>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Dato({ t, k, v }: { t: LukonTheme; k: string; v: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: t.mutedL, fontWeight: 600 }}>{k}</div>
      <div style={{ color: t.ink, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
    </div>
  );
}
