"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";

type Priority = "urgent" | "medium" | "low";
type Category = "estructural" | "mantenimiento" | "administrativo" | "pagos" | "seguridad" | "social";

interface Message {
  id: string; sender_name: string; sent_at: string;
  message_text: string; priority: Priority; category: Category;
  ai_summary: string; is_actionable: boolean; attended: boolean;
}
interface Building { id: string; name: string }

const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  urgent: { label: "🔴 Urgente",  color: "#ff4444", bg: "#2a1111" },
  medium: { label: "🟡 Medio",    color: "#ffaa00", bg: "#231c00" },
  low:    { label: "🟢 Bajo",     color: "#44cc88", bg: "#0f2318" },
};

const CATEGORY_LABELS: Record<Category, string> = {
  estructural:   "Estructural",
  mantenimiento: "Mantenimiento",
  administrativo:"Administrativo",
  pagos:         "Pagos",
  seguridad:     "Seguridad",
  social:        "Social",
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
  const [search,    setSearch]    = useState("");
  const [filterPri, setFilterPri] = useState<Priority | "all">("all");
  const [filterCat, setFilterCat] = useState<Category | "all">("all");
  const [onlyAction, setOnlyAction] = useState(false);
  const [expanded,  setExpanded]  = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const [bRes, mRes] = await Promise.all([
        supabase.from("sparc_buildings").select("id,name").eq("id", buildingId).single(),
        supabase.from("sparc_chat_messages").select("*").eq("building_id", buildingId).order("sent_at", { ascending: false }).limit(500),
      ]);

      if (bRes.data) setBuilding(bRes.data);
      if (mRes.data) setMessages(mRes.data);
      setLoading(false);
    }
    load();
  }, [buildingId, router]);

  async function toggleAttended(msg: Message) {
    const newVal = !msg.attended;
    await supabase.from("sparc_chat_messages").update({ attended: newVal, attended_at: newVal ? new Date().toISOString() : null }).eq("id", msg.id);
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, attended: newVal } : m));
  }

  const filtered = useMemo(() => {
    return messages.filter(m => {
      if (filterPri !== "all"  && m.priority !== filterPri)       return false;
      if (filterCat !== "all"  && m.category !== filterCat)       return false;
      if (onlyAction && !m.is_actionable)                         return false;
      if (search && !m.message_text.toLowerCase().includes(search.toLowerCase()) &&
          !m.sender_name.toLowerCase().includes(search.toLowerCase()) &&
          !m.ai_summary.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [messages, filterPri, filterCat, onlyAction, search]);

  function fmtDate(d: string) {
    return new Date(d).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0D1B2A", color: "#5a7a9a", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, sans-serif" }}>Cargando…</div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0D1B2A", color: "#f0f4f8", fontFamily: "Inter, sans-serif" }}>
      <NavBar buildingName={building?.name ?? "…"} buildingId={buildingId} active="mensajes" />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {/* Filtros */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar en mensajes…"
            style={{ flex: "1 1 220px", background: "#112233", border: "1px solid #1e3048", borderRadius: 8, padding: "8px 14px", color: "#f0f4f8", fontSize: 14, outline: "none" }}
          />
          <select value={filterPri} onChange={e => setFilterPri(e.target.value as any)}
            style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 8, padding: "8px 14px", color: "#f0f4f8", fontSize: 14 }}>
            <option value="all">Todas las prioridades</option>
            <option value="urgent">🔴 Urgentes</option>
            <option value="medium">🟡 Medios</option>
            <option value="low">🟢 Bajos</option>
          </select>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value as any)}
            style={{ background: "#112233", border: "1px solid #1e3048", borderRadius: 8, padding: "8px 14px", color: "#f0f4f8", fontSize: 14 }}>
            <option value="all">Todas las categorías</option>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "#5a7a9a", cursor: "pointer" }}>
            <input type="checkbox" checked={onlyAction} onChange={e => setOnlyAction(e.target.checked)} />
            Solo accionables
          </label>
          <span style={{ color: "#5a7a9a", fontSize: 13, marginLeft: "auto" }}>{filtered.length} mensajes</span>
        </div>

        {/* Tabla de mensajes */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.length === 0 && (
            <div style={{ color: "#5a7a9a", textAlign: "center", padding: "40px" }}>No hay mensajes con estos filtros.</div>
          )}
          {filtered.map(msg => {
            const pm   = PRIORITY_META[msg.priority];
            const isEx = expanded === msg.id;
            return (
              <div key={msg.id}
                style={{ background: msg.attended ? "#0d1b2a" : "#112233", border: `1px solid ${msg.attended ? "#1a2e42" : "#1e3048"}`, borderRadius: 10, padding: "12px 16px", opacity: msg.attended ? 0.6 : 1 }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {/* Prioridad badge */}
                  <span style={{ background: pm.bg, color: pm.color, borderRadius: 6, padding: "2px 8px", fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
                    {msg.priority === "urgent" ? "🔴" : msg.priority === "medium" ? "🟡" : "🟢"}
                  </span>
                  {/* Contenido */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{msg.sender_name}</span>
                      <span style={{ color: "#5a7a9a", fontSize: 12 }}>{fmtDate(msg.sent_at)}</span>
                      <span style={{ background: "#1a2e42", color: "#5a9abf", borderRadius: 4, padding: "1px 7px", fontSize: 11 }}>{CATEGORY_LABELS[msg.category]}</span>
                      {msg.is_actionable && <span style={{ background: "#1a2a1a", color: "#44cc88", borderRadius: 4, padding: "1px 7px", fontSize: 11 }}>✓ Accionable</span>}
                    </div>
                    {/* AI summary */}
                    {msg.ai_summary && (
                      <div style={{ color: "#8ab0cc", fontSize: 13, marginBottom: 6, fontStyle: "italic" }}>{msg.ai_summary}</div>
                    )}
                    {/* Texto expandible */}
                    <div style={{ fontSize: 13, color: "#c8d8e8", lineHeight: 1.5 }}>
                      {isEx ? msg.message_text : msg.message_text.substring(0, 120) + (msg.message_text.length > 120 ? "…" : "")}
                    </div>
                    {msg.message_text.length > 120 && (
                      <button onClick={() => setExpanded(isEx ? null : msg.id)}
                        style={{ background: "none", border: "none", color: FF_CYAN, fontSize: 12, cursor: "pointer", padding: "4px 0", marginTop: 2 }}>
                        {isEx ? "Ver menos" : "Ver más"}
                      </button>
                    )}
                  </div>
                  {/* Botón atendido */}
                  <button onClick={() => toggleAttended(msg)}
                    title={msg.attended ? "Marcar como pendiente" : "Marcar como atendido"}
                    style={{ background: msg.attended ? "#1a2e42" : "#0f2318", border: `1px solid ${msg.attended ? "#2a4060" : "#44cc8844"}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13, color: msg.attended ? "#5a7a9a" : "#44cc88", flexShrink: 0 }}>
                    {msg.attended ? "✓ Atendido" : "Atender"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
