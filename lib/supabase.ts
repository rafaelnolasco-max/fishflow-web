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
  payment_method:  PaymentMethod;
  created_at:      string;
}

// Client ID de Belange en la tabla clients (Belange Estética, CDMX)
export const BELANGE_CLIENT_ID = "33933663-79d2-4caa-86fe-7ea046082b7f";

/** Mapea un PosTransaction de Belange al shape BelangeTransaction para el UI */
export function posToBelangeTransaction(t: PosTransaction): BelangeTransaction {
  const meta = (t.metadata ?? {}) as Record<string, unknown>;
  return {
    id:              t.id,
    created_at:      t.created_at,
    client_name:     (meta.client_name as string)     ?? "",
    service:         t.service                        ?? "",
    price:           (meta.price_service as number)   ?? 0,
    producto:        (meta.producto as string)        ?? null,
    precio_producto: (meta.precio_producto as number) ?? null,
    payment_method:  (t.payment_method as PaymentMethod) ?? "efectivo",
  };
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
