// FishFlow — whisper-chunked
// ─────────────────────────────────────────────────────────────────────────────
// Transcribe audio LARGO de forma robusta. Resuelve el bug recurrente de
// TherapyOS con sesiones de ~45 min o más:
//
//   1. El webm de MediaRecorder no lleva duración en el header. Whisper lo lee
//      como "0 seconds" y devuelve HTTP 500 en archivos largos (los cortos
//      decodifican por casualidad). → Re-codificamos con ffmpeg a mp3 16 kHz
//      mono, que sí tiene headers válidos.
//   2. Un archivo largo en una sola llamada excede el timeout del Edge Function
//      (150 s). → Troceamos en segmentos de 10 min y transcribimos cada uno;
//      cada llamada a Whisper es corta. Concatenamos en orden.
//
// Corre en el runtime Node de Vercel (NO edge) porque usa el binario ffmpeg.
// Requiere la dependencia `ffmpeg-static`.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const SEGMENT_SECONDS = 600; // 10 min por trozo

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg salió ${code}: ${err.slice(-400)}`)),
    );
  });
}

async function transcribeOne(
  filePath: string,
  openaiKey: string,
  language: string,
): Promise<string> {
  const buf = await readFile(filePath);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/mpeg" }), "chunk.mp3");
  fd.append("model", "whisper-1");
  fd.append("language", language);
  const res = await fetch(WHISPER_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`Whisper HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return ((await res.json()).text ?? "").trim();
}

/**
 * Re-codifica a mp3 mono, trocea y transcribe. Devuelve el texto completo.
 * @param audio Buffer del audio original (webm/opus/m4a/…)
 */
export async function transcribeLongAudio(
  audio: ArrayBuffer,
  openaiKey: string,
  language = "es",
): Promise<{ transcript: string; chunks: number; durationSec: number }> {
  if (!ffmpegPath) throw new Error("ffmpeg-static no disponible");
  const dir = await mkdtemp(join(tmpdir(), "ffx-"));
  try {
    const inPath = join(dir, "in.bin");
    await writeFile(inPath, Buffer.from(audio));

    // 1) Transcodificar a mp3 16 kHz mono (headers limpios, tamaño chico)
    const mp3Path = join(dir, "full.mp3");
    await run(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", inPath,
      "-ar", "16000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k",
      mp3Path,
    ]);

    // 2) Trocear en segmentos de 10 min
    await run(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", mp3Path,
      "-f", "segment", "-segment_time", String(SEGMENT_SECONDS), "-c", "copy",
      join(dir, "seg_%03d.mp3"),
    ]);

    const segs = (await readdir(dir)).filter((f) => f.startsWith("seg_")).sort();
    if (segs.length === 0) throw new Error("ffmpeg no produjo segmentos");

    // 3) Transcribir cada trozo en orden y concatenar
    const parts: string[] = [];
    for (const seg of segs) {
      parts.push(await transcribeOne(join(dir, seg), openaiKey, language));
    }
    return { transcript: parts.join(" ").trim(), chunks: segs.length, durationSec: 0 };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
