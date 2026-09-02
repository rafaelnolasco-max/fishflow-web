// FishFlow — Motor de Programas · helpers de servidor
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ El modelo de acceso de la PERSONA INSCRITA es distinto al del staff.
//
// A un terapeuta o a Rafa se les valida con `requireClientAccess` (lib/apiAuth):
// tienen fila en `user_client_access` y la RLS les abre todo el cliente.
//
// A la persona inscrita NO. Darle `user_client_access` del cliente de Mario le
// abriría su panel entero: prospectos, correos y evaluaciones de terceros. Su
// identidad vive en `program_enrollments.user_id`, y estas rutas corren con
// service role validando a mano que la inscripción sea suya. Por eso el
// navegador de la persona nunca consulta estas tablas directo.

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const PROGRAMA_CLIENT_ID = "ea5266d5-cabb-44e2-a96a-0a0f40da07e7";
export const PROGRAMA_SLUG = "reconstruccion-mental";

/** Cliente con service role. Solo para rutas que ya validaron quién llama. */
export function adminDb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export type SesionPersona = { userId: string; email: string };

/** La sesión de quien llama, sin exigir acceso a ningún cliente. */
export async function getSesion(): Promise<SesionPersona | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { userId: user.id, email: user.email.toLowerCase() };
}

export type Inscripcion = {
  id: string;
  program_id: string;
  client_id: string;
  patient_id: string | null;
  lead_id: string | null;
  user_id: string | null;
  status: string;
  current_step: number;
};

/**
 * La inscripción de esta persona. Devuelve null si no tiene: eso NO es un error
 * del servidor, es alguien que todavía no acepta su invitación.
 */
export async function inscripcionDe(
  db: SupabaseClient,
  userId: string,
): Promise<Inscripcion | null> {
  const { data, error } = await db
    .from("program_enrollments")
    .select("id, program_id, client_id, patient_id, lead_id, user_id, status, current_step")
    .eq("user_id", userId)
    .in("status", ["activo", "pausado", "completado"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as Inscripcion) ?? null;
}

/** Normaliza un correo para comparar. El de la sesión y el del lead deben coincidir. */
export function mismoCorreo(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
