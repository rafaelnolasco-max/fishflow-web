import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/adminAuth";
import { loadComments, reviewAdmin } from "@/lib/contentReview";

export const runtime = "nodejs";

// Acciones de Rafa sobre una revisión:
//   resolve  { comment_id, note? }  → marca el comentario como ajustado
//   unresolve{ comment_id }         → lo regresa a pendiente
//   close / reopen                  → la liga del cliente pasa a solo lectura / se reabre
//   extend   { days }               → recorre el vencimiento desde hoy o desde la fecha actual (la mayor)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const supabase = reviewAdmin();
  const b = (await req.json().catch(() => ({}))) as {
    action?: string;
    comment_id?: string;
    note?: string;
    days?: number;
  };

  const { data: review } = await supabase
    .from("content_reviews")
    .select("id,expires_at")
    .eq("id", id)
    .maybeSingle();
  if (!review) return NextResponse.json({ error: "Revisión no encontrada." }, { status: 404 });

  let error: { message: string } | null = null;
  const now = new Date().toISOString();

  switch (b.action) {
    case "resolve":
    case "unresolve": {
      if (!b.comment_id) return NextResponse.json({ error: "Falta el comentario." }, { status: 400 });
      const patch =
        b.action === "resolve"
          ? { resolved_at: now, resolution_note: String(b.note ?? "").trim().slice(0, 2000) || null }
          : { resolved_at: null, resolution_note: null };
      ({ error } = await supabase
        .from("content_review_comments")
        .update(patch)
        .eq("id", b.comment_id)
        .eq("review_id", id));
      break;
    }
    case "close":
    case "reopen":
      ({ error } = await supabase
        .from("content_reviews")
        .update({ status: b.action === "close" ? "closed" : "open", updated_at: now })
        .eq("id", id));
      break;
    case "extend": {
      const days = Math.min(Math.max(Math.round(Number(b.days) || 7), 1), 60);
      const base = Math.max(Date.now(), new Date(review.expires_at as string).getTime());
      ({ error } = await supabase
        .from("content_reviews")
        .update({ expires_at: new Date(base + days * 86400000).toISOString(), updated_at: now })
        .eq("id", id));
      break;
    }
    default:
      return NextResponse.json({ error: "Acción no válida." }, { status: 400 });
  }

  if (error) {
    console.error("[admin/revisiones] patch:", error);
    return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
  }

  const { data: fresh } = await supabase
    .from("content_reviews")
    .select("status,expires_at")
    .eq("id", id)
    .single();
  return NextResponse.json({ ok: true, status: fresh?.status, vence: fresh?.expires_at, comments: await loadComments(supabase, id) });
}
