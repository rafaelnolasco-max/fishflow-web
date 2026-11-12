// FishFlow — Lukon · Instalaciones de GPS / dashcam (fase 1, 12-nov-2026)
// Constantes y utilidades compartidas por las rutas /api/lukon/instalaciones,
// el reporte público /instalacion/[token] y la pestaña del panel.

import type { SupabaseClient } from "@supabase/supabase-js";

export const LUKON_ID = "1aa4a82b-e524-40f4-808e-c02e87e82427";
export const INSTALLERS = [1, 2, 3] as const;          // por número, sin nombre (decisión de Rafa)
export const BUCKET = "installations";
/** Recibe el aviso de órdenes nuevas, reprogramadas y canceladas (Alex, admin de Lukon). */
export const LUKON_OPS_EMAIL = "aalmarazmo@lukon.com.mx";
export const AUTO_ACCEPT_DAYS = 3;
export const SITE = "https://www.fishflow.mx";

export type Status = "programada" | "en_sitio" | "terminada" | "incidencia" | "aceptada" | "cancelada";
export type Service = "gps" | "dashcam" | "gps_dashcam";
export type Stage = "antes" | "despues";

export const STATUS_LABEL: Record<Status, string> = {
  programada: "Programada", en_sitio: "En sitio", terminada: "Terminada · por aceptar", incidencia: "Con incidencia",
  aceptada: "Aceptada", cancelada: "Cancelada",
};
export const SERVICE_LABEL: Record<Service, string> = { gps: "GPS", dashcam: "Dashcam", gps_dashcam: "GPS + Dashcam" };

/** Fotos guiadas. `need` = obligatoria para avanzar; `only` = solo si el servicio la incluye. */
export const PHOTO_STEPS: { stage: Stage; kind: string; label: string; hint: string; need: boolean; only?: "gps" | "dashcam"; multi?: boolean }[] = [
  { stage: "antes", kind: "tablero", label: "Tablero encendido", hint: "Con kilometraje y testigos visibles, antes de tocar nada.", need: true },
  { stage: "antes", kind: "placa", label: "Placa o número de serie", hint: "Que se lea completa.", need: true },
  { stage: "antes", kind: "vehiculo", label: "Vehículo completo", hint: "Frente o lateral, para identificarlo.", need: false },
  { stage: "antes", kind: "danos", label: "Daños previos", hint: "Rayones, golpes o fallas que ya tenía. Si no hay, sáltala.", need: false, multi: true },
  { stage: "despues", kind: "conexiones", label: "Conexiones", hint: "Corriente, tierra e ignición bien aisladas.", need: true, only: "gps", multi: true },
  { stage: "despues", kind: "equipo", label: "Equipo GPS instalado", hint: "Con el IMEI visible.", need: true, only: "gps" },
  { stage: "despues", kind: "dashcam", label: "Dashcam instalada", hint: "Cámara y vista del encuadre en la pantalla.", need: true, only: "dashcam", multi: true },
  { stage: "despues", kind: "tablero_final", label: "Tablero al terminar", hint: "Encendido, sin testigos nuevos.", need: true },
  { stage: "despues", kind: "otra", label: "Otras", hint: "Cualquier detalle que convenga documentar.", need: false, multi: true },
];

export const stepsFor = (service: Service) =>
  PHOTO_STEPS.filter(s => !s.only || (s.only === "gps" ? service !== "dashcam" : service !== "gps"));

/** Fotos obligatorias que faltan para empezar el cierre de una etapa. */
export function missingPhotos(service: Service, stage: Stage, kinds: string[]) {
  return stepsFor(service).filter(s => s.stage === stage && s.need && !kinds.includes(s.kind)).map(s => s.label);
}

/** URLs firmadas (1 h) para mostrar fotos del bucket privado. */
export async function signPhotos<T extends { path: string }>(db: SupabaseClient, photos: T[]) {
  if (!photos.length) return [] as (T & { url: string | null })[];
  const { data } = await db.storage.from(BUCKET).createSignedUrls(photos.map(p => p.path), 3600);
  const byPath = new Map((data ?? []).map(d => [d.path, d.signedUrl]));
  return photos.map(p => ({ ...p, url: byPath.get(p.path) ?? null }));
}

export const fmtCdmx = (iso: string | null | undefined, withTime = true) =>
  iso ? new Date(iso).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City", day: "numeric", month: "long", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }) : "—";

export const folioTxt = (n: number) => `INS-${String(n).padStart(4, "0")}`;
