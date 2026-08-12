// FishFlow — whisper-chunked
// ─────────────────────────────────────────────────────────────────────────────
// Transcribe audio LARGO de forma robusta. Resuelve el bug recurrente de
// TherapyOS con sesiones de ~45 min o más:
//
//   1. El webm de MediaRecorder no lleva duración en el header. Whisper lo lee
//      como "0 seconds" y devuelve HTTP 500 en archivos largos (los cortos
//      decodifican por casualidad). → Re-codificamos con ffmpeg a mp3 16 kHz
//      mono, que sí tiene headers válidos.
//   2. Un archivo largo en una sola llamada excede el timeout de la función.
//      → Troceamos en segmentos de 10 min y transcribimos cada uno.
//   3. Los trozos se transcribían EN SERIE: una sesión de 55 min tardaba 306 s
//      y se comía el presupuesto completo de la función (2026-07-15 y 2026-08-11).
//      → Ahora corren en paralelo con un tope de concurrencia, y se concatenan
//      en el orden original. ~5 min bajan a ~1.5 min.
//
// Corre en el runtime Node de Vercel (NO edge) porque usa el binario ffmpeg.
// Requiere la dependencia `ffmpeg-static`.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

// En Vercel, ffmpeg-static devuelve una ruta congelada en build ("/ROOT/...")
// que NO existe en runtime, aunque el binario SÍ se empaqueta bajo
// process.cwd() (/var/task). Resolvemos la ruta real probando candidatos.
function resolveFfmpeg(): string {
  const candidates = [
    ffmpegPath || "",
    join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    "/var/task/node_modules/ffmpeg-static/ffmpeg",
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`ffmpeg no encontrado. Probé: ${candidates.join(", ")}`);
}

const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const SEGMENT_SECONDS = 600; // 10 min por trozo
const MAX_PARALLEL = 4;      // trozos simultáneos contra Whisper
const MAX_ATTEMPTS = 3;      // reintentos por trozo ante 429 / 5xx

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function transcribeOne(
  filePath: string,
  openaiKey: string,
  language: string,
): Promise<string> {
  const buf = await readFile(filePath);
  let lastErr = "";

  // Al correr en paralelo sube la probabilidad de 429; reintentamos con espera.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: "audio/mpeg" }), "chunk.mp3");
    fd.append("model", "whisper-1");
    fd.append("language", language);
    const res = await fetch(WHISPER_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: fd,
    });
    if (res.ok) return ((await res.json()).text ?? "").trim();

    lastErr = `Whisper HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    const retriable = res.status === 429 || res.status >= 500;
    if (!retriable || attempt === MAX_ATTEMPTS) break;
    await sleep(2000 * attempt);
  }
  throw new Error(lastErr);
}

/** Ejecuta `fn` sobre `items` con un tope de tareas simultáneas, preservando el orden. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
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
  const startedAt = Date.now();
  const ffmpeg = resolveFfmpeg();
  // El binario traceado a veces pierde el bit de ejecución → chmod defensivo.
  try {
    await chmod(ffmpeg, 0o755);
  } catch {
    /* noop */
  }
  const dir = await mkdtemp(join(tmpdir(), "ffx-"));
  try {
    const inPath = join(dir, "in.bin");
    await writeFile(inPath, Buffer.from(audio));

    // 1) Transcodificar a mp3 16 kHz mono (headers limpios, tamaño chico)
    const mp3Path = join(dir, "full.mp3");
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", inPath,
      "-ar", "16000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k",
      mp3Path,
    ]);

    // 2) Trocear en segmentos de 10 min
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", mp3Path,
      "-f", "segment", "-segment_time", String(SEGMENT_SECONDS), "-c", "copy",
      join(dir, "seg_%03d.mp3"),
    ]);

    const segs = (await readdir(dir)).filter((f) => f.startsWith("seg_")).sort();
    if (segs.length === 0) throw new Error("ffmpeg no produjo segmentos");

    // 3) Transcribir los trozos en paralelo (tope MAX_PARALLEL) y concatenar
    //    en el orden original: mapWithConcurrency respeta el índice.
    const parts = await mapWithConcurrency(segs, MAX_PARALLEL, (seg) =>
      transcribeOne(join(dir, seg), openaiKey, language),
    );

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[whisper-chunked] ${segs.length} trozos en ${elapsed}s (paralelo ${MAX_PARALLEL})`);

    return { transcript: parts.join(" ").trim(), chunks: segs.length, durationSec: elapsed };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
