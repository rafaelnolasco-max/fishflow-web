/**
 * Repartidor de cadencia del módulo de Contenido.
 *
 * Por qué existe: un cliente que produce quince publicaciones de un jalón no
 * quiere elegir quince fechas a mano. Elige el ritmo una vez —lunes, miércoles
 * y viernes— y el tablero acomoda todo en los siguientes huecos libres.
 *
 * Lógica pura a propósito: sin React y sin Supabase, para que el mismo cálculo
 * se pueda correr desde el navegador o desde una ruta de API más adelante.
 *
 * Sobre la zona horaria: México dejó el horario de verano en 2022, así que el
 * centro del país vive en UTC-6 todo el año. Por eso las 13:00 de CDMX son
 * SIEMPRE las 19:00 UTC, y podemos razonar en días UTC sin ambigüedad: a las
 * 19:00Z el día del calendario es el mismo en CDMX que en UTC.
 */

/** Días de la semana como los numera getUTCDay(): 0 = domingo, 1 = lunes… */
export const WEEKDAY = {
  dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6,
} as const;

/** Cadencia por omisión: lunes, miércoles y viernes. */
export const DEFAULT_CADENCE: number[] = [WEEKDAY.lun, WEEKDAY.mie, WEEKDAY.vie];

/** 13:00 en CDMX. Ver la nota de zona horaria del encabezado. */
export const DEFAULT_SLOT_HOUR_UTC = 19;

/** Tope de búsqueda: poco más de un año. Evita un ciclo infinito si la cadencia
 *  llegara vacía por un dato mal guardado. */
const MAX_DAYS_AHEAD = 420;

/** Normaliza un valor de scheduled_for al instante exacto, para poder comparar. */
export function slotKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Calcula los siguientes `count` huecos libres de la cadencia.
 *
 * @param count    cuántas fechas hacen falta
 * @param taken    instantes ya ocupados (se saltan)
 * @param now      desde cuándo buscar; por omisión, este momento
 * @param cadence  días de la semana permitidos (getUTCDay)
 * @param hourUtc  hora UTC del slot
 */
export function nextCadenceSlots({
  count,
  taken = [],
  now = new Date(),
  cadence = DEFAULT_CADENCE,
  hourUtc = DEFAULT_SLOT_HOUR_UTC,
}: {
  count: number;
  taken?: (string | Date | null | undefined)[];
  now?: Date;
  cadence?: number[];
  hourUtc?: number;
}): string[] {
  if (count <= 0 || cadence.length === 0) return [];

  const ocupados = new Set(
    taken.map(slotKey).filter((k): k is string => k !== null)
  );

  const out: string[] = [];
  const cursor = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0
  ));

  for (let i = 0; i < MAX_DAYS_AHEAD && out.length < count; i++) {
    // El hueco de hoy solo cuenta si todavía no ha pasado: nadie programa al pasado.
    if (cursor.getTime() > now.getTime() && cadence.includes(cursor.getUTCDay())) {
      const iso = cursor.toISOString();
      if (!ocupados.has(iso)) {
        out.push(iso);
        ocupados.add(iso);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return out;
}

/** "vie, 14 ago, 1:00 p.m." — la fecha como se la mostramos al cliente. */
export function formatSlot(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit",
  }).format(d);
}

/** "vie, 14 ago" — versión corta, para los chips de las tarjetas. */
export function formatSlotShort(value: string | Date) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "short", day: "numeric", month: "short",
  }).format(d);
}
