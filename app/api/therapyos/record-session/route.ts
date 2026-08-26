import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runRecordSession } from "@/lib/therapyRecord";
import { requireClientAccess } from "@/lib/apiAuth";

export const runtime = "nodejs"; // ffmpeg requiere runtime Node, no edge

// ════════════════════════════════════════════════════════════════════════════
// TherapyOS — record-session
// ════════════════════════════════════════════════════════════════════════════
// Punto de entrada de la grabadora y de "Subir audio". Valida acceso y delega
// el trabajo a `lib/therapyRecord`, compartido con reprocess-audio.
// NO envía nada al paciente: el envío es un paso manual aparte
// ("aprobar antes de enviar").
//
// 19-ago-2026: la transcripción se movió a `lib/sessionPipeline.ts`.
// 26-ago-2026: el resto del pipeline (análisis + guardado) se movió a
// `lib/therapyRecord.ts` para que el botón de reintentar no dependa de una
// llamada HTTP con cookies reenviadas.

// FishFlow está en Vercel Pro: el tope de 300 s era herencia de Hobby y era
// lo que cortaba la respuesta en sesiones de ~50 min (11-ago-2026), aunque la
// transcripción y el borrador sí se completaran.
export const maxDuration = 800; // transcripción + IA pueden tardar

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function POST(req: NextRequest) {
  try {
    const { patient_id, storage_path, session_date, duration_seconds, source } =
      (await req.json()) as {
        patient_id: string;
        storage_path: string;
        filename?: string;
        session_date: string;
        duration_seconds?: number;
        /** "recorder" = grabado en la app; "upload" = archivo ya grabado (Notas de Voz). */
        source?: "recorder" | "upload";
      };

    // El audio subido ya existe y es lo único que hay: no lo rechazamos por
    // corto. El del grabador sí, porque ahí un archivo de 2 s siempre es un
    // toque accidental al botón.
    const sourceType: "recorder" | "upload" = source === "upload" ? "upload" : "recorder";

    if (!patient_id || !storage_path || !session_date) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: patient_id, storage_path, session_date" },
        { status: 400 },
      );
    }

    if (sourceType === "recorder" && typeof duration_seconds === "number" && duration_seconds < 3) {
      return NextResponse.json(
        { error: "La grabación fue demasiado corta. Graba al menos unos segundos hablando." },
        { status: 422 },
      );
    }

    // ── 1. Paciente → client_id ────────────────────────────────────────────────
    const { data: patient, error: pErr } = await supabaseAdmin
      .from("patients")
      .select("id, client_id")
      .eq("id", patient_id)
      .single();
    if (pErr || !patient) {
      return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
    }

    // ── 2. Candado: sesión válida + acceso al cliente del paciente ─────────────
    // Esta ruta gasta créditos de Whisper y escribe notas clínicas.
    const auth = await requireClientAccess(patient.client_id);
    if (!auth.ok) return auth.response;

    // ── 3. Transcribir + analizar + guardar ────────────────────────────────────
    const result = await runRecordSession({
      patientId: patient_id,
      clientId: patient.client_id,
      storagePath: storage_path,
      sessionDate: session_date,
      sourceType,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, empty: result.empty, detail: result.detail },
        { status: result.status },
      );
    }

    return NextResponse.json(
      {
        session: result.session,
        transcription_id: result.transcriptionId,
        warning: result.warning,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("record-session error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
