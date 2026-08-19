// FishFlow — subida de audio a Storage con progreso
// ─────────────────────────────────────────────────────────────────────────────
// Compartido por el grabador y el selector de archivo de Therapy Flow.
// Va con XHR y no con el SDK porque necesitamos `upload.onprogress`: una sesión
// de una hora pesa ~28 MB y en datos móviles son varios minutos. Sin barra, la
// persona cree que se trabó y cierra la app.
//
// La política de Storage exige que la primera carpeta de la ruta sea un
// client_id al que el usuario tenga acceso.

import { supabase } from "@/lib/supabase";

export const MAX_AUDIO_BYTES = 200 * 1024 * 1024; // el bucket topa en 200 MB
const RETRIES = 3;

export function buildAudioPath(clientId: string, patientId: string, ext: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeExt = (ext || "m4a").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "m4a";
  return `${clientId}/therapy_self/${patientId}/${stamp}.${safeExt}`;
}

function putWithProgress(
  url: string, token: string, body: Blob, contentType: string, onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("Content-Type", contentType || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage HTTP ${xhr.status}: ${String(xhr.responseText).slice(0, 200)}`));
    xhr.onerror = () => reject(new Error("Se cortó la conexión durante la subida"));
    xhr.send(body);
  });
}

export type UploadResult = { storagePath: string };

/** Sube el audio y devuelve su ruta en Storage. Reintenta hasta 3 veces. */
export async function uploadAudio(opts: {
  blob: Blob;
  ext: string;
  clientId: string;
  patientId: string;
  onProgress?: (pct: number) => void;
  onRetry?: (attempt: number, total: number) => void;
}): Promise<UploadResult> {
  const { blob, ext, clientId, patientId, onProgress, onRetry } = opts;

  if (blob.size > MAX_AUDIO_BYTES) {
    throw new Error(
      "El archivo pasa de 200 MB. Si viene de Notas de Voz, cámbialo a calidad Comprimida " +
      "en Ajustes → Notas de Voz → Calidad de audio.",
    );
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Tu sesión expiró. Vuelve a entrar.");

  const storagePath = buildAudioPath(clientId, patientId, ext);
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/audio/${storagePath}`;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      await putWithProgress(url, session.access_token, blob, blob.type, onProgress ?? (() => {}));
      return { storagePath };
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) {
        onRetry?.(attempt, RETRIES);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
  }
  console.error("uploadAudio:", lastErr);
  throw new Error("No se pudo subir el audio. Revisa tu conexión e intenta otra vez.");
}

/** Mime de grabación: Safari/iOS no soporta webm — detectar (lección iPad/Safari). */
export function pickAudioMime(): { mime: string; ext: string } {
  const candidates = [
    { mime: "audio/mp4", ext: "m4a" }, // Safari / iOS primero: es el caso de uso real
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/aac", ext: "aac" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "", ext: "webm" };
}
