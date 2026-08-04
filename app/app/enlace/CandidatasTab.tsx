"use client";

/**
 * Panel de candidatas/os de Enlace Integral.
 *
 * Lee el modelo HireFlow (`hiring_applications` + `hiring_candidates`), que es
 * multi-tenant por `client_id` — no hay tablas propias de Enlace.
 *
 * Las postulaciones llegan de /demos/enlaceintegral/unete: la API sube el CV al
 * bucket privado `hiring-cv`, lo califica con Claude y guarda score, resumen y
 * detalles en `match_details`. Aquí Ivonne solo tiene que decidir.
 *
 * El CV se abre con URL firmada de 5 minutos: el bucket es privado y la RLS de
 * storage exige acceso al cliente dueño de la carpeta.
 */

import React, { useEffect, useMemo, useState } from "react";
import { supabase, ENLACE_CLIENT_ID } from "@/lib/supabase";
import {
  StatGrid, StatCard, Chip, Empty, Modal, Toast,
  Section as DSection,
  cardStyle as mkCard,
  type DashTheme,
} from "@/components/dashboard";

const C = {
  bg: "#F4F7F5", white: "#FFFFFF",
  green: "#65BC7B", greenDark: "#4B9A62", greenSoft: "#EAF7EE",
  carbon: "#212934", muted: "#5D7080", border: "#E2EAE5",
  red: "#D64545", gray: "#9CA3AF", amber: "#B96A1E", amberSoft: "#FFF4E5",
} as const;

const T: DashTheme = {
  accent: C.green, accentDark: C.greenDark, accentSoft: C.greenSoft,
  bg: C.bg, surface: C.white, text: C.carbon,
  muted: C.muted, border: C.border, danger: C.red, disabled: C.gray,
};

const cardStyle = mkCard(T);
const Section = (p: Omit<React.ComponentProps<typeof DSection>, "theme">) => <DSection theme={T} {...p} />;

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Candidate {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  cv_storage_path: string | null;
  source: string | null;
}

interface MatchDetails {
  fortalezas?: string[];
  banderas?: string[];
  veredicto?: string;
  formulario?: Record<string, string>;
}

interface Application {
  id: string;
  candidate_id: string;
  match_score: number | null;
  match_summary: string | null;
  match_details: MatchDetails | null;
  status: string;
  created_at: string;
  hiring_candidates: Candidate | null;
}

// Decisión de Ivonne sobre la postulación.
const STATUS: { id: string; label: string; bg: string; fg: string }[] = [
  { id: "active",      label: "Por revisar", bg: "#EEF2F6", fg: "#5D7080" },
  { id: "contacted",   label: "Contactada",  bg: "#FFF4E5", fg: "#B96A1E" },
  { id: "interviewed", label: "Entrevistada",bg: "#E5F0FF", fg: "#2563EB" },
  { id: "hired",       label: "Contratada",  bg: "#EAF7EE", fg: "#4B9A62" },
  { id: "rejected",    label: "Descartada",  bg: "#FDECEC", fg: "#B23B3B" },
];
function statusMeta(id: string | null) {
  return STATUS.find((s) => s.id === (id || "active")) ?? STATUS[0];
}

function scoreColor(score: number | null): string {
  if (score == null) return C.gray;
  if (score >= 70) return C.greenDark;
  if (score >= 45) return C.amber;
  return C.red;
}
function scoreLabel(score: number | null): string {
  if (score == null) return "Sin evaluar";
  if (score >= 70) return "Prioridad alta";
  if (score >= 45) return "Prioridad media";
  return "Prioridad baja";
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function waHref(phone: string | null, nombre: string) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const num = digits.length === 10 ? `52${digits}` : digits;
  const msg = `Hola ${nombre.split(" ")[0]}, soy de Enlace Integral Seguros. Recibimos tu postulación y nos gustaría platicar contigo.`;
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}

// ─── Componente ───────────────────────────────────────────────────────────────

type Filter = "todas" | "alto" | "medio" | "bajo" | "pendientes";

