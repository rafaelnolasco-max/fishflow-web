"use client";

/**
 * Panel de SPARC — Prospectos de la landing.
 *
 * BRANDING: este panel usa la marca del CLIENTE, no la de FishFlow. Colores y
 * tipografia salen del manual de SPARC y de su landing (www.sparcgroup.mx):
 * azul PMS 641C, verde PMS 7739C, Jost para titulos e Inter para cuerpo, con
 * su logo en el encabezado. Es la regla para todos los paneles de cliente: el
 * cliente entra a SU herramienta, no a la de su proveedor.
 *
 * Antes esta pantalla era la lista de edificios del analizador de chats de
 * WhatsApp. Eduardo no lo esta usando (17-sep-2026), asi que la entrada del
 * panel pasa a ser lo unico que si ocupa hoy: los prospectos que llegan por
 * la pagina.
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
import SparcHeader, { SparcFonts } from "./_components/SparcHeader";

/* Marca SPARC — misma paleta que la landing. */
const AZUL      = "#0065A1";
const AZUL_900  = "#00405F";
const AZUL_050  = "#EDF5FA";
const VERDE     = "#2C9A42";
const TINTA     = "#0E1D28";
const GRIS      = "#5C6E7C";
const LINEA     = "#E1E9F0";
const PAPEL     = "#F7FAFC";

const SPARC_CLIENT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

/** Embudo. Mismos nombres que Enlace para no inventar un vocabulario nuevo. */
const ESTATUS = ["nuevo", "contactado", "cotizado", "ganado", "perdido"] as const;

