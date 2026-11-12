// app/instalacion/[token]/page.tsx
// Reporte público de una instalación LUKON (sin login, acceso por token).
// Marca LUKON, sin mencionar a FishFlow. Nunca muestra datos internos:
// ubicación del equipo, notas técnicas ni coordenadas del instalador.

import type React from "react";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { PHOTO_STEPS, SERVICE_LABEL, AUTO_ACCEPT_DAYS, signPhotos, fmtCdmx, folioTxt, type Service } from "@/lib/installations";
import AcceptButton from "./AcceptButton";

export const dynamic = "force-dynamic";
export const metadata = {
  title: { absolute: "Reporte de instalación · LUKON" },
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/demos/lukon-sitio/img/favicon.svg", type: "image/svg+xml" }, { url: "/demos/lukon-sitio/img/favicon-32.png", sizes: "32x32" }],
    apple: "/demos/lukon-sitio/img/apple-touch-icon.png",
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const C = { navy: "#10336B", azul: "#0084F9", tinta: "#0B1A3A", gris: "#5A6B8C", linea: "#DCE5F3", papel: "#F6F9FE", suave: "#E9F2FF", verde: "#1F8A4C" };
const FONTS = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700&display=swap";

export default async function InstalacionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const S = {
    page: { fontFamily: "Inter, system-ui, sans-serif", background: C.papel, minHeight: "100vh", color: C.tinta, padding: "24px 16px 60px" } as React.CSSProperties,
    card: { maxWidth: 720, margin: "0 auto", background: "#fff", border: `1px solid ${C.linea}`, borderRadius: 16, overflow: "hidden" } as React.CSSProperties,
    body: { padding: "22px 24px" } as React.CSSProperties,
    h2: { fontFamily: "'Bebas Neue', Impact, sans-serif", fontSize: 26, letterSpacing: "0.02em", color: C.navy, margin: "26px 0 10px", fontWeight: 400 } as React.CSSProperties,
    label: { fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: C.gris } as React.CSSProperties,
  };
  const shell = (children: React.ReactNode) => (
    <div style={S.page}>
      <link rel="stylesheet" href={FONTS} />
      <div style={S.card}>
        <div style={{ padding: "18px 24px", borderBottom: `3px solid ${C.azul}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clients/lukon/email-logo.png" alt="LUKON" width={130} height={40} style={{ height: 40, width: "auto" }} />
          <span style={{ ...S.label, textAlign: "right" }}>Siempre Inteligente.<br />Siempre Seguro.</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (!UUID_RE.test(token)) return shell(<div style={S.body}>Reporte no encontrado.</div>);
  const db = supabaseAdmin();
  const { data: inst } = await db.from("telematica_installations").select("*").eq("report_token", token).maybeSingle();
  if (!inst || !["terminada", "aceptada"].includes(inst.status)) return shell(<div style={S.body}>Reporte no encontrado.</div>);

  const { data: rows } = await db.from("telematica_installation_photos").select("stage, kind, path, created_at").eq("installation_id", inst.id).order("created_at");
  const photos = await signPhotos(db, rows ?? []);
  const label = (stage: string, kind: string) => PHOTO_STEPS.find(s => s.stage === stage && s.kind === kind)?.label ?? kind;
  const vehiculo = [inst.vehicle_brand, inst.vehicle_model, inst.vehicle_year].filter(Boolean).join(" ") || "—";
  const minutos = inst.started_at && inst.finished_at ? Math.round((+new Date(inst.finished_at) - +new Date(inst.started_at)) / 60000) : null;
  const duracion = minutos == null ? "—" : minutos >= 60 ? `${Math.floor(minutos / 60)} h ${minutos % 60} min` : `${minutos} min`;

  const datos: [string, string][] = [
    ["Folio", folioTxt(inst.folio)], ["Cliente", inst.customer_name], ["Vehículo", vehiculo],
    ["Placa", inst.vehicle_plate || "—"], ["Color", inst.vehicle_color || "—"], ["Servicio", SERVICE_LABEL[inst.service as Service]],
    ["Inicio", fmtCdmx(inst.started_at)], ["Término", fmtCdmx(inst.finished_at)], ["Duración", duracion],
    ["Instalador", inst.installer_no ? `Instalador ${inst.installer_no}` : "—"],
    ...(inst.device_imei ? [["IMEI del GPS", inst.device_imei] as [string, string]] : []),
    ...(inst.remote_cutoff_test ? [["Prueba de apagado remoto", inst.remote_cutoff_test === "exitosa" ? "✓ Exitosa" : "No aplica"] as [string, string]] : []),
    ...(inst.dashcam_serial ? [["Serie de la dashcam", inst.dashcam_serial] as [string, string]] : []),
  ];

  const gallery = (stage: "antes" | "despues") => {
    const ps = photos.filter(p => p.stage === stage && p.url);
    if (!ps.length) return <p style={{ color: C.gris, fontSize: 14 }}>Sin fotos.</p>;
    return (
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {ps.map(p => (
          <a key={p.path} href={p.url!} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: C.tinta }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url!} alt={label(p.stage, p.kind)} loading="lazy" style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 10, background: C.suave, display: "block" }} />
            <div style={{ fontSize: 12, color: C.gris, marginTop: 4 }}>{label(p.stage, p.kind)}</div>
          </a>
        ))}
      </div>
    );
  };

  return shell(
    <div style={S.body}>
      <div style={S.label}>Reporte de instalación · {folioTxt(inst.folio)}</div>
      <h1 style={{ fontFamily: "'Bebas Neue', Impact, sans-serif", fontWeight: 400, fontSize: 38, lineHeight: 1.05, color: C.navy, margin: "6px 0 4px" }}>
        Tu {SERVICE_LABEL[inst.service as Service]} quedó instalado
      </h1>
      <p style={{ color: C.gris, fontSize: 15, margin: "0 0 18px" }}>{vehiculo}{inst.vehicle_plate ? ` · ${inst.vehicle_plate}` : ""}</p>

      <AcceptButton token={token} accepted={inst.status === "aceptada"} acceptedAt={inst.accepted_at ? fmtCdmx(inst.accepted_at) : null}
        auto={inst.accepted_auto} days={AUTO_ACCEPT_DAYS} />

      <h2 style={S.h2}>Datos de la instalación</h2>
      <div style={{ border: `1px solid ${C.linea}`, borderRadius: 10, overflow: "hidden" }}>
        {datos.map(([k, v], i) => (
          <div key={k} style={{ display: "flex", gap: 12, padding: "10px 14px", background: i % 2 ? "#fff" : C.papel, fontSize: 14 }}>
            <span style={{ flex: "0 0 150px", color: C.gris }}>{k}</span><span style={{ fontWeight: 600, wordBreak: "break-word" }}>{v}</span>
          </div>
        ))}
      </div>

      <h2 style={S.h2}>Así recibimos tu vehículo</h2>
      {gallery("antes")}
      <h2 style={S.h2}>Así lo entregamos</h2>
      {gallery("despues")}

      <p style={{ fontSize: 13, color: C.gris, marginTop: 28, lineHeight: 1.6 }}>
        ¿Algo no quedó bien? Escríbenos por WhatsApp al{" "}
        <a href={`https://wa.me/525513285555?text=${encodeURIComponent(`Hola LUKON, tengo una duda sobre mi instalación ${folioTxt(inst.folio)}.`)}`} style={{ color: C.azul, fontWeight: 600 }}>55 1328 5555</a>{" "}
        con tu folio {folioTxt(inst.folio)}.
      </p>
    </div>
  );
}
