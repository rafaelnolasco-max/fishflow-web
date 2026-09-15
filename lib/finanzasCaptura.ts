// FishFlow Finanzas — captura por screenshot del app del banco
// ─────────────────────────────────────────────────────────────────────────────
// El usuario fotografía los movimientos del día y la app los propone
// clasificados. Nada entra a finance_transactions sin que él confirme.
//
// La pieza delicada de este archivo es merchantKey(). De su estabilidad depende
// todo el aprendizaje: si el mismo Starbucks genera dos llaves distintas, las
// reglas que el usuario construye con sus correcciones nunca vuelven a pegar.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const FINANCE_BUCKET = "finance-uploads";

/** Igual que el tope del bucket. Se valida aquí para dar un error entendible. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Lo que acepta el bucket. */
export const ALLOWED_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
]);

/** De lo anterior, lo que el modelo puede mirar. HEIC se rechaza en la UI. */
export const VISION_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Tope de movimientos por screenshot. Un corte de tarjeta no trae más. */
export const MAX_ROWS_PER_CAPTURE = 40;

/** Debajo de esto, el movimiento sube al tope de la lista de revisión. */
export const LOW_CONFIDENCE = 0.75;

export const TX_TYPES = ["ingreso", "fijo", "placer", "futuro", "extraordinario"] as const;
export type TxType = (typeof TX_TYPES)[number];

export type TxnState = "authorized" | "posted";

/** Lo que el modelo devuelve por cada renglón, ya validado. */
export interface MovimientoLeido {
  tx_date: string;          // YYYY-MM-DD
  merchant_raw: string;
  amount: number;           // en la divisa de `currency`
  currency: string;         // ISO 4217
  txn_state: TxnState;
  tx_type: TxType | null;   // propuesta; null = no se atrevió
  confidence: number;       // 0–1
  /** Tarjetahabiente adicional que hizo el cargo. null = el titular. */
  cardholder: string | null;
}

export interface LecturaCaptura {
  card_last4: string | null;
  movimientos: MovimientoLeido[];
  unreadable_rows: number;
}

/** Fila de finance_tx_drafts tal como la consume la UI de revisión. */
export interface BorradorGasto {
  id: string;
  capture_id: string;
  tx_date: string;
  merchant_raw: string;
  merchant_key: string;
  concept: string;
  amount_original: number;
  currency: string;
  amount: number | null;
  fx_rate_used: number | null;
  tx_type: TxType | null;
  category: string | null;
  confidence: number | null;
  rule_hit: boolean;
  txn_state: TxnState;
  cardholder: string | null;
  status: "pending" | "confirmed" | "discarded" | "duplicate";
}

export function financeAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Normalización del nombre del comercio
// ════════════════════════════════════════════════════════════════════════════
// Los bancos escriben el comercio como
//   "SQ *BLUE BOTTLE COFFEE"  /  "WHATABURGER #1042 HOUSTON TX"
//   "OXXO 4521 CIUDAD DE MEXICO"  /  "NETFLIX.COM"
//
// La marca SIEMPRE va al principio; el ruido (sucursal, ciudad, estado) va
// después. Por eso no se limpia la cola —lo que exige una lista infinita de
// ciudades— sino que se conservan los primeros tokens de marca y se corta en
// el primer token de ruido. Es la diferencia entre un heurístico que aguanta
// comercios nuevos y uno que hay que parchar cada semana.

/** Prefijos que los procesadores de pago pegan al frente. */
const PREFIJOS_PROCESADOR = [
  /^SQ\s*\*+/,        // Square
  /^TST\s*\*+/,       // Toast
  /^SP\s*\*+/,        // Shopify / Stripe
  /^PY\s*\*+/,
  /^PAYPAL\s*\*+/,
  /^DD\s*\*+/,        // DoorDash
  /^EB\s*\*+/,        // Eventbrite
  /^IC\s*\*+/,        // Instacart
  /^WWW\.?\s*/,
  /^POS\s+/,
  /^COMPRA\s+(EN\s+)?/,
  /^PAGO\s+(A|DE|EN)?\s*/,
  /^CARGO\s+(RECURRENTE\s+)?/,
  /^TDC\s+/,
  /^MSI\s+/,
];

/**
 * Tokens que marcan el fin de la marca y el inicio del ruido.
 * No incluye nombres de ciudad a propósito: para eso está el corte por número.
 */
