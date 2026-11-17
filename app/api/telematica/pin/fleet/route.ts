// GET /api/telematica/pin/fleet?slug=<slug> — la flotilla de la vista por NIP, con sus unidades.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { pinSessions } from "@/lib/pinAccess";
import { fleetsWithVehicles } from "@/lib/telematicaFleets";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  const [s] = await pinSessions(slug);
  if (!s) return NextResponse.json({ error: "Tu sesión terminó. Vuelve a escribir el NIP." }, { status: 401 });

  const db = supabaseAdmin();
  const { data: fleet, error } = await db.from("clients").select("id, name, slug").eq("id", s.clientId).maybeSingle();
  if (error || !fleet) return NextResponse.json({ error: "Flotilla no encontrada" }, { status: 404 });
  try {
    return NextResponse.json({ fleets: await fleetsWithVehicles(db, [fleet]) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
