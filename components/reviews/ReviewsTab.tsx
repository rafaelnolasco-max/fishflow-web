"use client";

/**
 * Módulo Reputación — pestaña de Reseñas compartida (multi-tenant).
 * Cada dashboard la monta con su clientId + tema. Las plantillas y el link
 * de reseña viven en review_settings (Supabase); la cola en review_requests.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  StatGrid, StatCard, Section as DSection, Field as DField, Modal as DModal,
  Toast, SaveBtn, inputStyle as mkInput, cardStyle as mkCard, Empty,
  type DashTheme,
} from "@/components/dashboard";

// ─── Colores universales del módulo (no dependen del tema del cliente) ────────
const U = {
  wa: "#25D366", green: "#10B981", blue: "#3B82F6",
  yellow: "#F59E0B", red: "#EF4444", gray: "#9CA3AF",
  warnBg: "#FFFBEB", warnBorder: "#FDE68A", warnText: "#92400E",
} as const;

// ─── Tipos ────────────────────────────────────────────────────────────────────
export type ReviewSettings = {
  client_id: string;
  google_place_id: string | null;
  review_link: string | null;
  business_display_name: string | null;
  msg_template_1: string;
  msg_template_2: string;
  msg_template_3: string;
  review_goal: number;
  baseline_count: number | null;
};

export type ReviewRequest = {
  id: string;
  client_id: string;
  contact_name: string;
  contact_phone: string;
  source: "csv" | "appointment" | "manual";
  stage: 0 | 1 | 2 | 3;
  status: "active" | "completed" | "declined" | "no_response" | "negative_feedback";
  stage1_sent_at: string | null;
  stage2_sent_at: string | null;
  stage3_sent_at: string | null;
  notes: string | null;
  created_at: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function normalizePhone(raw: string): string {
  const digits = raw.trim().replace(/\D/g, "");
  return digits.startsWith("52") ? `+${digits}` : `+52${digits}`;
}

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] ?? full;
}

function fillTemplate(tpl: string, name: string, link: string | null) {
  return tpl.replaceAll("{nombre}", firstName(name)).replaceAll("{link}", link ?? "");
}

function waLink(phone: string, message: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

function isToday(iso: string | null) {
  if (!iso) return false;
  const d = new Date(iso), now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

const STAGE_BTN: Record<number, string> = {
  0: "1️⃣ Enviar saludo",
  1: "2️⃣ Pedir reseña",
  2: "3️⃣ Enviar link",
};
const STAGE_LABEL: Record<number, string> = {
  0: "Sin contactar", 1: "Saludo enviado", 2: "Petición enviada", 3: "Link enviado",
};
const SOURCE_LABEL: Record<string, string> = { csv: "CSV", appointment: "Cita", manual: "Manual" };

const NEGATIVE_TPL =
  "Lamento mucho que tu experiencia no haya sido la mejor 🙏 Me encantaría platicarlo contigo para mejorarlo. ¿Tienes 5 minutos esta semana para una llamada?";

// ─── Componente ───────────────────────────────────────────────────────────────
export default function ReviewsTab({
  clientId,
  theme: T,
  personLabel = "cliente",
  personLabelPlural = "clientes",
  emptyHint,
}: {
  clientId: string;
  theme: DashTheme;
  personLabel?: string;        // "paciente" / "clienta" — para el copy
  personLabelPlural?: string;  // "pacientes" / "clientas"
  emptyHint?: string;          // texto extra en el estado vacío (ej. "o usa ⭐ desde una cita")
}) {
  // ⚠️ No definir componentes aquí dentro (se recrean en cada render y React
  // desmonta los inputs → el teclado móvil se cierra a cada tecla). Usar
  // DSection/DField/DModal directo con theme={T}.
  const inputStyle = mkInput(T);
  const cardStyle = mkCard(T);

  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", phone: "" });
  const [settingsForm, setSettingsForm] = useState({ place_id: "", t1: "", t2: "", t3: "", goal: "25" });
  const [csvRows, setCsvRows] = useState<{ name: string; phone: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function fetchAll() {
    setLoading(true);
    const [{ data: st, error: e1 }, { data: rq, error: e2 }] = await Promise.all([
      supabase.from("review_settings").select("*").eq("client_id", clientId).maybeSingle(),
      supabase.from("review_requests").select("*").eq("client_id", clientId)
        .order("stage", { ascending: false }).order("created_at", { ascending: true }),
    ]);
    if (e1) console.error("review_settings:", e1);
    if (e2) console.error("review_requests:", e2);
    setSettings((st as ReviewSettings) ?? null);
    setRequests((rq as ReviewRequest[]) ?? []);
    if (st) {
      const s = st as ReviewSettings;
      setSettingsForm({
        place_id: s.google_place_id ?? "",
        t1: s.msg_template_1, t2: s.msg_template_2, t3: s.msg_template_3,
        goal: String(s.review_goal ?? 25),
      });
    }
    setLoading(false);
  }

  useEffect(() => { fetchAll(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = useMemo(() => requests.filter(r => r.status === "active"), [requests]);
  const completed = useMemo(() => requests.filter(r => r.status === "completed"), [requests]);
  const finished = useMemo(() => requests.filter(r => r.status !== "active"), [requests]);
  const sentToday = useMemo(
    () => requests.filter(r => isToday(r.stage1_sent_at) || isToday(r.stage2_sent_at) || isToday(r.stage3_sent_at)).length,
    [requests]
  );

  // ── Avanzar etapa (abre WhatsApp + registra) ────────────────────────────────
  async function advanceStage(r: ReviewRequest) {
    const tpl = r.stage === 0 ? settings?.msg_template_1 : r.stage === 1 ? settings?.msg_template_2 : settings?.msg_template_3;
    if (!tpl) { notify("Configura las plantillas primero"); return; }
    if (r.stage === 2 && !settings?.review_link) {
      notify("Falta el Place ID de Google en Configuración");
      setShowSettings(true);
      return;
    }
    const msg = fillTemplate(tpl, r.contact_name, settings?.review_link ?? null);
    window.open(waLink(r.contact_phone, msg), "_blank");

    const nextStage = (r.stage + 1) as ReviewRequest["stage"];
    const patch: Record<string, unknown> = { stage: nextStage, updated_at: new Date().toISOString() };
    patch[`stage${nextStage}_sent_at`] = new Date().toISOString();
    const { error } = await supabase.from("review_requests").update(patch).eq("id", r.id);
    if (error) { console.error(error); notify(`Error: ${error.message}`); return; }
    setRequests(prev => prev.map(x => x.id === r.id ? { ...x, ...patch } as ReviewRequest : x));
  }

  // ── Mensaje privado para feedback negativo ──────────────────────────────────
  function openNegativeChat(r: ReviewRequest) {
    window.open(waLink(r.contact_phone, fillTemplate(NEGATIVE_TPL, r.contact_name, null)), "_blank");
  }

  async function setStatus(r: ReviewRequest, status: ReviewRequest["status"]) {
    const { error } = await supabase.from("review_requests")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) { console.error(error); notify(`Error: ${error.message}`); return; }
    setRequests(prev => prev.map(x => x.id === r.id ? { ...x, status } : x));
    if (status === "completed") notify("⭐ ¡Reseña registrada!");
    if (status === "negative_feedback") openNegativeChat(r);
  }

  // ── Alta manual ─────────────────────────────────────────────────────────────
  async function saveManual() {
    if (!addForm.name.trim() || addForm.phone.trim().replace(/\D/g, "").length < 10) {
      notify("Nombre y teléfono de 10 dígitos"); return;
    }
    setSaving(true);
    const { error } = await supabase.from("review_requests").insert({
      client_id: clientId,
      contact_name: addForm.name.trim(),
      contact_phone: normalizePhone(addForm.phone),
      source: "manual",
    });
    setSaving(false);
    if (error) {
      notify(error.code === "23505" ? "Ese teléfono ya está en la cola" : `Error: ${error.message}`);
      return;
    }
    setAddForm({ name: "", phone: "" });
    setShowAdd(false);
    await fetchAll();
  }

  // ── CSV ─────────────────────────────────────────────────────────────────────
  function parseCsv(text: string) {
    const sep = text.includes(";") && !text.split("\n")[0]?.includes(",") ? ";" : ",";
    const rows: { name: string; phone: string }[] = [];
    for (const line of text.split(/\r?\n/)) {
      const cells = line.split(sep).map(c => c.replaceAll('"', "").trim());
      if (cells.length < 2) continue;
      const [name, phone] = cells;
      if (!name || !phone) continue;
      if (/nombre|name|tel|cel|phone/i.test(name + phone) && rows.length === 0) continue; // header
      if (phone.replace(/\D/g, "").length < 10) continue;
      rows.push({ name, phone: normalizePhone(phone) });
    }
    // dedupe interno
    const seen = new Set<string>();
    return rows.filter(r => !seen.has(r.phone) && seen.add(r.phone));
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsvRows(parseCsv(String(reader.result ?? "")));
    reader.readAsText(f);
  }

  async function importCsv() {
    if (csvRows.length === 0) return;
    setSaving(true);
    const existing = new Set(requests.filter(r => r.status === "active").map(r => r.contact_phone));
    const fresh = csvRows.filter(r => !existing.has(r.phone));
    let inserted = 0;
    for (const row of fresh) {
      const { error } = await supabase.from("review_requests").insert({
        client_id: clientId, contact_name: row.name, contact_phone: row.phone, source: "csv",
      });
      if (!error) inserted++;
      else if (error.code !== "23505") console.error(error);
    }
    setSaving(false);
    setShowCsv(false);
    setCsvRows([]);
    if (fileRef.current) fileRef.current.value = "";
    notify(`${inserted} contacto${inserted !== 1 ? "s" : ""} agregado${inserted !== 1 ? "s" : ""} a la cola`);
    await fetchAll();
  }

  // ── Settings ────────────────────────────────────────────────────────────────
  async function saveSettings() {
    setSaving(true);
    const placeId = settingsForm.place_id.trim() || null;
    const { error } = await supabase.from("review_settings").update({
      google_place_id: placeId,
      review_link: placeId ? `https://search.google.com/local/writereview?placeid=${placeId}` : null,
      msg_template_1: settingsForm.t1,
      msg_template_2: settingsForm.t2,
      msg_template_3: settingsForm.t3,
      review_goal: parseInt(settingsForm.goal) || 25,
      updated_at: new Date().toISOString(),
    }).eq("client_id", clientId);
    setSaving(false);
    if (error) { console.error(error); notify(`Error: ${error.message}`); return; }
    setShowSettings(false);
    await fetchAll();
    notify("Configuración guardada");
  }

  // ── Fila de la cola (función normal, no componente — evita remounts) ───────
  const renderRow = (r: ReviewRequest) => {
    return (
      <div key={r.id} style={{ ...cardStyle, padding: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ minWidth: 140, flex: "1 1 160px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{r.contact_name}</div>
          <div style={{ fontSize: 12, color: T.muted }}>{r.contact_phone} · {SOURCE_LABEL[r.source]}</div>
        </div>
        <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
          whiteSpace: "nowrap",
          background: r.stage === 3 ? `${U.green}20` : `${U.blue}15`,
          color: r.stage === 3 ? U.green : U.blue }}>
          {STAGE_LABEL[r.stage]}
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          {r.stage < 3 ? (
            <button onClick={() => advanceStage(r)} style={{
              background: U.wa, color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}>
              {STAGE_BTN[r.stage]}
            </button>
          ) : (
            <button onClick={() => setStatus(r, "completed")} style={{
              background: U.green, color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}>
              ⭐ Publicó reseña
            </button>
          )}
          <button onClick={() => setStatus(r, "no_response")} title="Marcar sin respuesta" style={{
            background: "none", border: `1px solid ${T.border}`, borderRadius: 8,
            padding: "8px 10px", fontSize: 12, color: T.muted, cursor: "pointer",
          }}>
            Sin resp.
          </button>
          <button onClick={() => setStatus(r, "negative_feedback")} title="Tuvo mala experiencia — abrir chat privado, sin link de reseña" style={{
            background: "none", border: `1px solid ${T.border}`, borderRadius: 8,
            padding: "8px 10px", fontSize: 12, color: U.red, cursor: "pointer",
          }}>
            😕
          </button>
        </div>
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ textAlign: "center", padding: 60, color: T.muted }}>Cargando reseñas...</div>;

  return (
    <>
      {!settings?.review_link && (
        <div style={{
          background: U.warnBg, border: `1px solid ${U.warnBorder}`, borderRadius: 10,
          padding: "10px 14px", fontSize: 13, color: U.warnText, marginBottom: 16,
        }}>
          ⚠️ Falta el Place ID de Google para generar el link de reseña.{" "}
          <button onClick={() => setShowSettings(true)} style={{
            background: "none", border: "none", color: U.warnText, fontWeight: 700,
            textDecoration: "underline", cursor: "pointer", fontSize: 13, padding: 0,
          }}>Configurar</button>
        </div>
      )}

      <StatGrid>
        <StatCard theme={T} icon="⭐" label={`Reseñas logradas (meta ${settings?.review_goal ?? 25})`} value={completed.length} accent={U.green} />
        <StatCard theme={T} icon="📤" label="En cola" value={active.length} />
        <StatCard theme={T} icon="📅" label="Mensajes hoy" value={sentToday} sub="Sugerido: máx 15–20 por día" />
        <StatCard theme={T} icon="🔗" label="Link de reseña" value={settings?.review_link ? "Listo ✓" : "Pendiente"} accent={settings?.review_link ? U.green : U.yellow} />
      </StatGrid>

      <DSection
        theme={T}
        title="Cola de reseñas"
        action={{ label: `+ Agregar ${personLabel}`, onClick: () => setShowAdd(true) }}
      >
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <button onClick={() => setShowCsv(true)} style={{
            background: "none", border: `1px solid ${T.border}`, borderRadius: 8,
            padding: "7px 14px", fontSize: 13, color: T.text, cursor: "pointer", fontWeight: 600,
          }}>📄 Importar CSV</button>
          <button onClick={() => setShowSettings(true)} style={{
            background: "none", border: `1px solid ${T.border}`, borderRadius: 8,
            padding: "7px 14px", fontSize: 13, color: T.text, cursor: "pointer", fontWeight: 600,
          }}>⚙️ Configuración</button>
          {finished.length > 0 && (
            <button onClick={() => setShowDone(v => !v)} style={{
              background: "none", border: "none", padding: "7px 4px",
              fontSize: 13, color: T.muted, cursor: "pointer", fontWeight: 600,
            }}>{showDone ? "▼" : "▶"} Historial ({finished.length})</button>
          )}
        </div>

        {active.length === 0 ? (
          <Empty theme={T} msg={`Sin ${personLabelPlural} en la cola. Agrega ${personLabel === "clienta" ? "una" : "uno"}, importa un CSV${emptyHint ? ` ${emptyHint}` : ""}.`} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {active.map(renderRow)}
          </div>
        )}

        {showDone && finished.length > 0 && (
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
            {finished.map(r => (
              <div key={r.id} style={{ ...cardStyle, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", opacity: .75 }}>
                <div style={{ flex: 1, fontSize: 13, color: T.text }}>{r.contact_name}</div>
                <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                  background: r.status === "completed" ? `${U.green}20` : `${U.gray}20`,
                  color: r.status === "completed" ? U.green : T.muted }}>
                  {r.status === "completed" ? "⭐ Reseña" : r.status === "negative_feedback" ? "Feedback privado" : r.status === "no_response" ? "Sin respuesta" : "Declinó"}
                </span>
              </div>
            ))}
          </div>
        )}
      </DSection>

      {/* ── Modal alta manual ── */}
      {showAdd && (
        <DModal theme={T} title={`Agregar ${personLabel} a la cola`} onClose={() => setShowAdd(false)}>
          <DField theme={T} label="Nombre *">
            <input value={addForm.name} placeholder="Nombre completo"
              onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
              style={{ ...inputStyle, boxSizing: "border-box", outline: "none" }} />
          </DField>
          <DField theme={T} label="Teléfono * (10 dígitos)">
            <input value={addForm.phone} type="tel" placeholder="5512345678"
              onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))}
              style={{ ...inputStyle, boxSizing: "border-box", outline: "none" }} />
          </DField>
          <SaveBtn theme={T} onClick={saveManual} disabled={saving} label={saving ? "Guardando..." : "Agregar a la cola"} />
        </DModal>
      )}

      {/* ── Modal CSV ── */}
      {showCsv && (
        <DModal theme={T} title={`Importar ${personLabelPlural} (CSV)`} onClose={() => { setShowCsv(false); setCsvRows([]); }}>
          <p style={{ fontSize: 13, color: T.muted, marginTop: 0 }}>
            Archivo con dos columnas: <b>nombre, teléfono</b>. Los teléfonos repetidos o ya en cola se omiten.
          </p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile}
            style={{ fontSize: 13, marginBottom: 12 }} />
          {csvRows.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                {csvRows.length} contactos detectados
              </div>
              <div style={{ maxHeight: 180, overflowY: "auto", border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                {csvRows.slice(0, 50).map((r, i) => (
                  <div key={i} style={{ fontSize: 12.5, color: T.muted, padding: "2px 0" }}>
                    {r.name} — {r.phone}
                  </div>
                ))}
                {csvRows.length > 50 && <div style={{ fontSize: 12, color: U.gray }}>…y {csvRows.length - 50} más</div>}
              </div>
            </>
          )}
          <SaveBtn theme={T} onClick={importCsv} disabled={saving || csvRows.length === 0}
            label={saving ? "Importando..." : `Importar ${csvRows.length || ""}`} />
        </DModal>
      )}

      {/* ── Modal configuración ── */}
      {showSettings && (
        <DModal theme={T} title="Configuración de reseñas" onClose={() => setShowSettings(false)} wide>
          <DField theme={T} label="Google Place ID">
            <input value={settingsForm.place_id} placeholder="ChIJ..."
              onChange={e => setSettingsForm(f => ({ ...f, place_id: e.target.value }))}
              style={{ ...inputStyle, boxSizing: "border-box", outline: "none" }} />
            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 4 }}>
              Búscalo en el{" "}
              <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noreferrer" style={{ color: T.accent }}>
                Place ID Finder
              </a>{" "}con el nombre de tu negocio en Google Maps{settings?.business_display_name ? ` (${settings.business_display_name})` : ""}.
            </div>
          </DField>
          {settings?.review_link && (
            <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 14, wordBreak: "break-all" }}>
              Link actual: <a href={settings.review_link} target="_blank" rel="noreferrer" style={{ color: T.accent }}>{settings.review_link}</a>
            </div>
          )}
          {([["Mensaje 1 — saludo", "t1"], ["Mensaje 2 — petición", "t2"], ["Mensaje 3 — link ({link})", "t3"]] as const).map(([label, key]) => (
            <DField theme={T} key={key} label={label}>
              <textarea rows={2} value={settingsForm[key]}
                onChange={e => setSettingsForm(f => ({ ...f, [key]: e.target.value }))}
                style={{ ...inputStyle, resize: "vertical", boxSizing: "border-box", outline: "none" }} />
            </DField>
          ))}
          <DField theme={T} label="Meta de reseñas">
            <input type="number" value={settingsForm.goal}
              onChange={e => setSettingsForm(f => ({ ...f, goal: e.target.value }))}
              style={{ ...inputStyle, boxSizing: "border-box", outline: "none", maxWidth: 120 }} />
          </DField>
          <div style={{ fontSize: 11.5, color: T.muted, marginBottom: 10 }}>
            Usa <b>{"{nombre}"}</b> para el nombre y <b>{"{link}"}</b> para el link de reseña.
          </div>
          <SaveBtn theme={T} onClick={saveSettings} disabled={saving} label={saving ? "Guardando..." : "Guardar configuración"} />
        </DModal>
      )}

      <Toast msg={toast} theme={T} />
    </>
  );
}
