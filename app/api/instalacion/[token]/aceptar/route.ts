// POST /api/instalacion/[token]/aceptar  → el cliente final acepta su instalación (sin login)
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { logEvent } from "@/lib/installations";
import { notifyAccepted } from "@/lib/installationsReport";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { token } = await params;
  if (!UUID_RE.test(token)) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });
  const db = supabaseAdmin();
  const { data: inst } = await db.from("telematica_installations").select("*").eq("report_token", token).maybeSingle();
  if (!inst) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });
  if (inst.status === "aceptada") return NextResponse.json({ ok: true, already: true });
  if (inst.status !== "terminada") return NextResponse.json({ error: "Esta instalación todavía no se puede aceptar" }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const now = new Date().toISOString();
  const { error } = await db.from("telematica_installations")
    .update({ status: "aceptada", accepted_at: now, accepted_auto: false, accept_ip: ip, updated_at: now }).eq("id", inst.id).eq("status", "terminada");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent(db, inst, "aceptada_cliente", "El cliente aceptó desde el reporte", inst.customer_email ?? "cliente");
  await notifyAccepted(db, inst).catch(() => {});
  return NextResponse.json({ ok: true });
}
