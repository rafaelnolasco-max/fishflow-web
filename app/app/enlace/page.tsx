"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, ENLACE_CLIENT_ID } from "@/lib/supabase";
import type { InsuranceVendorTopClient } from "@/lib/supabase";
import {
  TabBar, StatGrid, StatCard, Chip,
  Section as DSection,
  cardStyle as mkCard,
  type DashTheme,
} from "@/components/dashboard";
import ReviewsTab from "./ReviewsTab";
import CandidatasTab from "./CandidatasTab";

// ─── Paleta Enlace Integral (verde + carbón) ──────────────────────────────────
const C = {
  bg:        "#F4F7F5",
  white:     "#FFFFFF",
  green:     "#65BC7B",
  greenDark: "#4B9A62",
  greenSoft: "#EAF7EE",
  carbon:    "#212934",
  muted:     "#5D7080",
  border:    "#E2EAE5",
  red:       "#D64545",
  gray:      "#9CA3AF",
} as const;

const T: DashTheme = {
  accent: C.green, accentDark: C.greenDark, accentSoft: C.greenSoft,
  bg: C.bg, surface: C.white, text: C.carbon,
  muted: C.muted, border: C.border, danger: C.red, disabled: C.gray,
};

const cardStyle = mkCard(T);
const selectStyle: React.CSSProperties = {
  padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
  fontSize: 13, fontFamily: "inherit", background: C.white, color: C.carbon, cursor: "pointer",
};
const Section = (p: Omit<React.ComponentProps<typeof DSection>, "theme">) => <DSection theme={T} {...p} />;

const META_VENDEDORES = 40;
const META_CLIENTES_POR_VENDEDOR = 20;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const SOURCE_LABEL: Record<string, string> = {
  web_form: "Formulario web",
  excel_upload: "Excel subido",
};

// ─── Prospectos de la landing (tabla `leads`, filtrados a Enlace por client_id) ──
interface Lead {
  id: string;
  name: string;
  email: string;
  problem: string;
  ai_response: string | null;
  source: string | null;
  created_at: string;
  assigned_to: string | null;
  status: string | null;
}

// Embudo simple de atención del prospecto
const LEAD_STATUS: { id: string; label: string; bg: string; fg: string }[] = [
  { id: "nuevo",      label: "Nuevo",      bg: "#EEF2F6", fg: "#5D7080" },
  { id: "asignado",   label: "Asignado",   bg: "#E5F0FF", fg: "#2563EB" },
  { id: "contactado", label: "Contactado", bg: "#FFF4E5", fg: "#B96A1E" },
  { id: "cerrado",    label: "Cerrado",    bg: "#EAF7EE", fg: "#4B9A62" },
];
function statusMeta(id: string | null) {
  return LEAD_STATUS.find((s) => s.id === (id || "nuevo")) ?? LEAD_STATUS[0];
}

// El `problem` viene como "[Landing Enlace Integral] · Plan: X · WhatsApp: Y · ..."
// Extrae el valor de una etiqueta puntual sin depender del orden.
function leadField(problem: string, label: string): string {
  for (const part of (problem || "").split(" · ")) {
    const i = part.indexOf(":");
    if (i > -1 && part.slice(0, i).trim().toLowerCase() === label.toLowerCase()) {
      return part.slice(i + 1).trim();
    }
  }
  return "";
}
function leadPlan(l: Lead): string {
  const fromAi = (l.ai_response || "").replace(/^Plan recomendado:\s*/i, "").trim();
  return fromAi || leadField(l.problem, "Plan") || "—";
}
function leadWhats(l: Lead): string {
  return leadField(l.problem, "WhatsApp");
}
function leadEmail(l: Lead): string {
  // los leads sin correo se guardan con un placeholder wa-...@enlace.local
  return /@enlace\.local$/i.test(l.email) ? "" : l.email;
}

// ─── Export CSV para Meta (Customer List Custom Audience) ─────────────────────
// Meta pide nombre y apellido por separado (no "nombre completo"). Heurística
// para nombres mexicanos: últimas 1-2 palabras = apellidos, el resto = nombre(s).
// No es perfecta pero es razonable — el match real lo hacen email + teléfono.
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  if (parts.length === 2) return { first: parts[0], last: parts[1] };
  if (parts.length === 3) return { first: parts[0], last: `${parts[1]} ${parts[2]}` };
  // 4+ palabras: asumimos N nombres + 2 apellidos (paterno + materno)
  return { first: parts.slice(0, -2).join(" "), last: parts.slice(-2).join(" ") };
}

