"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";

type Priority = "urgent" | "medium" | "low";
type Category = "estructural" | "mantenimiento" | "administrativo" | "pagos" | "seguridad" | "social";
type Tab = "pendientes" | "respondidos" | "todos";

interface Message {
  id: string; sender_name: string; sent_at: string;
  message_text: string; priority: Priority; category: Category;
  ai_summary: string; is_actionable: boolean; attended: boolean;
  is_staff: boolean;
  response_status: "responded" | "pending" | null;
  responded_by: string | null;
  responded_at: string | null;
  response_excerpt: string | null;
}
interface Building { id: string; name: string }

const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  urgent: { label: "🔴 Urgente", color: "#ff4444", bg: "#2a1111" },
  medium: { label: "🟡 Medio",   color: "#ffaa00", bg: "#231c00" },
  low:    { label: "🟢 Bajo",    color: "#44cc88", bg: "#0f2318" },
};

const CATEGORY_LABELS: Record<Category, string> = {
  estructural:    "Estructural",
  mantenimiento:  "Mantenimiento",
  administrativo: "Administrativo",
  pagos:          "Pagos",
  seguridad:      "Seguridad",
  social:         "Social",
};

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
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 16 }}>
        <FishFlowMark size={24} />
        <button onClick={() => router.push("/app/sparc")} style={{ background: "none", border: "none", color: FF_CYAN, fontWeight: 700, fontSize: 15, cursor: "pointer", padding: 0 }}>Sparc</button>
        <span style={{ color: "#5a7a9a" }}>/</span>
        <span style={{ color: "#f0f4f8", fontSize: 14, fontWeight: 600 }}>{buildingName}</span>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
        {tabs.map(t => (
          <button key={t.path} onClick={() => router.push(`/app/sparc/${buildingId}/${t.path}`)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "8px 16px", fontSize: 14, fontWeight: active === t.path ? 700 : 400, color: active === t.path ? FF_CYAN : "#5a7a9a", borderBottom: active === t.path ? `2px solid ${FF_CYAN}` : "2px solid transparent", marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SparcMensajes() {
  const router     = useRouter();
  const params     = useParams();
  const buildingId = params.building_id as string;

  const [building,  setBuilding]  = useState<Building | null>(null);
  const [messages,  setMessages]  = useState<Message[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState<Tab>("pendientes");
  const [search,    setSearch]    = useState("");
  const [filterPri, setFilterPri] = useState<Priority | "all">("all");
  const [filterResp, setFilterResp] = useState<string>("all"); // "all" | nombre staff | "none"
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [expandedResp, setExpandedResp] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const [bRes, mRes] = await Promise.all([
        supabase.from("sparc_buildings").select("id,name").eq("id", buildingId).single(),
        supabase.from("sparc_chat_messages").select("*").eq("building_id", buildingId).order("sent_at", { ascending: false }).limit(1000),
      ]);
      if (bRes.data) setBuilding(bRes.data);
      if (mRes.data) setMessages(mRes.data);
      setLoading(false);
    }
    load();
  }, [buildingId, router]);

  async function toggleAttended(msg: Message) {
    const newVal = !msg.attended;
    await supabase.from("sparc_chat_messages")
      .update({ attended: newVal, attended_at: newVal ? new Date().toISOString() : null })
      .eq("id", msg.id);
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, attended: newVal } : m));
  }

  // Accionables = solo solicitudes de vecinos (no mensajes del propio equipo)
  const actionable = useMemo(() => messages.filter(m => m.is_actionable && !m.is_staff), [messages]);

  // Personas del equipo que aparecen como autoras de respuestas detectadas
  const responders = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) if (m.responded_by) set.add(m.responded_by);
    return [...set].sort();
  }, [messages]);

  const filtered = useMemo(() => {
    let base: Message[];
    if (tab === "pendientes")  base = actionable.filter(m => !m.attended);
    else if (tab === "respondidos") base = actionable.filter(m => m.attended);
    else base = messages; // todos

    return base.filter(m => {
      if (filterPri !== "all" && m.priority !== filterPri) return false;
      if (filterResp !== "all") {
        if (filterResp === "none") {
          if (m.response_status !== "pending") return false;
        } else if (m.responded_by !== filterResp) return false;
      }
      if (search && !m.message_text.toLowerCase().includes(search.toLowerCase()) &&
          !m.sender_name.toLowerCase().includes(search.toLowerCase()) &&
          !m.ai_summary.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [messages, actionable, tab, filterPri, filterResp, search]);

  const pendingCount    = actionable.filter(m => !m.attended).length;
  const respondedCount  = actionable.filter(m =>  m.attended).length;

  function fmtDate(d: string) {
    return new Date(d).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0D1B2A", color: "#5a7a9a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif" }}>Cargando…</div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0D1B2A", color: "#f0f4f8", fontFamily: "Inter, sans-serif" }}>
      <NavBar buildingName={building?.name ?? "…"} buildingId={buildingId} active="mensajes" />

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px" }}>

        {/* Tabs principales */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, background: "#112233", borderRadius: 12, padding: 6 }}>
          {([
            { key: "pendientes",  label: "Pendientes",  count: pendingCount,   color: FF_ORANGE },
            { key: "respondidos", label: "Respondidos", count: respondedCount, color: "#44cc88" },
            { key: "todos",       label: "Todos los mensajes", count: messages.length, color: "#5a7a9a" },
          ] as { key: Tab; label: string; count: number; color: string }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{
                flex: 1, background: tab === t.key ? "#0D1B2A" : "transparent",
                border: tab === t.key ? "1px solid #1e3048" : "1px solid transparent",
                borderRadius: 8, padding: "10px 16px", cursor: "pointer",
                color: tab === t.key ? "#f0f4f8" : "#5a7a9a",
                transition: "all 0.15s",
              }}>
              <div style={{ fontSize: 13, fontWeight: tab === t.key ? 700 : 400 }}>{t.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: tab === t.key ? t.color : "#3a5a7a", marginTop: 2 }}>{t.count}</div>
            </button>
          ))}
        </div>

        {/* Barra de búsqueda y filtro de prioridad */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar en mensajes…"
            style={{ flex: "1 1 200px", background: "#112233", border: "1px solid #1e3048", borderRadius: 8, padding: "8px 14px", color: "#f0f4f8", fontSize: 14, outline: "none" }} />
          <select value={filterPri} onChange={e => setFilterPri(e.target.value as any)}
            style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 8, padding: "8px 14px", color: "#f0f4f8", fontSize: 14 }}>
            <option value="all">Todas las prioridades</option>
            <option value="urgent">🔴 Urgentes</option>
            <option value="medium">🟡 Medios</option>
            <option value="low">🟢 Bajos</option>
          </select>
          <select value={filterResp} onChange={e => setFilterResp(e.target.value)}
            title="Filtrar por quién respondió (detección IA)"
            style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 8, padding: "8px 14px", color: "#f0f4f8", fontSize: 14 }}>
            <option value="all">🤖 Respuesta: todas</option>
            {responders.map(r => <option key={r} value={r}>Respondió: {r}</option>)}
            <option value="none">Sin respuesta detectada</option>
          </select>
          <span style={{ color: "#5a7a9a", fontSize: 13, alignSelf: "center", marginLeft: "auto" }}>
            {filtered.length} mensaje{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Estado vacío */}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 24px", color: "#5a7a9a" }}>
            {tab === "pendientes"
              ? <><div style={{ fontSize: 40, marginBottom: 12 }}>✅</div><div style={{ fontWeight: 600 }}>Sin mensajes pendientes</div><div style={{ fontSize: 13, marginTop: 4 }}>Todo está atendido.</div></>
              : tab === "respondidos"
              ? <><div style={{ fontSize: 40, marginBottom: 12 }}>📭</div><div style={{ fontWeight: 600 }}>Aún no hay mensajes respondidos</div></>
              : <><div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div><div>Sin resultados para esta búsqueda.</div></>
            }
          </div>
        )}

        {/* Lista de mensajes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(msg => {
            const pm  = PRIORITY_META[msg.priority];
            const isEx = expanded === msg.id;
            return (
              <div key={msg.id} style={{
                background: msg.attended ? "#0a1520" : "#112233",
                border: `1px solid ${msg.attended ? "#152030" : msg.priority === "urgent" ? "#ff444433" : "#1e3048"}`,
                borderRadius: 10, padding: "14px 16px",
                opacity: msg.attended ? 0.65 : 1,
                transition: "opacity 0.2s",
              }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {/* Prioridad */}
                  <span style={{ background: pm.bg, color: pm.color, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 3 }}>
                    {msg.priority === "urgent" ? "🔴" : msg.priority === "medium" ? "🟡" : "🟢"}
                  </span>

                  {/* Contenido */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{msg.sender_name}</span>
                      <span style={{ color: "#5a7a9a", fontSize: 12 }}>{fmtDate(msg.sent_at)}</span>
                      <span style={{ background: "#1a2e42", color: "#5a9abf", borderRadius: 4, padding: "1px 7px", fontSize: 11 }}>{CATEGORY_LABELS[msg.category]}</span>
                    </div>

                    {msg.ai_summary && (
                      <div style={{ color: "#8ab0cc", fontSize: 13, marginBottom: 5, fontStyle: "italic" }}>{msg.ai_summary}</div>
                    )}

                    <div style={{ fontSize: 13, color: "#c8d8e8", lineHeight: 1.5 }}>
                      {isEx ? msg.message_text : msg.message_text.substring(0, 140) + (msg.message_text.length > 140 ? "…" : "")}
                    </div>
                    {msg.message_text.length > 140 && (
                      <button onClick={() => setExpanded(isEx ? null : msg.id)}
                        style={{ background: "none", border: "none", color: FF_CYAN, fontSize: 12, cursor: "pointer", padding: "4px 0", marginTop: 2 }}>
                        {isEx ? "Ver menos" : "Ver más"}
                      </button>
                    )}

                    {/* Estado de respuesta detectado por IA (informativo, no cambia attended) */}
                    {!msg.is_staff && msg.is_actionable && msg.response_status && (
                      <div style={{ marginTop: 8 }}>
                        {msg.response_status === "responded" ? (
                          <>
                            <button onClick={() => setExpandedResp(expandedResp === msg.id ? null : msg.id)}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 6,
                                background: "#0f2318", border: "1px solid #44cc8855", borderRadius: 6,
                                padding: "4px 10px", fontSize: 12, fontWeight: 600, color: "#44cc88", cursor: "pointer",
                              }}>
                              🤖 Respondido por {msg.responded_by}
                              {msg.responded_at && <span style={{ color: "#2f8f5f", fontWeight: 400 }}>· {fmtDate(msg.responded_at)}</span>}
                              {msg.response_excerpt && <span style={{ color: "#2f8f5f" }}>{expandedResp === msg.id ? "▲" : "▼"}</span>}
                            </button>
                            {expandedResp === msg.id && msg.response_excerpt && (
                              <div style={{ marginTop: 6, background: "#0a1a12", border: "1px solid #1e3a28", borderLeft: "3px solid #44cc88", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#9fc8b0", lineHeight: 1.5 }}>
                                {msg.response_excerpt}
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            background: "#231c00", border: "1px solid #ffaa0033", borderRadius: 6,
                            padding: "4px 10px", fontSize: 12, fontWeight: 600, color: "#ffaa00",
                          }}>
                            🤖 Sin respuesta detectada
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Botón respuesta */}
                  {(tab === "pendientes" || tab === "respondidos" || msg.is_actionable) && (
                    <button onClick={() => toggleAttended(msg)}
                      title={msg.attended ? "Marcar como pendiente" : "Marcar como respondido"}
                      style={{
                        background: msg.attended ? "#152030" : "#0f2318",
                        border: `1px solid ${msg.attended ? "#2a4060" : "#44cc8855"}`,
                        borderRadius: 8, padding: "7px 12px", cursor: "pointer",
                        fontSize: 12, fontWeight: 600, flexShrink: 0,
                        color: msg.attended ? "#5a7a9a" : "#44cc88",
                        whiteSpace: "nowrap",
                      }}>
                      {msg.attended ? "✓ Respondido" : "Responder"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
