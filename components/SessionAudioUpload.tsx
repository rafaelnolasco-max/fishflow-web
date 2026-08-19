"use client";

// ════════════════════════════════════════════════════════════════════════════
// FishFlow — SessionAudioUpload (GENÉRICO, agnóstico al cliente)
// ════════════════════════════════════════════════════════════════════════════
// Hermano de components/SessionRecorder: en vez de grabar con el micrófono del
// navegador, recibe un archivo que la persona YA grabó (Notas de Voz de Apple,
// una grabadora de Android, un audio de WhatsApp) y lo sube a la MISMA carpeta
// de Storage. Quien lo monta recibe el mismo `RecorderResult`, así que el
// backend no cambia: el flujo sigue siendo `/api/therapyos/record-session`.
//
// ── Por qué existe (19-ago-2026) ────────────────────────────────────────────
// Mario grabó una sesión y la app dijo "no se detectó voz". El diagnóstico:
// el micrófono que veía el navegador captaba a −32 dB (voz al otro lado del
// cuarto) y se cortó en seco al segundo 26 — patrón de Micrófono de
// Continuidad perdiendo el iPhone cuando Notas de Voz reclama el micro en
// exclusiva. La grabación buena estaba en Notas de Voz todo ese tiempo.
//
// Grabar en la app tiene fallas que NO dependen de nosotros: iOS suelta el
// micrófono al bloquear la pantalla, Continuity se cae, otra app se lo roba.
// Notas de Voz no tiene ninguna: sigue grabando con la pantalla apagada. Por
// eso este camino no es un plan B, es el camino confiable para sesiones largas.
//
// ⚠️ Confirmación en dos pasos a propósito: el usuario elige el archivo, ve
// nombre y duración, y RECIÉN ENTONCES sube. Un audio de sesión son ~50 min
// por datos móviles; subir el archivo equivocado cuesta demasiado.

import { useRef, useState } from "react";
import { uploadAudioToPath, buildModuleAudioPath, MAX_AUDIO_BYTES } from "@/lib/uploadAudio";
import type { RecorderResult } from "@/components/SessionRecorder";

type Picked = { file: File; seconds: number | null };

// Por debajo de esto casi siempre es el archivo equivocado (un audio de
// WhatsApp, una nota de voz suelta), no una sesión.
const MIN_SECONDS = 20;

