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

export type ReviewVendor = {
  id: string;
  client_id: string;
  name: string;
  token: string;
  active: boolean;
};

export type ReviewRequest = {
  id: string;
  client_id: string;
  vendor_id: string | null;
  contact_name: string;
  contact_phone: string;
  source: "csv" | "appointment" | "manual";
  stage: 0 | 1 | 2 | 3;
  status: "active" | "completed" | "declined" | "no_response" | "negative_feedback";
  stage1_sent_at: string | null;
  stage2_sent_at: string | null;
  stage3_sent_at: string | null;
  reply_1: string | null;
  reply_2: string | null;
  draft_2: string | null;
  draft_3: string | null;
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
  clientId = "",
  theme: T,
  personLabel = "cliente",
  personLabelPlural = "clientes",
  emptyHint,
  smartReplies = false,
  vendorToken,
  showVendors = false,
}: {
  clientId?: string;           // requerido salvo en modo vendedora (se resuelve del token)
  theme: DashTheme;
  personLabel?: string;        // "paciente" / "clienta" — para el copy
  personLabelPlural?: string;  // "pacientes" / "clientas"
  emptyHint?: string;          // texto extra en el estado vacío (ej. "o usa ⭐ desde una cita")
  smartReplies?: boolean;      // opt-in: mensajes 2 y 3 redactados por IA con la respuesta del cliente
  /**
   * Modo vendedora: la página pública /resenas/[token] monta este mismo módulo
   * sin login. Todo va por /api/reviews/vendor/[token] (service role) y se
   * ocultan configuración, importador y alta manual — ella solo envía su cola.
   */
  vendorToken?: string;
  /**
   * Vista de coordinación (Ivonne Cruz en /app/enlace): progreso por vendedora,
   * filtro de la cola y botón para copiar el link personal de cada una.
   */
  showVendors?: boolean;
}) {
  const isVendor = !!vendorToken;
  const apiBase = `/api/reviews/vendor/${vendorToken}`;
  // ⚠️ No definir componentes aquí dentro (se recrean en cada render y React
  // desmonta los inputs → el teclado móvil se cierra a cada tecla). Usar
  // DSection/DField/DModal directo con theme={T}.
  const inputStyle = mkInput(T);
  const cardStyle = mkCard(T);

  const [settings, setSettings] = useState<ReviewSettings | null>(null);
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [loading, setLoading] = useState(true);
  // En modo vendedora el clientId llega del endpoint (lo necesita /api/reviews/draft)
  const [resolvedClientId, setResolvedClientId] = useState(clientId);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<ReviewVendor[]>([]);
  const [vendorFilter, setVendorFilter] = useState<string>("todas");
  const [copiedId, setCopiedId] = useState<string | null>(null);
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

  // ── Smart replies (opt-in): estado por fila ────────────────────────────────
  const [pasteBox, setPasteBox] = useState<Record<string, string>>({});   // respuesta pegada del cliente
  const [draftBox, setDraftBox] = useState<Record<string, string>>({});    // borrador IA editable
  const [busyRow, setBusyRow] = useState<Record<string, boolean>>({});     // generando

  function replyCol(stage: number) { return stage === 1 ? "reply_1" : "reply_2"; }
  function draftCol(stage: number) { return stage === 1 ? "draft_2" : "draft_3"; }
  function pasteVal(r: ReviewRequest) {
    return pasteBox[r.id] ?? (r.stage === 1 ? r.reply_1 : r.reply_2) ?? "";
  }
  function draftVal(r: ReviewRequest) {
    return draftBox[r.id] ?? (r.stage === 1 ? r.draft_2 : r.draft_3) ?? "";
  }

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  /**
   * Guarda cambios de un request. En el dashboard va por Supabase (RLS);
   * en modo vendedora por el endpoint con token (service role + validación de
   * pertenencia). Devuelve true si guardó.
   */
  async function patchRequest(id: string, patch: Record<string, unknown>): Promise<boolean> {
    if (isVendor) {
      try {
        const res = await fetch(apiBase, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: id, patch }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => null);
          notify(d?.error ?? "No se pudo guardar el cambio");
          return false;
        }
        return true;
      } catch (e) {
        console.error(e);
        notify("Sin conexión. Revisa tus datos e intenta de nuevo.");
        return false;
      }
    }
    const { error } = await supabase.from("review_requests").update(patch).eq("id", id);
    if (error) { console.error(error); notify(`Error: ${error.message}`); return false; }
    return true;
  }

  async function fetchVendor() {
    setLoading(true);
    try {
      const res = await fetch(apiBase, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) { setLinkError(data?.error ?? "Enlace no válido"); setLoading(false); return; }
      setVendorName(data.vendor?.name ?? null);
      setResolvedClientId(data.clientId ?? "");
      setSettings((data.settings as ReviewSettings) ?? null);
      setRequests((data.requests as ReviewRequest[]) ?? []);
    } catch (e) {
      console.error(e);
      setLinkError("No se pudo cargar tu lista. Revisa tu conexión.");
    }
    setLoading(false);
  }

  // Supabase trunca en 1000 filas sin avisar — con 400+ contactos por cliente
  // esto se alcanza pronto, así que se pagina siempre.
  async function fetchRequestsPaged(): Promise<ReviewRequest[]> {
    const PAGE = 1000;
    const acc: ReviewRequest[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("review_requests").select("*").eq("client_id", clientId)
        .order("stage", { ascending: false }).order("created_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) { console.error("review_requests:", error); break; }
      const page = (data as ReviewRequest[]) ?? [];
      acc.push(...page);
      if (page.length < PAGE) break;
    }
    return acc;
  }

  async function fetchVendors(): Promise<ReviewVendor[]> {
    if (!showVendors) return [];
    const { data, error } = await supabase
      .from("review_vendors").select("*").eq("client_id", clientId).order("name");
    if (error) { console.error("review_vendors:", error); return []; }
    return (data as ReviewVendor[]) ?? [];
  }

  async function fetchAll() {
    if (isVendor) return fetchVendor();
    setLoading(true);
    const [{ data: st, error: e1 }, rq, vd] = await Promise.all([
      supabase.from("review_settings").select("*").eq("client_id", clientId).maybeSingle(),
      fetchRequestsPaged(),
      fetchVendors(),
    ]);
    if (e1) console.error("review_settings:", e1);
    setSettings((st as ReviewSettings) ?? null);
    setRequests(rq);
    setVendors(vd);
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

  useEffect(() => { fetchAll(); }, [clientId, vendorToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // El filtro por vendedora solo aplica a la cola visible; las métricas de
  // arriba siguen siendo del cliente completo.
  const visibles = useMemo(
    () => vendorFilter === "todas" ? requests
      : vendorFilter === "sin" ? requests.filter(r => !r.vendor_id)
      : requests.filter(r => r.vendor_id === vendorFilter),
    [requests, vendorFilter]
  );
  const active = useMemo(() => visibles.filter(r => r.status === "active"), [visibles]);
  const activeAll = useMemo(() => requests.filter(r => r.status === "active"), [requests]);
  const completed = useMemo(() => requests.filter(r => r.status === "completed"), [requests]);
  const finished = useMemo(() => visibles.filter(r => r.status !== "active"), [visibles]);
  const sentToday = useMemo(
    () => requests.filter(r => isToday(r.stage1_sent_at) || isToday(r.stage2_sent_at) || isToday(r.stage3_sent_at)).length,
    [requests]
  );

  const nombreDeVendedora = useMemo(() => {
    const m = new Map(vendors.map(v => [v.id, v.name]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [vendors]);

  /** Progreso por vendedora, ordenado por lo que le falta (más urgente arriba). */
  const vendorStats = useMemo(() => {
    if (!showVendors) return [];
    const base = vendors.map(v => {
      const mine = requests.filter(r => r.vendor_id === v.id);
      const pend = mine.filter(r => r.status === "active");
      return {
        vendor: v,
        total: mine.length,
        pendientes: pend.length,
        sinContactar: pend.filter(r => r.stage === 0).length,
        enProceso: pend.filter(r => r.stage > 0).length,
        resenas: mine.filter(r => r.status === "completed").length,
        descartados: mine.filter(r => r.status === "no_response" || r.status === "declined" || r.status === "negative_feedback").length,
      };
    });
    return base.sort((a, b) => b.pendientes - a.pendientes);
  }, [vendors, requests, showVendors]);

  const sinAsignar = useMemo(() => requests.filter(r => !r.vendor_id).length, [requests]);

  function vendorUrl(v: ReviewVendor) {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://www.fishflow.mx";
    return `${origin}/resenas/${v.token}`;
  }

  async function copyVendorLink(v: ReviewVendor) {
    const msg = `Hola ${firstName(v.name)}, aquí está tu tablero de reseñas de Google:\n${vendorUrl(v)}\n\nÁbrelo en tu celular y da clic en el botón verde de cada cliente. El mensaje se manda desde TU WhatsApp, ya escrito — solo lo revisas y lo envías. Guarda el enlace, es tuyo.`;
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedId(v.id);
      setTimeout(() => setCopiedId(null), 2500);
    } catch {
      notify("No se pudo copiar. Copia el link a mano.");
    }
  }

  // ── Avanzar etapa (abre WhatsApp + registra) ────────────────────────────────
  // opts.message: texto ya listo (ej. borrador IA) — si falta, usa la plantilla.
  // opts.extraPatch: columnas extra a guardar (ej. reply_1/draft_2).
  async function advanceStage(
    r: ReviewRequest,
    opts?: { message?: string; extraPatch?: Record<string, unknown> },
  ) {
    const tpl = r.stage === 0 ? settings?.msg_template_1 : r.stage === 1 ? settings?.msg_template_2 : settings?.msg_template_3;
    if (!opts?.message?.trim() && !tpl) { notify("Configura las plantillas primero"); return; }
    if (r.stage === 2 && !settings?.review_link) {
      notify(isVendor ? "Falta configurar el link de reseña. Avísale a Ivonne." : "Falta el Place ID de Google en Configuración");
      if (!isVendor) setShowSettings(true);
      return;
    }
    const msg = opts?.message?.trim() || fillTemplate(tpl ?? "", r.contact_name, settings?.review_link ?? null);
    window.open(waLink(r.contact_phone, msg), "_blank");

    const nextStage = (r.stage + 1) as ReviewRequest["stage"];
    const patch: Record<string, unknown> = { stage: nextStage, updated_at: new Date().toISOString(), ...(opts?.extraPatch ?? {}) };
    patch[`stage${nextStage}_sent_at`] = new Date().toISOString();
    if (!(await patchRequest(r.id, patch))) return;
    setRequests(prev => prev.map(x => x.id === r.id ? { ...x, ...patch } as ReviewRequest : x));
  }

  // ── Smart replies: generar borrador IA con la respuesta del cliente ─────────
  async function generateDraft(r: ReviewRequest) {
    const reply = pasteVal(r).trim();
    if (!reply) { notify("Pega primero la respuesta del cliente"); return; }
    if (r.stage === 2 && !settings?.review_link) {
      notify(isVendor ? "Falta configurar el link de reseña. Avísale a Ivonne." : "Falta el Place ID de Google en Configuración");
      if (!isVendor) setShowSettings(true);
      return;
    }
    setBusyRow(prev => ({ ...prev, [r.id]: true }));
    try {
      const res = await fetch("/api/reviews/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: resolvedClientId, stage: r.stage, reply, contactName: r.contact_name }),
      });
      const data = await res.json();
      if (!res.ok || !data?.draft) { notify(data?.error ?? "No se pudo generar el mensaje"); return; }
      setDraftBox(prev => ({ ...prev, [r.id]: data.draft as string }));
      // Persistir respuesta + borrador (no avanza etapa hasta que envíes)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      patch[replyCol(r.stage)] = reply;
      patch[draftCol(r.stage)] = data.draft;
      await patchRequest(r.id, patch);
      setRequests(prev => prev.map(x => x.id === r.id ? { ...x, ...patch } as ReviewRequest : x));
    } catch (e: any) {
      console.error(e); notify("Error de red al generar el mensaje");
    } finally {
      setBusyRow(prev => ({ ...prev, [r.id]: false }));
    }
  }

  // Enviar usando el borrador IA (o la plantilla si no hay borrador) y avanzar.
  async function sendSmart(r: ReviewRequest) {
    const draft = draftVal(r).trim();
    const reply = pasteVal(r).trim();
    const extraPatch: Record<string, unknown> = {};
    if (reply) extraPatch[replyCol(r.stage)] = reply;
    if (draft) extraPatch[draftCol(r.stage)] = draft;
    await advanceStage(r, { message: draft || undefined, extraPatch });
    setPasteBox(prev => { const n = { ...prev }; delete n[r.id]; return n; });
    setDraftBox(prev => { const n = { ...prev }; delete n[r.id]; return n; });
  }

  // ── Mensaje privado para feedback negativo ──────────────────────────────────
  function openNegativeChat(r: ReviewRequest) {
    window.open(waLink(r.contact_phone, fillTemplate(NEGATIVE_TPL, r.contact_name, null)), "_blank");
  }

  async function setStatus(r: ReviewRequest, status: ReviewRequest["status"]) {
    if (!(await patchRequest(r.id, { status, updated_at: new Date().toISOString() }))) return;
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
    const smartActive = smartReplies && (r.stage === 1 || r.stage === 2);
    const busy = !!busyRow[r.id];
    const draft = draftVal(r);
    return (
      <div key={r.id} style={{ ...cardStyle, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Encabezado de la fila */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div style={{ minWidth: 140, flex: "1 1 160px" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{r.contact_name}</div>
            <div style={{ fontSize: 12, color: T.muted }}>
              {r.contact_phone} · {SOURCE_LABEL[r.source]}
              {showVendors && (
                <> · {nombreDeVendedora(r.vendor_id) ?? <span style={{ color: U.yellow }}>sin vendedora</span>}</>
              )}
            </div>
          </div>
          <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
            whiteSpace: "nowrap",
            background: r.stage === 3 ? `${U.green}20` : `${U.blue}15`,
            color: r.stage === 3 ? U.green : U.blue }}>
            {STAGE_LABEL[r.stage]}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
            {/* En smartActive el botón de envío vive en el panel de abajo */}
            {r.stage < 3 && !smartActive && (
              <button onClick={() => advanceStage(r)} style={{
                background: U.wa, color: "#fff", border: "none", borderRadius: 8,
                padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              }}>
                {STAGE_BTN[r.stage]}
              </button>
            )}
            {r.stage === 3 && (
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

        {/* Panel de IA (solo smartReplies, etapas 2 y 3) */}
        {smartActive && (
          <div style={{ borderTop: `1px dashed ${T.border}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 11.5, fontWeight: 600, color: T.muted }}>
              Respuesta del cliente por WhatsApp (pégala aquí para redactar {r.stage === 1 ? "el mensaje 2" : "el mensaje 3"})
            </label>
            <textarea
              rows={2}
              value={pasteVal(r)}
              placeholder="Ej. Todo bien, las unidades ya reportan sin problema"
              onChange={e => setPasteBox(prev => ({ ...prev, [r.id]: e.target.value }))}
              style={{ ...inputStyle, resize: "vertical", boxSizing: "border-box", outline: "none", fontSize: 13 }}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => generateDraft(r)} disabled={busy || !pasteVal(r).trim()} style={{
                background: busy ? T.border : T.accent, color: "#fff", border: "none", borderRadius: 8,
                padding: "8px 14px", fontSize: 12.5, fontWeight: 700,
                cursor: busy || !pasteVal(r).trim() ? "not-allowed" : "pointer", opacity: !pasteVal(r).trim() ? .6 : 1,
              }}>
                {busy ? "Generando..." : draft ? "✨ Regenerar" : "✨ Generar con IA"}
              </button>
            </div>

            {draft && (
              <>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: T.muted, marginTop: 2 }}>
                  Borrador (edítalo si quieres antes de enviar)
                </label>
                <textarea
                  rows={3}
                  value={draft}
                  onChange={e => setDraftBox(prev => ({ ...prev, [r.id]: e.target.value }))}
                  style={{ ...inputStyle, resize: "vertical", boxSizing: "border-box", outline: "none", fontSize: 13 }}
                />
              </>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => sendSmart(r)} style={{
                background: U.wa, color: "#fff", border: "none", borderRadius: 8,
                padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              }}>
                {draft ? "Enviar por WhatsApp" : STAGE_BTN[r.stage]}
              </button>
              {!draft && (
                <span style={{ fontSize: 11.5, color: T.muted, alignSelf: "center" }}>
                  Sin borrador se envía la plantilla de siempre.
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ textAlign: "center", padding: 60, color: T.muted }}>Cargando reseñas...</div>;

  if (linkError) {
    return (
      <div style={{ textAlign: "center", padding: "48px 20px", color: T.muted }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🔗</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>Enlace no disponible</div>
        <div style={{ fontSize: 14 }}>{linkError}</div>
      </div>
    );
  }

  return (
    <>
      {isVendor && vendorName && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>
            Hola {firstName(vendorName)}
          </div>
          <div style={{ fontSize: 13.5, color: T.muted, marginTop: 2 }}>
            Estos son tus clientes. Al dar clic se abre WhatsApp <b>desde tu número</b> con el mensaje ya escrito — tú lo revisas y lo envías.
          </div>
        </div>
      )}

      {!settings?.review_link && (
        <div style={{
          background: U.warnBg, border: `1px solid ${U.warnBorder}`, borderRadius: 10,
          padding: "10px 14px", fontSize: 13, color: U.warnText, marginBottom: 16,
        }}>
          {isVendor ? (
            <>⚠️ Todavía no está configurado el link de reseña. Puedes mandar los primeros dos mensajes; avísale a Ivonne para completar el tercero.</>
          ) : (
            <>
              ⚠️ Falta el Place ID de Google para generar el link de reseña.{" "}
              <button onClick={() => setShowSettings(true)} style={{
                background: "none", border: "none", color: U.warnText, fontWeight: 700,
                textDecoration: "underline", cursor: "pointer", fontSize: 13, padding: 0,
              }}>Configurar</button>
            </>
          )}
        </div>
      )}

      <StatGrid>
        <StatCard theme={T} icon="⭐" label={isVendor ? "Reseñas logradas" : `Reseñas logradas (meta ${settings?.review_goal ?? 25})`} value={completed.length} accent={U.green} />
        <StatCard theme={T} icon="📤" label={isVendor ? "Te faltan" : "En cola"} value={activeAll.length} />
        <StatCard theme={T} icon="📅" label="Mensajes hoy" value={sentToday} sub="Sugerido: máx 15–20 por día" />
        {!isVendor && (
          <StatCard theme={T} icon="🔗" label="Link de reseña" value={settings?.review_link ? "Listo ✓" : "Pendiente"} accent={settings?.review_link ? U.green : U.yellow} />
        )}
      </StatGrid>

      {showVendors && vendors.length > 0 && (
        <DSection theme={T} title={`Vendedoras (${vendors.length})`}>
          <p style={{ fontSize: 12.5, color: T.muted, marginTop: 0, marginBottom: 14, lineHeight: 1.55 }}>
            Cada vendedora tiene su propio tablero. Copia su enlace y mándaselo por WhatsApp:
            al abrirlo desde su celular, los mensajes salen de <b>su</b> número, no del tuyo.
            {sinAsignar > 0 && (
              <> <b style={{ color: U.warnText }}>{sinAsignar} contacto{sinAsignar !== 1 ? "s" : ""} sin vendedora asignada.</b></>
            )}
          </p>

          <div className="rv-grid">
            {vendorStats.map(s => {
              const avance = s.total > 0 ? Math.round(((s.total - s.pendientes) / s.total) * 100) : 0;
              return (
                <div key={s.vendor.id} style={{ ...cardStyle, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                      {s.vendor.name}
                    </div>
                    <div style={{ fontSize: 12, color: T.muted, whiteSpace: "nowrap" }}>{avance}%</div>
                  </div>

                  <div style={{ height: 7, borderRadius: 999, background: T.border, overflow: "hidden", marginBottom: 10 }}>
                    <div style={{ width: `${avance}%`, height: "100%", background: T.accent, transition: "width .3s" }} />
                  </div>

                  <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.7, marginBottom: 10 }}>
                    <div>⭐ <b style={{ color: U.green }}>{s.resenas}</b> reseñas · 📤 {s.pendientes} pendientes</div>
                    <div>Sin contactar {s.sinContactar} · En proceso {s.enProceso} · Cerrados sin reseña {s.descartados}</div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => copyVendorLink(s.vendor)} style={{
                      background: copiedId === s.vendor.id ? U.green : T.accent, color: "#fff", border: "none",
                      borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    }}>
                      {copiedId === s.vendor.id ? "✓ Copiado" : "🔗 Copiar link"}
                    </button>
                    <button onClick={() => { setVendorFilter(s.vendor.id); }} style={{
                      background: "none", border: `1px solid ${T.border}`, borderRadius: 8,
                      padding: "7px 12px", fontSize: 12.5, color: T.text, cursor: "pointer", fontWeight: 600,
                    }}>
                      Ver cola
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <style>{`
            .rv-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
            @media (max-width: 600px) { .rv-grid { grid-template-columns: 1fr; } }
          `}</style>
        </DSection>
      )}

      <DSection
        theme={T}
        title={isVendor ? "Tus clientes" : "Cola de reseñas"}
        action={isVendor ? undefined : { label: `+ Agregar ${personLabel}`, onClick: () => setShowAdd(true) }}
      >
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          {!isVendor && (
            <>
              <button onClick={() => setShowCsv(true)} style={{
                background: "none", border: `1px solid ${T.border}`, borderRadius: 8,
                padding: "7px 14px", fontSize: 13, color: T.text, cursor: "pointer", fontWeight: 600,
              }}>📄 Importar CSV</button>
              <button onClick={() => setShowSettings(true)} style={{
                background: "none", border: `1px solid ${T.border}`, borderRadius: 8,
                padding: "7px 14px", fontSize: 13, color: T.text, cursor: "pointer", fontWeight: 600,
              }}>⚙️ Configuración</button>
            </>
          )}
          {showVendors && vendors.length > 0 && (
            <select
              value={vendorFilter}
              onChange={e => setVendorFilter(e.target.value)}
              style={{ ...inputStyle, width: "auto", minWidth: 180, padding: "7px 10px", fontSize: 13, cursor: "pointer" }}
            >
              <option value="todas">Todas las vendedoras ({activeAll.length} en cola)</option>
              {vendorStats.map(s => (
                <option key={s.vendor.id} value={s.vendor.id}>{s.vendor.name} ({s.pendientes})</option>
              ))}
              {sinAsignar > 0 && <option value="sin">Sin asignar ({sinAsignar})</option>}
            </select>
          )}
          {finished.length > 0 && (
            <button onClick={() => setShowDone(v => !v)} style={{
              background: "none", border: "none", padding: "7px 4px",
              fontSize: 13, color: T.muted, cursor: "pointer", fontWeight: 600,
            }}>{showDone ? "▼" : "▶"} Historial ({finished.length})</button>
          )}
        </div>

        {active.length === 0 ? (
          <Empty theme={T} msg={isVendor
            ? "Ya no tienes clientes pendientes. ¡Terminaste tu lista!"
            : `Sin ${personLabelPlural} en la cola. Agrega ${personLabel === "clienta" ? "una" : "uno"}, importa un CSV${emptyHint ? ` ${emptyHint}` : ""}.`} />
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
