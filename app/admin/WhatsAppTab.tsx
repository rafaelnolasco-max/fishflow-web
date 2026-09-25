"use client";

/**
 * Pestaña "WhatsApp" del /admin — bandeja de la línea FishFlow
 * (+52 56 1059 7851, Cloud API).
 *
 * Lee public.whatsapp_messages (RLS: is_admin) y contesta vía
 * /api/whatsapp/send. Texto libre solo dentro de las 24 h posteriores al
 * último mensaje del contacto; fuera de esa ventana Meta exige plantilla.
 * Se refresca cada 15 s (no hay realtime en esta tabla).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const C = {
  bg: "#0A1820", surface: "#0C2232", panel: "#11313f", text: "#e8f4f8",
  muted: "#5a8a9e", border: "rgba(255,255,255,0.08)", accent: "#1FA9D6",
  out: "#135b4f", danger: "#ef4444", warn: "#F26B17",
};

const DAY = 24 * 60 * 60 * 1000;

interface Msg {
  id: string;
  direction: "inbound" | "outbound";
  contact_wa_id: string;
  contact_name: string | null;
  msg_type: string;
  body: string | null;
  template_name: string | null;
  status: string | null;
  error: unknown;
  sent_by: string | null;
  created_at: string;
}

interface Convo {
  wa: string;
  name: string | null;
  last: Msg;
  lastInboundAt: number | null;
}

const STATUS_ICON: Record<string, string> = {
  accepted: "·", sent: "✓", delivered: "✓✓", read: "✓✓", failed: "!",
};

function fmtWa(wa: string) {
  // 5215514831644 → +52 55 1483 1644 ; resto tal cual con +
  const m = wa.match(/^521?(\d{2})(\d{4})(\d{4})$/);
  return m ? `+52 ${m[1]} ${m[2]} ${m[3]}` : `+${wa}`;
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat("es-MX", today
    ? { hour: "numeric", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }
  ).format(d);
}

export default function WhatsAppTab() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("id,direction,contact_wa_id,contact_name,msg_type,body,template_name,status,error,sent_by,created_at")
      .order("created_at", { ascending: false })
      .range(0, 999);
    if (error) setLoadError(error.message);
    else { setLoadError(null); setMsgs((data ?? []).reverse() as Msg[]); }
    setLoading(false);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const convos = useMemo<Convo[]>(() => {
    const map = new Map<string, Convo>();
    for (const m of msgs) {
      const c = map.get(m.contact_wa_id) ?? { wa: m.contact_wa_id, name: null, last: m, lastInboundAt: null };
      c.last = m;
      if (m.contact_name) c.name = m.contact_name;
      if (m.direction === "inbound") c.lastInboundAt = new Date(m.created_at).getTime();
      map.set(m.contact_wa_id, c);
    }
    return [...map.values()].sort(
      (a, b) => new Date(b.last.created_at).getTime() - new Date(a.last.created_at).getTime()
    );
  }, [msgs]);

  const current = convos.find((c) => c.wa === sel) ?? null;
  const thread = useMemo(() => msgs.filter((m) => m.contact_wa_id === sel), [msgs, sel]);
  const windowOpen = !!current?.lastInboundAt && now - current.lastInboundAt < DAY;
  const hoursLeft = current?.lastInboundAt
    ? Math.max(0, Math.floor((current.lastInboundAt + DAY - now) / 3600000))
    : 0;

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [sel, thread.length]);

  async function send() {
    if (!sel || !draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: sel, text: draft }),
        signal: AbortSignal.timeout(30000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setSendError(j.error ?? `Error ${r.status}`);
      else { setDraft(""); await load(); }
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "No se pudo enviar");
    } finally {
      setSending(false);
    }
  }

  const box: React.CSSProperties = {
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden",
  };

  if (loading) return <div style={{ color: C.muted, padding: 24 }}>Cargando conversaciones…</div>;

  return (
    <div className="wa-grid" data-sel={sel ? "1" : "0"} style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 12, minHeight: 520 }}>
      <style>{`
        @media (max-width: 760px) {
          .wa-grid { grid-template-columns: 1fr !important; }
          .wa-grid[data-sel="1"] .wa-list { display: none; }
          .wa-grid[data-sel="0"] .wa-thread { display: none; }
        }
        .wa-back { display: none; }
        @media (max-width: 760px) { .wa-back { display: inline-block; } }
      `}</style>

      {/* Lista */}
      <div className="wa-list" style={box}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, color: C.text, fontWeight: 700, fontSize: 14 }}>
          WhatsApp FishFlow <span style={{ color: C.muted, fontWeight: 400 }}>· +52 56 1059 7851</span>
        </div>
        {loadError && <div style={{ color: C.danger, padding: 12, fontSize: 13 }}>{loadError}</div>}
        {!convos.length && !loadError && (
          <div style={{ color: C.muted, padding: 16, fontSize: 13 }}>Aún no hay conversaciones.</div>
        )}
        <div style={{ maxHeight: 600, overflowY: "auto" }}>
          {convos.map((c) => {
            const open = !!c.lastInboundAt && now - c.lastInboundAt < DAY;
            return (
              <button
                key={c.wa}
                onClick={() => { setSel(c.wa); setSendError(null); }}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                  background: sel === c.wa ? C.panel : "transparent", border: "none",
                  borderBottom: `1px solid ${C.border}`, cursor: "pointer", color: C.text,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name ?? fmtWa(c.wa)}</span>
                  <span style={{ color: C.muted, fontSize: 11, whiteSpace: "nowrap" }}>{fmtTime(c.last.created_at)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 3 }}>
                  <span style={{ color: C.muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.last.direction === "outbound" ? "Tú: " : ""}
                    {c.last.template_name ? `[${c.last.template_name}] ` : ""}
                    {c.last.body ?? ""}
                  </span>
                  {open && <span title="Ventana de 24 h abierta" style={{ width: 8, height: 8, borderRadius: 8, background: "#22c55e", flex: "none", marginTop: 4 }} />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Conversación */}
      <div className="wa-thread" style={{ ...box, display: "flex", flexDirection: "column" }}>
        {!current ? (
          <div style={{ color: C.muted, padding: 24, fontSize: 13, margin: "auto" }}>Elige una conversación.</div>
        ) : (
          <>
            <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <button className="wa-back" onClick={() => setSel(null)}
                style={{ background: "none", border: "none", color: C.accent, fontSize: 18, cursor: "pointer" }} aria-label="Volver">‹</button>
              <div>
                <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{current.name ?? fmtWa(current.wa)}</div>
                <div style={{ color: C.muted, fontSize: 12 }}>{fmtWa(current.wa)}</div>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 8, maxHeight: 520 }}>
              {thread.map((m) => (
                <div key={m.id} style={{
                  alignSelf: m.direction === "outbound" ? "flex-end" : "flex-start",
                  maxWidth: "78%", background: m.direction === "outbound" ? C.out : C.panel,
                  color: C.text, borderRadius: 10, padding: "8px 10px", fontSize: 13, lineHeight: 1.4,
                  border: m.status === "failed" ? `1px solid ${C.danger}` : "none",
                }}>
                  {(m.template_name || m.sent_by === "bot") && (
                    <div style={{ color: C.muted, fontSize: 11, marginBottom: 2 }}>
                      {m.sent_by === "bot" ? "🤖 Asistente IA" : `Plantilla · ${m.template_name}`}
                    </div>
                  )}
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body ?? `[${m.msg_type}]`}</div>
                  <div style={{ color: C.muted, fontSize: 10, textAlign: "right", marginTop: 3 }}>
                    {fmtTime(m.created_at)}
                    {m.direction === "outbound" && (
                      <span style={{ marginLeft: 5, color: m.status === "read" ? C.accent : m.status === "failed" ? C.danger : C.muted }}>
                        {STATUS_ICON[m.status ?? ""] ?? ""}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <div style={{ borderTop: `1px solid ${C.border}`, padding: 10 }}>
              {windowOpen ? (
                <div style={{ color: C.muted, fontSize: 11, marginBottom: 6 }}>
                  Ventana abierta · quedan ~{hoursLeft} h para contestar con texto libre
                </div>
              ) : (
                <div style={{ color: C.warn, fontSize: 12, marginBottom: 6 }}>
                  Ventana de 24 h cerrada: Meta solo acepta plantillas aprobadas con este contacto.
                </div>
              )}
              {sendError && <div style={{ color: C.danger, fontSize: 12, marginBottom: 6 }}>{sendError}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  disabled={!windowOpen || sending}
                  placeholder={windowOpen ? "Escribe una respuesta…" : "Ventana cerrada"}
                  rows={2}
                  style={{
                    flex: 1, resize: "vertical", background: C.bg, color: C.text,
                    border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, fontSize: 13,
                  }}
                />
                <button
                  onClick={send}
                  disabled={!windowOpen || sending || !draft.trim()}
                  style={{
                    background: C.accent, color: "#fff", border: "none", borderRadius: 8,
                    padding: "0 16px", fontWeight: 600, cursor: "pointer",
                    opacity: !windowOpen || sending || !draft.trim() ? 0.5 : 1,
                  }}
                >
                  {sending ? "…" : "Enviar"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Contador para la pestaña 💬 del /admin: conversaciones (últimos 7 días)
 * cuyo último mensaje es del cliente, o sea, sin responder. Se refresca cada 60 s.
 */
export function useWhatsAppPending(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const desde = new Date(Date.now() - 7 * DAY).toISOString();
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("contact_wa_id, direction")
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (!alive || error || !data) return;
      const seen = new Set<string>();
      let count = 0;
      for (const m of data as { contact_wa_id: string; direction: string }[]) {
        if (seen.has(m.contact_wa_id)) continue;
        seen.add(m.contact_wa_id);
        if (m.direction === "inbound") count++;
      }
      setN(count);
    };
    run();
    const t = setInterval(run, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return n;
}
