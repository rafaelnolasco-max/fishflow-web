// GET /api/telematica/fleets?parent=<client_id>
// Flotillas (clientes hijos) de un padre —hoy Lukon— con sus unidades,
// cuántos puntos tiene cada una y su rango de fechas.

import { NextRequest, NextResponse } from "next/server";
import { requireClientAccess } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { fleetsWithVehicles } from "@/lib/telematicaFleets";

export async function GET(req: NextRequest) {
  const parent = req.nextUrl.searchParams.get("parent");
  if (!parent) return NextResponse.json({ error: "Falta parent" }, { status: 400 });
  const auth = await requireClientAccess(parent);
  if (!auth.ok) return auth.response;

  const db = supabaseAdmin();
  const { data: fleets, error } = await db.from("clients")
    .select("id, name, slug, active").eq("parent_client_id", parent).order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    return NextResponse.json({ fleets: await fleetsWithVehicles(db, fleets ?? []) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
