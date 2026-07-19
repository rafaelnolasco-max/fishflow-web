"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, ENLACE_CLIENT_ID } from "@/lib/supabase";
import type { InsuranceVendorTopClient } from "@/lib/supabase";
import {
  DashboardHeader, StatGrid, StatCard, Chip,
  Section as DSection,
  cardStyle as mkCard,
  type DashTheme,
} from "@/components/dashboard";

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

type VendorGroup = {
  vendorName: string;
  clients: InsuranceVendorTopClient[];
  lastSubmission: string;
};

export default function EnlaceDashboardPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<InsuranceVendorTopClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"meta" | "avatar">("meta");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/login?next=/app/enlace");
    });
  }, [router]);

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

  const vendorGroups: VendorGroup[] = useMemo(() => {
    const map = new Map<string, InsuranceVendorTopClient[]>();
    for (const r of rows) {
      const key = r.vendor_name.trim();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .map(([vendorName, clients]) => ({
        vendorName,
        clients,
        lastSubmission: clients.reduce((max, c) => (c.created_at > max ? c.created_at : max), clients[0]?.created_at ?? ""),
      }))
      .sort((a, b) => b.clients.length - a.clients.length || a.vendorName.localeCompare(b.vendorName));
  }, [rows]);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return vendorGroups;
    const q = search.trim().toLowerCase();
    return vendorGroups.filter((g) => g.vendorName.toLowerCase().includes(q));
  }, [vendorGroups, search]);

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
      <DashboardHeader
        icon={<span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>EI</span>}
        title="Enlace Integral Seguros"
        subtitle="Top 20 clientes por vendedor · público similar Meta"
        theme={T}
        onLogout={logout}
      />

      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 16px" }}>

        <StatGrid>
          <StatCard theme={T} label="Registros totales" value={totalRegistros} sub={`meta: ${metaRegistros}`} />
          <StatCard theme={T} label="Vendedores que enviaron" value={`${totalVendedores} / ${META_VENDEDORES}`} />
          <StatCard theme={T} label="Vendedores completos (20/20)" value={vendedoresCompletos} accent={C.greenDark} />
          <StatCard theme={T} label="Avance total" value={`${metaRegistros ? Math.round((totalRegistros / metaRegistros) * 100) : 0}%`} />
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
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
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
                              <div key={c.id} style={{ ...cardStyle, padding: 12 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 700, color: C.carbon }}>{c.client_name}</div>
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
                                  <tr key={c.id}>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.carbon, fontWeight: 600 }}>{c.client_name}</td>
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
                                  <tr key={c.id}>
                                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.carbon, fontWeight: 600 }}>{c.client_name}</td>
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
      </main>
    </div>
  );
}
