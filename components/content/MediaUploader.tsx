"use client";

/**
 * Subida del arte o el reel de una publicación (multi-tenant).
 *
 * Por qué existe: el arte se produce en Canva y hasta hoy vivía en el celular del
 * cliente. Aquí queda pegado a su publicación y con URL pública, que es el
 * requisito duro de Blotato para poder publicar o programar más adelante
 * (`POST /posts` exige una URL descargable por HTTP; no acepta el archivo).
 *
 * Diseñado para el celular a propósito: el archivo recién exportado de Canva está
 * en el carrete, no en la Mac. El input no lleva `capture` justamente para que
 * abra la galería y no la cámara.
 *
 * Ruta en el bucket: {client_id}/{post_id}/{timestamp}-{archivo}
 * El timestamp evita que el CDN siga sirviendo el arte viejo al reemplazarlo.
 */

import React, { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { DashTheme } from "@/components/dashboard";

export const CONTENT_MEDIA_BUCKET = "content-media";

/** Tope del bucket (50 MB). Se valida aquí para no gastar la subida completa. */
const MAX_BYTES = 52_428_800;

const ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime";

/** 1080x1920. Fuera de este margen el reel sale con barras en Instagram y TikTok. */
const VERTICAL_RATIO = 9 / 16;
const RATIO_TOLERANCE = 0.05;

/** Campos de media que el uploader lee y escribe. */
export type PostMedia = {
  media_type: "image" | "video" | null;
  media_path: string | null;
  media_url: string | null;
  media_size_bytes: number | null;
  media_duration_s: number | null;
  media_width: number | null;
  media_height: number | null;
  media_uploaded_at: string | null;
};

type Probe = {
  width: number | null;
  height: number | null;
  duration: number | null;
};

function fmtMB(bytes: number) {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function fmtSecs(s: number) {
  return s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${s.toFixed(1)} s`;
}

/** Nombre seguro para el bucket: sin acentos, espacios ni signos. */
function safeName(name: string) {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const ext = (dot > 0 ? name.slice(dot + 1) : "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${base || "arte"}${ext ? `.${ext}` : ""}`;
}

/**
 * Lee dimensiones y duración antes de subir, para poder avisar de un reel
 * horizontal ANTES de gastar 20 MB de subida.
 *
 * Con tope de espera: un archivo corrupto nunca dispara loadedmetadata y sin el
 * corte el botón se quedaría en "Revisando…" para siempre.
 */
function probeMedia(file: File, kind: "image" | "video"): Promise<Probe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (p: Probe) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(p);
    };
    const timer = setTimeout(() => finish({ width: null, height: null, duration: null }), 8_000);

    if (kind === "video") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () =>
        finish({
          width: v.videoWidth || null,
          height: v.videoHeight || null,
          duration: Number.isFinite(v.duration) ? Number(v.duration.toFixed(2)) : null,
        });
      v.onerror = () => finish({ width: null, height: null, duration: null });
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () =>
        finish({ width: img.naturalWidth || null, height: img.naturalHeight || null, duration: null });
      img.onerror = () => finish({ width: null, height: null, duration: null });
      img.src = url;
    }
  });
}