// Normaliza a formato con lada (+52) cuando parece un número mexicano de 10 dígitos.
// Si no cuadra, se deja tal cual — mejor exportarlo imperfecto que perderlo.
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith("52")) return `+${digits}`;
  if (raw.trim().startsWith("+")) return raw.trim();
  return digits || raw.trim();
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function useIsMobile(breakpoint = 720) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return isMobile;
}

// Campos que componen el "avatar" de HubSpot (los 7 nuevos + fecha nac.).
// Nombre/tel/email casi siempre vienen llenos, así que no cuentan para el %.
const AVATAR_FIELDS = [
  "birth_date_or_age", "color", "occupation_type", "profession",
  "income", "dependents", "relevant_note", "products",
] as const;

function avatarPct(clients: InsuranceVendorTopClient[]): number {
  if (clients.length === 0) return 0;
  let filled = 0;
  for (const c of clients) {
    for (const f of AVATAR_FIELDS) {
      if (String((c as unknown as Record<string, unknown>)[f] ?? "").trim()) filled++;
    }
  }
  return Math.round((filled / (clients.length * AVATAR_FIELDS.length)) * 100);
}

type VendorGroup = {
  vendorName: string;
  clients: InsuranceVendorTopClient[];
  lastSubmission: string;
  avatar: number;
};

