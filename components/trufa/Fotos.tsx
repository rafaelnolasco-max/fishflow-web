"use client";

import { useRef, useState } from "react";
import { subirFoto, borrarFoto } from "@/lib/trufaFotos";
import RecortarFoto from "@/components/trufa/RecortarFoto";

// ─── Trufa — fotos del carnet ─────────────────────────────────────────────────
// Dos piezas: el botón que sube y la tira que muestra. Se usan juntas dentro de
// una consulta y por separado en la sección de seguimiento de la mascota.

export type Foto = {
  id: string;
  storage_path: string;
  caption: string | null;
  taken_on: string;
  appointment_id: string | null;
};

type Tema = { accent: string; surface: string; border: string; text: string; muted: string; danger: string; panel?: string };

export function BotonSubirFoto({
  petId, clientId, appointmentId, onDone, theme: t, label = "Agregar foto",
}: {
  petId: string; clientId: string; appointmentId?: string | null;
  onDone: () => Promise<void> | void; theme: Tema; label?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progreso, setProgreso] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setBusy(true); setError("");
    try {
      let i = 0;
      for (const f of files) {
        i += 1;
        setProgreso(files.length > 1 ? `Subiendo ${i} de ${files.length}…` : "Subiendo…");
        await subirFoto({ file: f, petId, clientId, appointmentId });
      }
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir la foto.");
    } finally {
      setBusy(false);
      setProgreso("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        // `capture` a propósito NO se pone: el dueño casi siempre quiere una
        // foto que ya tomó, y forzar la cámara le esconde el carrete.
        onChange={onPick}
        style={{ display: "none" }}
      />
      <button onClick={() => inputRef.current?.click()} disabled={busy}
        style={{ background: "none", border: `1px dashed ${t.border}`, borderRadius: 9,
          padding: "8px 14px", fontSize: 13, fontWeight: 700, fontFamily: "inherit",
          color: busy ? t.muted : t.accent, cursor: busy ? "default" : "pointer" }}>
        {busy ? (progreso || "Subiendo…") : label}
      </button>
      {error && <div style={{ fontSize: 12.5, color: t.danger, marginTop: 6, lineHeight: 1.5 }}>{error}</div>}
    </div>
  );
}

export function TiraFotos({
  fotos, urls, onChanged, theme: t,
}: {
  fotos: Foto[]; urls: Record<string, string>;
  onChanged: () => Promise<void> | void; theme: Tema;
}) {
  const [abierta, setAbierta] = useState<Foto | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  if (fotos.length === 0) return null;

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {fotos.map(f => {
          const url = urls[f.storage_path];
          return (
            <button key={f.id} onClick={() => setAbierta(f)}
              style={{ width: 84, height: 84, borderRadius: 10, overflow: "hidden", padding: 0,
                border: `1px solid ${t.border}`, background: t.panel ?? t.surface, cursor: "pointer" }}>
              {url
                ? <img src={url} alt={f.caption ?? "Foto"} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                : <span style={{ fontSize: 11, color: t.muted }}>…</span>}
            </button>
          );
        })}
      </div>

      {abierta && (
        <div onClick={() => setAbierta(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(31,23,20,.88)", zIndex: 60,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: 20, gap: 16 }}>
          {urls[abierta.storage_path] && (
            <img src={urls[abierta.storage_path]} alt={abierta.caption ?? "Foto"}
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 12, display: "block" }} />
          )}
          <div onClick={(e) => e.stopPropagation()} style={{ textAlign: "center", color: "#F6F0E8" }}>
            <div style={{ fontSize: 14, marginBottom: 4 }}>{abierta.caption ?? "Sin nota"}</div>
            <div style={{ fontSize: 12.5, opacity: .7 }}>{abierta.taken_on}</div>
          </div>
          <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setAbierta(null)}
              style={{ padding: "10px 20px", borderRadius: 9, border: "1px solid rgba(246,240,232,.3)",
                background: "transparent", color: "#F6F0E8", fontSize: 14, cursor: "pointer" }}>
              Cerrar
            </button>
            <button
              disabled={borrando === abierta.id}
              onClick={async () => {
                setBorrando(abierta.id);
                try {
                  await borrarFoto(abierta.id, abierta.storage_path);
                  setAbierta(null);
                  await onChanged();
                } finally { setBorrando(null); }
              }}
              style={{ padding: "10px 20px", borderRadius: 9, border: "none",
                background: t.danger, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              {borrando === abierta.id ? "Borrando…" : "Borrar"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Portada del carnet: la foto de la mascota, grande y redonda, con su nombre.
 * Sin foto muestra la inicial — un hueco gris haría ver el carnet incompleto
 * desde el primer día.
 */
export function PortadaMascota({
  nombre, subtitulo, url, petId, onDone, theme: t,
}: {
  nombre: string; subtitulo: string; url: string | null; petId: string;
  onDone: () => Promise<void> | void; theme: Tema;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // La foto elegida espera aquí mientras la persona la encuadra.
  const [porRecortar, setPorRecortar] = useState<File | null>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setError("");
    setPorRecortar(file);
  }

  async function guardarRecorte(blob: Blob) {
    setBusy(true); setError("");
    try {
      const { subirFotoPerfil } = await import("@/lib/trufaFotos");
      await subirFotoPerfil(blob, petId);
      setPorRecortar(null);
      await onDone();
    } catch (err) {
      setPorRecortar(null);
      setError(err instanceof Error ? err.message : "No se pudo subir la foto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18, background: t.surface,
      border: `1px solid ${t.border}`, borderRadius: 14, padding: 20, marginBottom: 18 }}>
      <input ref={inputRef} type="file" accept="image/*" onChange={onPick} style={{ display: "none" }} />
      <button onClick={() => inputRef.current?.click()} disabled={busy}
        aria-label={url ? `Cambiar la foto de ${nombre}` : `Agregar una foto de ${nombre}`}
        style={{ width: 84, height: 84, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
          padding: 0, border: `2px solid ${t.border}`, background: t.panel ?? t.surface,
          cursor: busy ? "default" : "pointer", display: "grid", placeItems: "center" }}>
        {url
          ? <img src={url} alt={nombre} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <span style={{ font: "800 30px/1 -apple-system, sans-serif", color: t.accent }}>
              {nombre.slice(0, 1).toUpperCase()}
            </span>}
      </button>

      <div style={{ minWidth: 0 }}>
        <div style={{ font: "800 24px/1.15 'Plus Jakarta Sans', Inter, sans-serif",
          letterSpacing: "-.02em", color: t.text }}>{nombre}</div>
        <div style={{ fontSize: 14, color: t.muted, marginTop: 3 }}>{subtitulo}</div>
        <button onClick={() => inputRef.current?.click()} disabled={busy}
          style={{ background: "none", border: "none", padding: "6px 0 0", fontFamily: "inherit",
            fontSize: 12.5, fontWeight: 700, color: busy ? t.muted : t.accent,
            cursor: busy ? "default" : "pointer" }}>
          {busy ? "Subiendo…" : url ? "Cambiar foto" : "Agregar foto"}
        </button>
        {error && <div style={{ fontSize: 12.5, color: t.danger, marginTop: 4, lineHeight: 1.5 }}>{error}</div>}
      </div>

      {porRecortar && (
        <RecortarFoto
          file={porRecortar}
          onCancel={() => setPorRecortar(null)}
          onListo={guardarRecorte}
          theme={t}
        />
      )}
    </div>
  );
}