const RUIDO = new Set([
  // web / canal
  "COM", "WWW", "NET", "MX", "ORG", "ONLINE", "APP", "WEB",
  // sucursal
  "STORE", "TIENDA", "SUCURSAL", "SUC", "BRANCH", "NO", "NUM",
  // geografía genérica
  "CIUDAD", "CD", "MEXICO", "MEX", "CDMX", "DF", "EDO", "ESTADO",
  "USA", "US", "MONTERREY", "GUADALAJARA",
  // razón social
  "SA", "SAPI", "CV", "SC", "SRL", "LLC", "INC", "CORP", "LTD", "DE",
]);

/** Códigos de estado de EE.UU. Solo cuentan como ruido si no van al inicio. */
const ESTADOS_US = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

/** Cuántos tokens de marca se conservan como máximo. */
/**
 * Tres es el punto donde la llave sigue siendo especifica ("blue-bottle-coffee")
 * sin volverse fragil. Subirlo deja entrar ciudad y sucursal.
 */
const MAX_TOKENS_MARCA = 3;

/**
 * Quita la cola geografica usando el codigo de estado como ancla.
 *
 * Sin esto, un comercio sin numero de sucursal se lleva la ciudad dentro de la
 * llave: "UBER TRIP HOUSTON TX" daba "uber-trip-houston", distinto de
 * "UBER TRIP KATY TX" — y entonces la regla que el usuario construyo con su
 * correccion no volvia a pegar nunca.
 *
 * Se asume que la ciudad es UN token, que es el caso mayoritario (HOUSTON,
 * AUSTIN, DALLAS). En ciudades de dos palabras se pierde la primera ("SUGAR
 * LAND" deja "SUGAR"), y eso es aceptable: la llave sigue siendo la MISMA para
 * ese comercio, que es lo unico que el aprendizaje necesita.
 *
 * No recorta si dejaria menos de dos tokens: "KATY TX" no es un comercio.
 */
function quitarColaGeografica(tokens: string[]): string[] {
  if (tokens.length < 4) return tokens;
  const ultimo = tokens[tokens.length - 1];
  if (ultimo.length === 2 && ESTADOS_US.has(ultimo)) return tokens.slice(0, -2);
  return tokens;
}

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Convierte el string del banco en una llave estable.
 *   "WHATABURGER #1042 HOUSTON TX" → "whataburger"
 *   "SQ *BLUE BOTTLE COFFEE"       → "blue-bottle-coffee"
 *   "UBER   TRIP HOUSTON TX"       → "uber-trip"
 *   "OXXO 4521 CIUDAD DE MEXICO"   → "oxxo"
 *
 * Devuelve "" solo si la entrada no tiene un solo carácter alfanumérico.
 */
