"use client";

// ════════════════════════════════════════════════════════════════════════════
// FishFlow — SessionRecorder (GENÉRICO, agnóstico al cliente)
// ════════════════════════════════════════════════════════════════════════════
// Grabadora de un toque. NO es de TherapyOS: recibe { clientId, module, refId }
// por props, graba con el micrófono, sube a `audio/{clientId}/{module}/{refId}/`
// y avisa con onUploaded(). Cualquier cliente futuro (veterinario, coach…) lo
// monta pasando sus props, sin reescribir nada.

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

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
// Tope duro de Whisper (OpenAI) = 25 MB por archivo. Subimos directo a Storage,
// así que cortamos aquí antes de gastar una subida que de todos modos fallaría.
const MAX_BYTES = 25 * 1024 * 1024;
// iPad/Safari corta subidas de un solo intento ante cualquier hipo de red
// ("Load failed"). Reintentamos con espera creciente antes de rendirnos.
const UPLOAD_RETRIES = 3;
const isSizeError = (m: string) => /exceeded the maximum allowed size|maximum allowed size|payload too large/i.test(m);

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
  const [error, setError]   = useState<string | null>(null);
  const [note, setNote]     = useState<string | null>(null);

  const mediaRef   = useRef<MediaRecorder | null>(null);
  const chunksRef  = useRef<Blob[]>([]);
  const timerRef   = useRef<number | null>(null);
  const startedRef = useRef<number>(0);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const { mime } = pickMime();
      const opts: MediaRecorderOptions = { audioBitsPerSecond: AUDIO_BITRATE };
      if (mime) opts.mimeType = mime;
      const mr = new MediaRecorder(stream, opts);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); void upload(); };
      mediaRef.current = mr;
      startedRef.current = Date.now();
      setSeconds(0);
      mr.start();
      setState("recording");
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

  // Sube con reintentos. Safari/iPad lanza "Load failed" ante cortes de red;
  // un reintento con espera suele salvar la subida sin perder la grabación.
  async function uploadWithRetry(path: string, blob: Blob, type: string): Promise<void> {
    let lastMsg = "";
    for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
      if (attempt > 1) setNote(`Reintentando subida (${attempt}/${UPLOAD_RETRIES})…`);
      const { error: upErr } = await supabase.storage
        .from("audio")
        .upload(path, blob, { contentType: type, upsert: true });
      if (!upErr) { setNote(null); return; }
      lastMsg = upErr.message ?? "";
      if (isSizeError(lastMsg)) break;            // inútil reintentar si es por tamaño
      if (attempt < UPLOAD_RETRIES) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
    setNote(null);
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    if (isSizeError(lastMsg)) {
      throw new Error(
        `La grabación pesa ${mb} MB y supera el máximo que se puede transcribir. ` +
        `Para sesiones muy largas, divídela en dos grabaciones.`,
      );
    }
    throw new Error(
      `No se pudo subir la grabación (${mb} MB) tras varios intentos. ` +
      `Suele ser la conexión a internet: revisa tu señal y vuelve a intentar — la grabación sigue aquí.`,
    );
  }

  async function upload() {
    setState("uploading");
    setNote(null);
    try {
      const { ext } = pickMime();
      const type = chunksRef.current[0]?.type || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      const duration = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));

      // Guarda antes de gastar la subida: si el archivo se pasa del tope de
      // Whisper, avisamos con algo accionable en vez del error críptico de Storage.
      if (blob.size > MAX_BYTES) {
        const mb = (blob.size / 1024 / 1024).toFixed(0);
        const mins = Math.round(duration / 60);
        setError(
          `La grabación pesa ${mb} MB (${mins} min) y supera el máximo que se puede transcribir. ` +
          `Para sesiones muy largas, divídela en dos grabaciones más cortas.`,
        );
        setState("error");
        return;
      }

      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${ts}.${ext}`;
      const path = `${clientId}/${module}/${refId ?? "na"}/${filename}`;

      await uploadWithRetry(path, blob, type);

      await onUploaded({ storagePath: path, filename, durationSeconds: duration });
      setState("done");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? String(e));
      setState("error");
    }
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

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
          <p style={{ fontSize: 12, color: "#7A7A72" }}>Pon el teléfono sobre el escritorio. La grabación queda local hasta que detienes.</p>
        </>
      )}

      {state === "uploading" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "#7A7A72", fontSize: 14 }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block", fontSize: 22 }}>⟳</span>
          {note ?? "Subiendo y transcribiendo… esto puede tardar un poco."}
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
