import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Cliente para componentes del browser — mantiene la sesión sincronizada con el middleware
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

export type PaymentMethod = "efectivo" | "tarjeta" | "transferencia";

export interface BelangeTransaction {
  id: string;
  client_name: string;
  service: string;
  price: number;
  producto?: string | null;
  precio_producto?: number | null;
  payment_method: PaymentMethod;
  created_at: string;
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
  created_at: string;
  updated_at: string;
}
