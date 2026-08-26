import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireClientAccess } from "@/lib/apiAuth";
import { runRecordSession } from "@/lib/therapyRecord";

export const runtime = "nodejs";
export const maxDuration = 800;

// ════════════════════════════════════════════════════════════════════════════
// TherapyOS — reprocess-audio
// ════════════════════════════════════════════════════════════════════════════
// Red de seguridad para grabaciones huérfanas: audios que SÍ subieron a Storage
// pero cuya transcripción falló (p. ej. la subida se cayó en el momento
// equivocado y no quedó fila en `transcriptions`).
//
//   GET  ?patient_id=...  → lista los .webm del paciente en Storage y marca
//                           cuáles ya tienen transcripción 'done' y cuáles son
//                           huérfanos (recuperables).
//   POST { patient_id, storage_path, session_date }
//                         → re-dispara el mismo pipeline de la grabadora
//                           (troceo ffmpeg + Whisper + borrador de sesión).
//
// No reimplementa la transcripción: usa `lib/therapyRecord`, exactamente el
// mismo camino que el flujo normal de la grabadora.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE);

const AUDIO_EXT = /\.(webm|m4a|mp3|wav|aac|mp4|ogg|caf|opus)$/i;

// ── GET: descubrir audios huérfanos de un paciente ──────────────────────────
export async function GET(req: NextRequest) {
  const patient_id = req.nextUrl.searchParams.get("patient_id");
  if (!patient_id) {
    return NextResponse.json({ error: "Falta patient_id" }, { status: 400 });
  }

  const { data: patient, error: pErr } = await supabaseAdmin
    .from("patients")
    .select("id, client_id, full_name")
    .eq("id", patient_id)
    .single();
  if (pErr || !patient) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }

  // Candado: esta ruta expone el nombre del paciente y el inventario de audios.
  const auth = await requireClientAccess(patient.client_id);
  if (!auth.ok) return auth.response;

  const prefix = `${patient.client_id}/therapy_session/${patient_id}`;
  const { data: files, error: lsErr } = await supabaseAdmin.storage
    .from("audio")
    .list(prefix, { limit: 200, sortBy: { column: "created_at", order: "desc" } });
  if (lsErr) {
    return NextResponse.json({ error: `Storage: ${lsErr.message}` }, { status: 502 });
  }

  // Transcripciones existentes de este paciente para cruzar por storage_path
  const { data: txs } = await supabaseAdmin
    .from("transcriptions")
    .select("storage_path, status")
    .eq("module", "therapy_session")
    .eq("ref_id", patient_id);
  const byPath = new Map((txs ?? []).map((t) => [t.storage_path, t.status]));

  // OJO: no filtrar por .webm. El grabador del navegador produce .webm, pero
  // "Subir audio" acepta lo que traiga Notas de Voz (.m4a), Android (.mp3) o
  // WhatsApp (.ogg). Filtrar por webm dejaba fuera justo los audios que más
  // importa poder reprocesar.
  const result = (files ?? [])
    .filter((f) => AUDIO_EXT.test(f.name))
    .map((f) => {
      const storage_path = `${prefix}/${f.name}`;
      const tx_status = byPath.get(storage_path) ?? null;
      return {
        storage_path,
        created_at: f.created_at,
        size_bytes: (f.metadata?.size as number) ?? null,
        tx_status, // null | 'processing' | 'error' | 'empty' | 'done'
        orphan: tx_status !== "done", // recuperable si no hay transcripción exitosa
      };
    });

  return NextResponse.json({ patient: patient.full_name, files: result });
}

// ── POST: re-disparar el pipeline sobre un audio existente ──────────────────
export async function POST(req: NextRequest) {
  const { patient_id, storage_path, session_date, source } = (await req.json()) as {
    patient_id?: string;
    storage_path?: string;
    session_date?: string;
    source?: "recorder" | "upload";
  };

  if (!patient_id || !storage_path) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: patient_id, storage_path" },
      { status: 400 },
    );
  }

  // Candado antes de gastar Whisper: sesión válida + acceso al cliente.
  const { data: patient, error: pErr } = await supabaseAdmin
    .from("patients")
    .select("id, client_id")
    .eq("id", patient_id)
    .single();
  if (pErr || !patient) {
    return NextResponse.json({ error: "Paciente no encontrado" }, { status: 404 });
  }
  const auth = await requireClientAccess(patient.client_id);
  if (!auth.ok) return auth.response;

  // Fecha de sesión: la provista, o la del nombre del archivo, o hoy.
  const fromName = storage_path.match(/(\d{4}-\d{2}-\d{2})T/)?.[1];
  const date = session_date ?? fromName ?? new Date().toISOString().slice(0, 10);

  // 26-ago-2026: antes esto era un fetch a record-session reenviando la cookie
  // del navegador. Si la sesión no viajaba, el reintento moría en 401 sin
  // llegar a Whisper. Ahora se llama al pipeline en proceso.
  const result = await runRecordSession({
    patientId: patient_id,
    clientId: patient.client_id,
    storagePath: storage_path,
    sessionDate: date,
    sourceType: source === "upload" ? "upload" : "recorder",
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
}
