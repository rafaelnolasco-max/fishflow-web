// GET   /api/lukon/instalaciones/[id]  → orden + fotos (URLs firmadas) + línea de tiempo
// PATCH /api/lukon/instalaciones/[id]  → { action, ...campos }
//   update      edita datos de la orden
//   reschedule  { scheduled_at, installer_no? }
//   start       { lat?, lon? }  programada → en_sitio (exige fotos de "antes" al terminar, no al empezar)
//   finish      { lat?, lon?, device_imei?, ... }  en_sitio → terminada; exige fotos obligatorias
//               e IMEI si incluye GPS; manda el reporte al cliente si tiene correo
//   cancel      { reason }
//   accept      aceptación registrada por Lukon (p. ej. el cliente lo confirmó por teléfono)

import { NextRequest, NextResponse } from "next/server";
import { authInstallation, forInstaller, INSTALLER_FIELDS } from "@/lib/installationsAuth";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { notifyOps } from "@/lib/installationsReport";
import { LUKON_ID, signPhotos, missingPhotos, fmtCdmx, type Service } from "@/lib/installations";
import { logEvent } from "@/lib/installationsLog";
import { sendInstallationReport } from "@/lib/installationsReport";
import { cleanOrder } from "../validate";

export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

async function load(id: string) {
  const db = supabaseAdmin();
  const { data } = await db.from("telematica_installations").select("*").eq("id", id).eq("client_id", LUKON_ID).maybeSingle();
  return { db, inst: data };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authInstallation(req, id);
  if (!auth.ok) return auth.response;
  const { db, inst } = await load(id);
  if (!inst) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  const [{ data: photos }, { data: events }] = await Promise.all([
    db.from("telematica_installation_photos").select("id, stage, kind, path, created_at").eq("installation_id", id).order("created_at"),
    db.from("telematica_installation_events").select("type, detail, by, at").eq("installation_id", id).order("at"),
  ]);
  if (auth.installer) return NextResponse.json({
    installation: forInstaller(inst), photos: await signPhotos(db, photos ?? []),
    events: (events ?? []).map(e => ({ ...e, by: null })), installer: true,
  });
  return NextResponse.json({ installation: inst, photos: await signPhotos(db, photos ?? []), events: events ?? [] });
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const auth = await authInstallation(req, id);
  if (!auth.ok) return auth.response;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  // El instalador (liga privada) solo puede empezar y terminar, y solo captura datos del equipo
  if (auth.installer) {
    if (!["start", "finish"].includes(String(b.action))) return NextResponse.json({ error: "Acción no permitida" }, { status: 403 });
    const keep: Record<string, unknown> = { action: b.action, lat: b.lat, lon: b.lon, remote_cutoff_test: b.remote_cutoff_test };
    for (const f of INSTALLER_FIELDS) if (f in b) keep[f] = b[f];
    b = keep;
  }
  const { db, inst } = await load(id);
  if (!inst) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });

  const now = new Date().toISOString();
  const by = auth.by;
  const action = String(b.action ?? "update");
  const done = async (patch: Record<string, unknown>, ev?: [string, string | null], notify?: "reprogramada" | "cancelada") => {
    const { data, error } = await db.from("telematica_installations").update({ ...patch, updated_at: now }).eq("id", id).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (ev) await logEvent(db, inst, ev[0], ev[1], by);
    if (notify) await notifyOps(data, notify);
    return NextResponse.json({ installation: data });
  };

  if (action === "update") {
    const v = cleanOrder(b, false);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
    // Cambiar fecha o instalador de una orden programada también avisa a Alex
    const sameTime = (a: unknown, b: unknown) => (a ? +new Date(String(a)) : 0) === (b ? +new Date(String(b)) : 0);
    const moved = inst.status === "programada" &&
      (("scheduled_at" in v.row && !sameTime(v.row.scheduled_at, inst.scheduled_at)) ||
       ("installer_no" in v.row && (v.row.installer_no ?? null) !== (inst.installer_no ?? null)));
    return done(v.row, ["editada", null], moved ? "reprogramada" : undefined);
  }

  if (action === "reschedule") {
    if (!["programada"].includes(inst.status)) return NextResponse.json({ error: "Solo se reprograman órdenes programadas" }, { status: 400 });
    const v = cleanOrder({ scheduled_at: b.scheduled_at, ...("installer_no" in b ? { installer_no: b.installer_no } : {}) }, false);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
    const txt = `Nueva fecha: ${fmtCdmx(v.row.scheduled_at as string | null)}${v.row.installer_no ? ` · Instalador ${v.row.installer_no}` : ""}${b.reason ? ` · ${String(b.reason).slice(0, 200)}` : ""}`;
    return done(v.row, ["reprogramada", txt], "reprogramada");
  }

  if (action === "start") {
    if (inst.status !== "programada") return NextResponse.json({ error: "La orden no está programada" }, { status: 400 });
    return done({ status: "en_sitio", started_at: now, start_lat: num(b.lat), start_lon: num(b.lon) },
      ["inicio", num(b.lat) != null ? `Ubicación ${num(b.lat)!.toFixed(5)}, ${num(b.lon)!.toFixed(5)}` : "Sin ubicación del celular"]);
  }

  if (action === "finish") {
    if (inst.status !== "en_sitio") return NextResponse.json({ error: "La instalación no está en curso" }, { status: 400 });
    const v = cleanOrder(b, false);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
    const merged = { ...inst, ...v.row };
    const { data: ph } = await db.from("telematica_installation_photos").select("kind").eq("installation_id", id);
    const kinds = (ph ?? []).map(p => p.kind);
    const faltan = [...missingPhotos(inst.service as Service, "antes", kinds), ...missingPhotos(inst.service as Service, "despues", kinds)];
    if (faltan.length) return NextResponse.json({ error: `Faltan fotos: ${faltan.join(", ")}` }, { status: 400 });
    if (inst.service !== "dashcam" && !merged.device_imei) return NextResponse.json({ error: "Falta el IMEI del equipo GPS" }, { status: 400 });
    // Prueba de apagado remoto: obligatoria si lleva GPS ("exitosa" o "no aplica")
    const cutoff = ["exitosa", "no_aplica"].includes(String(b.remote_cutoff_test)) ? String(b.remote_cutoff_test) : null;
    if (inst.service !== "dashcam" && !cutoff) return NextResponse.json({ error: "Falta la prueba de apagado remoto (exitosa o no aplica)" }, { status: 400 });
    const res = await db.from("telematica_installations").update({
      ...v.row, remote_cutoff_test: inst.service !== "dashcam" ? cutoff : null, status: "terminada", finished_at: now, finish_lat: num(b.lat), finish_lon: num(b.lon), updated_at: now,
    }).eq("id", id).select("*").single();
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    await logEvent(db, inst, "fin", num(b.lat) != null ? `Ubicación ${num(b.lat)!.toFixed(5)}, ${num(b.lon)!.toFixed(5)}` : "Sin ubicación del celular", by);
    const sent = res.data.customer_email ? await sendInstallationReport(db, res.data, by) : { ok: false, error: "Sin correo del cliente" };
    const { data: fresh } = await db.from("telematica_installations").select("*").eq("id", id).single();
    return NextResponse.json({ installation: fresh, report: sent });
  }

  if (action === "cancel") {
    if (["aceptada", "cancelada"].includes(inst.status)) return NextResponse.json({ error: "La orden ya está cerrada" }, { status: 400 });
    const reason = String(b.reason ?? "").trim().slice(0, 300);
    if (!reason) return NextResponse.json({ error: "Escribe el motivo de la cancelación" }, { status: 400 });
    return done({ status: "cancelada", cancel_reason: reason }, ["cancelada", reason], "cancelada");
  }

  if (action === "accept") {
    if (!["terminada", "incidencia"].includes(inst.status)) return NextResponse.json({ error: "Solo se aceptan instalaciones terminadas" }, { status: 400 });
    return done({ status: "aceptada", accepted_at: now, accepted_auto: false },
      ["aceptada_lukon", String(b.reason ?? "Registrada por LUKON").slice(0, 200)]);
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}
