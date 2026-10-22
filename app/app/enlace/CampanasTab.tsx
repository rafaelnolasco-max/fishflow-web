"use client";

/**
 * Pestaña "Campañas" del panel de Enlace Integral.
 *
 * Seguimiento de los correos uno a uno (primer uso: cierre de año 2026).
 * El clic en WhatsApp y la baja se registran solos (/c/<id>); lo demás —si
 * respondió, si hubo llamada, si aportó y cuánto— lo marca la asesora aquí.
 * Las respuestas por correo llegan al buzón de la asesora, por eso se marcan
 * a mano. Lee y escribe con RLS; la base solo deja tocar etapa, nota y monto.
 */

import React, { useEffect, useMemo, useState } from "react";
import { supabase, ENLACE_CLIENT_ID } from "@/lib/supabase";
import { StatGrid, StatCard, Chip, Empty, Toast, cardStyle as mkCard, type DashTheme } from "@/components/dashboard";
import { STAGE_LABEL, STAGES_MANUALES, type Stage } from "@/lib/campaigns";

const C = {
  bg: "#F4F7F5", white: "#FFFFFF",
  green: "#65BC7B", greenDark: "#4B9A62", greenSoft: "#EAF7EE",
  carbon: "#212934", muted: "#5D7080", border: "#E2EAE5",
  red: "#D64545", gray: "#9CA3AF", amber: "#B96A1E", amberSoft: "#FFF4E5",
  blue: "#2F6FAE", blueSoft: "#EAF2FB",
} as const;

const T: DashTheme = {
  accent: C.green, accentDark: C.greenDark, accentSoft: C.greenSoft,
  bg: C.bg, surface: C.white, text: C.carbon, muted: C.muted, border: C.border, danger: C.red, disabled: C.gray,
};
const cardStyle = mkCard(T);

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "sending" | "paused" | "done";
  daily_limit: number;
  created_at: string;
}

interface Rec {
  id: string;
  name: string;
  email: string;
  owner: string | null;
  segment: string | null;
  monthly_amount: number | null;
  stage: Stage;
  sent_at: string | null;
  wa_clicked_at: string | null;
  wa_click_count: number;
  contributed_amount: number | null;
  note: string | null;
  stage_updated_at: string | null;
  stage_updated_by: string | null;
}

const STAGE_COLOR: Record<Stage, { bg: string; fg: string }> = {
  pendiente: { bg: "#F1F3F4", fg: C.muted },
  enviado: { bg: "#F1F3F4", fg: C.carbon },
  interesado: { bg: C.amberSoft, fg: C.amber },
  respondio: { bg: C.blueSoft, fg: C.blue },
  llamada: { bg: C.blueSoft, fg: C.blue },
  aporto: { bg: C.greenSoft, fg: C.greenDark },
  lo_pensara: { bg: "#F4F0FA", fg: "#6B4FA0" },
  no_interesa: { bg: "#F1F3F4", fg: C.gray },
  baja: { bg: "#FDECEC", fg: C.red },
  error: { bg: "#FDECEC", fg: C.red },
};

const STATUS_LABEL: Record<Campaign["status"], string> = {
  draft: "En preparación",
  sending: "Enviando",
  paused: "En pausa",
  done: "Envío terminado",
};

const SEG_LABEL: Record<string, string> = { base: "Base", medio: "Media", alto: "Art. 185" };

const money = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;
const corta = (iso: string) =>
  new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });

const inputStyle: React.CSSProperties = {
  padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13,
  fontFamily: "inherit", background: C.white, color: C.carbon, boxSizing: "border-box",
};