function statusMeta(id: string | null) {
  switch (id) {
    case "contactado": return { bg: AZUL_050,   fg: AZUL,      bd: "#C7DCEA", label: "Contactado" };
    case "cotizado":   return { bg: "#FFF6E5",  fg: "#9A6B00",  bd: "#F0DDB5", label: "Cotizado" };
    case "ganado":     return { bg: "#EDF7EF",  fg: "#217634",  bd: "#BFE0CB", label: "Ganado" };
    case "perdido":    return { bg: "#FCEEEC",  fg: "#B3261E",  bd: "#F3C9C4", label: "Perdido" };
    default:           return { bg: "#FFF1E6",  fg: "#B45010",  bd: "#F5D5BC", label: "Nuevo" };
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

function fecha(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
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
        .range(0, 999); // PostgREST corta en 1000
      if (error) setError(error.message);
      else setLeads((data ?? []) as Lead[]);
      setLoading(false);
    }
    load();
  }, [router]);

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
    background: "#fff", border: `1px solid ${LINEA}`, borderRadius: 13,
    padding: "20px 22px", marginBottom: 14,
    boxShadow: "0 1px 2px rgba(14,29,40,.04)",
  };
  const chip: React.CSSProperties = {
    background: "#fff", border: `1px solid ${LINEA}`, color: GRIS,
    borderRadius: 999, padding: "6px 14px", cursor: "pointer", fontSize: 13,
    fontFamily: "inherit",
  };
  const jost: React.CSSProperties = { fontFamily: "'Jost', system-ui, sans-serif" };

  return (
    <div style={{ minHeight: "100vh", background: PAPEL, color: TINTA, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <SparcFonts />
      <SparcHeader userEmail={userEmail} />

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "40px 20px 64px" }}>
        <h1 style={{ ...jost, fontSize: 30, fontWeight: 500, marginBottom: 10, letterSpacing: "-.01em" }}>Prospectos</h1>
        <p style={{ color: GRIS, fontSize: 15, margin: "0 0 28px", lineHeight: 1.65, maxWidth: "62ch" }}>
          Cada persona que llena el formulario de{" "}
          <a href="https://www.sparcgroup.mx" target="_blank" rel="noopener noreferrer" style={{ color: AZUL, fontWeight: 500 }}>www.sparcgroup.mx</a>{" "}
          queda registrada aquí, además del aviso que llega a contacto@sparcgroup.mx.
        </p>

        <div style={{ display: "flex", gap: 16, marginBottom: 26, flexWrap: "wrap" }}>
          <div style={{ ...card, marginBottom: 0, minWidth: 148 }}>
            <div style={{ ...jost, fontSize: 30, fontWeight: 500, color: AZUL_900 }}>{leads.length}</div>
            <div style={{ color: GRIS, fontSize: 13 }}>Prospectos totales</div>
          </div>
          <div style={{ ...card, marginBottom: 0, minWidth: 148 }}>
            <div style={{ ...jost, fontSize: 30, fontWeight: 500, color: nuevos ? VERDE : AZUL_900 }}>{nuevos}</div>
            <div style={{ color: GRIS, fontSize: 13 }}>Sin contactar</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
          {["todos", ...ESTATUS].map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              style={{ ...chip,
                background: filtro === f ? AZUL : "#fff",
                borderColor: filtro === f ? AZUL : LINEA,
                color: filtro === f ? "#fff" : GRIS,
                fontWeight: filtro === f ? 600 : 400 }}>
              {f === "todos" ? "Todos" : statusMeta(f).label}
            </button>
          ))}
        </div>

        {loading && <p style={{ color: GRIS }}>Cargando prospectos…</p>}
        {error   && <p style={{ color: "#B3261E" }}>Error: {error}</p>}

        {!loading && !error && visibles.length === 0 && (
          <div style={{ ...card, textAlign: "center", padding: "56px 24px", color: GRIS }}>
            <div style={{ ...jost, fontWeight: 500, marginBottom: 8, fontSize: 18, color: TINTA }}>
              {leads.length === 0 ? "Todavía no llega ningún prospecto" : "Ninguno con ese estatus"}
            </div>
            {leads.length === 0 && (
              <div style={{ fontSize: 14.5, lineHeight: 1.6 }}>
                En cuanto alguien llene el formulario de la página, aparece aquí.
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
                <div style={{ ...jost, fontWeight: 600, fontSize: 19 }}>{l.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ padding: "3px 11px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                    background: st.bg, color: st.fg, border: `1px solid ${st.bd}` }}>
                    {st.label}
                  </span>
                  <span style={{ color: "#8698A5", fontSize: 12.5 }}>{fecha(l.created_at)}</span>
                </div>
              </div>

              {(a.inmueble || a.tipo || a.unidades) && (
                <div style={{ color: GRIS, fontSize: 14.5, marginTop: 8, lineHeight: 1.6 }}>
                  {a.inmueble && <><strong style={{ color: TINTA }}>{a.inmueble}</strong>{" · "}</>}
                  {a.tipo}
                  {a.unidades && ` · ${a.unidades} unidades`}
                </div>
              )}

              {a.mensaje && (
                <div style={{ color: "#25384A", fontSize: 14.5, marginTop: 12, lineHeight: 1.65,
                  background: PAPEL, border: `1px solid ${LINEA}`, borderRadius: 10, padding: "12px 14px" }}>
                  {a.mensaje}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                {tel && (
                  <a href={`https://wa.me/52${tel}`} target="_blank" rel="noopener noreferrer"
                    style={{ background: VERDE, color: "#fff", textDecoration: "none", borderRadius: 9,
                      padding: "9px 16px", fontSize: 13.5, fontWeight: 600 }}>
                    WhatsApp
                  </a>
                )}
                {l.phone && (
                  <a href={`tel:+52${tel}`} style={{ ...chip, textDecoration: "none", display: "inline-block", color: AZUL }}>{l.phone}</a>
                )}
                <a href={`mailto:${l.email}`} style={{ ...chip, textDecoration: "none", display: "inline-block", color: AZUL }}>{l.email}</a>
              </div>

              <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ color: "#8698A5", fontSize: 12.5, marginRight: 4 }}>Marcar como</span>
                {ESTATUS.map((s) => {
                  const activo = (l.status ?? "nuevo") === s;
                  return (
                    <button key={s} onClick={() => cambiarEstatus(l.id, s)} disabled={activo}
                      style={{ ...chip, padding: "5px 12px", fontSize: 12.5,
                        opacity: activo ? 0.4 : 1, cursor: activo ? "default" : "pointer" }}>
                      {statusMeta(s).label}
                    </button>
                  );
                })}
              </div>

              {l.utm_campaign && (
                <div style={{ color: "#8698A5", fontSize: 12, marginTop: 12 }}>
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
