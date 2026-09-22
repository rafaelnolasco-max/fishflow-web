// lib/storeAguachiles.ts
// Reglas de negocio de Los Aguachiles (Silvia "Chiva"), compartidas por la API
// pública de pedidos y el panel /app/aguachiles. Sin imports de servidor: el
// panel (cliente) también lo usa.
//
// ⚠️ El horario vive TAMBIÉN en mockups/losaguachiles/menu.py (lo que ve el
// cliente en la página). Si cambia uno, cambiar el otro: el servidor rechaza
// cualquier franja que no esté aquí.

export const AGUACHILES_CLIENT_ID = "09d07921-9cef-4cff-905e-b0962f903487";

export const AGUACHILES_WA = "525510516938"; // WhatsApp de Chiva, E.164 sin +

/** Envío plano en toda la zona (decisión de Rafa, 7-sep-2026). */
export const ENVIO_MXN = 30;

/** Jueves a domingo, 12:00 a 17:00 h (índice de Date.getUTCDay: 0 = domingo). */
export const DIAS_ABIERTOS = [4, 5, 6, 0];

export const FRANJAS = [
  "12:00 - 13:00",
  "13:00 - 14:00",
  "14:00 - 15:00",
  "15:00 - 16:00",
  "16:00 - 17:00",
] as const;

/** Una franja se cierra esta cantidad de horas antes de su inicio. */
export const CIERRE_HORAS = 1;

/** Hasta cuántos días adelante se acepta un pedido. */
export const DIAS_MAXIMOS = 21;

export const PAGOS = ["efectivo", "transferencia"] as const;
export type Pago = (typeof PAGOS)[number];

export const PAGO_LABEL: Record<string, string> = {
  efectivo: "Efectivo al entregar",
  transferencia: "Transferencia al entregar",
};

/** Estados de store_orders.fulfillment_status y cómo se llaman en su cocina. */
export const ESTADOS = ["nuevo", "produccion", "enviado", "entregado", "cancelado"] as const;
export type Estado = (typeof ESTADOS)[number];
export const ESTADO_LABEL: Record<Estado, string> = {
  nuevo: "Nuevo",
  produccion: "Preparando",
  enviado: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};
export const SIGUIENTE: Partial<Record<Estado, Estado>> = {
  nuevo: "produccion",
  produccion: "enviado",
  enviado: "entregado",
};

// ─── Hora de CDMX: UTC-6 fijo, sin horario de verano ─────────────────────────
const CDMX_MS = -6 * 60 * 60 * 1000;

/** "Ahora" expresado como si fuera UTC en CDMX (usar getUTC*). */
export function cdmxNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + CDMX_MS);
}

/** YYYY-MM-DD de hoy en CDMX. */
export function cdmxToday(now: Date = new Date()): string {
  return cdmxNow(now).toISOString().slice(0, 10);
}

/** Día de la semana (0 = domingo) de una fecha YYYY-MM-DD. */
export function dowOf(fecha: string): number {
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}

/**
 * ¿Se puede pedir para esta fecha y franja ahora mismo?
 * Devuelve null si sí, o el motivo en español si no.
 */
