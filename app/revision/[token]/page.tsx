// app/revision/[token]/page.tsx
// Módulo Revisión en línea — la pantalla que ve el cliente.
// Sin login: el token de la liga es la credencial. noindex, porque aquí se
// revisa material privado de un cliente (nombres de sus clientes, montos).

import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { loadComments, loadReviewByToken, renderItemHtml, reviewAdmin } from "@/lib/contentReview";
import Aviso from "../../descubrimiento/[token]/Aviso";
import Revision from "./Revision";

export const dynamic = "force-dynamic";

const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--ff-mono" });

export const metadata: Metadata = {
  title: "FishFlow — Revisión en línea",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = reviewAdmin();
  const found = await loadReviewByToken(supabase, token);

  if (!found.ok) {
    return (
      <div className={mono.variable}>
        <Aviso
          titulo={found.reason === "expired" ? "Esta liga ya venció" : "Liga no válida"}
          texto={
            found.reason === "expired"
              ? "Por seguridad las ligas de revisión caducan. Escríbenos y te mandamos una nueva."
              : "Revisa que la liga esté completa. Si la copiaste de un mensaje, puede haberse cortado."
          }
        />
      </div>
    );
  }

  const { review } = found;
  const comments = await loadComments(supabase, review.id);

  return (
    <div className={mono.variable}>
      <Revision
        token={token}
        titulo={review.title}
        intro={review.intro}
        preguntas={review.questions ?? []}
        revisores={review.reviewers ?? []}
        cerrada={review.status !== "open"}
        vence={review.expires_at}
        piezas={review.items.map((it) => ({
          id: it.id,
          n: it.n,
          titulo: it.titulo,
          subtitulo: it.subtitulo,
          tag: it.tag,
          asunto: it.asunto,
          nota: it.nota,
          html: renderItemHtml(review, it),
        }))}
        comentariosIniciales={comments}
      />
    </div>
  );
}
