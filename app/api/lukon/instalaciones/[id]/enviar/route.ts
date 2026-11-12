// POST /api/lukon/instalaciones/[id]/enviar  { to? }  → (re)envía el reporte al cliente
import { NextRequest, NextResponse } from "next/server";
import { requireClientAccess } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { LUKON_ID } from "@/lib/installations";
import { sendInstallationReport } from "@/lib/installationsReport";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireClientAccess(LUKON_ID);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const db = supabaseAdmin();
  const { data: inst } = await db.from("telematica_installations").select("*").eq("id", id).eq("client_id", LUKON_ID).maybeSingle();
  if (!inst) return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  if (!["terminada", "aceptada"].includes(inst.status)) return NextResponse.json({ error: "El reporte se envía cuando la instalación está terminada" }, { status: 400 });
  const to = typeof b.to === "string" && b.to.trim() ? b.to.trim() : null;
  if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return NextResponse.json({ error: "Correo inválido" }, { status: 400 });
  if (to && to !== inst.customer_email) await db.from("telematica_installations").update({ customer_email: to }).eq("id", id);
  const r = await sendInstallationReport(db, inst, auth.email, to);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  const { data: fresh } = await db.from("telematica_installations").select("*").eq("id", id).single();
  return NextResponse.json({ installation: fresh });
}
