import { NextRequest, NextResponse } from "next/server";
import {
  computeProgress,
  discoveryAdmin,
  loadInviteByToken,
  type DiscoveryBlock,
} from "@/lib/discovery";

export const runtime = "nodejs";

// ════════════════════════════════════════════════════════════════════════════
// Descubrimiento — autoguardado
// ════════════════════════════════════════════════════════════════════════════
// El prospecto contesta desde el celular entre paciente y paciente. Si se sale
// a media pregunta y pierde lo escrito, no vuelve. Por eso el formulario
// guarda solo, y esta ruta es la que recibe cada guardado.
//
// Sin candado de sesión a propósito: el prospecto no tiene cuenta. Lo que
// autoriza es el token, que es largo y caduca. Por eso la ruta NO acepta un
// invite_id ni un client_id del cliente: todo se resuelve desde el token.

/** Tope defensivo: el cuestionario más largo hoy ronda los 6 KB de respuestas. */
const MAX_ANSWERS_BYTES = 256 * 1024;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      token?: string;
      answers?: Record<string, unknown>;
    };
    const token = String(body.token ?? "");
    const answers = body.answers;

    if (!token || !answers || typeof answers !== "object" || Array.isArray(answers)) {
      return NextResponse.json({ error: "Petición incompleta." }, { status: 400 });
    }
    if (JSON.stringify(answers).length > MAX_ANSWERS_BYTES) {
      return NextResponse.json({ error: "Respuestas demasiado grandes." }, { status: 413 });
    }

    const supabase = discoveryAdmin();
    const found = await loadInviteByToken(supabase, token);
    if (!found.ok) {
      return NextResponse.json(
        { error: found.reason === "expired" ? "La liga ya venció." : "Liga no válida." },
        { status: found.reason === "expired" ? 410 : 404 },
      );
    }
    // Un cuestionario ya enviado no se reescribe: lo que se entregó, se queda.
    if (found.invite.status === "submitted") {
      return NextResponse.json({ error: "El cuestionario ya fue enviado." }, { status: 409 });
    }

    // Solo se guardan claves que existan en el cuestionario. Así una petición
    // hecha a mano no puede inflar la fila con basura.
    const validas = new Set(
      (found.template.blocks as DiscoveryBlock[]).flatMap((b) => b.questions.map((q) => q.id)),
    );
    const limpias: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(answers)) {
      if (validas.has(k)) limpias[k] = v;
    }

    const progress = computeProgress(found.template.blocks, limpias);
    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from("discovery_invites")
      .update({
        answers: limpias,
        progress,
        status: "in_progress",
        last_saved_at: nowIso,
      })
      .eq("id", found.invite.id);

    if (error) {
      console.error("[descubrimiento/guardar] update:", error);
      return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, progress, saved_at: nowIso });
  } catch (err) {
    console.error("[descubrimiento/guardar] error:", err);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}
