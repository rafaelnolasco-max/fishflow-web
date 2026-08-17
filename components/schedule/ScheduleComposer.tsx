"use client";

/**
 * Alta de una publicación programada. Un solo paso: imagen, texto, destino,
 * hora, y ya quedó.
 *
 * Es a propósito lo contrario de la pestaña de Contenido. Allá la IA propone y
 * hay un vaivén de borrador → aprobado porque el texto no lo escribió una
 * persona. Aquí el texto y la imagen ya son de la clienta: pedirle que apruebe
 * lo que ella misma acaba de escribir sería un trámite inventado.
 *
 * La IA queda de ayudante opcional, detrás de dos botones que nadie está
 * obligado a tocar.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Modal, Field, SaveBtn, inputStyle as mkInput, type DashTheme } from "@/components/dashboard";
import CarouselUploader, { type CarouselItem } from "@/components/schedule/CarouselUploader";
import {
  countHashtags,
  describeCadence,
  formatCdmx,
  INSTAGRAM_HASHTAG_LIMIT,
  suggestSlot,
  type SocialTarget,
} from "@/lib/socialTargets";

/** Instantes ya ocupados por destino, para que la sugerencia no repita hueco. */
export type TakenSlots = Record<string, string[]>;

export default function ScheduleComposer({
  clientId, targets, taken, theme: t, suggestFormat = "reflexion", onDone, onClose,
}: {
  clientId: string;
  targets: SocialTarget[];
  taken: TakenSlots;
  theme: DashTheme;
  /** Formato con el que se le pide el borrador a la IA. Ver /api/content/draft. */
  suggestFormat?: string;
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const input = useMemo(() => mkInput(t), [t]);

  // Agrupa en el bucket las imágenes de ESTA publicación. Se fija una vez: si se
  // recalculara en cada render, cada imagen caería en una carpeta distinta.
  const batchId = useRef(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  ).current;

  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? "");
  const [items, setItems] = useState<CarouselItem[]>([]);
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState<null | "texto" | "hashtags">(null);

  // Cuando la clienta escribe su propia fecha, dejamos de sugerirle: cambiar de
  // destino no debe borrarle lo que ya decidió.
  const [fechaTocada, setFechaTocada] = useState(false);

  const target = useMemo(
    () => targets.find((x) => x.key === targetKey) ?? targets[0],
    [targets, targetKey],
  );

  // ── Fecha sugerida ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!target || fechaTocada) return;
    const slot = suggestSlot(target, new Date(), taken[target.key] ?? []);
    setDate(slot.date);
    setTime(slot.time);
  }, [target, fechaTocada, taken]);

  // ── Ayuda de la IA (opcional) ───────────────────────────────────────────────
  const sugerir = useCallback(async (que: "texto" | "hashtags") => {
    const tema = caption.trim();
    if (!tema) {
      setError(
        que === "texto"
          ? "Escribe primero una idea corta de qué quieres decir y yo la desarrollo."
          : "Escribe primero el texto para sacar los hashtags de ahí.",
      );
      return;
    }

    setSuggesting(que);
    setError(null);
    // Tope del lado del navegador: sin esto el botón se queda en "Escribiendo…"
    // para siempre si la petición se cuelga.
    const ctrl = new AbortController();
    const corte = setTimeout(() => ctrl.abort(), 50_000);
    try {
      const res = await fetch("/api/content/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, format: suggestFormat, topic: tema }),
        signal: ctrl.signal,
      });
      const cuerpo = await res.text();
      let json: { error?: string; caption?: string; hashtags?: string };
      try {
        json = JSON.parse(cuerpo);
      } catch {
        throw new Error(
          res.ok
            ? "La respuesta llegó incompleta. Intenta de nuevo."
            : `El servidor respondió con un error (${res.status}). Intenta de nuevo.`,
        );
      }
      if (!res.ok) throw new Error(json?.error ?? "No se pudo generar.");

      if (que === "texto") {
        if (json.caption) setCaption(json.caption);
        // Los hashtags solo se rellenan si estaban vacíos: no se pisa lo que
        // la clienta ya escribió a mano.
        if (json.hashtags && !hashtags.trim()) setHashtags(json.hashtags);
      } else if (json.hashtags) {
        setHashtags(json.hashtags);
      }
    } catch (e: unknown) {
      const abortada = e instanceof DOMException && e.name === "AbortError";
      setError(
        abortada
          ? "Se tardó demasiado y cancelamos la espera. Vuelve a intentar."
          : e instanceof Error ? e.message : "No se pudo generar.",
      );
    } finally {
      clearTimeout(corte);
      setSuggesting(null);
    }
  }, [caption, hashtags, clientId, suggestFormat]);

  // ── Programar ───────────────────────────────────────────────────────────────
  async function programar() {
    if (!target) return;
    if (items.length === 0) {
      setError("Sube al menos una imagen.");
      return;
    }
    if (!caption.trim() && !hashtags.trim()) {
      setError("Escribe el texto de la publicación.");
      return;
    }
    if (!date || !time) {
      setError("Escoge el día y la hora.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/content/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          targetKey: target.key,
          caption: caption.trim(),
          hashtags: hashtags.trim(),
          mediaPaths: items.map((i) => i.path),
          mediaUrls: items.map((i) => i.url),
          date,
          time,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "No se pudo programar.");

      onDone(
        json.warning
          ? String(json.warning)
          : `Programada para el ${formatCdmx(json.scheduledTime)} en ${target.label}`,
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "No se pudo programar.");
      setSaving(false);
    }
  }

  /** Cerrar sin programar: se limpian del bucket las imágenes que ya subió. */
  function cancelar() {
    if (items.length > 0 && !confirm("¿Descartar esta publicación? Se pierden las imágenes que subiste.")) {
      return;
    }
    if (items.length > 0) {
      supabase.storage
        .from("content-media")
        .remove(items.map((i) => i.path))
        .then(({ error: rmErr }) => {
          if (rmErr) console.warn("[ScheduleComposer] no se pudo limpiar:", rmErr);
        });
    }
    onClose();
  }

  const nTags = countHashtags(hashtags);
  const exceso = target?.platform === "instagram" && nTags > INSTAGRAM_HASHTAG_LIMIT;
  const cadencia = target ? describeCadence(target) : "";

  const chipBtn = (activo: boolean): React.CSSProperties => ({
    flex: "1 1 130px",
    background: activo ? t.accentSoft : "none",
    border: `1.5px solid ${activo ? t.accent : t.border}`,
    borderRadius: 10, padding: "10px 12px", cursor: "pointer",
    textAlign: "left", color: t.text, fontFamily: "inherit",
  });

  const ghostBtn: React.CSSProperties = {
    background: "none", border: `1px solid ${t.border}`, borderRadius: 8,
    padding: "6px 12px", fontSize: 12, fontWeight: 600, color: t.accentDark,
    cursor: "pointer", whiteSpace: "nowrap",
  };

  return (
    <Modal title="Nueva publicación programada" onClose={cancelar} theme={t} wide>
      {error && (
        <div style={{
          background: "#FEF2F2", border: `1px solid ${t.danger}`, color: t.danger,
          borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 14, lineHeight: 1.5,
        }}>
          {error}
        </div>
      )}

      <Field label="Imágenes" theme={t}>
        <CarouselUploader
          clientId={clientId}
          batchId={batchId}
          items={items}
          onChange={(next) => { setItems(next); setError(null); }}
          theme={t}
          onError={setError}
        />
      </Field>

      <Field label="Texto de la publicación" theme={t}>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={8}
          placeholder="Escribe aquí tu publicación tal como quieres que se lea."
          style={{ ...input, resize: "vertical", lineHeight: 1.6 }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => sugerir("texto")}
            disabled={suggesting !== null}
            style={{ ...ghostBtn, opacity: suggesting !== null ? 0.6 : 1 }}
          >
            {suggesting === "texto" ? "Escribiendo…" : "✨ Sugerir texto"}
          </button>
          <span style={{ fontSize: 11.5, color: t.muted, lineHeight: 1.5, flex: "1 1 180px" }}>
            Opcional. Escribe una idea corta y la desarrollo con tu voz. Puedes ignorar este botón.
          </span>
        </div>
      </Field>

      <Field label="Hashtags" theme={t}>
        <input
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          placeholder="#psicología #bienestar"
          style={input}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => sugerir("hashtags")}
            disabled={suggesting !== null}
            style={{ ...ghostBtn, opacity: suggesting !== null ? 0.6 : 1 }}
          >
            {suggesting === "hashtags" ? "Pensando…" : "✨ Sugerir hashtags"}
          </button>
          <span style={{ fontSize: 11.5, color: t.muted }}>
            {nTags === 0 ? "Sin hashtags" : `${nTags} hashtag${nTags !== 1 ? "s" : ""}`}
          </span>
        </div>
        {exceso && (
          <div style={{
            fontSize: 12, color: "#92400E", background: "#FFFBEB",
            border: "1px solid #FDE68A", borderRadius: 8,
            padding: "8px 10px", marginTop: 8, lineHeight: 1.55,
          }}>
            ⚠️ Llevas {nTags} hashtags. En Instagram, pasando de {INSTAGRAM_HASHTAG_LIMIT} el
            alcance baja en lugar de subir. Te conviene quedarte en {INSTAGRAM_HASHTAG_LIMIT} o menos.
          </div>
        )}
      </Field>

      <Field label="¿A dónde se publica?" theme={t}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {targets.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => { setTargetKey(x.key); setError(null); }}
              style={chipBtn(x.key === target?.key)}
            >
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{x.label}</div>
              <div style={{ fontSize: 11.5, color: t.muted, marginTop: 2 }}>
                {x.platform === "instagram" ? "Instagram" : "Facebook"}
              </div>
            </button>
          ))}
        </div>
      </Field>

      <Field label="¿Cuándo?" theme={t}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); setFechaTocada(true); }}
            style={{ ...input, flex: "1 1 150px" }}
          />
          <input
            type="time"
            value={time}
            onChange={(e) => { setTime(e.target.value); setFechaTocada(true); }}
            style={{ ...input, flex: "0 1 120px" }}
          />
        </div>
        <div style={{ fontSize: 11.5, color: t.muted, marginTop: 6, lineHeight: 1.5 }}>
          Hora de la Ciudad de México.
          {cadencia && !fechaTocada && ` Te propuse el siguiente hueco de tu ritmo (${cadencia}); cámbialo si quieres.`}
        </div>
      </Field>

      <SaveBtn
        theme={t}
        onClick={programar}
        disabled={saving || items.length === 0}
        label={saving ? "Programando…" : "🗓 Programar publicación"}
      />
      <div style={{ fontSize: 11.5, color: t.muted, marginTop: 10, lineHeight: 1.5 }}>
        Se publica sola a la hora que escojas. Hasta entonces la puedes mover o cancelar
        desde el calendario.
      </div>
    </Modal>
  );
}
