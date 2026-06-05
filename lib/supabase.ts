import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Cliente para componentes del browser — mantiene la sesión sincronizada con el middleware
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

export type PaymentMethod = "efectivo" | "tarjeta" | "transferencia";

// ─── Tabla unificada pos_transactions ─────────────────────────────────────────
// Fuente de verdad para todas las transacciones de clientes activos.
// client_id referencia la tabla clients.

export type PosProvider = "mercadopago" | "conekta" | "clip" | "stripe" | "manual";
export type PosStatus   = "pending" | "paid" | "failed" | "refunded" | "cancelled";

export interface PosTransaction {
  id:             string;
  client_id:      string;
  provider:       PosProvider;
  external_id:    string | null;
  amount:         number;
  currency:       "MXN" | "USD";
  status:         PosStatus;
  payment_method: string | null;
  service:        string | null;
  metadata:       Record<string, unknown> | null;
  vertical:       string | null;
  product_id:     string | null;
  created_at:     string;
  updated_at:     string;
}

// ─── Belange — vista lógica sobre pos_transactions ────────────────────────────
// Los campos específicos de Belange (client_name, precio de servicio, producto)
// viven en metadata. Esta interfaz representa la forma mapeada para el UI.

export interface BelangeTransaction {
  id:              string;
  client_name:     string;
  service:         string;
  price:           number;         // precio del servicio (metadata.price_service)
  producto?:       string | null;
  precio_producto?: number | null;
  qty:             number;         // cantidad de producto vendida (metadata.qty, default 1)
  precio_sugerido?: number | null; // precio de lista al momento de la venta (metadata.precio_sugerido)
  payment_method:  PaymentMethod;
  created_at:      string;
}

// Client ID de Belange en la tabla clients (Belange Estética, CDMX)
export const BELANGE_CLIENT_ID = "33933663-79d2-4caa-86fe-7ea046082b7f";

// Client ID de Lukon Telemática en la tabla clients
export const LUKON_CLIENT_ID = "1aa4a82b-e524-40f4-808e-c02e87e82427";

/**
 * Normaliza el payment_method crudo de pos_transactions al tipo PaymentMethod
 * que conoce la UI. Los proveedores externos (Stripe, MercadoPago) usan sus
 * propios valores ("card", "oxxo", "account_money", etc.) que hay que mapear.
 */
function normalizePaymentMethod(raw: string | null | undefined): PaymentMethod {
  if (!raw) return "efectivo";
  const v = raw.toLowerCase();
  if (v === "tarjeta" || v === "card" || v.includes("card") || v.includes("credit") || v.includes("debit")) return "tarjeta";
  if (v === "transferencia" || v.includes("transfer") || v === "account_money" || v === "pix") return "transferencia";
  if (v === "efectivo" || v === "cash" || v === "oxxo") return "efectivo";
  return "tarjeta"; // fallback seguro para valores desconocidos
}

/** Mapea un PosTransaction de Belange al shape BelangeTransaction para el UI */
export function posToBelangeTransaction(t: PosTransaction): BelangeTransaction {
  const meta = (t.metadata ?? {}) as Record<string, unknown>;
  return {
    id:              t.id,
    created_at:      t.created_at,
    client_name:     (meta.client_name as string)      ?? "",
    service:         t.service                         ?? "",
    price:           (meta.price_service as number)    ?? 0,
    producto:        (meta.producto as string)         ?? null,
    precio_producto: (meta.precio_producto as number)  ?? null,
    qty:             (meta.qty as number)              ?? 1,
    precio_sugerido: (meta.precio_sugerido as number)  ?? null,
    payment_method:  normalizePaymentMethod(t.payment_method),
  };
}

// ─── Belange — Inventario de productos ───────────────────────────────────────
// Tabla belange_inventory: catálogo de productos con stock y precios.
// El campo `cost` NUNCA debe exponerse en la UI del cliente.

export type BelangeCategory = "capilares" | "afeitado" | "tratamientos" | "coloracion";

export interface BelangeInventoryProduct {
  id:              string;
  client_id:       string;
  name:            string;
  brand:           string | null;
  category:        BelangeCategory | null;
  // cost — campo omitido intencionalmente del tipo cliente; solo se usa server-side
  suggested_price: number | null;
  stock_qty:       number;
  min_stock:       number;
  active:          boolean;
  created_at:      string;
  updated_at:      string;
}

/** Devuelve true si el producto está en stock crítico */
export function isBelangeLowStock(p: BelangeInventoryProduct): boolean {
  return p.stock_qty <= p.min_stock;
}