export default function CampanasTab() {
  const [campañas, setCampañas] = useState<Campaign[] | null>(null);
  const [actual, setActual] = useState<string>("");
  const [recs, setRecs] = useState<Rec[]>([]);
  const [cargando, setCargando] = useState(false);
  const [yo, setYo] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [fAsesora, setFAsesora] = useState("todas");
  const [fEtapa, setFEtapa] = useState<string>("todas");
  const [fSeg, setFSeg] = useState("todos");
  const [q, setQ] = useState("");
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [montos, setMontos] = useState<Record<string, string>>({});

  const avisar = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setYo(data.user?.email ?? ""));
    supabase
      .from("campaigns")
      .select("id,name,description,status,daily_limit,created_at")
      .eq("client_id", ENLACE_CLIENT_ID)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error("[campañas]", error);
        setCampañas((data ?? []) as Campaign[]);
        if (data?.length) setActual(data[0].id);
      });
  }, []);

  useEffect(() => {
    if (!actual) return;
    setCargando(true);
    supabase
      .from("campaign_recipients")
      .select("id,name,email,owner,segment,monthly_amount,stage,sent_at,wa_clicked_at,wa_click_count,contributed_amount,note,stage_updated_at,stage_updated_by")
      .eq("campaign_id", actual)
      .order("name")
      .then(({ data, error }) => {
        if (error) console.error("[campañas] destinatarios", error);
        setRecs((data ?? []) as Rec[]);
        setCargando(false);
      });
  }, [actual]);

  const camp = campañas?.find((c) => c.id === actual) ?? null;
  const asesoras = useMemo(() => [...new Set(recs.map((r) => r.owner).filter(Boolean))] as string[], [recs]);
  const segmentos = useMemo(() => [...new Set(recs.map((r) => r.segment).filter(Boolean))] as string[], [recs]);

  const stats = useMemo(() => {
    const enviados = recs.filter((r) => r.sent_at).length;
    const wa = recs.filter((r) => r.wa_clicked_at).length;
    const resp = recs.filter((r) => ["respondio", "llamada", "aporto", "lo_pensara", "no_interesa"].includes(r.stage)).length;
    const llam = recs.filter((r) => ["llamada", "aporto"].includes(r.stage)).length;
    const aport = recs.filter((r) => r.stage === "aporto");
    const total = aport.reduce((s, r) => s + (Number(r.contributed_amount) || 0), 0);
    const bajas = recs.filter((r) => r.stage === "baja").length;
    return { enviados, wa, resp, llam, aport: aport.length, total, bajas };
  }, [recs]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return recs.filter(
      (r) =>
        (fAsesora === "todas" || r.owner === fAsesora) &&
        (fEtapa === "todas" || r.stage === fEtapa || (fEtapa === "seguimiento" && ["interesado", "respondio", "llamada", "lo_pensara"].includes(r.stage))) &&
        (fSeg === "todos" || r.segment === fSeg) &&
        (!t || r.name.toLowerCase().includes(t) || r.email.toLowerCase().includes(t)),
    );
  }, [recs, fAsesora, fEtapa, fSeg, q]);

  async function guardar(id: string, patch: Partial<Rec>, msg: string) {
    const now = new Date().toISOString();
    const cambios = { ...patch, updated_at: now, ...(patch.stage ? { stage_updated_at: now, stage_updated_by: yo || "panel" } : {}) };
    const { error } = await supabase.from("campaign_recipients").update(cambios).eq("id", id);
    if (error) {
      console.error("[campañas] guardar", error);
      avisar("No se pudo guardar. Intenta de nuevo.");
      return;
    }
    setRecs((rs) => rs.map((r) => (r.id === id ? ({ ...r, ...cambios } as Rec) : r)));
    avisar(msg);
  }

  if (campañas === null) return <Empty msg="Cargando campañas…" theme={T} />;
  if (!campañas.length)
    return (
      <div style={{ ...cardStyle, textAlign: "center", padding: "40px 24px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.carbon }}>Aún no hay campañas</div>
        <div style={{ fontSize: 13.5, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
          La campaña de cierre de año aparece aquí en cuanto carguemos la lista de clientes.
        </div>
      </div>
    );

  return (
    <div>
      <div style={{ ...cardStyle, marginBottom: 18, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          {campañas.length > 1 ? (
            <select value={actual} onChange={(e) => setActual(e.target.value)} style={{ ...inputStyle, fontWeight: 700, fontSize: 14 }}>
              {campañas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: 16, fontWeight: 700, color: C.carbon }}>{camp?.name}</div>
          )}
          {camp?.description ? <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>{camp.description}</div> : null}
        </div>
        {camp ? (
          <div style={{ textAlign: "right" }}>
            <Chip
              label={STATUS_LABEL[camp.status]}
              bg={camp.status === "sending" ? C.greenSoft : "#F1F3F4"}
              fg={camp.status === "sending" ? C.greenDark : C.muted}
            />
            <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>
              {stats.enviados} de {recs.length} enviados
              {camp.status === "sending" ? ` · ${camp.daily_limit} por día hábil` : ""}
            </div>
          </div>
        ) : null}
      </div>

      <StatGrid>
        <StatCard theme={T} label="Picaron WhatsApp" value={stats.wa} accent={stats.wa ? C.amber : undefined} sub={stats.enviados ? `${Math.round((stats.wa / stats.enviados) * 100)}% de los enviados` : undefined} />
        <StatCard theme={T} label="Respondieron" value={stats.resp} sub={`${stats.llam} con llamada`} />
        <StatCard theme={T} label="Aportaron" value={stats.aport} accent={C.greenDark} sub={stats.total ? `${money(stats.total)} en total` : "registra el monto al marcar"} />
        <StatCard theme={T} label="Bajas" value={stats.bajas} accent={stats.bajas ? C.red : undefined} />
      </StatGrid>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0 14px" }}>
        <input placeholder="Buscar cliente…" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...inputStyle, flex: "1 1 200px" }} />
        {asesoras.length > 1 ? (
          <select value={fAsesora} onChange={(e) => setFAsesora(e.target.value)} style={inputStyle}>
            <option value="todas">Todas las asesoras</option>
            {asesoras.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        ) : null}
        <select value={fEtapa} onChange={(e) => setFEtapa(e.target.value)} style={inputStyle}>
          <option value="todas">Todas las etapas</option>
          <option value="seguimiento">Por dar seguimiento</option>
          {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
        {segmentos.length > 1 ? (
          <select value={fSeg} onChange={(e) => setFSeg(e.target.value)} style={inputStyle}>
            <option value="todos">Todos los mensajes</option>
            {segmentos.map((s) => (
              <option key={s} value={s}>
                {SEG_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {cargando ? <Empty msg="Cargando clientes…" theme={T} /> : null}
      {!cargando && !visibles.length ? <Empty msg="Ningún cliente con estos filtros." theme={T} /> : null}

      <div style={{ display: "grid", gap: 10 }}>
        {visibles.map((r) => {
          const col = STAGE_COLOR[r.stage];
          return (
            <div key={r.id} style={{ ...cardStyle, padding: "14px 16px" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: C.carbon }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2, wordBreak: "break-all" }}>{r.email}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {r.monthly_amount ? <Chip label={`${money(Number(r.monthly_amount))} al mes`} bg="#F1F3F4" fg={C.carbon} /> : null}
                    {r.segment ? <Chip label={SEG_LABEL[r.segment] ?? r.segment} bg={r.segment === "alto" ? C.blueSoft : "#F1F3F4"} fg={r.segment === "alto" ? C.blue : C.muted} /> : null}
                    {r.owner ? <Chip label={r.owner} bg={C.greenSoft} fg={C.greenDark} /> : null}
                    {r.wa_clicked_at ? <Chip label={`WhatsApp ✓ ${corta(r.wa_clicked_at)}`} bg={C.amberSoft} fg={C.amber} /> : null}
                    {r.sent_at ? <span style={{ fontSize: 11.5, color: C.muted, alignSelf: "center" }}>enviado {corta(r.sent_at)}</span> : null}
                  </div>
                </div>
                <div style={{ flex: "0 1 200px", display: "grid", gap: 6 }}>
                  <select
                    value={r.stage}
                    onChange={(e) => guardar(r.id, { stage: e.target.value as Stage }, `Marcado: ${STAGE_LABEL[e.target.value as Stage]}`)}
                    disabled={r.stage === "pendiente" || r.stage === "error"}
                    style={{ ...inputStyle, background: col.bg, color: col.fg, fontWeight: 700, border: "none" }}
                  >
                    {(r.stage === "pendiente" || r.stage === "error" ? [r.stage] : STAGES_MANUALES).map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  {r.stage === "aporto" ? (
                    <input
                      inputMode="numeric"
                      placeholder="¿Cuánto aportó? $"
                      value={montos[r.id] ?? (r.contributed_amount ? String(r.contributed_amount) : "")}
                      onChange={(e) => setMontos((m) => ({ ...m, [r.id]: e.target.value.replace(/[^\d.]/g, "") }))}
                      onBlur={() => {
                        const v = montos[r.id];
                        if (v === undefined) return;
                        const n = v ? Number(v) : null;
                        if (n !== (r.contributed_amount ?? null)) guardar(r.id, { contributed_amount: n }, "Monto guardado");
                      }}
                      style={inputStyle}
                    />
                  ) : null}
                </div>
              </div>
              <textarea
                placeholder="Nota (ej. llamada el jueves 5 pm, quiere aportar con su aguinaldo)"
                value={notas[r.id] ?? r.note ?? ""}
                onChange={(e) => setNotas((n) => ({ ...n, [r.id]: e.target.value }))}
                onBlur={() => {
                  const v = notas[r.id];
                  if (v !== undefined && v !== (r.note ?? "")) guardar(r.id, { note: v.slice(0, 2000) || null }, "Nota guardada");
                }}
                rows={1}
                style={{ ...inputStyle, width: "100%", marginTop: 10, resize: "vertical", minHeight: 36 }}
              />
              {r.stage_updated_by && r.stage_updated_at ? (
                <div style={{ fontSize: 11, color: C.gray, marginTop: 4 }}>
                  Último cambio: {r.stage_updated_by} · {corta(r.stage_updated_at)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <Toast msg={toast} theme={T} />
    </div>
  );
}
