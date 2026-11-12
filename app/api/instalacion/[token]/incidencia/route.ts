// POST /api/instalacion/[token]/incidencia  { reason }  → el cliente NO acepta la instalación y dice por qué (sin login).
// La orden pasa a 'incidencia' (se detiene la auto-aceptación) y se avisa a Alex por correo y al equipo en Slack.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { logEvent } from "@/lib/installationsLog";
import { notifyOps } from "@/lib/installationsReport";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { token } = await params;
  if (!UUID_RE.test(token)) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const reason = String(b.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (reason.length < 5) return NextResponse.json({ error: "Cuéntanos brevemente qué no quedó bien" }, { status: 400 });
  const db = supabaseAdmin();
  const { data: inst } = await db.from("telematica_installations").select("*").eq("report_token", token).maybeSingle();
  if (!inst) return NextResponse.json({ error: "Reporte no encontrado" }, { status: 404 });
  if (inst.status === "aceptada") return NextResponse.json({ error: "Esta instalación ya fue aceptada. Escríbenos por WhatsApp y lo revisamos." }, { status: 400 });
  if (!["terminada", "incidencia"].includes(inst.status)) return NextResponse.json({ error: "Esta instalación todavía no está terminada" }, { status: 400 });
  const now = new Date().toISOString();
  const { data: fresh, error } = await db.from("telematica_installations")
    .update({ status: "incidencia", incident_reason: reason, incident_at: now, updated_at: now })
    .eq("id", inst.id).in("status", ["terminada", "incidencia"]).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent(db, inst, "incidencia_cliente", reason, inst.customer_email ?? "cliente");
  await notifyOps(fresh, "incidencia");
  return NextResponse.json({ ok: true });
}
