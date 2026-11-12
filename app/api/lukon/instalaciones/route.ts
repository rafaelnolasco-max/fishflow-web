// GET  /api/lukon/instalaciones        → órdenes de instalación de Lukon (con conteo de fotos)
// POST /api/lukon/instalaciones        → crear orden
// Fase 1: solo admins de Lukon (Alex) y Rafa. Ver lib/installations.ts.

import { NextRequest, NextResponse } from "next/server";
import { requireClientAccess } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { LUKON_ID, logEvent } from "@/lib/installations";
import { cleanOrder } from "./validate";

export async function GET() {
  const auth = await requireClientAccess(LUKON_ID);
  if (!auth.ok) return auth.response;
  const db = supabaseAdmin();
  const [{ data, error }, { data: ph }] = await Promise.all([
    db.from("telematica_installations").select("*").eq("client_id", LUKON_ID)
      .order("scheduled_at", { ascending: false, nullsFirst: false }).limit(500),
    db.from("telematica_installation_photos").select("installation_id").eq("client_id", LUKON_ID).limit(20000),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const count = new Map<string, number>();
  for (const p of ph ?? []) count.set(p.installation_id, (count.get(p.installation_id) ?? 0) + 1);
  return NextResponse.json({ installations: (data ?? []).map(i => ({ ...i, photos: count.get(i.id) ?? 0 })) });
}

export async function POST(req: NextRequest) {
  const auth = await requireClientAccess(LUKON_ID);
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const v = cleanOrder(body, true);
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db.from("telematica_installations")
    .insert({ ...v.row, client_id: LUKON_ID, created_by: auth.email }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logEvent(db, data, "creada", data.installer_no ? `Asignada al Instalador ${data.installer_no}` : null, auth.email);
  return NextResponse.json({ installation: data });
}
