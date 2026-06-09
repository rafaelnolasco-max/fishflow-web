"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";

interface Building  { id: string; name: string; address: string | null }
interface Summary   {
  summary_date: string; total_messages: number;
  urgent_count: number; medium_count: number; low_count: number;
  executive_summary: string; action_items: string[];
  urgent_summary: string; medium_summary: string; low_summary: string;
}
interface UploadInfo { id: string; uploaded_at: string; total_messages: number; date_range_start: string; date_range_end: string; processed: boolean }
interface PendingMsg {
  id: string; sender_name: string; sent_at: string; priority: string;
  ai_summary: string; message_text: string;
}
interface StaffMsg { responded_by: string | null; response_status: string | null; is_staff: boolean; is_actionable: boolean }

function FishFlowMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.52} viewBox="0 0 68 36" fill="none">
      <path d="M34 18 C34 9 25 3 15 6 C6 9 4 19 11 24 C19 30 34 27 34 18Z" stroke={FF_CYAN} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M34 18 C34 9 43 3 53 6 C62 9 64 19 57 24 C49 30 34 27 34 18Z" stroke={FF_ORANGE} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M64 14 L68 10 M64 22 L68 26" stroke={FF_ORANGE} strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function NavBar({ buildingName, buildingId, active }: { buildingName: string; buildingId: string; active: string }) {
  const router = useRouter();
  const tabs = [
    { label: "Dashboard",  path: "dashboard" },
    { label: "Mensajes",   path: "mensajes"  },
    { label: "Subir chat", path: "subir"     },
  ];
  return (
    <div style={{ borderBottom: "1px solid #1e3048", background: "#0D1B2A", padding: "0 32px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 16, paddingBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <FishFlowMark size={24} />
          <button onClick={() => router.push("/app/sparc")} style={{ background: "none", border: "none", color: FF_CYAN, fontWeight: 700, fontSize: 15, cursor: "pointer", padding: 0 }}>
            Sparc
          </button>
          <span style={{ color: "#5a7a9a" }}>/</span>
          <span style={{ color: "#f0f4f8", fontSize: 14, fontWeight: 600 }}>{buildingName}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
        {tabs.map(t => (
          <button key={t.path} onClick={() => router.push(`/app/sparc/${buildingId}/${t.path}`)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "8px 16px", fontSize: 14, fontWeight: active === t.path ? 700 : 400,
              color: active === t.path ? FF_CYAN : "#5a7a9a",
              borderBottom: active === t.path ? `2px solid ${FF_CYAN}` : "2px solid transparent",
              marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SparcDashboard() {
  const router    = useRouter();
  const params    = useParams();
  const buildingId = params.building_id as string;

  const [building,        setBuilding]        = useState<Building | null>(null);
  const [summaries,       setSummaries]       = useState<Summary[]>([]);
  const [lastUpload,      setLastUpload]      = useState<UploadInfo | null>(null);
  const [loading,         setLoading]         = useState(true);
  const [selectedSummary, setSelectedSummary] = useState<Summary | null>(null);
  const [pending,         setPending]         = useState<PendingMsg[]>([]);
  const [respLoad,        setRespLoad]        = useState<{ name: string; count: number }[]>([]);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [bRes, sRes, uRes, pRes] = await Promise.all([
        supabase.from("sparc_buildings").select("id,name,address").eq("id", buildingId).single(),
        supabase.from("sparc_daily_summaries").select("*").eq("building_id", buildingId).order("summary_date", { ascending: false }).limit(14),
        supabase.from("sparc_chat_uploads").select("id,uploaded_at,total_messages,date_range_start,date_range_end,processed").eq("building_id", buildingId).order("uploaded_at", { ascending: false }).limit(1).single(),
        supabase.from("sparc_chat_messages")
          .select("id,sender_name,sent_at,priority,ai_summary,message_text,is_staff,is_actionable,response_status,responded_by")
          .eq("building_id", buildingId).eq("is_actionable", true).eq("is_staff", false).limit(1000),
      ]);

      if (bRes.data) setBuilding(bRes.data);
      if (sRes.data) {
        setSummaries(sRes.data);
        // Default: día con más urgentes (o el más reciente si no hay urgentes)
        const mostUrgent = [...sRes.data].sort((a, b) => b.urgent_count - a.urgent_count)[0] ?? sRes.data[0];
        setSelectedSummary(mostUrgent ?? null);
      }
      if (uRes.data) setLastUpload(uRes.data);

      if (pRes.data) {
        const rows = pRes.data as any[];
        // Bandeja de pendientes: accionables de vecinos sin respuesta detectada, más viejo primero
        const pend = rows
          .filter(m => m.response_status === "pending")
          .map(m => ({ id: m.id, sender_name: m.sender_name, sent_at: m.sent_at, priority: m.priority, ai_summary: m.ai_summary, message_text: m.message_text }))
          .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
        setPending(pend);
        // Carga por persona: cuántos mensajes de vecinos atendió cada quien (detección IA)
        const counts = new Map<string, number>();
        for (const m of rows) {
          if (m.response_status === "responded" && m.responded_by) {
            counts.set(m.responded_by, (counts.get(m.responded_by) ?? 0) + 1);
          }
        }
        setRespLoad([...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));
      }
      setLoading(false);
    }
    load();
  }, [buildingId, router]);

  const totals = summaries.reduce((acc, s) => ({
    urgent: acc.urgent + s.urgent_count,
    medium: acc.medium + s.medium_count,
    low:    acc.low    + s.low_count,
    total:  acc.total  + s.total_messages,
  }), { urgent: 0, medium: 0, low: 0, total: 0 });

  const latestSummary = selectedSummary ?? summaries[0] ?? null;

  function fmt(d: string) {
    return new Date(d + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  }

  function antiguedad(sentAt: string) {
    const dias = Math.floor((Date.now() - new Date(sentAt).getTime()) / 86400000);
    if (dias <= 0) return "hoy";
    if (dias === 1) return "1 día sin respuesta";
    return `${dias} días sin respuesta`;
  }

  const PRI_DOT: Record<string, string> = { urgent: "🔴", medium: "🟡", low: "🟢" };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0D1B2A", color: "#5a7a9a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif" }}>
      Cargando…
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0D1B2A", color: "#f0f4f8", fontFamily: "Inter, sans-serif" }}>
      <NavBar buildingName={building?.name ?? "…"} buildingId={buildingId} active="dashboard" />

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "36px 24px" }}>
        {/* Header info */}
        {lastUpload && (
          <div style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 10, padding: "12px 20px", marginBottom: 28, fontSize: 13, color: "#5a7a9a", display: "flex", gap: 24, flexWrap: "wrap" }}>
            <span>📁 Último upload: <b style={{ color: "#f0f4f8" }}>{new Date(lastUpload.uploaded_at).toLocaleDateString("es-MX")}</b></span>
            <span>📅 Rango: <b style={{ color: "#f0f4f8" }}>{fmt(lastUpload.date_range_start)} — {fmt(lastUpload.date_range_end)}</b></span>
            <span>💬 Mensajes procesados: <b style={{ color: "#f0f4f8" }}>{lastUpload.total_messages}</b></span>
          </div>
        )}

        {!lastUpload && (
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); router.push(`/app/sparc/${buildingId}/subir`); }}
            style={{ background: "#112233", border: "1px dashed #1e3048", borderRadius: 10, padding: "32px", marginBottom: 28, textAlign: "center", color: "#5a7a9a" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
            <div style={{ marginBottom: 4 }}>No hay chats procesados aún.</div>
            <div style={{ fontSize: 12, marginBottom: 16, color: "#3a5a7a" }}>Arrastra tu ZIP o TXT aquí, o haz clic en el botón</div>
            <button onClick={() => router.push(`/app/sparc/${buildingId}/subir`)}
              style={{ background: FF_CYAN, border: "none", borderRadius: 8, padding: "10px 24px", color: "#0D1B2A", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
              Subir primer chat
            </button>
          </div>
        )}

        {/* Cards de métricas */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
          {[
            { label: "🔴 Urgentes",  value: totals.urgent, color: "#ff4444", bg: "#2a1111" },
            { label: "🟡 Medios",    value: totals.medium, color: "#ffaa00", bg: "#231c00" },
            { label: "🟢 Bajos",     value: totals.low,    color: "#44cc88", bg: "#0f2318" },
          ].map(c => (
            <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.color}33`, borderRadius: 12, padding: "24px 20px" }}>
              <div style={{ fontSize: 13, color: "#aaa", marginBottom: 6 }}>{c.label}</div>
              <div style={{ fontSize: 40, fontWeight: 800, color: c.color }}>{c.value}</div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>de {totals.total} mensajes</div>
            </div>
          ))}
        </div>

        {/* Bandeja de Pendientes — accionables de vecinos sin respuesta detectada */}
        <div style={{ background: "#112233", border: `1px solid ${pending.length > 0 ? "#ff720044" : "#1e3048"}`, borderRadius: 12, padding: "20px 24px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "#5a7a9a", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>
              📥 Bandeja de pendientes
            </div>
            <span style={{ background: pending.length > 0 ? "#2a1500" : "#0f2318", color: pending.length > 0 ? FF_ORANGE : "#44cc88", borderRadius: 20, padding: "2px 12px", fontSize: 13, fontWeight: 700 }}>
              {pending.length} sin responder
            </span>
          </div>

          {pending.length === 0 ? (
            <div style={{ color: "#5a7a9a", fontSize: 13, padding: "8px 0" }}>✅ Todo lo accionable tiene respuesta detectada.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pending.slice(0, 8).map(p => (
                <div key={p.id}
                  onClick={() => router.push(`/app/sparc/${buildingId}/mensajes`)}
                  style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#0d1b2a", borderRadius: 8, padding: "10px 14px", fontSize: 13, cursor: "pointer" }}>
                  <span style={{ flexShrink: 0 }}>{PRI_DOT[p.priority] ?? "🟢"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, color: "#f0f4f8" }}>{p.sender_name}</span>
                      <span style={{ color: p.priority === "urgent" ? FF_ORANGE : "#5a7a9a", fontSize: 12, fontWeight: 600 }}>· {antiguedad(p.sent_at)}</span>
                    </div>
                    <div style={{ color: "#9fb8cc", fontSize: 13, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.ai_summary || p.message_text.substring(0, 80)}
                    </div>
                  </div>
                </div>
              ))}
              {pending.length > 8 && (
                <button onClick={() => router.push(`/app/sparc/${buildingId}/mensajes`)}
                  style={{ background: "none", border: "none", color: FF_CYAN, fontSize: 13, cursor: "pointer", padding: "8px 0 0", textAlign: "left" }}>
                  Ver los {pending.length} pendientes en Mensajes →
                </button>
              )}
            </div>
          )}

          {/* Carga por persona del equipo */}
          {respLoad.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #1e3048" }}>
              <div style={{ fontSize: 11, color: "#5a7a9a", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                Respuestas detectadas por persona
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {respLoad.map(r => (
                  <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8, background: "#0f2318", border: "1px solid #44cc8833", borderRadius: 8, padding: "8px 14px" }}>
                    <span style={{ color: "#c8d8e8", fontSize: 13, fontWeight: 600 }}>{r.name}</span>
                    <span style={{ color: "#44cc88", fontSize: 16, fontWeight: 800 }}>{r.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Resumen del día más reciente */}
        {latestSummary && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 12, color: "#5a7a9a", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>
              Reporte IA — {fmt(latestSummary.summary_date)}
            </div>

            {/* Resumen general */}
            <div style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 12, padding: "20px 24px", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#5a7a9a", marginBottom: 6, fontWeight: 600 }}>RESUMEN GENERAL</div>
              <p style={{ lineHeight: 1.7, color: "#c8d8e8", fontSize: 14, margin: 0 }}>
                {latestSummary.executive_summary}
              </p>
            </div>

            {/* 3 secciones por prioridad */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginBottom: 16 }}>
              {[
                { key: "urgent_summary",  label: "🔴 LO MÁS URGENTE",  color: "#ff4444", bg: "#2a1111", border: "#ff444433", text: latestSummary.urgent_summary  },
                { key: "medium_summary",  label: "🟡 TEMAS MEDIOS",     color: "#ffaa00", bg: "#231c00", border: "#ffaa0033", text: latestSummary.medium_summary  },
                { key: "low_summary",     label: "🟢 TEMAS MENORES",    color: "#44cc88", bg: "#0f2318", border: "#44cc8833", text: latestSummary.low_summary     },
              ].map(s => (
                <div key={s.key} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10, padding: "16px 20px" }}>
                  <div style={{ fontSize: 11, color: s.color, fontWeight: 700, marginBottom: 8, letterSpacing: 1 }}>{s.label}</div>
                  <p style={{ color: "#c8d8e8", fontSize: 14, lineHeight: 1.65, margin: 0 }}>
                    {s.text || "—"}
                  </p>
                </div>
              ))}
            </div>

            {/* Acciones pendientes */}
            {Array.isArray(latestSummary.action_items) && latestSummary.action_items.length > 0 && (
              <div style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, color: "#5a7a9a", marginBottom: 12, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>
                  ✅ Acciones pendientes para el administrador
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {(latestSummary.action_items as string[]).map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#0d1b2a", borderRadius: 8, padding: "10px 14px", fontSize: 14 }}>
                      <span style={{ color: FF_ORANGE, flexShrink: 0, fontWeight: 800 }}>{i + 1}.</span>
                      <span style={{ color: "#c8d8e8" }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Historial de días — clickeable */}
        {summaries.length > 0 && (
          <div style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ fontSize: 12, color: "#5a7a9a", marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>
              Historial por día — toca un día para ver su reporte
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {summaries.map(s => {
                const isSelected = latestSummary?.summary_date === s.summary_date;
                return (
                  <div key={s.summary_date}
                    onClick={() => setSelectedSummary(s)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 12px", borderRadius: 8, fontSize: 13,
                      cursor: "pointer",
                      background: isSelected ? "#0d1b2a" : "transparent",
                      border: isSelected ? `1px solid ${FF_CYAN}44` : "1px solid transparent",
                      transition: "background 0.1s",
                    }}>
                    <span style={{ color: isSelected ? FF_CYAN : "#5a7a9a", width: 110, flexShrink: 0, fontWeight: isSelected ? 700 : 400 }}>
                      {isSelected ? "▶ " : ""}{fmt(s.summary_date)}
                    </span>
                    <span style={{ color: s.urgent_count > 0 ? "#ff4444" : "#3a5a7a" }}>🔴 {s.urgent_count}</span>
                    <span style={{ color: s.medium_count > 0 ? "#ffaa00" : "#3a5a7a" }}>🟡 {s.medium_count}</span>
                    <span style={{ color: "#44cc88" }}>🟢 {s.low_count}</span>
                    <span style={{ color: "#5a7a9a", marginLeft: "auto" }}>{s.total_messages} msgs</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