export default function CandidatasTab() {
  const [rows, setRows] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("todas");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Application | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      // Supabase trunca en 1000 filas por request. Aquí paginamos por si el
      // volumen de la campaña crece más de lo esperado.
      const all: Application[] = [];
      const PAGE = 500;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("hiring_applications")
          .select(
            "id, candidate_id, match_score, match_summary, match_details, status, created_at, " +
            "hiring_candidates ( id, full_name, email, phone, linkedin_url, cv_storage_path, source )"
          )
          .eq("client_id", ENLACE_CLIENT_ID)
          .order("match_score", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(from, from + PAGE - 1);

        if (error) {
          console.error("[CandidatasTab] carga:", error);
          break;
        }
        const page = (data ?? []) as unknown as Application[];
        all.push(...page);
        if (page.length < PAGE) break;
      }
      if (alive) {
        setRows(all);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function setStatus(app: Application, status: string) {
    setSavingId(app.id);
    const { error } = await supabase
      .from("hiring_applications")
      .update({ status })
      .eq("id", app.id);
    setSavingId(null);
    if (error) {
      console.error("[CandidatasTab] update status:", error);
      flash("No se pudo guardar el cambio");
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === app.id ? { ...r, status } : r)));
    setOpen((prev) => (prev && prev.id === app.id ? { ...prev, status } : prev));
    flash(`Marcada como ${statusMeta(status).label.toLowerCase()}`);
  }

  async function openCv(path: string | null) {
    if (!path) return flash("Esta postulación no trae CV");
    const { data, error } = await supabase.storage
      .from("hiring-cv")
      .createSignedUrl(path, 300);
    if (error || !data?.signedUrl) {
      console.error("[CandidatasTab] signed url:", error);
      return flash("No se pudo abrir el CV");
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  const stats = useMemo(() => {
    const alto = rows.filter((r) => (r.match_score ?? -1) >= 70).length;
    const medio = rows.filter((r) => (r.match_score ?? -1) >= 45 && (r.match_score ?? -1) < 70).length;
    const pend = rows.filter((r) => (r.status || "active") === "active").length;
    return { total: rows.length, alto, medio, pend };
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      const s = r.match_score;
      if (filter === "alto" && !(s != null && s >= 70)) return false;
      if (filter === "medio" && !(s != null && s >= 45 && s < 70)) return false;
      if (filter === "bajo" && !(s != null && s < 45)) return false;
      if (filter === "pendientes" && (r.status || "active") !== "active") return false;
      if (!q) return true;
      const c = r.hiring_candidates;
      return [c?.full_name, c?.email, c?.phone, r.match_summary]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, filter, query]);

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "todas", label: `Todas (${rows.length})` },
    { id: "alto", label: `Prioridad alta (${stats.alto})` },
    { id: "medio", label: `Media (${stats.medio})` },
    { id: "bajo", label: "Baja" },
    { id: "pendientes", label: `Por revisar (${stats.pend})` },
  ];

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: C.muted }}>Cargando candidaturas…</div>;
  }

  return (
    <>
      <StatGrid>
        <StatCard theme={T} label="Postulaciones" value={stats.total} />
        <StatCard theme={T} label="Prioridad alta" value={stats.alto} accent={C.greenDark} sub="score 70 o más" />
        <StatCard theme={T} label="Prioridad media" value={stats.medio} sub="score 45 a 69" />
        <StatCard theme={T} label="Por revisar" value={stats.pend} accent={stats.pend > 0 ? C.amber : undefined} />
      </StatGrid>

      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>
          Cada CV se resume automáticamente contra el perfil del puesto para que empieces por
          los más prometedores. <strong style={{ color: C.carbon }}>El score es una guía, no una decisión</strong>:
          la entrevista sigue siendo tuya.
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              background: filter === f.id ? C.green : C.white,
              color: filter === f.id ? "#fff" : C.muted,
              border: `1px solid ${filter === f.id ? C.green : C.border}`,
              borderRadius: 999, padding: "7px 15px", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
            }}
          >
            {f.label}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nombre, correo o teléfono…"
          style={{
            flex: "1 1 220px", minWidth: 0, padding: "9px 13px", borderRadius: 9,
            border: `1px solid ${C.border}`, fontSize: 13.5, fontFamily: "inherit",
            background: C.white, color: C.carbon,
          }}
        />
      </div>

      <Section title={`Candidatas y candidatos${visible.length !== rows.length ? ` · ${visible.length} de ${rows.length}` : ""}`}>
        {visible.length === 0 ? (
          <Empty
            theme={T}
            msg={
              rows.length === 0
                ? "Todavía no llegan postulaciones. En cuanto alguien envíe su CV desde la página, aparece aquí ordenada por afinidad."
                : "Ningún resultado con ese filtro."
            }
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {visible.map((app) => {
              const c = app.hiring_candidates;
              const sm = statusMeta(app.status);
              const col = scoreColor(app.match_score);
              return (
                <div
                  key={app.id}
                  onClick={() => setOpen(app)}
                  style={{
                    background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${col}`,
                    borderRadius: 12, padding: "14px 16px", cursor: "pointer",
                    display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap",
                  }}
                >
                  <div style={{
                    background: col, color: "#fff", fontWeight: 800, fontSize: 19,
                    minWidth: 54, textAlign: "center", padding: "10px 8px", borderRadius: 10, flexShrink: 0,
                  }}>
                    {app.match_score ?? "—"}
                  </div>
                  <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 15.5, color: C.carbon }}>
                        {c?.full_name ?? "Sin nombre"}
                      </span>
                      <Chip label={sm.label} bg={sm.bg} fg={sm.fg} />
                    </div>
                    <div style={{ fontSize: 13, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
                      {app.match_summary || "Sin resumen automático — abre para revisar el CV a mano."}
                    </div>
                    <div style={{ fontSize: 12, color: C.gray, marginTop: 6 }}>
                      {scoreLabel(app.match_score)} · {fmtDateTime(app.created_at)}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    {c?.cv_storage_path && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openCv(c.cv_storage_path); }}
                        style={{
                          background: C.white, color: C.carbon, border: `1px solid ${C.border}`,
                          borderRadius: 8, padding: "8px 13px", fontSize: 12.5, fontWeight: 700,
                          cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                        }}
                      >
                        Ver CV
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {open && (
        <Modal theme={T} title={open.hiring_candidates?.full_name ?? "Candidatura"} onClose={() => setOpen(null)} wide>
          <DetailBody
            app={open}
            onCv={() => openCv(open.hiring_candidates?.cv_storage_path ?? null)}
            onStatus={(s) => setStatus(open, s)}
            saving={savingId === open.id}
          />
        </Modal>
      )}

      <Toast msg={toast} theme={T} />
    </>
  );
}

// ─── Detalle ──────────────────────────────────────────────────────────────────

function DetailBody({
  app, onCv, onStatus, saving,
}: {
  app: Application;
  onCv: () => void;
  onStatus: (status: string) => void;
  saving: boolean;
}) {
  const c = app.hiring_candidates;
  const d = app.match_details ?? {};
  const form = d.formulario ?? {};
  const col = scoreColor(app.match_score);
  const wa = waHref(c?.phone ?? null, c?.full_name ?? "");

  const FIELDS: [string, string][] = [
    ["Ciudad", form.ciudad ?? ""],
    ["Experiencia en ventas", form.experiencia ?? ""],
    ["¿Ya vendió seguros?", form.seguros ?? ""],
    ["Disponibilidad", form.disponibilidad ?? ""],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{
        background: C.greenSoft, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 16, display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap",
      }}>
        <div style={{
          background: col, color: "#fff", fontWeight: 800, fontSize: 26,
          minWidth: 66, textAlign: "center", padding: "12px 8px", borderRadius: 11,
        }}>
          {app.match_score ?? "—"}
        </div>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: col }}>
            {scoreLabel(app.match_score)}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 14.5, color: C.carbon, lineHeight: 1.55 }}>
            {app.match_summary || "No se generó resumen automático. Revisa el CV directamente."}
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))" }}>
        <ListBlock title="A favor" items={d.fortalezas ?? []} color={C.greenDark} />
        <ListBlock title="A revisar" items={d.banderas ?? []} color={C.amber} />
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 10 }}>
          Datos de contacto
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <tbody>
            <Row k="WhatsApp" v={c?.phone ?? ""} />
            <Row k="Correo" v={c?.email ?? ""} />
            {c?.linkedin_url ? <Row k="LinkedIn" v={c.linkedin_url} /> : null}
            {FIELDS.map(([k, v]) => <Row key={k} k={k} v={v} />)}
          </tbody>
        </table>
        {form.motivacion ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 6 }}>
              Por qué le interesa
            </div>
            <p style={{ margin: 0, fontSize: 14, color: C.carbon, lineHeight: 1.6, fontStyle: "italic" }}>
              “{form.motivacion}”
            </p>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {c?.cv_storage_path && (
          <button
            onClick={onCv}
            style={{
              background: C.carbon, color: "#fff", border: "none", borderRadius: 9,
              padding: "11px 20px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Abrir CV
          </button>
        )}
        {wa && (
          <a
            href={wa} target="_blank" rel="noopener noreferrer"
            style={{
              background: "#25D366", color: "#fff", borderRadius: 9, textDecoration: "none",
              padding: "11px 20px", fontSize: 13.5, fontWeight: 700, display: "inline-block",
            }}
          >
            Escribirle por WhatsApp
          </a>
        )}
      </div>

      <div>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 10 }}>
          Mover a
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATUS.map((s) => {
            const active = (app.status || "active") === s.id;
            return (
              <button
                key={s.id}
                disabled={saving || active}
                onClick={() => onStatus(s.id)}
                style={{
                  background: active ? s.bg : C.white,
                  color: active ? s.fg : C.muted,
                  border: `1px solid ${active ? s.fg : C.border}`,
                  borderRadius: 999, padding: "8px 16px", fontSize: 13, fontWeight: 700,
                  cursor: saving || active ? "default" : "pointer", fontFamily: "inherit",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ListBlock({ title, items, color }: { title: string; items: string[]; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color, marginBottom: 8 }}>
        {title}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 13.5, color: C.gray }}>—</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, color: C.carbon, lineHeight: 1.6 }}>
          {items.map((i, n) => <li key={n}>{i}</li>)}
        </ul>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr>
      <td style={{ padding: "7px 0", color: C.muted, width: 170, verticalAlign: "top" }}>{k}</td>
      <td style={{ padding: "7px 0", color: C.carbon, fontWeight: 600, wordBreak: "break-word" }}>{v || "—"}</td>
    </tr>
  );
}
