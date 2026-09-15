// FishFlow / Trufa — fotos del carnet
// ─────────────────────────────────────────────────────────────────────────────
// Una foto de iPhone son 4-8 MB. En la sala de espera de una veterinaria, con
// datos móviles, eso es un minuto por foto y una barra que parece trabada. Se
// reescala ANTES de subir: a 1600 px el lado largo, una lesión de piel se
// aprecia igual y el archivo baja a unos 300 KB.
//
// HEIC de iPhone: Safari lo decodifica en canvas y sale JPEG, así que el
// reescalado también resuelve el formato. En un navegador que no lo decodifique
// (Android abriendo un HEIC ajeno), `reducirImagen` devuelve el archivo tal cual
// y el bucket lo acepta — se ve en iOS y no se ve en Android, pero no se pierde.

import { supabase } from "@/lib/supabase";

export const LADO_MAX = 1600;
export const CALIDAD = 0.82;
export const MAX_BYTES = 10 * 1024 * 1024;

export type FotoSubida = { storagePath: string; bytes: number };

/** Reescala a JPEG. Si el navegador no puede decodificar, regresa el original. */
export async function reducirImagen(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", CALIDAD),
    );
    // Si el reescalado salió más pesado que el original (imagen ya diminuta),
    // no tiene caso: nos quedamos con el archivo tal cual.
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function rutaFoto(petId: string, ext: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${petId}/${stamp}-${rnd}.${ext}`;
}

/** Sube una foto al bucket privado y registra la fila en vet_photos. */
export async function subirFoto(opts: {
  file: File;
  petId: string;
  clientId: string;
  appointmentId?: string | null;
  caption?: string | null;
  takenOn?: string | null;
}): Promise<FotoSubida> {
  const blob = await reducirImagen(opts.file);
  if (blob.size > MAX_BYTES) {
    throw new Error(`La foto pesa ${(blob.size / 1024 / 1024).toFixed(1)} MB y el máximo son 10 MB.`);
  }

  const ext = blob.type === "image/jpeg" ? "jpg"
    : (opts.file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const storagePath = rutaFoto(opts.petId, ext || "jpg");

  const { error: upErr } = await supabase.storage
    .from("trufa-media")
    .upload(storagePath, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (upErr) throw new Error(`No se pudo subir la foto: ${upErr.message}`);

  const { data: { user } } = await supabase.auth.getUser();
  const { error: rowErr } = await supabase.from("vet_photos").insert({
    client_id: opts.clientId,
    pet_id: opts.petId,
    appointment_id: opts.appointmentId ?? null,
    storage_path: storagePath,
    caption: opts.caption?.trim() || null,
    taken_on: opts.takenOn || new Date().toLocaleDateString("en-CA"),
    uploaded_by: user?.id ?? null,
  });
  if (rowErr) {
    // La fila es lo que hace visible la foto; sin ella el objeto queda huérfano
    // y contando contra la cuota. Se limpia aquí mismo.
    await supabase.storage.from("trufa-media").remove([storagePath]);
    throw new Error("No se pudo guardar la foto en el carnet.");
  }

  return { storagePath, bytes: blob.size };
}

/**
 * URLs firmadas para mostrar. El bucket es privado: sin esto no hay forma de
 * pintar la imagen. Una hora alcanza de sobra para una sesión.
 */
export async function firmarFotos(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from("trufa-media")
    .createSignedUrls(paths, 3600);
  if (error || !data) return {};
  const mapa: Record<string, string> = {};
  for (const d of data) {
    if (d.path && d.signedUrl) mapa[d.path] = d.signedUrl;
  }
  return mapa;
}

/** Borra la foto del carnet y del bucket. */
export async function borrarFoto(id: string, storagePath: string): Promise<void> {
  const { error } = await supabase.from("vet_photos").delete().eq("id", id);
  if (error) throw new Error("No se pudo borrar la foto.");
  await supabase.storage.from("trufa-media").remove([storagePath]);
}

/**
 * Foto de perfil de la mascota. No pasa por vet_photos a propósito: no es una
 * foto más del historial, es la portada, y vive en vet_pets.photo_url para que
 * el carnet y el encabezado la lean sin recorrer el álbum.
 *
 * Guarda la RUTA, no una URL: el bucket es privado y la URL firmada caduca.
 */
export async function subirFotoPerfil(imagen: Blob, petId: string): Promise<string> {
  // Recibe un Blob y no un File porque lo normal es que llegue YA RECORTADO
  // desde RecortarFoto: 800x800 JPEG. `reducirImagen` no le hace nada (es más
  // chico que LADO_MAX) y sigue cubriendo el caso de subir el original directo.
  const blob = await reducirImagen(imagen);
  if (blob.size > MAX_BYTES) {
    throw new Error(`La foto pesa ${(blob.size / 1024 / 1024).toFixed(1)} MB y el máximo son 10 MB.`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const storagePath = `${petId}/perfil-${stamp}.jpg`;

  const { error: upErr } = await supabase.storage
    .from("trufa-media")
    .upload(storagePath, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (upErr) throw new Error(`No se pudo subir la foto: ${upErr.message}`);

  // La anterior se lee ANTES de pisarla, si no queda huérfana en el bucket.
  const { data: previa } = await supabase
    .from("vet_pets").select("photo_url").eq("id", petId).maybeSingle();

  const { error: rowErr } = await supabase
    .from("vet_pets").update({ photo_url: storagePath }).eq("id", petId);
  if (rowErr) {
    await supabase.storage.from("trufa-media").remove([storagePath]);
    throw new Error("No se pudo guardar la foto de perfil.");
  }

  const anterior = previa?.photo_url as string | null | undefined;
  if (anterior && anterior !== storagePath) {
    await supabase.storage.from("trufa-media").remove([anterior]);
  }

  return storagePath;
}