// ─── TherapyOS ────────────────────────────────────────────────────────────────

export const MARIO_CLIENT_ID = "d4e5f6a7-b8c9-4012-def0-123456789abc";

export interface TherapyPatient {
  id: string;
  client_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  started_at: string | null;         // date ISO
  active: boolean;
  session_fee: number | null;        // tarifa por sesión
  next_session_at: string | null;    // timestamptz ISO
  created_at: string;
  // Campos calculados (no en DB, se agregan en el fetch)
  session_count?: number;
}

export interface EmotionalState {
  sobriedad: "Estable" | "En riesgo" | "No aplica";
  madurez_emocional: "Alta" | "Media" | "Baja" | "En proceso";
  ansiedad: "Alta" | "Moderada" | "Baja";
  energia_vital: "Alta" | "Media" | "Baja";
  notas_emocionales: string;
}

export interface Commitment {
  texto: string;
  quien: "paciente" | "terapeuta";
  completado: boolean;
}

export interface Pattern {
  emoji: string;
  es_nuevo: boolean;
  descripcion: string;
}

export interface SessionTopic {
  label: string;
  tipo: "principal" | "insight" | "familiar" | "laboral" | "clinico";
  descripcion: string;
}

export interface SessionConnection {
  hay_conexion: boolean;
  descripcion: string;
  evolucion: string;
}

export interface TherapySession {
  id: string;
  patient_id: string;
  client_id: string;
  session_number: number;
  session_date: string;              // date ISO
  transcript: string | null;
  raw_summary: unknown | null;
  session_title: string | null;
  clinical_summary: string | null;
  patient_summary: string | null;
  briefing_next: string | null;
  private_notes: string | null;
  emotional_state: EmotionalState | null;
  commitments: Commitment[] | null;
  patterns_detected: Pattern[] | null;
  topics: SessionTopic[] | null;
  connections_to_prev: SessionConnection | null;
  payment_link: string | null;
  payment_status: "pending" | "sent" | "paid";
  ai_processed: boolean;
  created_at: string;
  updated_at: string;
}

export interface TherapySessionLog {
  id: string;
  session_id: string;
  action: "created" | "updated" | "ai_processed";
  changed_by: string | null;
  changed_at: string;
  snapshot: unknown | null;
}

// ─── CANE Neurofeedback ───────────────────────────────────────────────────────

export const CANE_CLIENT_ID = "a9b8c7d6-e5f4-3210-9876-fedcba543210";

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "rescheduled"
  | "no_response";

export interface CANEAppointment {
  id:                  string;
  client_id:           string;
  patient_name:        string;
  patient_phone:       string;
  doctor_name:         string | null;
  appointment_date:    string;   // 'YYYY-MM-DD'
  appointment_time:    string;   // 'HH:MM:SS'
  status:              AppointmentStatus;
  confirmation_method: string | null;
  notes:               string | null;
  created_at:          string;
  updated_at:          string;
}

export interface CANECallLog {
  id:               string;
  appointment_id:   string;
  provider:         "vapi" | "twilio";
  provider_call_id: string | null;
  status:           string;
  outcome:          string | null;
  duration_seconds: number | null;
  called_at:        string;
  completed_at:     string | null;
}

// ─── TBA Telecom ──────────────────────────────────────────────────────────────

export type OpportunityStage =
  | "prospecto"
  | "propuesta"
  | "negociacion"
  | "cerrado_ganado"
  | "cerrado_perdido";

export type ProductType = "hardware" | "licencia" | "hardware_licencia";

export type Currency = "MXN" | "USD";

export interface TBAOpportunity {
  id: string;
  opportunity_name: string;
  company_name: string;
  contact_name: string;
  product_type: ProductType;
  vendor: string;
  amount: number;
  currency: Currency;
  stage: OpportunityStage;
  close_date: string | null;
  notes: string | null;
  // Comisiones
  commission_rafa: number | null;
  commission_charly: number | null;
  commission_currency: Currency | null;
  commission_paid_date: string | null;
  // Fulfillment post-venta
  shipped: boolean;
  delivered: boolean;
  invoiced: boolean;
  paid: boolean;
  fulfillment_notes: string | null;
  // Auditoría — manejados por triggers en Supabase
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TBAOpportunityLog {
  id: string;
  opportunity_id: string;
  action: "created" | "updated";
  changed_by: string;
  changed_by_email: string;
  changed_at: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  snapshot: Record<string, unknown> | null;
}
