"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadAudioToPath, buildModuleAudioPath, pickAudioMime } from "@/lib/uploadAudio";
import { backupChunk, clearBackup, markStart, readBackup, type PendingRecording } from "@/lib/recordingBackup";

// ─── Trufa — grabar la consulta con el veterinario ────────────────────────────
// Hermano del grabador de Therapy Flow, no el mismo: aquí la grabación dura 10
// minutos y no 50, el piso de "esto no fue una consulta" es otro, y el respaldo
// usa su propio scope para que nadie vea en Trufa la sesión de terapia que dejó
// a medias en el mismo navegador.
//
// Las tres protecciones de iOS sí son las mismas, porque el problema es el
// mismo: Safari suspende el micrófono al bloquear la pantalla.
//   1. Wake Lock, y se vuelve a pedir al regresar a la pestaña.
//   2. Respaldo por trozos en IndexedDB cada 15 s.
//   3. Aviso visible mientras corre el cronómetro.

const CHUNK_MS = 15_000;
const AUDIO_BITRATE = 64_000;
const SCOPE = "trufa";
const MIN_SECONDS = 20;

type State = "idle" | "recording" | "uploading" | "processing" | "error";

type Props = {
  petId: string;
  maxMinutes?: number;
  onSaved: () => Promise<void> | void;
  theme: { accent: string; surface: string; border: string; text: string; muted: string; danger: string; panel?: string };
};

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function ConsultaRecorder({ petId, maxMinutes = 45, onSaved, theme: t }: Props) {
  const [state, setState] = useState<State>("idle");
  const [seconds, setSeconds] = useState(0);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [motivo, setMotivo] = useState("");
  const [vetName, setVetName] = useState("");
  const [pending, setPending] = useState<PendingRecording | null>(null);

  const mrRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lockRef = useRef<any>(null);

  useEffect(() => { void readBackup(SCOPE).then(setPending); }, []);

  const pedirLock = useCallback(async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nav = navigator as any;
      if (nav.wakeLock?.request) lockRef.current = await nav.wakeLock.request("screen");
    } catch { /* Safari viejo o pestaña en segundo plano */ }
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

  const subir = useCallback(async (blob: Blob, ext: string, dur: number | null) => {
    setState("uploading"); setPct(0); setMsg("");
    try {
      // La carpeta raíz es la MASCOTA, no el cliente: la política de Storage de
      // Trufa valida propiedad con user_owns_pet(), porque un suscriptor no
      // tiene user_client_access al cliente 'trufa'.
      const { storagePath, filename } = buildModuleAudioPath(petId, SCOPE, null, ext);
      await uploadAudioToPath({
        blob, storagePath,
        onProgress: setPct,
        onRetry: (a, total) => setMsg(`Se cortó la subida. Reintentando (${a} de ${total})…`),
      });
      await clearBackup();
      setPending(null);

      setState("processing");
      setMsg("Listo. Estoy escuchando la consulta, esto tarda un par de minutos.");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Se cerró tu sesión. Vuelve a entrar.");

      const res = await fetch("/api/trufa/consulta", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          pet_id: petId, storage_path: storagePath, filename,
          duration_seconds: dur, motivo: motivo.trim() || undefined,
          vet_name: vetName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo procesar la consulta.");

      setState("idle"); setMsg(""); setSeconds(0); setPct(0);
      setMotivo(""); setVetName("");
      await onSaved();
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : "No se pudo guardar la consulta.");
    }
  }, [petId, motivo, vetName, onSaved]);

  function detener() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mrRef.current?.stop();
  }

  async function empezar() {
    setMsg(""); setPct(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const { mime, ext } = pickAudioMime();
      const opts: MediaRecorderOptions = { audioBitsPerSecond: AUDIO_BITRATE };
      if (mime) opts.mimeType = mime;

      const mr = new MediaRecorder(stream, opts);
      const trozos: Blob[] = [];

      mr.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        trozos.push(e.data);
        void backupChunk(e.data);
      };

      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        void soltarLock();
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        const dur = Math.round((Date.now() - startedRef.current) / 1000);
        const blob = new Blob(trozos, { type: mime || "audio/mp4" });
        if (dur < MIN_SECONDS) {
          await clearBackup();
          setState("error");
          setMsg(`La grabación duró ${dur} segundos. Necesito al menos ${MIN_SECONDS} para sacar algo útil.`);
          return;
        }
        await subir(blob, ext, dur);
      };

      await clearBackup();
      await markStart(ext, SCOPE);

      mrRef.current = mr;
      startedRef.current = Date.now();
      setSeconds(0);
      mr.start(CHUNK_MS);
      setState("recording");
      void pedirLock();

      timerRef.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - startedRef.current) / 1000);
        setSeconds(s);
        if (s >= maxMinutes * 60) detener();
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

  const panel = t.panel ?? t.surface;
  const busy = state === "uploading" || state === "processing";

  const inp: React.CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 9, border: `1px solid ${t.border}`,
    fontSize: 14, fontFamily: "inherit", background: t.surface, color: t.text,
  };

  // ── Rescate de una grabación que se cortó ─────────────────────────────────
  if (pending && state === "idle") {
    return (
      <div style={{ background: panel, border: `1px solid ${t.accent}`, borderRadius: 14, padding: 18 }}>
        <strong style={{ display: "block", marginBottom: 8, fontSize: 15 }}>
          Quedó una consulta a medio grabar
        </strong>
        <p style={{ fontSize: 13.5, color: t.muted, lineHeight: 1.55, margin: "0 0 14px" }}>
          Son unos {mmss(pending.seconds)} de audio que se alcanzaron a guardar antes de que
          se cerrara la app. Puedes procesarlos o descartarlos.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void subir(pending.blob, pending.ext, pending.seconds)}
            style={{ flexGrow: 1, padding: "11px 0", borderRadius: 10, border: "none",
              background: t.accent, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Procesar lo que se grabó
          </button>
          <button onClick={() => { void clearBackup(); setPending(null); }}
            style={{ padding: "11px 16px", borderRadius: 10, border: `1px solid ${t.border}`,
              background: "transparent", color: t.muted, fontSize: 14, cursor: "pointer" }}>
            Descartar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: panel, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18 }}>
      {state === "idle" && (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: t.muted, display: "block", marginBottom: 5 }}>
              ¿Por qué van? (opcional)
            </label>
            <input style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)}
              placeholder="Se rasca mucho, revisión de rutina…" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: t.muted, display: "block", marginBottom: 5 }}>
              Veterinario (opcional)
            </label>
            <input style={inp} value={vetName} onChange={(e) => setVetName(e.target.value)}
              placeholder="Dra. …" />
          </div>
          <button onClick={() => void empezar()}
            style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: "none",
              background: t.accent, color: "#fff", fontSize: 15, fontWeight: 800, cursor: "pointer" }}>
            Grabar la consulta
          </button>
          <p style={{ fontSize: 12.5, color: t.muted, lineHeight: 1.55, margin: "12px 0 0" }}>
            Avísale al veterinario que vas a grabar. Deja el teléfono cerca de él, con la
            pantalla encendida.
          </p>
        </>
      )}

      {state === "recording" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span style={{ width: 11, height: 11, borderRadius: "50%", background: t.danger }} />
            <span style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: t.text }}>
              {mmss(seconds)}
            </span>
          </div>
          <button onClick={detener}
            style={{ width: "100%", padding: "13px 0", borderRadius: 10, border: `1px solid ${t.border}`,
              background: t.surface, color: t.text, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
            Terminar y guardar
          </button>
          <p style={{ fontSize: 12.5, color: t.muted, lineHeight: 1.55, margin: "12px 0 0" }}>
            No cierres la app ni bloquees la pantalla. Si algo la cierra, lo grabado hasta
            ese momento se recupera al volver a abrir.
          </p>
        </>
      )}

      {busy && (
        <>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
            {state === "uploading" ? `Subiendo… ${pct}%` : "Escuchando la consulta…"}
          </div>
          <div style={{ height: 6, borderRadius: 999, background: t.border, overflow: "hidden" }}>
            <div style={{ height: "100%", width: state === "uploading" ? `${pct}%` : "100%",
              background: t.accent, transition: "width .2s" }} />
          </div>
          {msg && <p style={{ fontSize: 13, color: t.muted, lineHeight: 1.55, margin: "12px 0 0" }}>{msg}</p>}
        </>
      )}

      {state === "error" && (
        <>
          <p style={{ fontSize: 14, color: t.danger, lineHeight: 1.55, margin: "0 0 14px" }}>{msg}</p>
          <button onClick={() => { setState("idle"); setMsg(""); }}
            style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: `1px solid ${t.border}`,
              background: "transparent", color: t.text, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Intentar de nuevo
          </button>
        </>
      )}
    </div>
  );
}
