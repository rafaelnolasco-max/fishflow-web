"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// ─── Therapy Flow — subida del audio de la sesión ─────────────────────────────
// El flujo primario es SUBIR un archivo ya grabado, no grabar en el navegador:
// en iOS Safari suspende el micrófono en cuanto se bloquea la pantalla, así que
// una sesión de 50 minutos grabada en la web se pierde. Notas de Voz sí graba
// con la pantalla apagada.
//
// La subida va directo a Storage con XHR para poder pintar progreso real. Una
// sesión de una hora pesa ~28 MB y en datos móviles eso son varios minutos: sin
// barra, el usuario cree que se trabó y cierra la app. Reintenta hasta 3 veces.

const MAX_BYTES = 200 * 1024 * 1024; // el bucket topa en 200 MB

type Props = {
  clientId: string;
  patientId: string;
  maxMinutes: number;
  disabled?: boolean;
  disabledReason?: string;
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

function uploadWithProgress(
  url: string, token: string, file: File, onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Storage HTTP ${xhr.status}: ${String(xhr.responseText).slice(0, 200)}`));
    xhr.onerror = () => reject(new Error("Se cortó la conexión durante la subida"));
    xhr.send(file);
  });
}

export default function AudioUpload({
  clientId, patientId, maxMinutes, disabled, disabledReason, onUploaded, theme: t,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "checking" | "uploading" | "processing" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");

  async function handleFile(file: File) {
    setMsg(""); setPct(0); setState("checking");

    if (file.size > MAX_BYTES) {
      setState("error");
      setMsg(
        "El archivo pasa de 200 MB. Suele ser que Notas de Voz está en calidad Sin comprimir: " +
        "cámbialo en Ajustes → Notas de Voz → Calidad de audio → Comprimida y vuelve a grabar.",
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

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setState("error"); setMsg("Tu sesión expiró. Vuelve a entrar."); return; }

    // La política de Storage valida que la primera carpeta sea un client_id
    // al que el usuario tenga acceso.
    const ext = (file.name.split(".").pop() || "m4a").toLowerCase().slice(0, 5);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const storagePath = `${clientId}/therapy_self/${patientId}/${stamp}.${ext}`;
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/audio/${storagePath}`;

    setState("uploading");
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await uploadWithProgress(url, session.access_token, file, setPct);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        setMsg(`Se cortó la subida. Reintentando (${attempt} de 3)…`);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (lastErr) {
      setState("error");
      setMsg("No se pudo subir el archivo. Revisa tu conexión e intenta otra vez.");
      return;
    }

    setState("processing");
    setMsg("Subido. Estoy escuchando la sesión, esto tarda uno o dos minutos.");
    try {
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
    <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18 }}>
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
          width: "100%", padding: "14px 0", borderRadius: 11, border: "none",
          background: busy || disabled ? "#41586F" : t.accent,
          color: "#0D1B2A", fontSize: 15, fontWeight: 800,
          cursor: busy || disabled ? "default" : "pointer",
        }}
      >
        {state === "uploading" ? `Subiendo… ${pct}%`
          : state === "processing" ? "Procesando la sesión…"
          : state === "checking" ? "Revisando el archivo…"
          : "Subir el audio de mi sesión"}
      </button>

      {state === "uploading" && (
        <div style={{ height: 6, background: t.border, borderRadius: 4, marginTop: 12, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: t.accent, transition: "width .2s" }} />
        </div>
      )}

      {disabled && disabledReason && !msg && (
        <p style={{ fontSize: 13, color: t.muted, marginTop: 12, marginBottom: 0, lineHeight: 1.5 }}>
          {disabledReason}
        </p>
      )}

      {msg && (
        <p style={{ fontSize: 13, marginTop: 12, marginBottom: 0, lineHeight: 1.5,
          color: state === "error" ? t.danger : t.muted }}>
          {msg}
        </p>
      )}

      {!busy && !msg && !disabled && (
        <p style={{ fontSize: 12.5, color: t.muted, marginTop: 12, marginBottom: 0, lineHeight: 1.55 }}>
          Grábala con Notas de Voz — sigue grabando con la pantalla apagada. Al terminar,
          compártela aquí. El audio se borra en cuanto se transcribe.
        </p>
      )}
    </div>
  );
}
