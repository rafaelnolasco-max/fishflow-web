// POST /api/telematica/resumen-semanal/prueba — solo Rafa (admin).
// Manda YA el resumen semanal de todas las flotillas a los destinatarios del lunes,
// con "[Prueba]" en el asunto. Con ?whatsapp=1 manda también la plantilla de WhatsApp.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { REPLY_TO } from "@/lib/email";
import { LUKON_OPS_EMAIL } from "@/lib/installations";
import { sendWeeklyAll } from "@/lib/fleetWeekly";
import { sendWeeklyWhatsApp } from "@/lib/fleetWhatsApp";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const r = await sendWeeklyAll(supabaseAdmin(), {
    to: [LUKON_OPS_EMAIL, REPLY_TO], subjectPrefix: "[Prueba] ", link: "https://www.fishflow.mx/app/lukon",
  });
  const wa = req.nextUrl.searchParams.get("whatsapp") === "1" ? await sendWeeklyWhatsApp(supabaseAdmin(), r.reports) : null;
  return NextResponse.json({ sent: r.sent, skipped: r.skipped, failed: r.failed, whatsapp: wa });
}
