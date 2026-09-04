// FishFlow — Módulo Descubrimiento
// ─────────────────────────────────────────────────────────────────────────────
// El cuestionario que antes se mandaba en PDF, ahora como link con token.
// El prospecto no tiene cuenta: el token ES la credencial, así que todo lo
// público pasa por service-role desde el servidor y nada toca Storage desde
// el navegador.
//
// El cuestionario vive como datos en `discovery_templates.blocks`. Cambiar de
// vertical es sembrar otra fila, no escribir otra pantalla.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const DISCOVERY_BUCKET = "discovery-uploads";

/** Igual que el tope del bucket. Se valida aquí para dar un error entendible. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Tope de archivos por invitación. No es una cuota comercial: la ruta de la
 * foto gasta créditos del modelo y NO lleva candado de sesión, así que sin
 * tope cualquiera con el link podría vaciar la cuenta subiendo imágenes.
 */
export const MAX_ATTACHMENTS_PER_INVITE = 8;

/** Lo que acepta el bucket. */
export const ALLOWED_UPLOAD_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

/** De lo anterior, lo que el modelo puede mirar. HEIC y PDF se guardan nomás. */
export const VISION_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export type QuestionType = "text" | "textarea" | "choice" | "multi" | "photo";

export interface DiscoveryQuestion {
  id: string;
  /** Número que se pinta en pantalla ("01"). Decorativo, no es el id. */
  n?: string;
  type: QuestionType;
  label: string;
  hint?: string;
  options?: string[];
  required?: boolean;
  /** Aviso en rojo antes del control. Se usa para el "tapa los datos". */
  warning?: string;
}

export interface DiscoveryBlock {
  id: string;
  label: string;
  title: string;
  questions: DiscoveryQuestion[];
}

export interface DiscoveryTemplate {
  id: string;
  client_id: string;
  name: string;
  vertical: string;
  intro: string | null;
  blocks: DiscoveryBlock[];
  active: boolean;
}

export type InviteStatus = "sent" | "opened" | "in_progress" | "submitted";

export interface DiscoveryInvite {
  id: string;
  client_id: string;
  template_id: string;
  public_token: string;
  prospect_name: string;
  prospect_org: string | null;
  prospect_email: string | null;
  prospect_phone: string | null;
  status: InviteStatus;
  answers: Record<string, unknown>;
  progress: number;
  opened_at: string | null;
  last_saved_at: string | null;
  submitted_at: string | null;
  expires_at: string;
}

/** Lo que el modelo devuelve al mirar la foto de un documento del prospecto. */
export interface NotaLeida {
  legible: boolean;
  motivo_no_legible?: string;
  campos_detectados: string[];
  nota: {
    motivo?: string;
    padecimiento_actual?: string;
    antecedentes?: string;
    exploracion?: string;
    estudios?: string;
    diagnostico?: string;
    plan?: string;
    medicacion?: string[];
    proxima_cita?: string;
  };
  indicaciones_paciente?: string;
}

/**
 * Cliente con service-role. Solo para el servidor: estas rutas son públicas y
 * la autorización la da el token, no la sesión.
 */
export function discoveryAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/** Token opaco de 32 caracteres. El constraint de la tabla exige >= 24. */
export function newDiscoveryToken(): string {
  const alfabeto = "abcdefghijkmnopqrstuvwxyz23456789"; // sin l/1/0/o: se dictan por teléfono
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join("");
}

/** Una respuesta cuenta si tiene algo escrito o algo elegido. */
export function isAnswered(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

/** Avance 0-100 sobre el total de preguntas del cuestionario. */
export function computeProgress(
  blocks: DiscoveryBlock[],
  answers: Record<string, unknown>,
): number {
  const total = blocks.reduce((n, b) => n + b.questions.length, 0);
  if (total === 0) return 0;
  const hechas = blocks.reduce(
    (n, b) => n + b.questions.filter((q) => isAnswered(answers[q.id])).length,
    0,
  );
  return Math.round((hechas / total) * 100);
}

/** Nombre seguro para Storage: sin acentos, espacios ni rutas. */
export function safeFileName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .slice(-80) || "archivo"
  );
}

export type InviteLookup =
  | { ok: true; invite: DiscoveryInvite; template: DiscoveryTemplate }
  | { ok: false; reason: "not_found" | "expired" };

/**
 * Busca la invitación por token y trae su cuestionario. No distingue entre
 * token inexistente y token mal escrito: hacia afuera, ambos son lo mismo.
 */
export async function loadInviteByToken(
  supabase: SupabaseClient,
  token: string,
): Promise<InviteLookup> {
  if (!token || token.length < 24) return { ok: false, reason: "not_found" };

  const { data, error } = await supabase
    .from("discovery_invites")
    .select("*, template:discovery_templates(*)")
    .eq("public_token", token)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "not_found" };

  const template = (data as Record<string, unknown>).template as DiscoveryTemplate | null;
  if (!template) return { ok: false, reason: "not_found" };

  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  const { template: _omitido, ...invite } = data as Record<string, unknown>;
  return {
    ok: true,
    invite: invite as unknown as DiscoveryInvite,
    template: { ...template, blocks: (template.blocks ?? []) as DiscoveryBlock[] },
  };
}
