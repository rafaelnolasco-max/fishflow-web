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
