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
  payment_method: PaymentMethod;
  created_at: string;
}
