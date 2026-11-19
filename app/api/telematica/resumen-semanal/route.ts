// GET /api/telematica/resumen-semanal?client_id=<flotilla>[&ref=YYYY-MM-DD]
// Vista previa del correo semanal (HTML), para el panel de LUKON. No manda nada.
import { NextRequest, NextResponse } from "next/server";
import { requireFleetAccess, supabaseAdmin } from "@/lib/telematicaAuth";
import { buildWeekly } from "@/lib/fleetWeekly";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("client_id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return NextResponse.json({ error: "Flotilla inválida" }, { status: 400 });
  const auth = await requireFleetAccess(clientId);
  if (!auth.ok) return auth.response;
  const ref = req.nextUrl.searchParams.get("ref");
  const r = await buildWeekly(supabaseAdmin(), clientId, {
    link: "https://www.fishflow.mx/app/lukon",
    ref: ref && /^\d{4}-\d{2}-\d{2}$/.test(ref) ? new Date(`${ref}T18:00:00Z`) : undefined,
  });
  if (!r) return NextResponse.json({ error: "Flotilla sin unidades" }, { status: 404 });
  return new NextResponse(r.html, { headers: { "content-type": "text/html; charset=utf-8", "x-subject": encodeURIComponent(r.subject) } });
}
