"use client";

/**
 * Motor de Promociones — pestaña compartida (multi-tenant).
 *
 * Mismo componente para cafetería, estética y restaurante: lo único que cambia
 * por cliente es el copy de las campañas y la ventana de días. Nada de tablas
 * ni de pantallas por vertical.
 *
 * La pieza que da el valor no es el envío, es el CÓDIGO ÚNICO con caducidad:
 * sin código no hay canje verificable, sin canje no hay número que enseñarle al
 * dueño, y sin número no hay renovación. Por eso la caja de canje va hasta
 * arriba de la pantalla: es lo que el mostrador usa todos los días.
 *
 * Todo corre bajo la RLS del usuario (supabase del browser, patrón de
 * ReviewsTab). No hay endpoint propio porque no hay ningún secreto que guardar:
 * el envío de WhatsApp es asistido — el dueño da un clic por persona.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  StatGrid, StatCard, Section as DSection, Field as DField, Modal as DModal,
  Toast, SaveBtn, inputStyle as mkInput, cardStyle as mkCard, Empty, Chip,
  type DashTheme,
} from "@/components/dashboard";

// ─── Colores del módulo, independientes del tema del cliente ─────────────────
const U = {
  wa: "#25D366", green: "#10B981", blue: "#3B82F6",
  yellow: "#F59E0B", red: "#EF4444", gray: "#9CA3AF",
} as const;

// ─── Tipos ───────────────────────────────────────────────────────────────────
export type PromoKind = "cumpleanos" | "recompra" | "reactivacion" | "dia_muerto" | "manual";
export type PromoStatus = "borrador" | "activa" | "pausada" | "terminada";

export type Segment = {
  csat_min?: number;
  dias_sin_ver?: number;
  touchpoint_kind?: string;
  product_ref?: string;
};

export type PromoCampaign = {
  id: string;
  client_id: string;
  name: string;
  kind: PromoKind;
  channel: "whatsapp" | "email" | "ambos";
  body: string;
  subject: string | null;
  offer_label: string;
  segment: Segment | null;
  valid_hours: number;
  status: PromoStatus;
  created_at: string;
};

export type PromoCode = {
  id: string;
  campaign_id: string;
  contact_id: string;
  code: string;
  state: "pendiente" | "enviado" | "canjeado" | "vencido" | "cancelado";
  expires_at: string;
  sent_at: string | null;
  redeemed_at: string | null;
  created_at: string;
};

export type Contact = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  birthday_month: number | null;
  birthday_day: number | null;
  last_csat: number | null;
  last_product: string | null;
  last_touchpoint_kind: string | null;
  last_seen_at: string | null;
};

type Stats = {
  campaign_id: string;
  codigos: number;
  enviados: number;
  canjeados: number;
  tasa_canje: number | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Alfabeto sin caracteres ambiguos: nada de O/0 ni I/1. Quien teclea esto es el
// cajero, leyendo la pantalla de un celular ajeno con la fila esperando.
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function nuevoCodigo(usados: Set<string>): string {
  for (let intento = 0; intento < 40; intento++) {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    const code = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
    if (!usados.has(code)) {
      usados.add(code);
      return code;
    }
  }
  throw new Error("No se pudo generar un código libre.");
}

function primerNombre(full: string | null): string {
  const n = (full ?? "").trim().split(/\s+/)[0];
  return n || "hola";
}

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
}

function fechaHora(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—";
}

function waLink(phone: string, message: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
}

/** La página pública del cupón. Es el enlace que WhatsApp pinta como flyer. */
export function linkCupon(code: string, origen: string): string {
  return `${origen}/promo/${code}`;
}

/** Rellena el copy de la campaña con los datos de la persona y del código. */
export function renderMensaje(
  c: PromoCampaign,
  persona: Contact,
  code: PromoCode,
  negocio: string,
  origen: string,
): string {
  return c.body
    .replaceAll("{{nombre}}", primerNombre(persona.name))
    .replaceAll("{{codigo}}", code.code)
    .replaceAll("{{vence}}", fechaCorta(code.expires_at))
    .replaceAll("{{negocio}}", negocio)
    .replaceAll("{{oferta}}", c.offer_label)
    .replaceAll("{{producto}}", persona.last_product ?? "café")
    .replaceAll("{{link}}", linkCupon(code.code, origen));
}

