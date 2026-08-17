/**
 * Destinos de publicación y horarios de la ventana "Programar".
 *
 * Lógica pura a propósito — sin React, sin Supabase, sin `fetch` — para que el
 * mismo cálculo corra en el navegador (al sugerir la fecha) y en la ruta de API
 * (al validarla antes de mandarla a Blotato). Si los dos lados no calculan igual,
 * el cliente ve una hora y se publica otra.
 *
 * ─── Sobre la hora ───────────────────────────────────────────────────────────
 * México eliminó el horario de verano en 2022. La Ciudad de México vive en
 * UTC-6 los 365 días del año, sin excepción. Eso convierte la conversión en una
 * resta fija y nos deja fuera del pantano de las zonas horarias:
 *
 *     20:30 CDMX  ===  02:30 UTC del día siguiente,  SIEMPRE.
 *
 * NO usar `new Date("2026-08-18T20:30")` sin sufijo: eso se interpreta en la
 * zona del navegador, y el navegador de Karlita no siempre está en CDMX (un
 * viaje, un iPad mal configurado). Se anexa el offset explícito y se acabó.
 */

/** Offset fijo de CDMX. Ver la nota del encabezado antes de tocarlo. */
export const CDMX_OFFSET = "-06:00";

/** Instagram premia los pies limpios: pasando de 5 hashtags el alcance baja. */
export const INSTAGRAM_HASHTAG_LIMIT = 5;

/** Un carrusel de Instagram admite de 2 a 10 láminas. Una sola imagen también vale. */
export const MAX_CAROUSEL = 10;

// ─── Destinos ─────────────────────────────────────────────────────────────────

/** Hueco de la cadencia, en hora de CDMX. dow: 0 = domingo … 6 = sábado. */
export type CadenceSlot = { dow: number; hour: number; minute: number };

/**
 * Una cuenta a la que este cliente puede publicar.
 *
 * `label` es lo que ve el cliente y NO tiene por qué parecerse al nombre que la
 * cuenta tiene en Blotato: la página de CANE está bajo el login "Karla Alonso
 * Ruiz" y mostrarlo así solo confunde.
 */
export type SocialTarget = {
  key: string;
  label: string;
  platform: "instagram" | "facebook";
  accountId: string;
  /** Obligatorio en Facebook. */
  pageId?: string | null;
  cadence: CadenceSlot[];
};

function parseCadence(raw: unknown): CadenceSlot[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const s = item as Partial<CadenceSlot> | null;
    if (!s || typeof s.dow !== "number" || typeof s.hour !== "number") return [];
    const dow = Math.trunc(s.dow);
    const hour = Math.trunc(s.hour);
    const minute = typeof s.minute === "number" ? Math.trunc(s.minute) : 0;
    if (dow < 0 || dow > 6 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return [];
    return [{ dow, hour, minute }];
  });
}

/**
 * Normaliza content_settings.blotato_accounts (jsonb: sin garantías de forma).
 * Descarta en silencio lo que no sirva —un destino a medias es peor que ninguno—
 * y en particular un Facebook sin pageId, que Blotato rechazaría al publicar.
 */
export function parseTargets(raw: unknown): SocialTarget[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const t = item as Partial<SocialTarget> | null;
    if (!t) return [];
    const platform = t.platform;
    if (platform !== "instagram" && platform !== "facebook") return [];
    if (typeof t.accountId !== "string" || !t.accountId) return [];
    if (typeof t.key !== "string" || !t.key) return [];
    const pageId = typeof t.pageId === "string" && t.pageId ? t.pageId : null;
    if (platform === "facebook" && !pageId) return [];
    return [{
      key: t.key,
      label: typeof t.label === "string" && t.label ? t.label : t.key,
      platform,
      accountId: t.accountId,
      pageId,
      cadence: parseCadence(t.cadence),
    }];
  });
}

// ─── Conversión de hora ───────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/**
 * "2026-08-18" + "20:30" (hora de CDMX) → "2026-08-19T02:30:00.000Z".
 * Devuelve null si la entrada no tiene la forma de los inputs date/time del HTML.
 */
