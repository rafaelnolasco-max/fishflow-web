"use client";

import { useRef, useState } from "react";
import { uploadAudio, MAX_AUDIO_BYTES } from "@/lib/uploadAudio";

// ─── Therapy Flow — subir un audio ya grabado ─────────────────────────────────
// Alternativa al grabador de la app (components/AudioRecorder). Es el camino
// seguro cuando la sesión es larga: Notas de Voz sigue grabando con la pantalla
// bloqueada, cosa que ningún navegador en iOS puede hacer.

type Props = {
  clientId: string;
  patientId: string;
  maxMinutes: number;
  disabled?: boolean;
  onUploaded: (info: { storagePath: string; durationSeconds: number | null }) => Promise<void> | void;
  theme: { accent: string; surface: string; border: string; text: string; muted: string; danger: string };
};

/** Lee la duración del archivo sin subirlo, para no gastar la subida en balde. */
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

export default function AudioUpload({
  clientId, patientId, maxMinutes, disabled, onUploaded, theme: t,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "checking" | "uploading" | "processing" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");

  async function handleFile(file: File) {
    setMsg(""); setPct(0); setState("checking");

    if (file.size > MAX_AUDIO_BYTES) {
      setState("error");
      setMsg(
        "El archivo pasa de 200 MB. Suele ser que Notas de Voz está en calidad Sin comprimir: " +
        "cámbialo en Ajustes → Notas de Voz → Calidad de audio → Comprimida.",
      );
      return;
    }

    const duration = await readDuration(file);
    if (duration !== null && duration > maxMinutes * 60) {
      setState("error");
      setMsg(`La grabación dura ${Math.round(duration / 60)} minutos y el máximo son ${maxMinutes}.`);
      return;
    }
    if (duration !== null && duration < 60) {
      setState("error");
      setMsg("La grabación dura menos de un minuto. ¿Será el archivo correcto?");
      return;
    }

    try {
      setState("uploading");
      const ext = (file.name.split(".").pop() || "m4a");
      const { storagePath } = await uploadAudio({
        blob: file, ext, clientId, patientId,
        onProgress: setPct,
        onRetry: (a, total) => setMsg(`Se cortó la subida. Reintentando (${a} de ${total})…`),
      });
      setState("processing");
      setMsg("Subido. Estoy escuchando la sesión, esto tarda uno o dos minutos.");
      await onUploaded({ storagePath, durationSeconds: duration });
      setState("idle"); setMsg(""); setPct(0);
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "No se pudo procesar la sesión.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = state === "uploading" || state === "processing" || state === "checking";

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.m4a,.mp3,.wav,.aac,.webm"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />

      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy || disabled}
        style={{
          width: "100%", padding: "12px 0", borderRadius: 11,
          border: `1px solid ${t.border}`, background: "transparent",
          color: busy || disabled ? t.muted : t.text,
          fontSize: 14, fontWeight: 700, fontFamily: "inherit",
          cursor: busy || disabled ? "default" : "pointer",
        }}
      >
        {state === "uploading" ? `Subiendo… ${pct}%`
          : state === "processing" ? "Procesando la sesión…"
          : state === "checking" ? "Revisando el archivo…"
          : "Subir un audio que ya grabé"}
      </button>

      {state === "uploading" && (
        <div style={{ height: 5, background: t.border, borderRadius: 4, marginTop: 10, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: t.accent, transition: "width .2s" }} />
        </div>
      )}

      {msg && (
        <p style={{ fontSize: 13, marginTop: 11, marginBottom: 0, lineHeight: 1.5,
          color: state === "error" ? t.danger : t.muted }}>
          {msg}
        </p>
      )}

      {!busy && !msg && (
        <p style={{ fontSize: 12, color: t.muted, marginTop: 10, marginBottom: 0, lineHeight: 1.55, textAlign: "center" }}>
          Para sesiones largas: graba con Notas de Voz — sigue grabando con la pantalla apagada.
        </p>
      )}
    </div>
  );
}
