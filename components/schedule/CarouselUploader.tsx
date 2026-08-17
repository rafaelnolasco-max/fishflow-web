"use client";

/**
 * Subida de las imágenes de UNA publicación programada, con orden.
 *
 * Por qué no reusa MediaUploader: aquel sube UN archivo y lo escribe en una fila
 * de content_posts. Aquí son de 1 a 10 imágenes que todavía no pertenecen a
 * ninguna fila —la publicación se crea al final, de un solo golpe— y el ORDEN es
 * parte del contenido: es el orden en que se deslizan las láminas del carrusel
 * de Instagram. Meterle eso a MediaUploader habría torcido el módulo de
 * Contenido, que funciona bien como está.
 *
 * Ruta en el bucket: {client_id}/programadas/{lote}/{timestamp}-{archivo}
 * La política de Storage valida la PRIMERA carpeta (el client_id), así que el
 * resto de la ruta es libre y aquí se usa para agrupar por publicación.
 *
 * Pensado para el celular: el archivo recién exportado está en el carrete, y
 * reordenar se hace con flechas grandes y no arrastrando, que en táctil pelea
 * con el desplazamiento de la página.
 */

import React, { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { DashTheme } from "@/components/dashboard";
import { MAX_CAROUSEL } from "@/lib/socialTargets";

/** Mismo bucket que el módulo de Contenido: un solo lugar para el arte del cliente. */
const BUCKET = "content-media";

/** Tope del bucket. Se valida aquí para no gastar la subida completa en vano. */
const MAX_BYTES = 52_428_800;

/** Solo imágenes: el carrusel es de imágenes y los reels tienen otro flujo. */
const ACCEPT = "image/jpeg,image/png,image/webp";

export type CarouselItem = {
  path: string;
  url: string;
  name: string;
  width: number | null;
  height: number | null;
};

function fmtMB(bytes: number) {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Nombre seguro para el bucket: sin acentos, espacios ni signos. */
function safeName(name: string) {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const ext = (dot > 0 ? name.slice(dot + 1) : "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${base || "imagen"}${ext ? `.${ext}` : ""}`;
}

/** Dimensiones antes de subir, con tope de espera por si el archivo viene corrupto. */
function probe(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (r: { width: number | null; height: number | null }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(r);
    };
    const timer = setTimeout(() => finish({ width: null, height: null }), 8_000);
    const img = new Image();
    img.onload = () => finish({ width: img.naturalWidth || null, height: img.naturalHeight || null });
    img.onerror = () => finish({ width: null, height: null });
    img.src = url;
  });
}

/** Ordena "diseño (2)" antes que "diseño (10)": los números como números. */
function byName(a: File, b: File) {
  return a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" });
}

export default function CarouselUploader({
  clientId, batchId, items, onChange, theme: t, onError,
}: {
  clientId: string;
  /** Agrupa en el bucket las imágenes de esta publicación. */
  batchId: string;
  items: CarouselItem[];
  onChange: (items: CarouselItem[]) => void;
  theme: DashTheme;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const lleno = items.length >= MAX_CAROUSEL;

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // Se limpia de inmediato para poder volver a escoger los mismos archivos.
    e.target.value = "";
    if (picked.length === 0) return;

    const espacio = MAX_CAROUSEL - items.length;
    if (picked.length > espacio) {
      onError(
        espacio === 0
          ? `Ya llevas ${MAX_CAROUSEL} imágenes, que es el máximo de un carrusel.`
          : `Solo caben ${espacio} imagen${espacio !== 1 ? "es" : ""} más en este carrusel.`,
      );
      return;
    }

    const files = picked.sort(byName);
    const nuevos: CarouselItem[] = [];
    const fallidos: string[] = [];

    setProgress({ done: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      if (file.size > MAX_BYTES) {
        fallidos.push(`${file.name} (${fmtMB(file.size)})`);
        setProgress({ done: i + 1, total: files.length });
        continue;
      }

      const dims = await probe(file);
      const path = `${clientId}/programadas/${batchId}/${Date.now()}-${safeName(file.name)}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

      if (upErr) {
        console.error("[CarouselUploader] upload error:", upErr);
        fallidos.push(file.name);
      } else {
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        nuevos.push({
          path,
          url: pub.publicUrl,
          name: file.name,
          width: dims.width,
          height: dims.height,
        });
      }

      setProgress({ done: i + 1, total: files.length });
    }

    setProgress(null);

    if (nuevos.length > 0) onChange([...items, ...nuevos]);
    if (fallidos.length > 0) {
      onError(
        `No se pudo subir: ${fallidos.slice(0, 3).join(", ")}${fallidos.length > 3 ? "…" : ""}. ` +
        `Revisa que sean imágenes de menos de 50 MB.`,
      );
    }
  }

  function move(index: number, delta: number) {
    const destino = index + delta;
    if (destino < 0 || destino >= items.length) return;
    const copia = items.slice();
    [copia[index], copia[destino]] = [copia[destino], copia[index]];
    onChange(copia);
  }

  function remove(index: number) {
    const item = items[index];
    onChange(items.filter((_, i) => i !== index));
    // Limpieza del bucket, sin avisar si falla: la publicación del cliente ya
    // quedó bien y un archivo huérfano no es su problema.
    supabase.storage.from(BUCKET).remove([item.path]).then(({ error }) => {
      if (error) console.warn("[CarouselUploader] no se pudo borrar:", error);
    });
  }

  const trabajando = progress !== null;

  const miniBtn: React.CSSProperties = {
    background: "none", border: `1px solid ${t.border}`, borderRadius: 8,
    width: 34, height: 34, fontSize: 15, color: t.muted, cursor: "pointer",
    display: "grid", placeItems: "center", flexShrink: 0, lineHeight: 1,
  };

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        onChange={handlePick}
        style={{ display: "none" }}
      />

      {items.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          {items.map((item, i) => (
            <div
              key={item.path}
              style={{
                display: "flex", gap: 10, alignItems: "center",
                background: t.panel ?? "#F9FAFB", border: `1px solid ${t.border}`,
                borderRadius: 10, padding: 8,
              }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: 999, background: t.accent, color: "#fff",
                display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
              }}>
                {i + 1}
              </div>

              <div style={{
                width: 48, height: 48, borderRadius: 8, overflow: "hidden",
                background: "#000", flexShrink: 0,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt={`Lámina ${i + 1}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>

              <div style={{ fontSize: 12, color: t.muted, minWidth: 0, flex: 1, lineHeight: 1.5 }}>
                <div style={{
                  color: t.text, fontWeight: 600, fontSize: 12.5,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {item.name}
                </div>
                {item.width && item.height && <div>{item.width}×{item.height}</div>}
              </div>

              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label="Subir una posición"
                style={{ ...miniBtn, opacity: i === 0 ? 0.35 : 1, cursor: i === 0 ? "default" : "pointer" }}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                aria-label="Bajar una posición"
                style={{
                  ...miniBtn,
                  opacity: i === items.length - 1 ? 0.35 : 1,
                  cursor: i === items.length - 1 ? "default" : "pointer",
                }}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Quitar esta imagen"
                style={{ ...miniBtn, color: t.danger, borderColor: t.danger }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={trabajando || lleno}
        style={{
          width: "100%", background: "none", color: trabajando || lleno ? t.disabled : t.accentDark,
          border: `1px dashed ${trabajando || lleno ? t.border : t.accent}`,
          borderRadius: 10, padding: "12px", fontSize: 13.5, fontWeight: 600,
          cursor: trabajando ? "wait" : lleno ? "not-allowed" : "pointer",
        }}
      >
        {trabajando
          ? `Subiendo ${progress!.done} de ${progress!.total}…`
          : lleno
            ? `Ya llevas ${MAX_CAROUSEL}, el máximo del carrusel`
            : items.length === 0
              ? "📎 Subir imagen o imágenes"
              : "📎 Agregar otra imagen"}
      </button>

      <div style={{ fontSize: 11.5, color: t.muted, marginTop: 6, lineHeight: 1.5 }}>
        {items.length > 1
          ? `${items.length} láminas: se publican como carrusel, en el orden de arriba. Muévelas con ↑ y ↓.`
          : "Si subes dos o más, se publican como carrusel en el orden que tú acomodes."}
      </div>
    </div>
  );
}
