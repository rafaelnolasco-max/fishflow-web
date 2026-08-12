"use client";

/**
 * Carga en lote del arte producido en Canva.
 *
 * Por qué existe: el cliente exporta su tanda completa de Canva —quince
 * archivos— y hasta ahora tenía que crear la publicación y subir la imagen una
 * por una. Aquí suelta todo de un jalón y el tablero crea un borrador por
 * archivo, en el orden en que los nombró.
 *
 * Quedan como BORRADOR a propósito: el arte ya está, pero el texto lo escribe
 * o lo genera el cliente, y nada se aprueba solo.
 */

import React, { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { DashTheme } from "@/components/dashboard";
import { uploadMediaToPost } from "@/components/content/MediaUploader";

const ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime";

/** Tope por tanda. Más que esto es casi siempre una selección por error. */
const MAX_FILES = 30;

/**
 * Canva exporta "diseño (1).png", "diseño (2).png"… El orden alfabético natural
 * pondría el 10 antes que el 2, así que se comparan los números como números.
 */
function byName(a: File, b: File) {
  return a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" });
}

export default function BulkUpload({
  clientId, defaultFormat, theme: t, onDone, onError,
}: {
  clientId: string;
  /** Formato con el que nacen los borradores; el cliente lo corrige al editar. */
  defaultFormat: string;
  theme: DashTheme;
  /** Se llama al terminar la tanda para que el tablero recargue. */
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    // Se limpia de inmediato para poder volver a escoger los mismos archivos.
    e.target.value = "";
    if (picked.length === 0) return;

    if (picked.length > MAX_FILES) {
      onError(`Son ${picked.length} archivos y el máximo por tanda son ${MAX_FILES}. Súbelos en dos vueltas.`);
      return;
    }

    const files = picked.sort(byName);
    const fallidos: string[] = [];
    let creados = 0;

    setProgress({ done: 0, total: files.length });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Primero la publicación: la ruta del bucket necesita el id del post.
      const { data: nuevo, error: insErr } = await supabase
        .from("content_posts")
        .insert({ client_id: clientId, format: defaultFormat, source: "manual" })
        .select("id")
        .single();

      if (insErr || !nuevo) {
        console.error("[BulkUpload] insert error:", insErr);
        fallidos.push(file.name);
        setProgress({ done: i + 1, total: files.length });
        continue;
      }

      const res = await uploadMediaToPost({ file, clientId, postId: nuevo.id });

      if (!res.ok) {
        // Sin archivo, el borrador vacío solo estorbaría en la lista.
        await supabase.from("content_posts").delete().eq("id", nuevo.id);
        fallidos.push(file.name);
      } else {
        creados++;
      }

      setProgress({ done: i + 1, total: files.length });
    }

    setProgress(null);

    if (fallidos.length > 0) {
      onError(
        `${fallidos.length} archivo${fallidos.length !== 1 ? "s" : ""} no se pudo subir: ` +
        `${fallidos.slice(0, 3).join(", ")}${fallidos.length > 3 ? "…" : ""}. ` +
        `Revisa que pesen menos de 50 MB y vuelve a intentar solo con esos.`
      );
    }
    if (creados > 0) {
      onDone(
        creados === 1
          ? "1 borrador creado con su arte"
          : `${creados} borradores creados con su arte`
      );
    }
  }

  const trabajando = progress !== null;

  return (
    <div style={{
      background: t.surface, border: `1px dashed ${t.border}`,
      borderRadius: 10, padding: "10px 12px",
      display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
    }}>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        onChange={handlePick}
        style={{ display: "none" }}
      />

      <div style={{ fontSize: 12.5, color: t.muted, flex: "1 1 220px", minWidth: 0, lineHeight: 1.5 }}>
        {trabajando ? (
          <strong style={{ color: t.text }}>
            Subiendo {progress!.done} de {progress!.total}… no cierres esta página.
          </strong>
        ) : (
          <>
            <strong style={{ color: t.text }}>¿Ya tienes la tanda de Canva?</strong>{" "}
            Súbelas todas juntas y te dejo un borrador por cada una.
          </>
        )}
      </div>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={trabajando}
        style={{
          background: trabajando ? t.disabled : t.accent, color: "#fff", border: "none",
          borderRadius: 9, padding: "9px 16px", fontSize: 13, fontWeight: 600,
          cursor: trabajando ? "wait" : "pointer", whiteSpace: "nowrap",
        }}
      >
        {trabajando ? "Subiendo…" : "📎 Subir varios artes"}
      </button>
    </div>
  );
}
