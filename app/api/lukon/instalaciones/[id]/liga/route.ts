// POST /api/lukon/instalaciones/[id]/liga  { nueva?: boolean }
// Genera (o reusa) la liga privada del instalador y devuelve el texto listo para WhatsApp.
// nueva=true anula la liga anterior. Solo admin (Alex / Rafa).
import { NextRequest, NextResponse } from "next/server";
import { requireClientAccess } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { LUKON_ID, SITE, SERVICE_LABEL, fmtCdmx, folioTxt, type Service } from "@/lib/installations";
import { logEvent } from "@/lib/installationsLog";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireClientAccess(LUKON_ID);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const db = supabaseAdmin();
  const { data: inst } = await db.from("telematica_installations").select("*").eq("id", id).eq("client_id", LUKON_ID).maybeSingle();
  if (!inst) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  if (!["programada", "en_sitio"].includes(inst.status)) return NextResponse.json({ error: "La liga solo sirve para órdenes programadas o en sitio" }, { status: 400 });

  let token: string = inst.installer_token;
  if (!token || b.nueva === true) {
    token = crypto.randomUUID();
    const { error } = await db.from("telematica_installations").update({ installer_token: token, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logEvent(db, inst, "liga_instalador", b.nueva === true && inst.installer_token ? "Liga nueva (la anterior quedó anulada)" : "Liga generada para el instalador", auth.email ?? null);
  }
  const url = `${SITE}/instalador/${token}`;
  const veh = [inst.vehicle_brand, inst.vehicle_model, inst.vehicle_year].filter(Boolean).join(" ") || "Vehículo";
  const maps = (inst.notes ?? "").match(/https?:\/\/\S+/)?.[0]
    ?? (inst.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(inst.address)}` : null);
  const text = [
    `🔧 LUKON · Orden ${folioTxt(inst.folio)}${inst.installer_no ? ` · Instalador ${inst.installer_no}` : ""}`,
    `📅 ${fmtCdmx(inst.scheduled_at)}`,
    `🚘 ${veh}${inst.vehicle_plate ? ` · ${inst.vehicle_plate}` : ""} · ${SERVICE_LABEL[inst.service as Service]}`,
    `👤 ${inst.customer_name}${inst.customer_phone ? ` · ${inst.customer_phone}` : ""}`,
    inst.address ? `📍 ${inst.address}` : null,
    maps ? `🗺️ ${maps}` : null,
    inst.notes ? `📝 ${inst.notes}` : null,
    ``,
    `Al llegar abre esta liga, toca "Empezar" y sigue los pasos (fotos, IMEI, prueba de apagado remoto):`,
    url,
  ].filter(l => l !== null).join("\n");
  return NextResponse.json({ url, text });
}
