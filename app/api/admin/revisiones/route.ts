import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { reviewAdmin, reviewStats, type ReviewComment, type ReviewItem } from "@/lib/contentReview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista de revisiones de todos los clientes para la pestaña Revisiones del /admin.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const supabase = reviewAdmin();

  const { data: reviews, error } = await supabase
    .from("content_reviews")
    .select("id,client_id,public_token,title,status,expires_at,created_at,updated_at,items,clients(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "No se pudieron leer las revisiones." }, { status: 500 });

  const ids = (reviews ?? []).map((r) => r.id as string);
  const { data: comments } = ids.length
    ? await supabase
        .from("content_review_comments")
        .select("review_id,item_id,verdict,resolved_at,created_at")
        .in("review_id", ids)
    : { data: [] };

  const porRevision: Record<string, ReviewComment[]> = {};
  for (const c of (comments ?? []) as (ReviewComment & { review_id: string })[]) {
    (porRevision[c.review_id] ??= []).push(c);
  }

  const out = (reviews ?? []).map((r) => {
    const cliente = (r.clients as unknown as { name?: string } | null)?.name ?? "—";
    return {
      id: r.id,
      cliente,
      titulo: r.title,
      token: r.public_token,
      status: r.status,
      vence: r.expires_at,
      creada: r.created_at,
      ...reviewStats((r.items ?? []) as ReviewItem[], porRevision[r.id as string] ?? []),
    };
  });
  return NextResponse.json(out);
}
