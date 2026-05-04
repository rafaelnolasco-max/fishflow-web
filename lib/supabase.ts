import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type PaymentMethod = "efectivo" | "tarjeta" | "transferencia";

export interface BelangeTransaction {
  id: string;
  client_name: string;
  service: string;
  price: number;
  payment_method: PaymentMethod;
  created_at: string;
}