/** Cumple dentro de los próximos `dias` días, sin importar el año. */
function cumpleProximo(p: Contact, dias: number): boolean {
  if (!p.birthday_month || !p.birthday_day) return false;
  const hoy = new Date();
  for (let i = 0; i <= dias; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i);
    if (d.getMonth() + 1 === p.birthday_month && d.getDate() === p.birthday_day) return true;
  }
  return false;
}

const KIND_LABEL: Record<PromoKind, string> = {
  cumpleanos: "Cumpleaños",
  recompra: "Recompra",
  reactivacion: "Reactivación",
  dia_muerto: "Día muerto",
  manual: "Manual",
};

const STATUS_COLOR: Record<PromoStatus, { bg: string; fg: string }> = {
  borrador: { bg: "#F1F5F9", fg: "#475569" },
  activa: { bg: "#DCFCE7", fg: "#166534" },
  pausada: { bg: "#FEF3C7", fg: "#92400E" },
  terminada: { bg: "#F1F5F9", fg: "#94A3B8" },
};

const PLANTILLA_NUEVA =
  "Hola {{nombre}}, tenemos algo para ti en {{negocio}}: {{oferta}}. Enseña el código {{codigo}}. " +
  "Vence {{vence}}. Aquí está tu cupón: {{link}}";

