"use client";

/**
 * Panel de SPARC — Prospectos de la landing.
 *
 * Antes esta pantalla era la lista de edificios del analizador de chats de
 * WhatsApp. Eduardo no lo esta usando (17-sep-2026), asi que la entrada del
 * panel pasa a ser lo unico que si ocupa hoy: los prospectos que llegan por
 * www.sparcgroup.mx.
 *
 * El analizador NO se borro: sigue vivo en /app/sparc/<building_id>/dashboard,
 * mensajes y subir, con sus tablas `sparc_buildings` y `sparc_chat_uploads`.
 * Para devolverlo basta con volver a colgar un enlace aqui.
 *
 * Los prospectos los escribe /api/demo/sparc-lead en la tabla `leads` con
 * client_id de Sparc, el mismo patron que usa Enlace.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const FF_CYAN   = "#00B8CC";
const FF_ORANGE = "#FF7200";
const SPARC_CLIENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

/** Embudo. Mismos nombres que Enlace para no inventar un vocabulario nuevo. */
const ESTATUS = ["nuevo", "contactado", "cotizado", "ganado", "perdido"] as const;

function statusMeta(id: string | null) {
  switch (id) {
    case "contactado": return { bg: "#1e3a52", fg: "#7fc3ff", label: "Contactado" };
    case "cotizado":   return { bg: "#3a3320", fg: "#ffd479", label: "Cotizado" };
    case "ganado":     return { bg: "#12331f", fg: "#6ee7a0", label: "Ganado" };
    case "perdido":    return { bg: "#33191c", fg: "#ff9b9b", label: "Perdido" };
    default:           return { bg: "#2a1c0e", fg: "#ffb26b", label: "Nuevo" };
  }
}

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  problem: string;
  answers: Record<string, string> | null;
  status: string | null;
  created_at: string;
  utm_campaign: string | null;
  utm_source: string | null;
}

function FishFlowMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.52} viewBox="0 0 68 36" fill="none">
      <path d="M34 18 C34 9 25 3 15 6 C6 9 4 19 11 24 C19 30 34 27 34 18Z" stroke={FF_CYAN} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M34 18 C34 9 43 3 53 6 C62 9 64 19 57 24 C49 30 34 27 34 18Z" stroke={FF_ORANGE} strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M64 14 L68 10 M64 22 L68 26" stroke={FF_ORANGE} strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function fecha(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export default function SparcProspectos() {
  const router = useRouter();
  const [leads,     setLeads]     = useState<Lead[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [filtro,    setFiltro]    = useState<string>("todos");

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUserEmail(user.email ?? "");
      const { data, error } = await supabase
        .from("leads")
        .select("id,name,email,phone,problem,answers,status,created_at,utm_campaign,utm_source")
        .eq("client_id", SPARC_CLIENT_ID)
        .order("created_at", { ascending: false })
        .range(0, 999); // PostgREST corta en 1000; ver nota de paginacion
      if (error) setError(error.message);
      else setLeads((data ?? []) as Lead[]);
      setLoading(false);
    }
    load();
  }, [router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function cambiarEstatus(id: string, status: string) {
    const previo = leads.find((l) => l.id === id)?.status ?? null;
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) {
      // Revertir: dejar la pantalla mintiendo es peor que no guardar.
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, status: previo } : l)));
      alert("No se pudo actualizar el estatus: " + error.message);
    }
  }

  const visibles = filtro === "todos" ? leads : leads.filter((l) => (l.status ?? "nuevo") === filtro);
  const nuevos = leads.filter((l) => (l.status ?? "nuevo") === "nuevo").length;

  const card: React.CSSProperties = {
    background: "#112233", border: "1px solid #1e3048", borderRadius: 12,
    padding: "20px 22px", marginBottom: 14,
  };
  const chip: React.CSSProperties = {
    background: "none", border: "1px solid #1e3048", color: "#5a7a9a",
    borderRadius: 999, padding: "6px 14px", cursor: "pointer", fontSize: 13,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0D1B2A", color: "#f0f4f8", fontFamily: "Inter, sans-serif" }}>
      <div style={{ borderBottom: "1px solid #1e3048", padding: "16px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <FishFlowMark size={28} />
          <span style={{ fontWeight: 700, fontSize: 16, color: FF_CYAN }}>Sparc</span>
          <span style={{ color: "#5a7a9a", fontSize: 14 }}>/ Prospectos</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, color: "#5a7a9a" }}>{userEmail}</span>
          <button onClick={handleLogout} style={{ ...chip, borderRadius: 6, padding: "6px 14px" }}>Salir</button>
        </div>
      </div>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "40px 20px 64px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Prospectos</h1>
        <p style={{ color: "#5a7a9a", fontSize: 15, margin: "0 0 28px", lineHeight: 1.6 }}>
          Cada persona que llena el formulario de{" "}
          <a href="https://www.sparcgroup.mx" target="_blank" rel="noopener noreferrer" style={{ color: FF_CYAN }}>www.sparcgroup.mx</a>{" "}
          queda aqui, ademas del aviso que llega a contacto@sparcgroup.mx.
        </p>

        <div style={{ display: "flex", gap: 20, marginBottom: 26, flexWrap: "wrap" }}>
          <div style={{ ...card, marginBottom: 0, minWidth: 130 }}>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{leads.length}</div>
            <div style={{ color: "#5a7a9a", fontSize: 13 }}>Prospectos totales</div>
          </div>
          <div style={{ ...card, marginBottom: 0, minWidth: 130 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: nuevos ? "#ffb26b" : "#f0f4f8" }}>{nuevos}</div>
            <div style={{ color: "#5a7a9a", fontSize: 13 }}>Sin contactar</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
          {["todos", ...ESTATUS].map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              style={{ ...chip,
                borderColor: filtro === f ? FF_CYAN : "#1e3048",
                color: filtro === f ? FF_CYAN : "#5a7a9a" }}>
              {f === "todos" ? "Todos" : statusMeta(f).label}
            </button>
          ))}
        </div>

        {loading && <p style={{ color: "#5a7a9a" }}>Cargando prospectos…</p>}
        {error   && <p style={{ color: "#ff6b6b" }}>Error: {error}</p>}

        {!loading && !error && visibles.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 24px", color: "#5a7a9a" }}>
            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 16 }}>
              {leads.length === 0 ? "Todavia no llega ningun prospecto" : "Ninguno con ese estatus"}
            </div>
            {leads.length === 0 && (
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                En cuanto alguien llene el formulario de la pagina, aparece aqui.
              </div>
            )}
          </div>
        )}

        {visibles.map((l) => {
          const a = l.answers ?? {};
          const tel = (l.phone ?? "").replace(/\D/g, "");
          const st = statusMeta(l.status);
          return (
            <div key={l.id} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                <div style={{ fontWeight: 700, fontSize: 17 }}>{l.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: st.bg, color: st.fg }}>
                    {st.label}
                  </span>
                  <span style={{ color: "#5a7a9a", fontSize: 12.5 }}>{fecha(l.created_at)}</span>
                </div>
              </div>

              {(a.inmueble || a.tipo || a.unidades) && (
                <div style={{ color: "#8fa8be", fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
                  {a.inmueble && <><strong style={{ color: "#f0f4f8" }}>{a.inmueble}</strong>{" · "}</>}
                  {a.tipo}
                  {a.unidades && ` · ${a.unidades} unidades`}
                </div>
              )}

              {a.mensaje && (
                <div style={{ color: "#c6d4e0", fontSize: 14.5, marginTop: 12, lineHeight: 1.65,
                  background: "#0D1B2A", border: "1px solid #1e3048", borderRadius: 9, padding: "12px 14px" }}>
                  {a.mensaje}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                {tel && (
                  <a href={`https://wa.me/52${tel}`} target="_blank" rel="noopener noreferrer"
                    style={{ background: "#2C9A42", color: "#fff", textDecoration: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13.5, fontWeight: 700 }}>
                    WhatsApp
                  </a>
                )}
                {l.phone && (
                  <a href={`tel:+52${tel}`} style={{ ...chip, textDecoration: "none", display: "inline-block" }}>{l.phone}</a>
                )}
                <a href={`mailto:${l.email}`} style={{ ...chip, textDecoration: "none", display: "inline-block" }}>{l.email}</a>
              </div>

              <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: "#5a7a9a", fontSize: 12.5, marginRight: 4 }}>Marcar como</span>
                {ESTATUS.map((s) => (
                  <button key={s} onClick={() => cambiarEstatus(l.id, s)}
                    disabled={(l.status ?? "nuevo") === s}
                    style={{ ...chip, padding: "5px 12px", fontSize: 12.5,
                      opacity: (l.status ?? "nuevo") === s ? 0.35 : 1,
                      cursor: (l.status ?? "nuevo") === s ? "default" : "pointer" }}>
                    {statusMeta(s).label}
                  </button>
                ))}
              </div>

              {l.utm_campaign && (
                <div style={{ color: "#5a7a9a", fontSize: 12, marginTop: 12 }}>
                  Origen: {l.utm_source || "—"} / {l.utm_campaign}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
