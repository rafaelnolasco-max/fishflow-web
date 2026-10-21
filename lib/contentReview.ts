// FishFlow — Módulo Revisión en línea
// ─────────────────────────────────────────────────────────────────────────────
// Liga privada (fishflow.mx/revision/<token>) para que el cliente revise piezas
// antes de publicarlas (correos, copys, guiones) y deje visto bueno o
// comentarios por pieza. Mismo esquema que Descubrimiento: el revisor no tiene
// cuenta, el token es la credencial y todo pasa por service-role en servidor.
//
// Tablas: content_reviews (la revisión y sus piezas) y content_review_comments.
// Ver supabase/migrations/20261021120000_content_reviews.sql.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ReviewItem {
  id: string;
  /** Número que se pinta ("1"). */
  n?: string;
  titulo: string;
  subtitulo?: string;
  tag?: string;
  asunto?: string;
  /** HTML de la pieza. Si la revisión trae shell_html, se inserta en {{contenido}}. */
  html: string;
  /** Aviso amarillo sobre la pieza (datos por confirmar, etc.). */
  nota?: string;
}

export interface ContentReview {
  id: string;
  client_id: string;
  public_token: string;
  title: string;
  intro: string | null;
  questions: string[];
  items: ReviewItem[];
  shell_html: string | null;
  reviewers: string[];
  slack_channel: string | null;
  status: "open" | "closed";
  expires_at: string;
  created_at: string;
}

export type Verdict = "aprobado" | "cambios" | "comentario";

export interface ReviewComment {
  id: string;
  item_id: string | null;
  author: string;
  verdict: Verdict;
  body: string;
  created_at: string;
}

/** Tope defensivo por revisión: sin cuenta, nada impide que alguien spamee. */
export const MAX_COMMENTS_PER_REVIEW = 400;

export function reviewAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

type Lookup =
  | { ok: true; review: ContentReview }
  | { ok: false; reason: "not_found" | "expired" };

export async function loadReviewByToken(supabase: SupabaseClient, token: string): Promise<Lookup> {
  if (!token || token.length < 24) return { ok: false, reason: "not_found" };
  const { data, error } = await supabase
    .from("content_reviews")
    .select("*")
    .eq("public_token", token)
    .maybeSingle();
  if (error || !data) return { ok: false, reason: "not_found" };
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, review: data as ContentReview };
}

export async function loadComments(supabase: SupabaseClient, reviewId: string): Promise<ReviewComment[]> {
  const { data } = await supabase
    .from("content_review_comments")
    .select("id,item_id,author,verdict,body,created_at")
    .eq("review_id", reviewId)
    .order("created_at", { ascending: true });
  return (data ?? []) as ReviewComment[];
}

/** HTML final de una pieza: el item dentro de la envoltura, si la hay. */
export function renderItemHtml(review: Pick<ContentReview, "shell_html">, item: ReviewItem): string {
  if (!review.shell_html) return item.html;
  return review.shell_html.replace("{{contenido}}", item.html);
}
