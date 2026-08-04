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

// Item individual dentro de una venta multi-producto
export interface BelangeCartItem {
  nombre:           string;
  precio:           number;
  qty:              number;
  product_id?:      string | null;
  precio_sugerido?: number | null;
}

export interface BelangeTransaction {
  id:              string;
  client_name:     string;
  service:         string;
  price:           number;         // precio del servicio (metadata.price_service)
  producto?:       string | null;
  precio_producto?: number | null;
  qty:             number;         // qty total de productos vendidos
  precio_sugerido?: number | null; // precio de lista del primer item (compat)
  payment_method:  PaymentMethod;
  created_at:      string;
  items?:          BelangeCartItem[]; // multi-producto: si existe, tiene prioridad
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

  // Formato nuevo: metadata.items (multi-producto)
  const rawItems = meta.items as BelangeCartItem[] | undefined;
  if (rawItems && rawItems.length > 0) {
    const totalProductos = rawItems.reduce((s, i) => s + i.precio * i.qty, 0);
    const totalQty       = rawItems.reduce((s, i) => s + i.qty, 0);
    return {
      id:              t.id,
      created_at:      t.created_at,
      client_name:     (meta.client_name as string) ?? "",
      service:         t.service                    ?? "",
      price:           (meta.price_service as number) ?? 0,
      producto:        rawItems[0].nombre,
      precio_producto: totalProductos,
      qty:             totalQty,
      precio_sugerido: rawItems[0].precio_sugerido ?? null,
      payment_method:  normalizePaymentMethod(t.payment_method),
      items:           rawItems,
    };
  }

