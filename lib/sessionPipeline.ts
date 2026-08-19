// FishFlow — sessionPipeline
// ─────────────────────────────────────────────────────────────────────────────
// Tubería compartida de "audio guardado → transcripción" para los módulos que
// procesan sesiones largas:
//
//   • TherapyOS       (`/api/therapyos/record-session`) — el terapeuta
//   • Therapy Flow    (`/api/terapia/upload-session`)   — el paciente
//
// Vive aquí para que los fixes se arreglen UNA vez: el registro en
// `transcriptions`, el guardia anti-alucinación de Whisper y la descarga por
// streaming son idénticos en los dos flujos.
//
// ⚠️ La descarga es por streaming a `/tmp`, NO con `arrayBuffer()`. Una sesión
// de una hora en calidad normal de Notas de Voz pesa ~28 MB y puede llegar a
// 200 MB: cargarla completa en memoria es lo que tumba la función.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { transcribeLongAudioFromFile } from "@/lib/whisper-chunked";

// Whisper alucina firmas de subtítulos cuando el audio está en silencio o sin
// voz (ej. "Subtítulos realizados por la comunidad de Amara.org"). Detectamos
// esa basura para NO generar una sesión clínica fantasma.
const HALLUCINATION_PATTERNS = [
  /amara\.org/i,
  /subt[íi]tulos?\s+(realizados|por|hechos|creados)/i,
  /gracias por ver/i,
  /thanks for watching/i,
  /subscribe/i,
  /www\.[a-z]/i,
];

/** true si la transcripción no trae voz real (silencio o alucinación de Whisper). */
export function looksEmpty(t: string): boolean {
  const clean = (t ?? "").trim();
  if (clean.length < 20) return true;
  if (clean.length < 140 && HALLUCINATION_PATTERNS.some((re) => re.test(clean))) return true;
  let stripped = clean;
  for (const re of HALLUCINATION_PATTERNS) stripped = stripped.replace(re, "");
  if (stripped.replace(/[^a-záéíóúñ0-9]/gi, "").length < 15) return true;
  return false;
}

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Baja un objeto de Storage a un archivo temporal, por streaming.
 * Devuelve la ruta del archivo y la del directorio a limpiar.
 */
async function downloadToTmp(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
): Promise<{ file: string; dir: string; bytes: number }> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 900);
  if (error || !data?.signedUrl) {
    throw new Error(`Storage: no se pudo firmar la URL (${error?.message ?? "sin datos"})`);
  }

  const res = await fetch(data.signedUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Storage: descarga falló con HTTP ${res.status}`);
  }

  const dir = await mkdtemp(join(tmpdir(), "ffdl-"));
  const file = join(dir, "audio.bin");
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(file));

  const { size } = await stat(file);
  if (size === 0) throw new Error("Storage: el archivo descargado está vacío");
  return { file, dir, bytes: size };
}

export type TranscribeStoredAudioInput = {
  clientId: string;
  /** Etiqueta del módulo para la tabla `transcriptions` (ej. "therapy_session"). */
  module: string;
  /** A qué entidad pertenece el audio (ej. el patient_id). */
  refId: string;
  storagePath: string;
  storageBucket?: string;
  /** "recorder" cuando se grabó en la app, "upload" cuando el usuario subió un archivo. */
  sourceType?: string;
  language?: string;
};

export type TranscribeStoredAudioResult =
  | { ok: true; transcript: string; transcriptionId: string | null; bytes: number }
  | { ok: false; reason: "empty" | "error"; message: string; transcriptionId: string | null };

/**
 * Registra la transcripción, baja el audio, lo transcribe y deja el estado
 * final en la tabla `transcriptions`. No crea ni toca sesiones: eso es
 * responsabilidad de quien llama.
 */
export async function transcribeStoredAudio(
  input: TranscribeStoredAudioInput,
): Promise<TranscribeStoredAudioResult> {
  const {
    clientId, module, refId, storagePath,
    storageBucket = "audio",
    sourceType = "recorder",
    language = "es",
  } = input;

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return { ok: false, reason: "error", message: "OPENAI_API_KEY no configurada", transcriptionId: null };
  }

  const supabase = admin();

  const { data: txRow } = await supabase
    .from("transcriptions")
    .insert({
      client_id: clientId,
      module,
      ref_id: refId,
      source_type: sourceType,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      status: "processing",
      language,
    })
    .select("id")
    .single();
  const transcriptionId: string | null = txRow?.id ?? null;

  let dir: string | null = null;
  try {
    const dl = await downloadToTmp(supabase, storageBucket, storagePath);
    dir = dl.dir;

    const { transcript } = await transcribeLongAudioFromFile(dl.file, openaiKey, language);

    if (looksEmpty(transcript)) {
      if (transcriptionId) {
        await supabase
          .from("transcriptions")
          .update({
            status: "empty",
            error: "Sin voz detectada (probable silencio / micrófono sin captar)",
            updated_at: new Date().toISOString(),
          })
          .eq("id", transcriptionId);
      }
      return {
        ok: false,
        reason: "empty",
        message: "No se detectó voz en la grabación.",
        transcriptionId,
      };
    }

    if (transcriptionId) {
      await supabase
        .from("transcriptions")
        .update({ status: "done", transcript, updated_at: new Date().toISOString() })
        .eq("id", transcriptionId);
    }

    return { ok: true, transcript, transcriptionId, bytes: dl.bytes };
  } catch (e) {
    if (transcriptionId) {
      await supabase
        .from("transcriptions")
        .update({ status: "error", error: String(e), updated_at: new Date().toISOString() })
        .eq("id", transcriptionId);
    }
    return { ok: false, reason: "error", message: String(e), transcriptionId };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Borra el audio original de Storage. Se usa en cuanto la transcripción sale
 * bien: en terapia el archivo es lo más sensible que guardamos.
 */
export async function deleteStoredAudio(bucket: string, path: string): Promise<void> {
  try {
    await admin().storage.from(bucket).remove([path]);
  } catch (e) {
    console.error("[sessionPipeline] no se pudo borrar el audio:", e);
  }
}
