"use client";

// ════════════════════════════════════════════════════════════════════════════
// FishFlow — SessionRecorder (GENÉRICO, agnóstico al cliente)
// ════════════════════════════════════════════════════════════════════════════
// Grabadora de un toque. NO es de TherapyOS: recibe { clientId, module, refId }
// por props, graba con el micrófono, sube a `audio/{clientId}/{module}/{refId}/`
// y avisa con onUploaded(). Cualquier cliente futuro (veterinario, coach…) lo
// monta pasando sus props, sin reescribir nada.
//
// ── Actualización 19-ago-2026 ───────────────────────────────────────────────
// Antes acumulaba TODOS los trozos en memoria y armaba el archivo hasta que le
// dabas "Detener": si iOS bloqueaba la pantalla a mitad de una sesión de 50
// minutos, se perdía la grabación COMPLETA. Ahora:
//   1. Wake Lock — la pantalla no se apaga sola mientras grabas, y se vuelve a
//      pedir al regresar a la pestaña (iOS lo suelta al ir a segundo plano).
//   2. Respaldo por trozos en IndexedDB cada 15 s — si algo mata la pestaña, lo
//      grabado se recupera al volver a abrir el panel.
//   3. Subida con barra de progreso real.
// También se retiró el tope de 25 MB: era el límite por archivo de Whisper,
// pero desde el fix de audios largos el servidor trocea la grabación en
// segmentos de 10 min (lib/whisper-chunked). Ya no hay que dividir la sesión
// en dos; el tope ahora es el del bucket, 200 MB.

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadAudioToPath, buildModuleAudioPath, MAX_AUDIO_BYTES } from "@/lib/uploadAudio";
import { backupChunk, clearBackup, markStart, readBackup, type PendingRecording } from "@/lib/recordingBackup";

type RecState = "idle" | "recording" | "uploading" | "done" | "error";

export interface RecorderResult {
  storagePath: string;
  filename: string;
  durationSeconds: number;
}

// Voz para transcripción NO necesita alta fidelidad. Whisper baja todo a 16kHz
// mono internamente, así que grabamos mono a bitrate bajo desde el origen.
// Esto mantiene archivos chicos: 32 kbps ≈ 9 MB / 40 min, ≈ 21 MB / 90 min.
const AUDIO_BITRATE = 32000; // bits/seg
const CHUNK_MS = 15_000;     // cada cuánto se respalda un trozo

function pickMime(): { mime: string; ext: string } {
  const candidates = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "mp4" }, // Safari / iOS
    { mime: "audio/aac", ext: "aac" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "", ext: "webm" };
}