export function motivoFranjaInvalida(fecha: string, franja: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return "Fecha inválida";
  if (!(FRANJAS as readonly string[]).includes(franja)) return "Esa franja no existe";
  if (!DIAS_ABIERTOS.includes(dowOf(fecha))) return "Ese día no abrimos: solo de jueves a domingo";

  const hoy = cdmxToday(now);
  if (fecha < hoy) return "Esa fecha ya pasó";

  const limite = new Date(`${hoy}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + DIAS_MAXIMOS);
  if (new Date(`${fecha}T00:00:00Z`) > limite) return "Solo tomamos pedidos con hasta tres semanas de anticipación";

  if (fecha === hoy) {
    const inicio = parseInt(franja.slice(0, 2), 10);
    const n = cdmxNow(now);
    const ahora = n.getUTCHours() + n.getUTCMinutes() / 60;
    if (inicio - CIERRE_HORAS <= ahora) return "Esa franja ya cerró. Escoge una más tarde u otro día.";
  }
  return null;
}

/** Folio legible: "LA-1042". */
export function folio(orderNo: number): string {
  return `LA-${orderNo}`;
}

/** Normaliza un teléfono mexicano a 10 dígitos (quita lada 52 / 521). */
export function telefono10(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
  if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
  return d;
}

export function pesos(n: number): string {
  return "$" + Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 });
}

/** "jueves 24 de septiembre" a partir de YYYY-MM-DD. */
export function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
    "septiembre", "octubre", "noviembre", "diciembre"];
  return `${dias[d.getUTCDay()]} ${d.getUTCDate()} de ${meses[d.getUTCMonth()]}`;
}

// ─── Ubicación de entrega ────────────────────────────────────────────────────
/** Caja amplia de la zona metropolitana del Valle de México. Fuera de aquí es un pin equivocado. */
export const CAJA_ZMVM = { latMin: 18.8, latMax: 20.2, lngMin: -99.9, lngMax: -98.5 };

export function ubicacionValida(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= CAJA_ZMVM.latMin && lat <= CAJA_ZMVM.latMax &&
    lng >= CAJA_ZMVM.lngMin && lng <= CAJA_ZMVM.lngMax;
}

/** Liga que abre el punto exacto en Google Maps (app o web). */
export function ligaMapa(lat: number | null, lng: number | null, direccion: string): string {
  if (lat != null && lng != null) return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`;
}

/** Liga de "cómo llegar" para el repartidor. */
export function ligaRuta(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

// ─── Ruta de entrega ─────────────────────────────────────────────────────────
/**
 * Cocina de Chiva, punto de salida por defecto de la ruta.
 * PENDIENTE: pedirle la dirección. Mientras sea null, la ruta sale de la
 * ubicación del celular (si da permiso) o del orden más corto entre paradas.
 */
export const AGUACHILES_COCINA: { lat: number; lng: number } | null = null;

export type Punto = { lat: number; lng: number };

/** Distancia en línea recta, en km (haversine). */
export function kmEntre(a: Punto, b: Punto): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function largo<T extends Punto>(orden: T[], origen: Punto | null): number {
  let km = 0;
  if (origen && orden.length) km += kmEntre(origen, orden[0]);
  for (let i = 1; i < orden.length; i++) km += kmEntre(orden[i - 1], orden[i]);
  return km;
}

function vecinoMasCercano<T extends Punto>(paradas: T[], inicio: Punto, yaIncluido?: T): T[] {
  const pend = paradas.filter((p) => p !== yaIncluido);
  const orden: T[] = yaIncluido ? [yaIncluido] : [];
  let actual: Punto = yaIncluido ?? inicio;
  while (pend.length) {
    let mejor = 0;
    for (let i = 1; i < pend.length; i++) if (kmEntre(actual, pend[i]) < kmEntre(actual, pend[mejor])) mejor = i;
    actual = pend[mejor];
    orden.push(pend.splice(mejor, 1)[0]);
  }
  return orden;
}

/** Mejora 2-opt: invierte tramos mientras acorte el recorrido (n chico, sobra). */
function dosOpt<T extends Punto>(orden: T[], origen: Punto | null): T[] {
  let r = orden.slice();
  let mejoro = true;
  while (mejoro) {
    mejoro = false;
    for (let i = origen ? 0 : 1; i < r.length - 1; i++) {
      for (let k = i + 1; k < r.length; k++) {
        const cand = r.slice(0, i).concat(r.slice(i, k + 1).reverse(), r.slice(k + 1));
        if (largo(cand, origen) + 1e-9 < largo(r, origen)) { r = cand; mejoro = true; }
      }
    }
  }
  return r;
}

/**
 * Orden de entrega que minimiza el recorrido en línea recta.
 * Con origen (cocina o GPS) sale de ahí; sin origen prueba cada parada como
 * arranque y se queda con la más corta. Recorrido abierto: no regresa.
 */
export function proponerRuta<T extends Punto>(paradas: T[], origen: Punto | null): { orden: T[]; km: number } {
  if (paradas.length <= 1) return { orden: paradas.slice(), km: largo(paradas, origen) };
  let mejor: T[] = [];
  if (origen) {
    mejor = dosOpt(vecinoMasCercano(paradas, origen), origen);
  } else {
    let mejorKm = Infinity;
    for (const arranque of paradas) {
      const r = dosOpt(vecinoMasCercano(paradas, arranque, arranque), null);
      const km = largo(r, null);
      if (km < mejorKm) { mejorKm = km; mejor = r; }
    }
  }
  return { orden: mejor, km: largo(mejor, origen) };
}

/**
 * Ligas de Google Maps para recorrer la ruta en orden. Google Maps en celular
 * solo respeta pocas paradas intermedias por liga, así que se parte en tramos de
 * hasta 4 entregas; cada tramo arranca donde terminó el anterior. Sin origen,
 * Google Maps sale de donde esté el teléfono.
 */
export function ligasRuta(orden: Punto[], origen: Punto | null, porTramo = 4): string[] {
  const c = (p: Punto) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const ligas: string[] = [];
  let desde: Punto | null = origen;
  for (let i = 0; i < orden.length; i += porTramo) {
    const tramo = orden.slice(i, i + porTramo);
    const destino = tramo[tramo.length - 1];
    const intermedias = tramo.slice(0, -1);
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${c(destino)}`;
    if (desde) url += `&origin=${c(desde)}`;
    if (intermedias.length) url += `&waypoints=${encodeURIComponent(intermedias.map(c).join("|"))}`;
    ligas.push(url);
    desde = destino;
  }
  return ligas;
}
