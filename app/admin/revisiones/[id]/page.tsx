// /admin/revisiones/<id> — panel de Rafa para una revisión.
// El middleware ya limita /admin a Rafa; aquí se repite el candado porque la
// página lee con service role.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/adminAuth";
import { loadComments, renderItemHtml, reviewAdmin, type ContentReview } from "@/lib/contentReview";
import Panel from "./Panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Revisión — FishFlow Admin", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) redirect("/login?next=/admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = reviewAdmin();
  const { data } = await supabase.from("content_reviews").select("*, clients(name)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const review = data as ContentReview & { clients: { name: string } | null };
  const comments = await loadComments(supabase, review.id);

  return (
    <Panel
      id={review.id}
      cliente={review.clients?.name ?? "—"}
      titulo={review.title}
      token={review.public_token}
      status={review.status}
      vence={review.expires_at}
      revisores={review.reviewers ?? []}
      preguntas={review.questions ?? []}
      piezas={review.items.map((it) => ({
        id: it.id,
        n: it.n,
        titulo: it.titulo,
        subtitulo: it.subtitulo,
        asunto: it.asunto,
        v: it.v ?? 1,
        ajustada_at: it.ajustada_at ?? null,
        html: renderItemHtml(review, it),
      }))}
      comentariosIniciales={comments}
    />
  );
}
