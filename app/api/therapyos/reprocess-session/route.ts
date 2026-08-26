import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reprocessSessionAI } from "@/lib/therapySession";
import { requireClientAccess } from "@/lib/apiAuth";

export const runtime = "nodejs";
export const maxDuration = 800;

// ════════════════════════════════════════════════════════════════════════════
// TherapyOS — reprocess-session
// ════════════════════════════════════════════════════════════════════════════
// Re-corre el análisis clínico sobre una sesión que YA tiene transcripción
// guardada. No toca Storage ni Whisper: es el camino barato para recuperar una
// sesión que quedó con `ai_processed = false` porque el modelo falló.
//
// Distinto de `reprocess-audio`, que sirve cuando lo que falló fue la
// transcripción misma y hay que volver a pasar el audio por Whisper.
//
//   POST { session_id } → sesión actualizada, con resúmenes.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const { session_id } = (await req.json()) as { session_id?: string };
    if (!session_id) {
      return NextResponse.json({ error: "Falta session_id" }, { status: 400 });
    }

    const { data: session, error: sErr } = await supabaseAdmin
      .from("sessions")
      .select("id, client_id")
      .eq("id", session_id)
      .single();
    if (sErr || !session) {
      return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 });
    }

    const auth = await requireClientAccess(session.client_id);
    if (!auth.ok) return auth.response;

    const result = await reprocessSessionAI(session_id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status },
      );
    }

    return NextResponse.json({ session: result.session }, { status: 200 });
  } catch (err) {
    console.error("reprocess-session error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