export default function EnlaceDashboardPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<InsuranceVendorTopClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"meta" | "avatar">("meta");
  const [mainTab, setMainTab] = useState<"captura" | "prospectos" | "resenas" | "candidatas">("captura");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/login?next=/app/enlace");
    });
  }, [router]);

  useEffect(() => {
    async function fetchLeads() {
      setLeadsLoading(true);
      // RLS ya limita a los leads de Enlace; el filtro explícito es defensa en profundidad.
      const { data, error } = await supabase
        .from("leads")
        .select("id,name,email,problem,ai_response,source,created_at,assigned_to,status")
        .eq("client_id", ENLACE_CLIENT_ID)
        .order("created_at", { ascending: false });
      if (error) console.error(error);
      else setLeads((data as Lead[]) ?? []);
      setLeadsLoading(false);
    }
    fetchLeads();
  }, []);

  // Conteo de candidatas (postulaciones en hiring_applications) para el badge del tab.
  // Fetch ligero con count exact/head: no trae filas, solo el número.
  const [candidatasCount, setCandidatasCount] = useState<number>(0);

  useEffect(() => {
    async function fetchCandidatasCount() {
      const { count, error } = await supabase
        .from("hiring_applications")
        .select("id", { count: "exact", head: true })
        .eq("client_id", ENLACE_CLIENT_ID);
      if (error) console.error(error);
      else setCandidatasCount(count ?? 0);
    }
    fetchCandidatasCount();
  }, []);

  useEffect(() => {
    async function fetchRows() {
      setLoading(true);
      const { data, error } = await supabase
        .from("insurance_vendor_top_clients")
        .select("*")
        .eq("client_id", ENLACE_CLIENT_ID)
        .order("vendor_name", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) console.error(error);
      else setRows(data ?? []);
      setLoading(false);
    }
    fetchRows();
  }, []);

  // ─── Duplicados en toda la base de Enlace ────────────────────────────────────
  // Un contacto está duplicado si su correo o su teléfono ya aparece en otro
  // registro. Casi siempre es la misma vendedora capturando dos veces; cuando son
  // dos vendedoras distintas hay que decidir a quién le toca el cliente.
  const dupInfo = useMemo(() => {
    const byEmail = new Map<string, InsuranceVendorTopClient[]>();
    const byPhone = new Map<string, InsuranceVendorTopClient[]>();
    for (const r of rows) {
      const em = (r.email || "").trim().toLowerCase();
      const ph = (r.phone || "").replace(/\D/g, "");
      if (em) { if (!byEmail.has(em)) byEmail.set(em, []); byEmail.get(em)!.push(r); }
      if (ph) { if (!byPhone.has(ph)) byPhone.set(ph, []); byPhone.get(ph)!.push(r); }
    }
    const ids = new Set<string>();
    const crossVendor = new Set<string>();
    for (const group of [...byEmail.values(), ...byPhone.values()]) {
      if (group.length < 2) continue;
      const vendors = new Set(group.map((g) => (g.vendor_name || "").trim().toLowerCase()));
      for (const g of group) {
        ids.add(g.id);
        if (vendors.size > 1) crossVendor.add(g.id);
      }
    }
    return { ids, crossVendor };
  }, [rows]);

  const vendorGroups: VendorGroup[] = useMemo(() => {
    // Agrupamos sin distinguir mayúsculas: "edna cruz" y "Edna Cruz" son la misma
    // persona. El endpoint ya guarda el nombre canónico, esto es defensa en profundidad.
    const map = new Map<string, InsuranceVendorTopClient[]>();
    const labels = new Map<string, string>();
    for (const r of rows) {
      const name = r.vendor_name.trim().replace(/\s+/g, " ");
      const key = name.toLowerCase();
      if (!labels.has(key)) labels.set(key, name);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .map(([key, clients]) => ({
        vendorName: labels.get(key) ?? key,
        clients,
        lastSubmission: clients.reduce((max, c) => (c.created_at > max ? c.created_at : max), clients[0]?.created_at ?? ""),
        avatar: avatarPct(clients),
      }))
      .sort((a, b) => b.clients.length - a.clients.length || a.vendorName.localeCompare(b.vendorName));
  }, [rows]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return vendorGroups;
    const q = search.trim().toLowerCase();
    return vendorGroups.filter((g) => g.vendorName.toLowerCase().includes(q));
  }, [vendorGroups, search]);

  // Vendedoras registradas (para asignar prospectos), dedup y sin el placeholder
  const vendorOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const g of vendorGroups) {
      const name = g.vendorName.trim();
      const key = name.toLowerCase();
      if (!name || key === "vendedor o representante por definir" || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [vendorGroups]);

  const totalRegistros = rows.length;
  const totalVendedores = vendorGroups.length;
  const vendedoresCompletos = vendorGroups.filter((g) => g.clients.length >= META_CLIENTES_POR_VENDEDOR).length;
  const metaRegistros = META_VENDEDORES * META_CLIENTES_POR_VENDEDOR;

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login?next=/app/enlace");
  }

  function toggleExpand(vendor: string) {
    setExpanded(expanded === vendor ? null : vendor);
  }

  // Asignar un prospecto a una vendedora (o desasignar con "")
  async function assignLead(leadId: string, vendor: string) {
    const patch = {
      assigned_to: vendor || null,
      assigned_at: vendor ? new Date().toISOString() : null,
      status: vendor ? "asignado" : "nuevo",
    };
    const { error } = await supabase.from("leads").update(patch).eq("id", leadId);
    if (error) { console.error(error); alert("No se pudo asignar: " + error.message); return; }
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, assigned_to: patch.assigned_to, status: patch.status } : l)));
  }

  // Cambiar el estatus del embudo (nuevo/asignado/contactado/cerrado)
  async function changeLeadStatus(leadId: string, status: string) {
    const { error } = await supabase.from("leads").update({ status }).eq("id", leadId);
    if (error) { console.error(error); alert("No se pudo actualizar el estatus: " + error.message); return; }
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status } : l)));
  }

  // Descarga genérica de un CSV con BOM (acentos correctos en Excel)
  function triggerDownload(lines: string[], filename: string) {
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // CSV con los 11 encabezados exactos de la plantilla "Avatar CRM" de HubSpot
  function downloadAvatarCRM() {
    const headers = [
      "NOMBRE COMPLETO", "FECHA DE NACIMIENTO", "WHATS APP", "CORREO", "COLOR",
      "INDEPENDIENTE O PROFESIONISTA", "PROFESION", "INGRESO", "DEPENDIENTES",
      "PUNTO RELEVANTE", "PRODUCTO (S)",
    ];
    const lines = [headers.join(",")];
    for (const c of rows) {
      const cells = [
        c.client_name,
        c.birth_date_or_age ?? "",
        normalizePhone(c.phone),
        c.email,
        c.color ?? "",
        c.occupation_type ?? "",
        c.profession ?? "",
        c.income ?? "",
        c.dependents ?? "",
        c.relevant_note ?? "",
        c.products ?? "",
      ].map((v) => csvEscape(String(v)));
      lines.push(cells.join(","));
    }
    const today = new Date().toISOString().slice(0, 10);
    triggerDownload(lines, `enlace-integral-avatar-crm-${today}.csv`);
  }

  function downloadCSV() {
    const headers = ["Email", "Phone", "First Name", "Last Name", "City", "State", "Zip", "Country", "Gender", "Date of Birth / Age"];
    const lines = [headers.join(",")];
    for (const c of rows) {
      const { first, last } = splitName(c.client_name);
      const cells = [
        c.email,
        normalizePhone(c.phone),
        first,
        last,
        c.city ?? "",
        c.state ?? "",
        c.postal_code ?? "",
        "MX",
        (c.gender ?? "").toLowerCase(),
        c.birth_date_or_age ?? "",
      ].map((v) => csvEscape(String(v)));
      lines.push(cells.join(","));
    }
    const today = new Date().toISOString().slice(0, 10);
    triggerDownload(lines, `enlace-integral-meta-audiencia-${today}.csv`);
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: C.bg, fontFamily: "Inter, sans-serif" }}>
      {/* Header con la identidad de la landing (logo + borde verde) para que el
          dashboard se sienta del mismo producto que su página. */}
      <header style={{ background: C.white, borderBottom: `3px solid ${C.green}` }}>
        <div style={{ maxWidth: 1040, margin: "0 auto", padding: "14px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <img src="/clients/enlace/logo.png" alt="Enlace Integral Seguros"
            style={{ height: 40, width: "auto", display: "block" }} />
          <button
            onClick={logout}
            style={{ fontSize: 13, color: C.muted, background: "none",
              border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 14px",
              cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
          >
            Salir
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 16px" }}>

        <div style={{ marginBottom: 20 }}>
          <TabBar
            theme={T}
            active={mainTab}
            onChange={(id) =>
              setMainTab(
                id === "prospectos" ? "prospectos"
                : id === "resenas" ? "resenas"
                : id === "candidatas" ? "candidatas"
                : "captura"
              )
            }
            tabs={[
              { id: "captura", label: "Captura Top 20", icon: "📋" },
              { id: "prospectos", label: `Prospectos${leads.length ? ` (${leads.length})` : ""}`, icon: "🎯" },
              { id: "candidatas", label: `Candidatas${candidatasCount ? ` (${candidatasCount})` : ""}`, icon: "👥" },
              { id: "resenas", label: "Reseñas", icon: "⭐" },
            ]}
          />
        </div>

      {mainTab === "captura" && (
      <>
        <StatGrid>
          <StatCard theme={T} label="Registros totales" value={totalRegistros} sub={`meta: ${metaRegistros}`} />
          <StatCard theme={T} label="Vendedores que enviaron" value={`${totalVendedores} / ${META_VENDEDORES}`} />
          <StatCard theme={T} label="Vendedores completos (20/20)" value={vendedoresCompletos} accent={C.greenDark} />
          <StatCard theme={T} label="Avance total" value={`${metaRegistros ? Math.round((totalRegistros / metaRegistros) * 100) : 0}%`} />
          <StatCard
            theme={T}
            label="Contactos repetidos"
            value={dupInfo.ids.size}
            accent={dupInfo.ids.size > 0 ? "#B96A1E" : undefined}
            sub={dupInfo.crossVendor.size > 0 ? `${dupInfo.crossVendor.size} entre vendedoras distintas` : "mismo correo o teléfono"}
          />
        </StatGrid>

        <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.carbon }}>Exportar para Meta Ads</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
              CSV listo para subir como "Customer list" en Meta Ads Manager ({totalRegistros} registro{totalRegistros !== 1 ? "s" : ""}).
            </div>
          </div>
          <button
            onClick={downloadCSV}
            disabled={totalRegistros === 0}
            style={{
              background: totalRegistros === 0 ? C.gray : C.green, color: "#fff", border: "none",
              borderRadius: 9, padding: "9px 18px", fontSize: 13.5, fontWeight: 700,
              cursor: totalRegistros === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap",
            }}
          >
            ⬇ Descargar CSV
          </button>
        </div>

        <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.carbon }}>Exportar Avatar CRM (HubSpot)</div>
            <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>
              CSV con el formato Avatar CRM de Enlace, listo para importar contactos en HubSpot ({totalRegistros} registro{totalRegistros !== 1 ? "s" : ""}).
            </div>
          </div>
          <button
            onClick={downloadAvatarCRM}
            disabled={totalRegistros === 0}
            style={{
              background: totalRegistros === 0 ? C.gray : C.carbon, color: "#fff", border: "none",
              borderRadius: 9, padding: "9px 18px", fontSize: 13.5, fontWeight: 700,
              cursor: totalRegistros === 0 ? "not-allowed" : "pointer", whiteSpace: "nowrap",
            }}
          >
            ⬇ Descargar Avatar CRM
          </button>
        </div>

        <Section
          title={<>Progreso por vendedor</>}
        >
          <div style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="Buscar vendedor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%", maxWidth: 320, padding: "9px 12px", borderRadius: 9,
                border: `1px solid ${C.border}`, fontSize: 13.5, fontFamily: "inherit", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "inline-flex", borderRadius: 9, border: `1px solid ${C.border}`,
              overflow: "hidden", flexShrink: 0 }}>
              {([["meta", "Vista Meta"], ["avatar", "Vista Avatar CRM"]] as const).map(([mode, label]) => {
                const active = viewMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    style={{
                      background: active ? C.green : C.white, color: active ? "#fff" : C.muted,
                      border: "none", padding: "9px 16px", fontSize: 13, fontWeight: 700,
                      cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: "center", padding: 60, color: C.muted }}>Cargando...</div>
          ) : filteredGroups.length === 0 ? (
            <div style={{ ...cardStyle, padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.carbon, marginBottom: 4 }}>Sin registros todavía</div>
              <div style={{ fontSize: 13, color: C.muted }}>
                Comparte el link del formulario con los vendedores para empezar a recibir su Top 20.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredGroups.map((g) => {
                const isExpanded = expanded === g.vendorName;
                const complete = g.clients.length >= META_CLIENTES_POR_VENDEDOR;
                return (
                  <div key={g.vendorName} style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
                    <button
                      onClick={() => toggleExpand(g.vendorName)}
                      style={{
                        width: "100%", background: "none", border: "none", cursor: "pointer",
                        padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 12, textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <span style={{ color: C.muted, fontSize: 12 }}>{isExpanded ? "▼" : "▶"}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, fontWeight: 700, color: C.carbon }}>{g.vendorName}</div>
                          <div style={{ fontSize: 12, color: C.muted }}>Última entrega: {fmtDate(g.lastSubmission)}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        <Chip
                          label={`Avatar ${g.avatar}%`}
                          bg={g.avatar >= 80 ? C.greenSoft : g.avatar >= 40 ? "#FFF4E5" : "#FDECEC"}
                          fg={g.avatar >= 80 ? C.greenDark : g.avatar >= 40 ? "#B96A1E" : C.red}
                        />
                        <Chip
                          label={`${g.clients.length} / ${META_CLIENTES_POR_VENDEDOR}`}
                          bg={complete ? C.greenSoft : "#FFF4E5"}
                          fg={complete ? C.greenDark : "#B96A1E"}
                        />
                      </div>
                    </button>

                    {isExpanded && (
                      <div style={{ borderTop: `1px solid ${C.border}`, backgroundColor: "#FAFCFA" }}>
                        {isMobile ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14 }}>
                            {g.clients.map((c) => (
                              <div key={c.id} style={{ ...cardStyle, padding: 12,
                                ...(dupInfo.ids.has(c.id) ? { borderColor: "#EBC99A", background: "#FFFBF4" } : {}) }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.carbon }}>{c.client_name}</div>
                                  {dupInfo.ids.has(c.id) && (
                                    <Chip
                                      label={dupInfo.crossVendor.has(c.id) ? "Repetido · otra vendedora" : "Repetido"}
                                      bg="#FFF4E5" fg="#B96A1E"
                                    />
                                  )}
                                </div>
                                <div style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{c.phone} · {c.email}</div>
                                {viewMode === "meta" ? (
                                  <>
                                    {(c.city || c.state || c.postal_code) && (
                                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                                        {[c.city, c.state, c.postal_code].filter(Boolean).join(", ")}
                                      </div>
                                    )}
                                    {(c.gender || c.birth_date_or_age) && (
                                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                                        {[c.gender, c.birth_date_or_age].filter(Boolean).join(" · ")}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                                    {([
                                      ["Fecha nac.", c.birth_date_or_age],
                                      ["Color", c.color],
                                      ["Indep./Profesionista", c.occupation_type],
                                      ["Profesión", c.profession],
                                      ["Ingreso", c.income],
                                      ["Dependientes", c.dependents],
                                      ["Punto relevante", c.relevant_note],
                                      ["Producto(s)", c.products],
                                    ] as const).map(([label, val]) => (
                                      <div key={label} style={{ fontSize: 12, color: C.muted }}>
                                        <span style={{ fontWeight: 600, color: C.carbon }}>{label}:</span>{" "}
                                        {val || "—"}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div style={{ marginTop: 6 }}>
                                  <Chip label={SOURCE_LABEL[c.source] ?? c.source} bg="#EEF1F3" fg={C.muted} />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : viewMode === "avatar" ? (
                          <div style={{ padding: "8px 16px 16px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1180 }}>
                              <thead>
                                <tr>
                                  {["Nombre completo", "Fecha nac.", "WhatsApp", "Correo", "Color", "Indep./Profesionista", "Profesión", "Ingreso", "Dependientes", "Punto relevante", "Producto(s)"].map((h) => (
                                    <th key={h} style={{
                                      padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 600,
                                      color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em",
                                      borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                                    }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {g.clients.map((c) => (
                                  <tr key={c.id} style={dupInfo.ids.has(c.id) ? { background: "#FFFBF4" } : undefined}>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.carbon, fontWeight: 600 }}>
                                      {c.client_name}
                                      {dupInfo.ids.has(c.id) && (
                                        <span title={dupInfo.crossVendor.has(c.id)
                                          ? "Este contacto también lo cargó otra vendedora"
                                          : "Contacto repetido en la base"}
                                          style={{ marginLeft: 6, color: "#B96A1E" }}>⚠</span>
                                      )}
                                    </td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.birth_date_or_age || "—"}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.carbon }}>{c.phone}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.carbon }}>{c.email}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.color || "—"}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.occupation_type || "—"}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.profession || "—"}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.income || "—"}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.dependents || "—"}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.relevant_note || "—"}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.products || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div style={{ padding: "8px 16px 16px", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
                              <thead>
                                <tr>
                                  {["Cliente", "Teléfono", "Email", "Ciudad / Estado", "CP", "Género", "Nac. / Edad", "Fuente", "Recibido"].map((h) => (
                                    <th key={h} style={{
                                      padding: "8px 10px", textAlign: "left", fontSize: 11, fontWeight: 600,
                                      color: C.muted, textTransform: "uppercase", letterSpacing: "0.04em",
                                      borderBottom: `1px solid ${C.border}`,
                                    }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {g.clients.map((c) => (
                                  <tr key={c.id} style={dupInfo.ids.has(c.id) ? { background: "#FFFBF4" } : undefined}>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.carbon, fontWeight: 600 }}>
                                      {c.client_name}
                                      {dupInfo.ids.has(c.id) && (
                                        <span title={dupInfo.crossVendor.has(c.id)
                                          ? "Este contacto también lo cargó otra vendedora"
                                          : "Contacto repetido en la base"}
                                          style={{ marginLeft: 6, color: "#B96A1E" }}>⚠</span>
                                      )}
                                    </td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.carbon }}>{c.phone}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.carbon }}>{c.email}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>
                                      {[c.city, c.state].filter(Boolean).join(", ") || "—"}
                                    </td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.postal_code || "—"}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.gender || "—"}</td>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.muted }}>{c.birth_date_or_age || "—"}</td>
                                    <td style={{ padding: "8px 10px" }}>
                                      <Chip label={SOURCE_LABEL[c.source] ?? c.source} bg="#EEF1F3" fg={C.muted} />
                                    </td>
                                    <td style={{ padding: "8px 10px", fontSize: 12, color: C.muted }}>{fmtDateTime(c.created_at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </>
      )}

      {mainTab === "prospectos" && (
      <>
        <StatGrid>
          <StatCard theme={T} label="Prospectos totales" value={leads.length} sub="desde la página" />
          <StatCard
            theme={T}
            label="Últimos 7 días"
            value={leads.filter((l) => Date.now() - new Date(l.created_at).getTime() < 7 * 864e5).length}
            accent={C.greenDark}
          />
          <StatCard
            theme={T}
            label="Sin asignar"
            value={leads.filter((l) => !l.assigned_to).length}
            accent={C.red}
          />
        </StatGrid>

        <Section title={<>Prospectos de la página</>}>
          <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 14 }}>
            Cada persona que completa el cuestionario en la página aparece aquí. Contáctala por WhatsApp
            mientras está interesada.
          </div>

          {leadsLoading ? (
            <div style={{ textAlign: "center", padding: 60, color: C.muted }}>Cargando...</div>
          ) : leads.length === 0 ? (
            <div style={{ ...cardStyle, padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.carbon, marginBottom: 4 }}>Aún no hay prospectos</div>
              <div style={{ fontSize: 13, color: C.muted }}>
                Cuando alguien llene el cuestionario en la página, su contacto aparecerá aquí al instante.
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {leads.map((l) => {
                const tel = leadWhats(l);
                const telDigits = tel.replace(/\D/g, "");
                const mail = leadEmail(l);
                return (
                  <div key={l.id} style={{ ...cardStyle, padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.carbon }}>{l.name}</div>
                        <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Chip label={leadPlan(l)} bg={C.greenSoft} fg={C.greenDark} />
                        </div>
                        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>
                          {tel && <>WhatsApp: <b style={{ color: C.carbon }}>{tel}</b><br /></>}
                          {mail && <>Correo: <b style={{ color: C.carbon }}>{mail}</b><br /></>}
                          {leadField(l.problem, "Objetivo") && <>Objetivo: {leadField(l.problem, "Objetivo")} · </>}
                          {leadField(l.problem, "Edad") && <>Edad: {leadField(l.problem, "Edad")} · </>}
                          {leadField(l.problem, "Capacidad") && <>Capacidad: {leadField(l.problem, "Capacidad")}</>}
                        </div>
                        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>Recibido: {fmtDateTime(l.created_at)}</div>
                      </div>
                      {telDigits && (
                        <a
                          href={`https://wa.me/${telDigits.length === 10 ? "52" + telDigits : telDigits}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ background: "#25D366", color: "#fff", textDecoration: "none",
                            padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}
                        >
                          Escribir por WhatsApp
                        </a>
                      )}
                    </div>

                    {/* Asignación y estatus — Edna reparte cada prospecto a una vendedora */}
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`,
                      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 999,
                        fontSize: 11, fontWeight: 700, background: statusMeta(l.status).bg, color: statusMeta(l.status).fg }}>
                        {statusMeta(l.status).label}
                      </span>

                      <label style={{ fontSize: 12, color: C.muted }}>Estatus</label>
                      <select value={statusMeta(l.status).id}
                        onChange={(e) => changeLeadStatus(l.id, e.target.value)} style={selectStyle}>
                        {LEAD_STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>

                      <label style={{ fontSize: 12, color: C.muted, marginLeft: "auto" }}>Asignar a</label>
                      <select value={l.assigned_to ?? ""}
                        onChange={(e) => assignLead(l.id, e.target.value)} style={selectStyle}>
                        <option value="">Sin asignar</option>
                        {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
                        {l.assigned_to && !vendorOptions.includes(l.assigned_to) &&
                          <option value={l.assigned_to}>{l.assigned_to}</option>}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </>
      )}

      {mainTab === "candidatas" && <CandidatasTab />}

      {mainTab === "resenas" && <ReviewsTab />}
      </main>
    </div>
  );
}
