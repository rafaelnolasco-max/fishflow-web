import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { transcribeStoredAudio } from "@/lib/sessionPipeline";
import { requireClientAccess } from "@/lib/apiAuth";

export const runtime = "nodejs"; // ffmpeg requiere runtime Node, no edge

// ════════════════════════════════════════════════════════════════════════════
// TherapyOS — record-session
// ════════════════════════════════════════════════════════════════════════════
// Orquesta el flujo de la grabadora para TherapyOS:
//   1. transcribe el audio guardado (lib/sessionPipeline)
//   2. pasa el texto al `process-session` existente (sin tocarlo) → crea BORRADOR
//   3. marca la sesión con source_type='recorder' + audio_path + transcription_id
// NO envía nada al paciente. El envío (email/WhatsApp) es un paso manual aparte
// ("aprobar antes de enviar").
//
// 19-ago-2026: la transcripción (registro en `transcriptions`, descarga por
// streaming, transcode en una pasada y guardia anti-alucinación) se movió a
// `lib/sessionPipeline.ts`, compartida con Therapy Flow. El comportamiento de
// esta ruta no cambia.

// FishFlow está en Vercel Pro: el tope de 300 s era herencia de Hobby y era
// lo que cortaba la respuesta en sesiones de ~50 min (11-ago-2026), aunque la
// transcripción y el borrador sí se completaran.
export const maxDuration = 800; // transcripción + IA pueden tardar

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

export async function POST(req: NextRequest) {
  try {
    const { patient_id, storage_path, session_date, duration_seconds } = (await req.json()) as {
      patient_id: string;
      storage_path: string;
      filename?: string;
      session_date: string;
      duration_seconds?: number;
    };

    if (!patient_id || !storage_path || !session_date) {
      return NextResponse.json(
        { error: "Faltan campos requeridos: patient_id, storage_path, session_date" },
        { status: 400 },
      );
    }

    if (typeof duration_seconds === "number" && duration_seconds < 3) {
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

    // ── 1b. Candado: sesión válida + acceso al cliente del paciente ────────────
    // Esta ruta gasta créditos de Whisper y escribe notas clínicas: no puede
    // quedar abierta. La llamada interna desde `reprocess-audio` reenvía la
    // cookie de sesión del navegador que la disparó.
    const auth = await requireClientAccess(patient.client_id);
    if (!auth.ok) return auth.response;

    // ── 2. Transcribir (descarga por streaming + transcode en una pasada) ──────
    const tx = await transcribeStoredAudio({
      clientId: patient.client_id,
      module: "therapy_session",
      refId: patient_id,
      storagePath: storage_path,
      sourceType: "recorder",
      language: "es",
    });

    if (!tx.ok) {
      if (tx.reason === "empty") {
        return NextResponse.json(
          {
            error: "No se detectó voz en la grabación. Suele ser que el micrófono no captó audio. Revisa el permiso del micrófono e intenta de nuevo, hablando cerca del teléfono.",
            empty: true,
          },
          { status: 422 },
        );
      }
      return NextResponse.json(
        { error: `Error al transcribir: ${tx.message}` },
        { status: 502 },
      );
    }

    // ── 3. Procesar con IA (reusa process-session, sin tocarlo) → borrador ──────
    const psRes = await fetch(`${APP_URL}/api/therapyos/process-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient_id, transcript: tx.transcript, session_date }),
    });
    const psData = await psRes.json();
    if (!psRes.ok || !psData.session) {
      return NextResponse.json(
        { error: `Error al procesar la sesión: ${psData.error ?? "desconocido"}` },
        { status: 502 },
      );
    }

    // ── 4. Marcar la sesión como originada por grabadora ───────────────────────
    const { data: updated } = await supabaseAdmin
      .from("sessions")
      .update({
        source_type: "recorder",
        audio_path: storage_path,
        transcription_id: tx.transcriptionId ?? null,
      })
      .eq("id", psData.session.id)
      .select()
      .single();

    return NextResponse.json(
      { session: updated ?? psData.session, transcription_id: tx.transcriptionId },
      { status: 201 },
    );
  } catch (err) {
    console.error("record-session error:", err);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