export function merchantKey(raw: string): string {
  let s = sinAcentos(String(raw ?? "")).toUpperCase().trim();
  if (!s) return "";

  // Prefijos de procesador: puede haber más de uno encadenado.
  for (let i = 0; i < 3; i++) {
    const antes = s;
    for (const re of PREFIJOS_PROCESADOR) s = s.replace(re, "").trim();
    if (s === antes) break;
  }

  const brutos = s.replace(/[^A-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (brutos.length === 0) return "";
  const tokens = quitarColaGeografica(brutos);

  const marca: string[] = [];
  for (let i = 0; i < tokens.length && marca.length < MAX_TOKENS_MARCA; i++) {
    const t = tokens[i];
    const tieneDigito = /\d/.test(t);

    // Un número corta la marca — pero no si va al inicio ("7 ELEVEN").
    if (tieneDigito) {
      if (marca.length === 0 && /^\d+$/.test(t) && t.length <= 2) { marca.push(t); continue; }
      break;
    }
    if (RUIDO.has(t)) break;
    if (marca.length > 0 && t.length === 2 && ESTADOS_US.has(t)) break;

    marca.push(t);
  }

  // Si todo resultó ruido, quedarse con los primeros tokens crudos antes que
  // devolver vacío: una llave fea y estable sirve; una vacía junta comercios
  // distintos en la misma regla.
  let finales = marca.length > 0 ? marca : tokens.slice(0, 2);

  // Posesivo inglés: el apóstrofo se pierde al tokenizar y deja la "s" suelta,
  // así que "MCDONALD'S" caía en "mcdonald-s". Solo se recorta cuando la
  // palabra anterior es larga, para no destrozar siglas como "H E B".
  if (finales.length >= 2) {
    const ult = finales[finales.length - 1];
    const penult = finales[finales.length - 2];
    if (ult.length === 1 && penult.length >= 4) finales = finales.slice(0, -1);
  }

  return finales.join("-").toLowerCase();
}

/**
 * Nombre legible para el tablero, derivado de la llave.
 *   "blue-bottle-coffee" → "Blue Bottle Coffee"
 * Se usa solo si el usuario no guardó un concept_label propio.
 */
export function conceptoLegible(key: string): string {
  return key
    .split("-")
    .filter(Boolean)
    .map(w => (w.length <= 3 && w === w.toUpperCase() ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// ════════════════════════════════════════════════════════════════════════════
// Validación de lo que devuelve el modelo
// ════════════════════════════════════════════════════════════════════════════
// Se valida aquí, fuera de la ruta, porque es donde de verdad se puede probar:
// un renglón inventado no se nota en pantalla, contamina el histórico.

/** Valida y limpia lo que vino del modelo. Lo que no cuadre se descarta. */
export function parseLectura(raw: string, monedaDefault: string): LecturaCaptura | null {
  let p: Record<string, unknown>;
  try {
    const i = raw.indexOf("{");
    const j = raw.lastIndexOf("}");
    if (i < 0 || j <= i) return null;
    p = JSON.parse(raw.slice(i, j + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const crudos = Array.isArray(p.movimientos) ? p.movimientos : [];
  const movimientos: MovimientoLeido[] = [];
  let descartados = 0;

  for (const m of crudos.slice(0, MAX_ROWS_PER_CAPTURE)) {
    const r = (m ?? {}) as Record<string, unknown>;
    const merchant = String(r.merchant_raw ?? "").trim();
    const amount = Number(r.amount);
    const fecha = String(r.tx_date ?? "");

    // Un renglón sin monto positivo, sin comercio o con fecha inválida no se
    // rescata: entra como ilegible para que el usuario lo vea y decida.
    if (!merchant || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      descartados++;
      continue;
    }

    const tipo = String(r.tx_type ?? "");
    const estado = String(r.txn_state ?? "posted");
    const conf = Number(r.confidence);
    const div = String(r.currency ?? "").toUpperCase();

    movimientos.push({
      tx_date: fecha,
      merchant_raw: merchant.slice(0, 200),
      amount: aCentavos(amount),
      currency: /^[A-Z]{3}$/.test(div) ? div : monedaDefault,
      txn_state: estado === "authorized" ? "authorized" : ("posted" as TxnState),
      tx_type: (TX_TYPES as readonly string[]).includes(tipo) ? (tipo as TxType) : null,
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
      cardholder: (() => {
        const c = String(r.cardholder ?? "").trim();
        // Se acota para que un desvarío del modelo no meta un párrafo aquí.
        return c && c.length <= 60 ? c.slice(0, 60) : null;
      })(),
    });
  }

  // Amex Mexico muestra CINCO digitos (····51000), no cuatro.
  const last4 = String(p.card_last4 ?? "").replace(/\D/g, "").slice(-6);
  const ilegibles = Number(p.unreadable_rows);

  return {
    card_last4: last4.length >= 4 ? last4 : null,
    movimientos,
    unreadable_rows: (Number.isFinite(ilegibles) ? Math.max(0, ilegibles) : 0) + descartados,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Deduplicación
// ════════════════════════════════════════════════════════════════════════════
// El screenshot de hoy casi siempre arrastra los cargos de ayer. El hash va
// sobre el monto ORIGINAL y no el convertido: el tipo de cambio puede cambiar
// entre una captura y otra, el cargo en dólares no.

export async function dedupeHash(
  txDate: string,
  amountOriginal: number,
  currency: string,
  key: string,
): Promise<string> {
  const material = `${txDate}|${amountOriginal.toFixed(2)}|${currency.toUpperCase()}|${key}`;
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(material).digest("hex");
}

/** Redondeo a centavos, para que el hash y el monto guardado coincidan. */
export function aCentavos(n: number): number {
  return Math.round(n * 100) / 100;
}