export default function MediaUploader({
  postId, clientId, media, theme: t, onSaved, onError,
}: {
  postId: string;
  clientId: string;
  media: PostMedia;
  theme: DashTheme;
  /** Se llama tras escribir en la BD para que el tablero recargue. */
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<null | "probing" | "uploading" | "removing">(null);
  const [warning, setWarning] = useState<string | null>(null);

  const hasMedia = Boolean(media.media_url);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Se limpia de inmediato para que volver a escoger el MISMO archivo dispare
    // el evento otra vez (si no, el input lo considera "sin cambio").
    e.target.value = "";
    if (!file) return;

    setWarning(null);

    if (file.size > MAX_BYTES) {
      onError(
        `El archivo pesa ${fmtMB(file.size)} y el máximo son 50 MB. ` +
        `En Canva baja la calidad de exportación o recorta el video.`
      );
      return;
    }

    const kind: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";

    setBusy("probing");
    const probe = await probeMedia(file, kind);

    // Avisos, no bloqueos: quien manda es el cliente.
    const avisos: string[] = [];
    if (kind === "video" && probe.width && probe.height) {
      const ratio = probe.width / probe.height;
      if (Math.abs(ratio - VERTICAL_RATIO) > RATIO_TOLERANCE) {
        avisos.push(
          `El video no es vertical 9:16 (${probe.width}x${probe.height}). ` +
          `Instagram y TikTok le van a poner barras. En Canva usa "Redimensionar" a Video de TikTok.`
        );
      }
    }
    if (kind === "video" && file.type === "video/quicktime") {
      avisos.push(
        "Es un .mov del iPhone. Se guarda bien, pero al publicar conviene MP4: expórtalo desde Canva."
      );
    }
    if (kind === "video" && probe.duration && probe.duration > 90) {
      avisos.push(`Dura ${fmtSecs(probe.duration)}. Los reels que mejor rinden andan entre 15 y 30 segundos.`);
    }
    setWarning(avisos.length > 0 ? avisos.join(" ") : null);

    setBusy("uploading");
    const path = `${clientId}/${postId}/${Date.now()}-${safeName(file.name)}`;
    const previo = media.media_path;

    const { error: upErr } = await supabase.storage
      .from(CONTENT_MEDIA_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });

    if (upErr) {
      console.error("[MediaUploader] upload error:", upErr);
      setBusy(null);
      onError(`No se pudo subir el archivo: ${upErr.message}`);
      return;
    }

    const { data: pub } = supabase.storage.from(CONTENT_MEDIA_BUCKET).getPublicUrl(path);

    const { error: dbErr } = await supabase
      .from("content_posts")
      .update({
        media_type: kind,
        media_path: path,
        media_url: pub.publicUrl,
        media_size_bytes: file.size,
        media_duration_s: probe.duration,
        media_width: probe.width,
        media_height: probe.height,
        media_uploaded_at: new Date().toISOString(),
        media_deleted_at: null,
      })
      .eq("id", postId);

    if (dbErr) {
      // El archivo ya está arriba pero la publicación no lo sabe: se limpia para
      // no dejar basura huérfana en el bucket.
      console.error("[MediaUploader] db error:", dbErr);
      await supabase.storage.from(CONTENT_MEDIA_BUCKET).remove([path]);
      setBusy(null);
      onError("El archivo subió pero no se pudo guardar en la publicación. Intenta de nuevo.");
      return;
    }

    // Reemplazo: el archivo anterior ya no le sirve a nadie. Best-effort, si
    // falla no se le dice nada al cliente porque su publicación quedó correcta.
    if (previo && previo !== path) {
      const { error: rmErr } = await supabase.storage.from(CONTENT_MEDIA_BUCKET).remove([previo]);
      if (rmErr) console.warn("[MediaUploader] no se pudo borrar el archivo anterior:", rmErr);
    }

    setBusy(null);
    onSaved(kind === "video" ? "Reel subido" : "Arte subido");
  }

  async function handleRemove() {
    if (!media.media_path) return;
    if (!confirm("¿Quitar el archivo de esta publicación?")) return;

    setBusy("removing");
    const { error: rmErr } = await supabase.storage
      .from(CONTENT_MEDIA_BUCKET)
      .remove([media.media_path]);
    if (rmErr) console.warn("[MediaUploader] remove error:", rmErr);

    const { error: dbErr } = await supabase
      .from("content_posts")
      .update({
        media_type: null, media_path: null, media_url: null,
        media_size_bytes: null, media_duration_s: null,
        media_width: null, media_height: null, media_uploaded_at: null,
      })
      .eq("id", postId);

    setBusy(null);
    if (dbErr) {
      console.error("[MediaUploader] db clear error:", dbErr);
      onError("No se pudo quitar el archivo. Intenta de nuevo.");
      return;
    }
    setWarning(null);
    onSaved("Archivo quitado");
  }

  const btnBase: React.CSSProperties = {
    borderRadius: 8, padding: "7px 13px", fontSize: 12.5,
    fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
    background: "none", color: t.muted, border: `1px solid ${t.border}`,
  };

  const label =
    busy === "probing" ? "Revisando…" :
    busy === "uploading" ? "Subiendo…" :
    busy === "removing" ? "Quitando…" :
    hasMedia ? "Reemplazar archivo" : "📎 Subir arte o reel";

  return (
    <div style={{ marginBottom: 12 }}>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        onChange={handlePick}
        style={{ display: "none" }}
      />

      {hasMedia && (
        <div style={{
          display: "flex", gap: 12, alignItems: "flex-start",
          background: t.panel ?? "#F9FAFB", border: `1px solid ${t.border}`,
          borderRadius: 10, padding: 10, marginBottom: 8,
        }}>
          <div style={{
            width: 84, minWidth: 84, aspectRatio: "9 / 16",
            borderRadius: 8, overflow: "hidden", background: "#000",
          }}>
            {media.media_type === "video" ? (
              <video
                src={media.media_url ?? undefined}
                controls
                preload="metadata"
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={media.media_url ?? undefined}
                alt="Arte de la publicación"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            )}
          </div>

          <div style={{ fontSize: 12, color: t.muted, lineHeight: 1.6, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: t.text, fontSize: 12.5 }}>
              {media.media_type === "video" ? "🎬 Reel listo" : "🖼️ Arte listo"}
            </div>
            {media.media_width && media.media_height && (
              <div>{media.media_width}×{media.media_height}</div>
            )}
            {media.media_duration_s != null && <div>{fmtSecs(Number(media.media_duration_s))}</div>}
            {media.media_size_bytes != null && <div>{fmtMB(Number(media.media_size_bytes))}</div>}
          </div>
        </div>
      )}

      {warning && (
        <div style={{
          fontSize: 12, color: "#92400E", background: "#FFFBEB",
          border: "1px solid #FDE68A", borderRadius: 8,
          padding: "8px 10px", marginBottom: 8, lineHeight: 1.55,
        }}>
          ⚠️ {warning}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
          style={{
            ...btnBase,
            cursor: busy !== null ? "wait" : "pointer",
            opacity: busy !== null ? 0.6 : 1,
          }}
        >
          {label}
        </button>
        {hasMedia && busy === null && (
          <button onClick={handleRemove} style={{ ...btnBase, color: t.danger, borderColor: t.danger }}>
            Quitar
          </button>
        )}
      </div>

      {!hasMedia && busy === null && (
        <div style={{ fontSize: 11.5, color: t.muted, marginTop: 6, lineHeight: 1.5 }}>
          Exporta el diseño de Canva y súbelo aquí. Para reels: vertical 9:16, MP4, máximo 50 MB.
        </div>
      )}
    </div>
  );
}