  // Formato anterior: un solo producto (backward compat)
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
  source_type?: string | null;
  audio_path?: string | null;
  transcription_id?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
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

// ─── SieckVet — Veterinaria (demo vivo) ───────────────────────────────────────
// client_id en la tabla clients. Replica el patrón de TherapyOS.
export const SIECKVET_CLIENT_ID = "2d6f44b7-ea36-47f1-85ae-ed5129799d2c";

export type VetSpecies = "perro" | "gato" | "otro";
export type VetApptStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type VetConfirmStatus = "pending" | "confirmed" | "reschedule_requested" | "cancelled";

export interface VetVet {
  id: string;
  client_id: string;
  name: string;
  specialty: string | null;
  active: boolean;
  created_at: string;
}

export interface VetPet {
  id: string;
  client_id: string;
  name: string;
  species: VetSpecies;
  breed: string | null;
  sex: string | null;
  birth_date: string | null;
  owner_name: string;
  owner_phone: string | null;
  owner_email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  // enriquecido en el UI
  appt_count?: number;
}

export interface VetAppointment {
  id: string;
  client_id: string;
  pet_id: string;
  vet_id: string | null;
  scheduled_at: string;
  reason: string | null;
  status: VetApptStatus;
  confirmation_status: VetConfirmStatus;
  confirmation_sent_at: string | null;
  public_token: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // joins opcionales
  pet?: VetPet | null;
  vet?: VetVet | null;
}

export interface VetVisitSummaryRaw {
  motivo?: string;
  diagnostico?: string;
  indicaciones?: string;
  proxima_cita?: string;
}

export interface VetVisitSummary {
  id: string;
  client_id: string;
  appointment_id: string;
  transcription_id: string | null;
  source_type: string | null;
  transcript: string | null;
  raw_summary: VetVisitSummaryRaw | null;
  owner_summary: string | null;
  ai_processed: boolean;
  approved_at: string | null;
  sent_at: string | null;
  public_token: string;
  created_at: string;
  updated_at: string;
  // joins opcionales
  appointment?: VetAppointment | null;
}

// ─── HireFlow — Reclutamiento / ATS con IA (demo vivo) ────────────────────────
// client_id en la tabla clients. Replica el patrón de TherapyOS / SieckVet.
export const HIREFLOW_CLIENT_ID = "a7c3f9e2-1b4d-4a6e-8f2c-9d0e1a2b3c4d";

export type HiringPositionStatus = "open" | "paused" | "closed" | "filled";
export type HiringAppStatus =
  | "new" | "screening" | "interviewing" | "finalist" | "hired" | "rejected" | "withdrawn";
export type HiringInterviewStatus = "scheduled" | "completed" | "canceled" | "no_show";
export type HiringRecommendation = "advance" | "hold" | "reject" | string;

export interface HiringStage {
  order: number;
  name: string;
  type: string; // "interview" | "panel" | ...
}

export interface HiringRequirements {
  must_have?: string[];
  nice_to_have?: string[];
  min_years?: number;
}

export interface HiringPosition {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  requirements: string | null;
  requirements_struct: HiringRequirements | null;
  department: string | null;
  location: string | null;
  employment_type: string | null;
  stages: HiringStage[];
  status: HiringPositionStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // enriquecido en el UI
  app_count?: number;
}

export interface HiringCandidate {
  id: string;
  client_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  cv_storage_path: string | null;
  cv_text: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export interface HiringMatchDetails {
  cumple?: string[];
  parcial?: string[];
  falta?: string[];
}

export interface HiringVerdictDetails {
  ranking?: number;
  fortalezas?: string[];
  riesgos?: string[];
}

export interface HiringApplication {
  id: string;
  client_id: string;
  position_id: string;
  candidate_id: string;
  match_score: number | null;
  match_summary: string | null;
  match_details: HiringMatchDetails | null;
  current_stage: number;
  status: HiringAppStatus;
  final_verdict: string | null;
  final_verdict_details: HiringVerdictDetails | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  // joins opcionales
  candidate?: HiringCandidate | null;
  position?: HiringPosition | null;
  interviews?: HiringInterview[];
}

export interface HiringInterviewRaw {
  fortalezas?: string[];
  debilidades?: string[];
  recomendacion?: string;
}

export interface HiringInterview {
  id: string;
  client_id: string;
  application_id: string;
  stage_order: number | null;
  stage_name: string | null;
  interviewer_name: string | null;
  interviewer_role: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  status: HiringInterviewStatus;
  transcription_id: string | null;
  transcript: string | null;
  source_type: string | null;
  raw_summary: HiringInterviewRaw | null;
  ai_summary: string | null;
  ai_processed: boolean;
  score: number | null;
  recommendation: HiringRecommendation | null;
  created_at: string;
  updated_at: string;
}

// ─── Mario Citalán — Arquitectura del Criterio ─────────────────────────────────
// Panel de prospectos de las evaluaciones (mariocitalan.net), SEPARADO de
// TherapyOS (su consultorio, MARIO_CLIENT_ID más arriba).

export const CRITERIO_CLIENT_ID = "ea5266d5-cabb-44e2-a96a-0a0f40da07e7";

/** Prospecto de las evaluaciones de Actitud / Criterio (tabla genérica `leads`). */
export interface CriterioLead {
  id:          string;
  name:        string;
  email:       string;
  phone:       string | null;
  problem:     string;
  ai_response: string | null;
  profile:     string | null;
  route:       string | null;
  answers:     Record<string, unknown> | null;
  notes:       string | null;
  opt_in:      boolean;
  /** Estado en el embudo de suscripción: pendiente | suscrito | baja | fuera */
  newsletter:  string | null;
  newsletter_at:   string | null;
  newsletter_note: string | null;
  /**
   * Alta en la lista de espera del libro "Ciencia en escena".
   * Permiso INDEPENDIENTE de `newsletter`: autoriza el aviso de lanzamiento,
   * no el boletín recurrente. NULL = no está en la lista.
   */
  libro_at:    string | null;
  source:      string | null;
  status:      string | null;
  created_at:  string;
}

// ─── Enlace Integral Seguros ───────────────────────────────────────────────────

export const ENLACE_CLIENT_ID = "e8094119-0414-4d46-8506-6ee1a52e852c";

export interface InsuranceVendorTopClient {
  id:                 string;
  client_id:          string;
  vendor_name:        string;
  client_name:        string;
  phone:              string;
  email:              string;
  city:               string | null;
  state:              string | null;
  postal_code:        string | null;
  gender:             string | null;
  birth_date_or_age:  string | null;
  // Campos Avatar CRM (HubSpot)
  color:              string | null;
  occupation_type:    string | null;
  profession:         string | null;
  income:             string | null;
  dependents:         string | null;
  relevant_note:      string | null;
  products:           string | null;
  source:             "web_form" | "excel_upload";
  created_at:         string;
}

// ─── regintel — Inteligencia Regulatoria (vertical regulatorio_farma) ─────────
// Slug neutro a propósito: la vertical es reutilizable con otras farmacéuticas.
export const REGINTEL_CLIENT_ID = "c2b2a692-7f39-42a1-841a-5ae31e21e851";

export type RegIntelTipo = "autorizado" | "revocado" | "cancelado" | "solicitud";
export type RegIntelEstado = "pendiente" | "aprobado" | "descartado";
export type RegIntelClasificacion =
  | "ya_en_base" | "fuera_de_base_curada" | "producto_propio" | "discrepancia";

export interface RegIntelSource {
  id: string;
  client_id: string;
  canal: string;
  anio: number | null;
  nombre: string;
  url: string;
  attachment_id: string | null;
  last_modified: string | null;
  etag: string | null;
  sha256: string | null;
  bytes: number | null;
  registros_declarados: number | null;
  registros_parseados: number | null;
  declarado_es_incremento: boolean;
  cuadra: boolean | null;
  storage_path: string | null;
  detectado_en: string;
  revisado_en: string | null;
  origen: "automatico" | "manual";
  estado_proceso: "pendiente" | "procesado" | "error";
  nombre_archivo: string | null;
  subido_por: string | null;
  nota: string | null;
}

export interface RegIntelWatchlist {
  id: string;
  client_id: string;
  molecula: string;
  sinonimos: string[];
  portafolio: string | null;
  producto_propio: string | null;
  interes_comercial: boolean;
  activo: boolean;
}

export interface RegIntelRegistro {
  id: string;
  client_id: string;
  source_id: string | null;
  folio: string;
  tipo: RegIntelTipo;
  titular: string | null;
  denominacion_distintiva: string | null;
  denominacion_generica: string | null;
  clasificacion: string | null;
  forma_farmaceutica: string | null;
  vigencia: string | null;
  motivo: string | null;
}

export interface RegIntelHallazgo {
  id: string;
  client_id: string;
  registro_id: string;
  watchlist_id: string | null;
  molecula_match: string;
  estado: RegIntelEstado;
  clasificacion: RegIntelClasificacion | null;
  nota: string | null;
  referencia_base: string | null;
  revisado_en: string | null;
  created_at: string;
}

export interface RegIntelConsulta {
  id: string;
  client_id: string;
  molecula: string;
  motivo: string | null;
  estado: "pendiente" | "resuelta" | "sin_resultado";
  resultado: string | null;
  consultado_en: string | null;
  storage_path: string | null;
  nombre_archivo: string | null;
  created_at: string;
}