export default function SessionRecorder({
  clientId,
  module,
  refId,
  disabled,
  onUploaded,
  accent = "#7A9E7E",
}: {
  clientId: string;
  module: string;
  refId?: string | null;
  disabled?: boolean;
  onUploaded: (r: RecorderResult) => Promise<void> | void;
  accent?: string;
}) {
  const [state, setState]   = useState<RecState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [pct, setPct]       = useState(0);
  const [error, setError]   = useState<string | null>(null);
  const [note, setNote]     = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRecording | null>(null);

  const mediaRef   = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const timerRef   = useRef<number | null>(null);
  const startedRef = useRef<number>(0);
  const extRef     = useRef<string>("webm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lockRef    = useRef<any>(null);

  // ── ¿Quedó una grabación a medias de la vez pasada? ────────────────────────
  useEffect(() => { void readBackup(module).then(setPending); }, [module]);

  // ── Wake Lock ─────────────────────────────────────────────────────────────
  const pedirLock = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      if (nav.wakeLock?.request) lockRef.current = await nav.wakeLock.request("screen");
    } catch {
      /* Safari viejo o pestaña en background: seguimos sin lock */
    }
  }, []);

  const soltarLock = useCallback(async () => {
    try { await lockRef.current?.release?.(); } catch { /* noop */ }
    lockRef.current = null;
  }, []);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && state === "recording") void pedirLock();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state, pedirLock]);

  // ── Subida ────────────────────────────────────────────────────────────────
  const subir = useCallback(async (blob: Blob, ext: string, duration: number) => {
    setState("uploading");
    setNote(null);
    setPct(0);
    try {
      if (blob.size > MAX_AUDIO_BYTES) {
        const mb = (blob.size / 1024 / 1024).toFixed(0);
        throw new Error(`La grabación pesa ${mb} MB y el máximo son 200 MB.`);
      }

      const { storagePath: path, filename } = buildModuleAudioPath(clientId, module, refId, ext);

      await uploadAudioToPath({
        blob,
        storagePath: path,
        onProgress: setPct,
        onRetry: (a, total) => setNote(`Reintentando subida (${a}/${total})…`),
      });

      await clearBackup();
      setPending(null);
      setNote(null);
      await onUploaded({ storagePath: path, filename, durationSeconds: duration });
      setState("done");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? String(e));
      setState("error");
    }
  }, [clientId, module, refId, onUploaded]);

  // ── Grabar ────────────────────────────────────────────────────────────────
  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const { mime, ext } = pickMime();
      extRef.current = ext;
      const opts: MediaRecorderOptions = { audioBitsPerSecond: AUDIO_BITRATE };
      if (mime) opts.mimeType = mime;
      const mr = new MediaRecorder(stream, opts);

      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        chunksRef.current.push(e.data);
        // Respaldo inmediato: esto es lo que se rescata si muere la pestaña.
        void backupChunk(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void soltarLock();
        const duration = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
        const type = chunksRef.current[0]?.type || mime || "audio/webm";
        void subir(new Blob(chunksRef.current, { type }), ext, duration);
      };

      // Arrancamos con el respaldo limpio: lo que quede ahí es de ESTA grabación.
      await clearBackup();
      await markStart(ext, module);

      mediaRef.current = mr;
      startedRef.current = Date.now();
      setSeconds(0);
      mr.start(CHUNK_MS); // trozos, no un solo blob al final
      setState("recording");
      void pedirLock();

      timerRef.current = window.setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedRef.current) / 1000));
      }, 1000);
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      setError(
        err?.name === "NotAllowedError"
          ? "Necesito permiso del micrófono para grabar."
          : `No se pudo iniciar la grabación: ${err?.message ?? String(e)}`,
      );
      setState("error");
    }
  }

  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRef.current?.stop();
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  // ── Rescate de una grabación interrumpida ─────────────────────────────────
  if (pending && (state === "idle" || state === "error")) {
    return (
      <div style={{ border: `1px solid ${accent}`, borderRadius: 12, padding: 16, width: "100%" }}>
        <strong style={{ display: "block", marginBottom: 6, fontSize: 14 }}>
          Quedó una grabación sin terminar
        </strong>
        <p style={{ fontSize: 12.5, color: "#7A7A72", lineHeight: 1.5, marginTop: 0 }}>
          Son unos {Math.max(1, Math.round(pending.seconds / 60))} minutos. Probablemente se bloqueó
          la pantalla o se cerró la pestaña. Puedes procesarla igual.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => { void clearBackup().then(() => setPending(null)); }}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #E5E4DF",
              background: "transparent", color: "#2C2C2C", fontSize: 13, cursor: "pointer" }}>
            Descartar
          </button>
          <button type="button"
            onClick={() => void subir(pending.blob, pending.ext, pending.seconds)}
            style={{ flex: 2, padding: "10px 0", borderRadius: 8, border: "none",
              background: accent, color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Recuperar y procesar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "10px 0" }}>
      {(state === "idle" || state === "error") && (
        <button
          type="button"
          onClick={start}
          disabled={disabled}
          style={{
            width: 96, height: 96, borderRadius: "50%", border: "none",
            background: disabled ? "#C9C9C2" : accent, color: "white",
            fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 4, boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
          }}
        >
          <span style={{ fontSize: 28 }}>🎙️</span>
          Grabar
        </button>
      )}

      {state === "recording" && (
        <>
          <div style={{ fontSize: 30, fontVariantNumeric: "tabular-nums", color: "#2C2C2C", fontWeight: 600 }}>
            <span style={{ color: "#D4726A", marginRight: 8 }}>●</span>{mmss}
          </div>
          <button
            type="button"
            onClick={stop}
            style={{
              padding: "12px 28px", borderRadius: 999, border: "none",
              background: "#D4726A", color: "white", fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}
          >
            ■ Detener y procesar
          </button>
          <p style={{ fontSize: 12, color: "#7A7A72", textAlign: "center", lineHeight: 1.5, maxWidth: 300 }}>
            Deja el equipo desbloqueado y esta pestaña al frente. Si se bloquea, el micrófono se corta —
            pero lo grabado hasta ese momento se guarda solo y lo recuperas al volver a entrar.
          </p>
        </>
      )}

      {state === "uploading" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          color: "#7A7A72", fontSize: 14, width: "100%", maxWidth: 300 }}>
          <span>{note ?? (pct < 100 ? `Subiendo… ${pct}%` : "Transcribiendo… esto puede tardar un poco.")}</span>
          <div style={{ height: 6, background: "#E5E4DF", borderRadius: 4, width: "100%", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: accent, transition: "width .2s" }} />
          </div>
        </div>
      )}

      {state === "done" && (
        <div style={{ color: "#4A6B4E", fontSize: 14, fontWeight: 500 }}>✓ Grabación procesada</div>
      )}

      {error && (
        <p style={{ color: "#D4726A", fontSize: 13, textAlign: "center" }}>{error}</p>
      )}
    </div>
  );
}