export function cdmxToUtcIso(date: string, time: string): string | null {
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const d = new Date(`${date}T${time}:00${CDMX_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * El viaje de regreso: un instante UTC → los valores que van en los inputs
 * date y time del formulario, ya en hora de CDMX.
 */
export function utcIsoToCdmxFields(value: string | Date): { date: string; time: string } {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  // Correr el reloj 6 horas hacia atrás deja la hora de pared de CDMX escrita en
  // los campos UTC del objeto, que es justo lo que toISOString() imprime.
  const shifted = new Date(d.getTime() - 6 * 60 * 60 * 1000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

/** "mar, 18 ago, 8:30 p.m." — la fecha como se la mostramos al cliente. */
export function formatCdmx(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit",
  }).format(d);
}

/**
 * "Martes, 18 de agosto" — encabezado de cada grupo del calendario.
 *
 * Solo se pone mayúscula la PRIMERA letra, a mano. Un `textTransform: capitalize`
 * en CSS capitaliza cada palabra y en español escribe "Martes, 18 De Agosto":
 * ni el mes ni la preposición llevan mayúscula.
 */
export function formatCdmxDay(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const texto = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long", day: "numeric", month: "long",
  }).format(d);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "8:30 p.m." — la hora sola, para la fila de la publicación. */
export function formatCdmxTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "numeric", minute: "2-digit",
  }).format(d);
}

/** Clave de agrupación por día de CDMX ("2026-08-18"), no por día UTC. */
export function cdmxDayKey(value: string | Date): string {
  return utcIsoToCdmxFields(value).date;
}

// ─── Sugerencia de fecha ──────────────────────────────────────────────────────

/** Día de la semana en CDMX (0 = domingo), sin depender de la zona del navegador. */
function cdmxDow(date: string): number {
  // Se ancla a mediodía para que ningún redondeo de milisegundos mueva el día.
  return new Date(`${date}T12:00:00${CDMX_OFFSET}`).getUTCDay();
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00${CDMX_OFFSET}`);
  d.setUTCDate(d.getUTCDate() + days);
  return utcIsoToCdmxFields(d).date;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Siguiente hueco libre de la cadencia del destino, en hora de CDMX.
 *
 * `taken` son los instantes UTC ya ocupados en ese mismo destino: si el martes
 * 20:30 ya tiene publicación, la sugerencia salta al miércoles. Es una
 * sugerencia — el cliente puede escribir la fecha que quiera.
 *
 * Sin cadencia configurada cae a "mañana a las 20:00", que es un default honesto:
 * no inventa un ritmo que nadie acordó, pero tampoco deja el campo vacío.
 */
export function suggestSlot(
  target: Pick<SocialTarget, "cadence">,
  now: Date = new Date(),
  taken: (string | Date)[] = [],
): { date: string; time: string } {
  const hoy = utcIsoToCdmxFields(now).date;

  if (target.cadence.length === 0) {
    return { date: addDays(hoy, 1), time: "20:00" };
  }

  const ocupados = new Set(
    taken
      .map((v) => (v instanceof Date ? v : new Date(v)))
      .filter((d) => !Number.isNaN(d.getTime()))
      .map((d) => d.toISOString()),
  );

  // Cuatro semanas alcanzan de sobra para cualquier cadencia semanal.
  for (let i = 0; i <= 28; i++) {
    const date = addDays(hoy, i);
    const dow = cdmxDow(date);
    const delDia = target.cadence
      .filter((s) => s.dow === dow)
      .sort((a, b) => a.hour - b.hour || a.minute - b.minute);

    for (const slot of delDia) {
      const time = `${pad2(slot.hour)}:${pad2(slot.minute)}`;
      const iso = cdmxToUtcIso(date, time);
      if (!iso) continue;
      // Nadie programa al pasado, y el hueco de hoy solo cuenta si no ha llegado.
      if (new Date(iso).getTime() <= now.getTime()) continue;
      if (ocupados.has(iso)) continue;
      return { date, time };
    }
  }

  return { date: addDays(hoy, 1), time: "20:00" };
}

/** Los horarios acordados, en palabras, para explicarle al cliente de dónde sale la sugerencia. */
export function describeCadence(target: Pick<SocialTarget, "cadence">): string {
  if (target.cadence.length === 0) return "";
  const DIAS = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
  return target.cadence
    .slice()
    .sort((a, b) => a.dow - b.dow || a.hour - b.hour)
    .map((s) => `${DIAS[s.dow]} ${s.hour}:${pad2(s.minute)}`)
    .join(", ");
}

// ─── Hashtags ─────────────────────────────────────────────────────────────────

/** Cuenta los hashtags reales de un texto libre, sin importar cómo los separen. */
export function countHashtags(raw: string): number {
  return (raw.match(/#[^\s#]+/g) ?? []).length;
}

/**
 * Une pie y hashtags en el texto que se manda a Blotato.
 * Línea en blanco de por medio: es como se lee un pie en Instagram.
 */
export function composePostText(caption: string, hashtags: string): string {
  const pie = caption.trim();
  const tags = hashtags.trim();
  if (!pie) return tags;
  if (!tags) return pie;
  return `${pie}\n\n${tags}`;
}
