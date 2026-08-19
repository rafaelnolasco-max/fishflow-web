"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadAudio, pickAudioMime } from "@/lib/uploadAudio";
import { backupChunk, clearBackup, markStart, readBackup, type PendingRecording } from "@/lib/recordingBackup";

// ─── Therapy Flow — grabar la sesión desde la app ─────────────────────────────
// Grabar aquí es el camino cómodo; subir un archivo de Notas de Voz sigue
// existiendo como alternativa.
//
// Tres protecciones, porque el grabador web en iOS tiene un límite real:
// Safari suspende el micrófono cuando la pantalla se bloquea.
//   1. Wake Lock — la pantalla no se apaga sola mientras grabas (y se vuelve a
//      pedir al regresar a la pestaña, porque iOS lo suelta al ir a segundo plano).
//   2. Respaldo por trozos en IndexedDB cada 15 s — si algo mata la pestaña, lo
//      grabado hasta ese momento NO se pierde; se recupera al volver a abrir.
//   3. Aviso visible mientras corre el cronómetro.

const CHUNK_MS = 15_000;
const AUDIO_BITRATE = 64_000; // suficiente para voz; el servidor lo baja a 24 kbps

type State = "idle" | "recording" | "uploading" | "processing" | "error";

type Props = {
  clientId: string;
  patientId: string;
  maxMinutes: number;
  disabled?: boolean;
  disabledReason?: string;
  onUploaded: (info: { storagePath: string; durationSeconds: number | null }) => Promise<void> | void;
  theme: { accent: string; surface: string; border: string; text: string; muted: string; danger: string; panel?: string };
};

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function AudioRecorder({
  clientId, patientId, maxMinutes, disabled, disabledReason, onUploaded, theme: t,
}: Props) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState<PendingRecording | null>(null);

  const mrRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  const extRef = useRef("webm");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lockRef = useRef<any>(null);

  // ── Grabación interrumpida de una vez anterior ────────────────────────────
  useEffect(() => { void readBackup("terapia").then(setPending); }, []);

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

  // ── Subir ─────────────────────────────────────────────────────────────────
  const subir = useCallback(async (blob: Blob, ext: string, dur: number | null) => {
    setState("uploading"); setPct(0); setMsg("");
    try {
      const { storagePath } = await uploadAudio({
        blob, ext, clientId, patientId,
        onProgress: setPct,
        onRetry: (a, total) => setMsg(`Se cortó la subida. Reintentando (${a} de ${total})…`),
      });
      await clearBackup();
      setPending(null);
      setState("processing");
      setMsg("Subido. Estoy escuchando la sesión, esto tarda uno o dos minutos.");
      await onUploaded({ storagePath, durationSeconds: dur });
      setState("idle"); setMsg(""); setSeconds(0); setPct(0);
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "No se pudo subir la grabación.");
    }
  }, [clientId, patientId, onUploaded]);

  // ── Empezar / detener ─────────────────────────────────────────────────────
  async function empezar() {
    setMsg(""); setPct(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const { mime, ext } = pickAudioMime();
      extRef.current = ext;
      const opts: MediaRecorderOptions = { audioBitsPerSecond: AUDIO_BITRATE };
      if (mime) opts.mimeType = mime;

      const mr = new MediaRecorder(stream, opts);
      const trozos: Blob[] = [];

      mr.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        trozos.push(e.data);
        // Respaldo inmediato: si la pestaña muere, esto es lo que se rescata.
        void backupChunk(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        void soltarLock();
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        const dur = Math.round((Date.now() - startedRef.current) / 1000);
        const blob = new Blob(trozos, { type: mime || "audio/mp4" });
        if (dur < 60) {
          await clearBackup();
          setState("error");
          setMsg("La grabación duró menos de un minuto. ¿Seguro que era la sesión?");
          return;
        }
        await subir(blob, ext, dur);
      };

      // Arrancamos con el respaldo limpio: lo que quede ahí es de ESTA grabación.
      await clearBackup();
      await markStart(ext, "terapia");

      mrRef.current = mr;
      startedRef.current = Date.now();
      setSeconds(0);
      mr.start(CHUNK_MS); // trozos, NO un solo blob al final
      setState("recording");
      void pedirLock();

      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedRef.current) / 1000);
        setSeconds(s);
        if (s >= maxMinutes * 60) detener(); // tope duro de la cuenta
      }, 1000);
    } catch (e) {
      const err = e as { name?: string; message?: string };
      setState("error");
      setMsg(
        err?.name === "NotAllowedError"
          ? "Necesito permiso del micrófono. Actívalo en los ajustes del navegador y vuelve a intentar."
          : `No se pudo iniciar la grabación: ${err?.message ?? String(e)}`,
      );
    }
  }

  function detener() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mrRef.current?.stop();
  }

  const busy = state === "uploading" || state === "processing";
  const panel = t.panel ?? t.surface;

  // ── Rescate de una grabación interrumpida ─────────────────────────────────
  if (pending && state === "idle") {
    return (
      <div style={{ background: panel, border: `1px solid ${t.accent}`, borderRadius: 14, padding: 18 }}>
        <strong style={{ display: "block", marginBottom: 8, fontSize: 15 }}>
          Quedó una grabación sin terminar
        </strong>
        <p style={{ fontSize: 13.5, color: t.muted, lineHeight: 1.55, marginTop: 0 }}>
          Son unos {Math.max(1, Math.round(pending.seconds / 60))} minutos. Seguramente se bloqueó
          la pantalla o se cerró la app. Puedes procesarla igual.
        </p>
        <div style={{ display: "flex", gap: 9 }}>
          <button
            onClick={() => { void clearBackup().then(() => setPending(null)); }}
            style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: `1px solid ${t.border}`,
              background: "transparent", color: t.text, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
            Descartar
          </button>
          <button
            onClick={() => void subir(pending.blob, pending.ext, pending.seconds)}
            style={{ flex: 2, padding: "12px 0", borderRadius: 10, border: "none",
              background: t.accent, color: "#0D1B2A", fontSize: 14, fontWeight: 800,
              cursor: "pointer", fontFamily: "inherit" }}>
            Recuperarla y procesarla
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: t.surface, border: `1px solid ${state === "recording" ? t.accent : t.border}`,
      borderRadius: 14, padding: 18 }}>

      {state === "recording" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14 }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: t.danger,
              animation: "ffpulse 1.4s ease-in-out infinite" }} />
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>
              {mmss(seconds)}
            </span>
            <span style={{ fontSize: 12.5, color: t.muted, marginLeft: "auto" }}>
              máx {maxMinutes} min
            </span>
          </div>

          <button onClick={detener}
            style={{ width: "100%", padding: "14px 0", borderRadius: 11, border: "none",
              background: t.accent, color: "#0D1B2A", fontSize: 15, fontWeight: 800,
              cursor: "pointer", fontFamily: "inherit" }}>
            Terminar y procesar
          </button>

          <p style={{ fontSize: 12.5, color: t.muted, marginTop: 13, marginBottom: 0, lineHeight: 1.6 }}>
            Deja el teléfono desbloqueado y esta pantalla al frente. Si se bloquea, el micrófono se
            corta — pero lo grabado hasta ese momento se guarda solo y lo recuperas al volver a abrir.
          </p>
        </>
      ) : (
        <>
          <button onClick={empezar} disabled={busy || disabled}
            style={{ width: "100%", padding: "14px 0", borderRadius: 11, border: "none",
              background: busy || disabled ? "#41586F" : t.accent, color: "#0D1B2A",
              fontSize: 15, fontWeight: 800, fontFamily: "inherit",
              cursor: busy || disabled ? "default" : "pointer" }}>
            {state === "uploading" ? `Subiendo… ${pct}%`
              : state === "processing" ? "Procesando la sesión…"
              : "Grabar mi sesión"}
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
              color: state === "error" ? t.danger : t.muted }}>{msg}</p>
          )}

          {!busy && !msg && !disabled && (
            <p style={{ fontSize: 12.5, color: t.muted, marginTop: 12, marginBottom: 0, lineHeight: 1.6 }}>
              Dale antes de empezar la sesión y deja el teléfono desbloqueado, boca abajo, cerca de los dos.
            </p>
          )}
        </>
      )}

      <style>{`@keyframes ffpulse { 0%,100% { opacity: 1 } 50% { opacity: .25 } }`}</style>
    </div>
  );
}