// ─── Componente ──────────────────────────────────────────────────────────────
export default function PromosTab({
  clientId,
  theme: T,
  businessName,
}: {
  clientId: string;
  theme: DashTheme;
  businessName: string;
}) {
  const [campanas, setCampanas] = useState<PromoCampaign[]>([]);
  const [codigos, setCodigos] = useState<PromoCode[]>([]);
  const [contactos, setContactos] = useState<Contact[]>([]);
  const [stats, setStats] = useState<Stats[]>([]);
  const [cargando, setCargando] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [editando, setEditando] = useState<PromoCampaign | null>(null);
  const [nueva, setNueva] = useState(false);
  const [verCola, setVerCola] = useState<string | null>(null);   // campaign_id
  const [canje, setCanje] = useState("");
  const [canjeMsg, setCanjeMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [usuario, setUsuario] = useState<string>("");

  // El enlace del cupón sale del mismo origen donde está abierto el tablero, así
  // no hay que configurar el dominio en ningún lado ni recordar el apex/www.
  const origen = typeof window === "undefined" ? "https://www.fishflow.mx" : window.location.origin;

  const avisar = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3200);
  }, []);

  const cargar = useCallback(async () => {
    if (!clientId) return;
    setCargando(true);

    // Marcar vencidos antes de contar nada: un código caduco que sigue diciendo
    // "enviado" infla la métrica que el dueño usa para decidir si esto sirve.
    await supabase.rpc("promo_vencer_codigos", { p_client_id: clientId });

    const [c, k, p, s, u] = await Promise.all([
      supabase.from("promo_campaigns").select("*").eq("client_id", clientId).order("created_at"),
      supabase.from("promo_codes").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
      supabase
        .from("contacts")
        .select("id, name, phone, email, birthday_month, birthday_day, last_csat, last_product, last_touchpoint_kind, last_seen_at")
        .eq("client_id", clientId)
        .is("opt_out_at", null),
      supabase.from("promo_campaign_stats").select("*").eq("client_id", clientId),
      supabase.auth.getUser(),
    ]);

    if (c.error) console.error("[promos] campañas:", c.error);
    if (k.error) console.error("[promos] códigos:", k.error);
    if (p.error) console.error("[promos] contactos:", p.error);

    setCampanas((c.data as PromoCampaign[]) ?? []);
    setCodigos((k.data as PromoCode[]) ?? []);
    setContactos((p.data as Contact[]) ?? []);
    setStats((s.data as Stats[]) ?? []);
    setUsuario(u.data?.user?.email ?? "");
    setCargando(false);
  }, [clientId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const porId = useMemo(() => new Map(contactos.map((c) => [c.id, c])), [contactos]);
  const conPermiso = useMemo(
    () => contactos.filter((c) => c.phone).length,
    [contactos],
  );
  const canjeadosMes = useMemo(() => {
    const desde = new Date();
    desde.setDate(1);
    desde.setHours(0, 0, 0, 0);
    return codigos.filter((k) => k.redeemed_at && new Date(k.redeemed_at) >= desde).length;
  }, [codigos]);
  // Se cuenta por sent_at y no por estado: un código que se envió y venció sin
  // usarse igual se envió, y sacarlo del denominador infla la tasa de canje.
  const enviadosTotal = codigos.filter((k) => k.sent_at !== null).length;
  const canjeadosTotal = codigos.filter((k) => k.state === "canjeado").length;
  const tasa = enviadosTotal ? Math.round((canjeadosTotal / enviadosTotal) * 1000) / 10 : null;
  const pendientes = codigos.filter((k) => k.state === "pendiente");

  // ── Canje ──────────────────────────────────────────────────────────────────
  async function canjear() {
    const code = canje.trim().toUpperCase();
    if (code.length !== 5) {
      setCanjeMsg({ ok: false, texto: "El código son 5 caracteres." });
      return;
    }
    const { data, error } = await supabase
      .from("promo_codes")
      .select("*")
      .eq("client_id", clientId)
      .eq("code", code)
      .maybeSingle();

    if (error || !data) {
      setCanjeMsg({ ok: false, texto: "No encontramos ese código." });
      return;
    }
    const k = data as PromoCode;
    if (k.state === "canjeado") {
      setCanjeMsg({ ok: false, texto: `Ese código ya se usó el ${fechaHora(k.redeemed_at)}.` });
      return;
    }
    if (k.state === "cancelado") {
      setCanjeMsg({ ok: false, texto: "Ese código fue cancelado." });
      return;
    }
    if (new Date(k.expires_at) < new Date()) {
      await supabase.from("promo_codes").update({ state: "vencido" }).eq("id", k.id);
      setCanjeMsg({ ok: false, texto: `Ese código venció el ${fechaHora(k.expires_at)}.` });
      void cargar();
      return;
    }

    const { error: errU } = await supabase
      .from("promo_codes")
      .update({ state: "canjeado", redeemed_at: new Date().toISOString(), redeemed_by: usuario || null })
      .eq("id", k.id);
    if (errU) {
      setCanjeMsg({ ok: false, texto: "No se pudo registrar el canje. Intenta de nuevo." });
      return;
    }

    const persona = porId.get(k.contact_id);
    const camp = campanas.find((c) => c.id === k.campaign_id);
    setCanjeMsg({
      ok: true,
      texto: `${camp?.offer_label ?? "Promoción"} — ${persona?.name ?? "cliente"}. Aplícalo en caja.`,
    });
    setCanje("");
    void cargar();
  }

  // ── Preparar la corrida de una campaña ─────────────────────────────────────
  async function prepararEnvio(c: PromoCampaign) {
    const seg = c.segment ?? {};

    // Quien ya trae un código sin usar de esta campaña no entra otra vez: dos
    // códigos vivos de la misma promoción es la forma más fácil de regalar dos.
    const vivos = new Set(
      codigos
        .filter((k) => k.campaign_id === c.id && (k.state === "pendiente" || k.state === "enviado"))
        .map((k) => k.contact_id),
    );

    let audiencia = contactos.filter((p) => p.phone && !vivos.has(p.id));

    // csat_min deja fuera a quien nunca calificó (last_csat null). Es a
    // propósito: una promoción de recompra a alguien de quien no sabemos nada
    // es publicidad, no seguimiento.
    if (typeof seg.csat_min === "number") {
      audiencia = audiencia.filter((p) => (p.last_csat ?? 0) >= seg.csat_min!);
    }
    if (seg.touchpoint_kind) {
      audiencia = audiencia.filter((p) => p.last_touchpoint_kind === seg.touchpoint_kind);
    }
    if (seg.product_ref) {
      audiencia = audiencia.filter((p) => p.last_product === seg.product_ref);
    }
    if (typeof seg.dias_sin_ver === "number") {
      const corte = Date.now() - seg.dias_sin_ver * 86_400_000;
      audiencia = audiencia.filter((p) => p.last_seen_at && new Date(p.last_seen_at).getTime() <= corte);
    }
    if (c.kind === "cumpleanos") {
      audiencia = audiencia.filter((p) => cumpleProximo(p, 7));
    }

    if (!audiencia.length) {
      avisar("Ahora mismo nadie cumple el criterio de esta campaña.");
      return;
    }

    const usados = new Set(codigos.map((k) => k.code));
    const expira = new Date(Date.now() + c.valid_hours * 3_600_000).toISOString();
    const filas = audiencia.map((p) => ({
      client_id: clientId,
      campaign_id: c.id,
      contact_id: p.id,
      code: nuevoCodigo(usados),
      state: "pendiente" as const,
      expires_at: expira,
    }));

    const { error } = await supabase.from("promo_codes").insert(filas);
    if (error) {
      console.error("[promos] generar códigos:", error);
      avisar("No se pudieron generar los códigos.");
      return;
    }
    avisar(`${filas.length} código${filas.length === 1 ? "" : "s"} listo${filas.length === 1 ? "" : "s"} para enviar.`);
    setVerCola(c.id);
    void cargar();
  }

  // ── Marcar enviado (el clic que abre WhatsApp) ─────────────────────────────
  async function marcarEnviado(k: PromoCode) {
    const { error } = await supabase
      .from("promo_codes")
      .update({ state: "enviado", sent_at: new Date().toISOString(), sent_channel: "whatsapp" })
      .eq("id", k.id);
    if (error) {
      avisar("No se pudo marcar como enviado.");
      return;
    }
    void cargar();
  }

  async function guardarCampana(c: PromoCampaign, esNueva: boolean) {
    const fila = {
      client_id: clientId,
      name: c.name.trim(),
      kind: c.kind,
      channel: c.channel,
      body: c.body,
      subject: c.subject,
      offer_label: c.offer_label.trim(),
      segment: c.segment ?? {},
      valid_hours: c.valid_hours,
      status: c.status,
      updated_at: new Date().toISOString(),
    };
    if (!fila.name || !fila.offer_label || !fila.body.trim()) {
      avisar("Nombre, oferta y mensaje son obligatorios.");
      return;
    }
    const { error } = esNueva
      ? await supabase.from("promo_campaigns").insert(fila)
      : await supabase.from("promo_campaigns").update(fila).eq("id", c.id);
    if (error) {
      console.error("[promos] guardar campaña:", error);
      avisar("No se pudo guardar.");
      return;
    }
    setEditando(null);
    setNueva(false);
    avisar("Campaña guardada.");
    void cargar();
  }

  if (cargando) {
    return <p style={{ color: T.muted, fontSize: 14 }}>Cargando promociones…</p>;
  }

  return (
    <div>
      <StatGrid>
        <StatCard theme={T} label="Contactos con permiso" value={conPermiso} icon="📇" />
        <StatCard theme={T} label="Por enviar" value={pendientes.length} icon="✉️"
          accent={pendientes.length ? U.yellow : undefined} />
        <StatCard theme={T} label="Canjeados este mes" value={canjeadosMes} icon="🎟️"
          accent={canjeadosMes ? U.green : undefined} />
        <StatCard theme={T} label="Tasa de canje" value={tasa === null ? "—" : `${tasa}%`} icon="📈"
          sub={enviadosTotal ? `${canjeadosTotal} de ${enviadosTotal} enviados` : "sin envíos todavía"} />
      </StatGrid>

      {/* ── Canje: lo primero de la pantalla porque es lo de todos los días ── */}
      <DSection title="Canjear un código" theme={T}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={canje}
            onChange={(e) => {
              setCanje(e.target.value.toUpperCase().slice(0, 5));
              setCanjeMsg(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void canjear()}
            placeholder="ABCDE"
            aria-label="Código de la promoción"
            style={{
              ...mkInput(T), width: 160, fontSize: 24, fontWeight: 800, letterSpacing: 4,
              textAlign: "center", fontFamily: "ui-monospace, monospace", padding: "12px 10px",
            }}
          />
          <button
            onClick={() => void canjear()}
            style={{
              background: T.accent, color: "#fff", border: "none", borderRadius: 10,
              padding: "14px 26px", fontSize: 15, fontWeight: 700, cursor: "pointer",
            }}
          >
            Canjear
          </button>
        </div>
        {canjeMsg && (
          <div
            style={{
              marginTop: 12, padding: "12px 14px", borderRadius: 10, fontSize: 14, fontWeight: 600,
              background: canjeMsg.ok ? "#DCFCE7" : "#FEF2F2",
              color: canjeMsg.ok ? "#166534" : "#991B1B",
              border: `1px solid ${canjeMsg.ok ? "#BBF7D0" : "#FECACA"}`,
            }}
          >
            {canjeMsg.ok ? "✓ " : "✕ "}
            {canjeMsg.texto}
          </div>
        )}
        <p style={{ fontSize: 12, color: T.muted, marginTop: 10, marginBottom: 0 }}>
          El cliente enseña el mensaje en el mostrador y aquí se teclean los 5 caracteres. No hace
          falta escáner ni terminal.
        </p>
      </DSection>

      {/* ── Campañas ─────────────────────────────────────────────────────── */}
      <DSection
        title="Campañas"
        theme={T}
        action={{ label: "+ Nueva campaña", onClick: () => { setNueva(true); setEditando(campanaVacia(clientId)); } }}
      >
        {!campanas.length && <Empty msg="Todavía no hay campañas." theme={T} />}
        <div style={{ display: "grid", gap: 12 }}>
          {campanas.map((c) => {
            const s = stats.find((x) => x.campaign_id === c.id);
            const cola = codigos.filter((k) => k.campaign_id === c.id && k.state === "pendiente");
            const col = STATUS_COLOR[c.status];
            return (
              <div key={c.id} style={{ ...mkCard(T) }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 15, color: T.text }}>{c.name}</strong>
                  <Chip label={KIND_LABEL[c.kind]} bg={T.accentSoft} fg={T.accentDark} />
                  <Chip label={c.status} bg={col.bg} fg={col.fg} />
                  <span style={{ marginLeft: "auto", fontSize: 12, color: T.muted }}>
                    vence a las {c.valid_hours} h
                  </span>
                </div>
                <div style={{ fontSize: 13, color: T.muted, marginTop: 6 }}>{c.offer_label}</div>
                <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12, color: T.muted }}>
                  <span>Enviados: <b style={{ color: T.text }}>{s?.enviados ?? 0}</b></span>
                  <span>Canjeados: <b style={{ color: U.green }}>{s?.canjeados ?? 0}</b></span>
                  <span>Tasa: <b style={{ color: T.text }}>{s?.tasa_canje == null ? "—" : `${s.tasa_canje}%`}</b></span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  <button
                    onClick={() => void prepararEnvio(c)}
                    style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 9,
                      padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    Preparar envío
                  </button>
                  {cola.length > 0 && (
                    <button
                      onClick={() => setVerCola(verCola === c.id ? null : c.id)}
                      style={{ background: U.wa, color: "#fff", border: "none", borderRadius: 9,
                        padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                    >
                      {verCola === c.id ? "Ocultar cola" : `Enviar ${cola.length} por WhatsApp`}
                    </button>
                  )}
                  <button
                    onClick={() => { setNueva(false); setEditando(c); }}
                    style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 9,
                      padding: "9px 16px", fontSize: 13, fontWeight: 600, color: T.text, cursor: "pointer" }}
                  >
                    Editar
                  </button>
                </div>

                {verCola === c.id && (
                  <div style={{ marginTop: 14, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
                    <p style={{ fontSize: 12, color: T.muted, marginTop: 0 }}>
                      Un clic por persona: se abre WhatsApp con el mensaje listo y aquí queda
                      registrado como enviado.
                    </p>
                    <div style={{ display: "grid", gap: 8 }}>
                      {cola.map((k) => {
                        const persona = porId.get(k.contact_id);
                        if (!persona?.phone) return null;
                        const msg = renderMensaje(c, persona, k, businessName, origen);
                        return (
                          <div key={k.id} style={{ display: "flex", gap: 10, alignItems: "center",
                            padding: "10px 12px", border: `1px solid ${T.border}`, borderRadius: 10 }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                                {persona.name ?? "Cliente del QR"}
                              </div>
                              <div style={{ fontSize: 11, color: T.muted, fontFamily: "ui-monospace, monospace" }}>
                                {persona.phone} · código {k.code}
                              </div>
                              <a
                                href={linkCupon(k.code, origen)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 11, color: T.accentDark }}
                              >
                                Ver el cupón
                              </a>
                            </div>
                            <a
                              href={waLink(persona.phone, msg)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => void marcarEnviado(k)}
                              style={{ background: U.wa, color: "#fff", borderRadius: 8,
                                padding: "8px 14px", fontSize: 12, fontWeight: 700, textDecoration: "none",
                                whiteSpace: "nowrap" }}
                            >
                              Enviar
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DSection>

      {/* ── Últimos canjes: la prueba de que el módulo mueve caja ─────────── */}
      <DSection title="Últimos canjes" theme={T}>
        {!canjeadosTotal && <Empty msg="Sin canjes todavía." theme={T} />}
        <div style={{ display: "grid", gap: 8 }}>
          {codigos
            .filter((k) => k.state === "canjeado")
            .slice(0, 10)
            .map((k) => {
              const persona = porId.get(k.contact_id);
              const camp = campanas.find((c) => c.id === k.campaign_id);
              return (
                <div key={k.id} style={{ display: "flex", gap: 10, alignItems: "center",
                  padding: "10px 12px", border: `1px solid ${T.border}`, borderRadius: 10 }}>
                  <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 800, color: T.accentDark }}>
                    {k.code}
                  </span>
                  <span style={{ fontSize: 13, color: T.text }}>{persona?.name ?? "Cliente"}</span>
                  <span style={{ fontSize: 12, color: T.muted }}>{camp?.offer_label}</span>
                  <span style={{ marginLeft: "auto", fontSize: 11, color: T.muted }}>
                    {fechaHora(k.redeemed_at)}
                  </span>
                </div>
              );
            })}
        </div>
      </DSection>

      {editando && (
        <EditorCampana
          campana={editando}
          esNueva={nueva}
          theme={T}
          onClose={() => { setEditando(null); setNueva(false); }}
          onSave={(c) => void guardarCampana(c, nueva)}
        />
      )}

      <Toast msg={toast} theme={T} />
    </div>
  );
}

function campanaVacia(clientId: string): PromoCampaign {
  return {
    id: "",
    client_id: clientId,
    name: "",
    kind: "manual",
    channel: "whatsapp",
    body: PLANTILLA_NUEVA,
    subject: null,
    offer_label: "",
    segment: {},
    valid_hours: 72,
    status: "borrador",
    created_at: new Date().toISOString(),
  };
}

// ─── Editor ──────────────────────────────────────────────────────────────────
function EditorCampana({
  campana,
  esNueva,
  theme: T,
  onClose,
  onSave,
}: {
  campana: PromoCampaign;
  esNueva: boolean;
  theme: DashTheme;
  onClose: () => void;
  onSave: (c: PromoCampaign) => void;
}) {
  const [c, setC] = useState<PromoCampaign>({ ...campana, segment: campana.segment ?? {} });
  const set = <K extends keyof PromoCampaign>(k: K, v: PromoCampaign[K]) =>
    setC((prev) => ({ ...prev, [k]: v }));
  const setSeg = (k: keyof Segment, v: number | string | undefined) =>
    setC((prev) => ({ ...prev, segment: { ...(prev.segment ?? {}), [k]: v === "" ? undefined : v } }));

  return (
    <DModal title={esNueva ? "Nueva campaña" : "Editar campaña"} onClose={onClose} theme={T} wide>
      <DField label="Nombre interno" theme={T}>
        <input style={mkInput(T)} value={c.name} onChange={(e) => set("name", e.target.value)} />
      </DField>

      <DField label="Qué se ofrece (lo ve el cajero al canjear)" theme={T}>
        <input style={mkInput(T)} value={c.offer_label} placeholder="10% en tu café"
          onChange={(e) => set("offer_label", e.target.value)} />
      </DField>

      <DField label="Tipo" theme={T}>
        <select style={mkInput(T)} value={c.kind} onChange={(e) => set("kind", e.target.value as PromoKind)}>
          {(Object.keys(KIND_LABEL) as PromoKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
      </DField>

      <DField label="Mensaje" theme={T}>
        <textarea
          style={{ ...mkInput(T), minHeight: 110, resize: "vertical" }}
          value={c.body}
          onChange={(e) => set("body", e.target.value)}
        />
        <p style={{ fontSize: 11, color: T.muted, marginTop: 6, marginBottom: 0 }}>
          Etiquetas disponibles: {"{{nombre}}"} {"{{codigo}}"} {"{{vence}}"} {"{{negocio}}"}{" "}
          {"{{oferta}}"} {"{{producto}}"} {"{{link}}"}
        </p>
        <p style={{ fontSize: 11, color: T.muted, marginTop: 4, marginBottom: 0 }}>
          Deja {"{{link}}"} al final: es la página del cupón, y es lo que hace que WhatsApp muestre
          el flyer en vez de puro texto.
        </p>
      </DField>

      <DField label="Vigencia del código (horas)" theme={T}>
        <input type="number" min={1} max={8760} style={mkInput(T)} value={c.valid_hours}
          onChange={(e) => set("valid_hours", Number(e.target.value) || 72)} />
        <p style={{ fontSize: 11, color: T.muted, marginTop: 6, marginBottom: 0 }}>
          Corto crea urgencia: 72 h es la referencia. Largo se olvida y no se canjea.
        </p>
      </DField>

      <div style={{ borderTop: `1px solid ${T.border}`, margin: "6px 0 14px", paddingTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10 }}>A quién le llega</div>

        <DField label="Calificación mínima que dejó (vacío = a todos los que calificaron)" theme={T}>
          <select style={mkInput(T)} value={c.segment?.csat_min ?? ""}
            onChange={(e) => setSeg("csat_min", e.target.value ? Number(e.target.value) : undefined)}>
            <option value="">Sin filtro</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} o más</option>)}
          </select>
        </DField>

        <DField label="Días sin venir (vacío = sin filtro)" theme={T}>
          <input type="number" min={0} max={3650} style={mkInput(T)} value={c.segment?.dias_sin_ver ?? ""}
            onChange={(e) => setSeg("dias_sin_ver", e.target.value ? Number(e.target.value) : undefined)} />
        </DField>

        <DField label="Producto que se llevó (vacío = cualquiera)" theme={T}>
          <input style={mkInput(T)} value={c.segment?.product_ref ?? ""} placeholder="Chiapas"
            onChange={(e) => setSeg("product_ref", e.target.value)} />
        </DField>
      </div>

      <DField label="Estado" theme={T}>
        <select style={mkInput(T)} value={c.status} onChange={(e) => set("status", e.target.value as PromoStatus)}>
          <option value="borrador">Borrador</option>
          <option value="activa">Activa</option>
          <option value="pausada">Pausada</option>
          <option value="terminada">Terminada</option>
        </select>
      </DField>

      <SaveBtn theme={T} onClick={() => onSave(c)} label={esNueva ? "Crear campaña" : "Guardar cambios"} />
    </DModal>
  );
}