/** Lee la duración sin subir el archivo, para no gastar la subida en balde. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("audio");
    el.preload = "metadata";
    const done = (v: number | null) => { URL.revokeObjectURL(url); resolve(v); };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration) : null);
    el.onerror = () => done(null);
    el.src = url;
    // Safari a veces no dispara ninguno de los dos: no bloqueamos por eso.
    window.setTimeout(() => done(null), 6000);
  });
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")} min`;
}

export default function SessionAudioUpload({
  clientId,
  module,
  refId,
  disabled,
  onUploaded,
  accent = "#7A9E7E",
  border = "#E0DDD5",
  muted = "#7A7A72",
  text = "#2C2C2C",
  danger = "#D4726A",
}: {
  clientId: string;
  module: string;
  refId?: string | null;
  disabled?: boolean;
  onUploaded: (r: RecorderResult) => Promise<void> | void;
  accent?: string;
  border?: string;
  muted?: string;
  text?: string;
  danger?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "checking" | "ready" | "uploading" | "processing" | "done" | "error">("idle");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");

  function fail(m: string) {
    setState("error");
    setMsg(m);
    setPicked(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handlePick(file: File) {
    setMsg(""); setPct(0); setState("checking");

    if (file.size > MAX_AUDIO_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(0);
      fail(
        `El archivo pesa ${mb} MB y el máximo son 200 MB. Si viene de Notas de Voz, ` +
        "cámbialo a calidad Comprimida en Ajustes → Notas de Voz → Calidad de audio " +
        "y vuelve a exportarlo.",
      );
      return;
    }

    const seconds = await readDuration(file);
    if (seconds !== null && seconds < MIN_SECONDS) {
      fail(`Ese archivo dura ${seconds} segundos. ¿Será el audio correcto de la sesión?`);
      return;
    }

    setPicked({ file, seconds });
    setState("ready");
  }

  async function handleUpload() {
    if (!picked) return;
    const { file, seconds } = picked;
    setMsg(""); setPct(0); setState("uploading");

    try {
      const ext = (file.name.split(".").pop() || "m4a").toLowerCase();
      const { storagePath, filename } = buildModuleAudioPath(clientId, module, refId, ext);

      await uploadAudioToPath({
        blob: file,
        storagePath,
        onProgress: setPct,
        onRetry: (a, total) => setMsg(`Se cortó la subida. Reintentando (${a} de ${total})…`),
      });

      setState("processing");
      setMsg("");
      await onUploaded({
        storagePath,
        filename,
        // El backend rechaza menos de 3 s; si no pudimos leer la duración
        // mandamos 0 y dejamos que decida el servidor con el audio real.
        durationSeconds: seconds ?? 0,
      });

      setState("done");
      setPicked(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (e) {
      fail(e instanceof Error ? e.message : "No se pudo subir el audio.");
    }
  }

  const busy = state === "uploading" || state === "processing" || state === "checking";
  const bloqueado = busy || disabled;

  return (
    <div style={{ width: "100%" }}>
      <input
        ref={inputRef}
        type="file"
        // Lista explícita además de audio/*: en iOS, `audio/*` a secas esconde
        // el botón de Archivos, que es justo de donde sale Notas de Voz.
        accept="audio/*,.m4a,.mp3,.wav,.aac,.webm,.mp4,.caf"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePick(f); }}
      />

      {/* ── Paso 1: elegir ─────────────────────────────────────────────────── */}
      {(state === "idle" || state === "error" || state === "done" || state === "checking") && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={bloqueado}
          style={{
            width: "100%", padding: "14px 0", borderRadius: 11,
            border: `1px dashed ${bloqueado ? border : accent}`,
            background: "transparent",
            color: bloqueado ? muted : accent,
            fontSize: 14, fontWeight: 600, fontFamily: "inherit",
            cursor: bloqueado ? "default" : "pointer",
          }}
        >
          {state === "checking" ? "Revisando el archivo…" : "Elegir archivo de audio"}
        </button>
      )}

      {/* ── Paso 2: confirmar ──────────────────────────────────────────────── */}
      {state === "ready" && picked && (
        <div style={{ border: `1px solid ${border}`, borderRadius: 11, padding: "14px 16px" }}>
          <p style={{ fontSize: 13, color: text, margin: 0, fontWeight: 600, wordBreak: "break-all" }}>
            {picked.file.name}
          </p>
          <p style={{ fontSize: 12, color: muted, margin: "4px 0 12px" }}>
            {picked.seconds !== null ? `${mmss(picked.seconds)} · ` : ""}
            {(picked.file.size / 1024 / 1024).toFixed(1)} MB
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => { setPicked(null); setState("idle"); if (inputRef.current) inputRef.current.value = ""; }}
              style={{
                flex: 1, padding: "10px 0", borderRadius: 8, border: `1px solid ${border}`,
                background: "transparent", color: text, fontSize: 13, fontFamily: "inherit", cursor: "pointer",
              }}
            >
              Cambiar
            </button>
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={disabled}
              style={{
                flex: 2, padding: "10px 0", borderRadius: 8, border: "none",
                background: accent, color: "white", fontSize: 13, fontWeight: 600,
                fontFamily: "inherit", cursor: "pointer",
              }}
            >
              Subir y procesar
            </button>
          </div>
        </div>
      )}

      {/* ── Progreso ───────────────────────────────────────────────────────── */}
      {(state === "uploading" || state === "processing") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, color: muted }}>
            {msg || (state === "uploading" ? `Subiendo… ${pct}%` : "Transcribiendo la sesión. Tarda uno o dos minutos.")}
          </span>
          <div style={{ height: 6, background: border, borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              width: state === "processing" ? "100%" : `${pct}%`,
              height: "100%", background: accent, transition: "width .2s",
              opacity: state === "processing" ? 0.5 : 1,
            }} />
          </div>
          <span style={{ fontSize: 11, color: muted, lineHeight: 1.5 }}>
            No cierres esta pestaña hasta que aparezca el borrador.
          </span>
        </div>
      )}

      {state === "error" && msg && (
        <p style={{ color: danger, fontSize: 13, marginTop: 10, marginBottom: 0, lineHeight: 1.5 }}>{msg}</p>
      )}

      {(state === "idle" || state === "done") && (
        <div style={{ fontSize: 11.5, color: muted, marginTop: 12, lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 6px" }}>
            <strong style={{ color: text }}>Desde el iPhone:</strong> abre Notas de Voz, toca la grabación,
            botón compartir → Guardar en Archivos. Luego elígela aquí.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: text }}>Desde la Mac:</strong> en Notas de Voz arrastra la grabación
            al escritorio y elígela aquí.
          </p>
        </div>
      )}
    </div>
  );
}
