import { NextRequest, NextResponse } from "next/server";
import {
  MAX_COMMENTS_PER_REVIEW,
  loadComments,
  loadReviewByToken,
  reviewAdmin,
  type Verdict,
} from "@/lib/contentReview";
import { notifySlack, slackEscape, type SlackChannel } from "@/lib/slack";

export const runtime = "nodejs";

// ════════════════════════════════════════════════════════════════════════════
// Revisión en línea — guardar un comentario o visto bueno
// ════════════════════════════════════════════════════════════════════════════
// Sin candado de sesión a propósito: quien revisa es el cliente y no tiene
// cuenta. Lo que autoriza es el token (largo y con caducidad). Todo se resuelve
// desde el token: la ruta no acepta review_id ni client_id del navegador.

const VERDICTS: Verdict[] = ["aprobado", "cambios", "comentario"];
const SLACK_CHANNELS: SlackChannel[] = ["leads", "alertas", "enlace", "mario"];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      token?: string;
      item_id?: string | null;
      author?: string;
      verdict?: string;
      body?: string;
    };
    const token = String(body.token ?? "");
    const author = String(body.author ?? "").trim().slice(0, 80);
    const verdict = String(body.verdict ?? "") as Verdict;
    const texto = String(body.body ?? "").trim().slice(0, 4000);
    const itemId = body.item_id ? String(body.item_id) : null;

    if (!token || !author || !VERDICTS.includes(verdict)) {
      return NextResponse.json({ error: "Petición incompleta." }, { status: 400 });
    }
    if (verdict !== "aprobado" && !texto) {
      return NextResponse.json({ error: "Escribe tu comentario." }, { status: 400 });
    }

    const supabase = reviewAdmin();
    const found = await loadReviewByToken(supabase, token);
    if (!found.ok) {
      return NextResponse.json(
        { error: found.reason === "expired" ? "La liga ya venció." : "Liga no válida." },
        { status: found.reason === "expired" ? 410 : 404 },
      );
    }
    const { review } = found;
    if (review.status !== "open") {
      return NextResponse.json({ error: "Esta revisión ya se cerró." }, { status: 409 });
    }

    // Solo piezas que existan en la revisión (null = comentario general).
    const item = itemId ? review.items.find((i) => i.id === itemId) : null;
    if (itemId && !item) {
      return NextResponse.json({ error: "Pieza no encontrada." }, { status: 404 });
    }
    // Quien comenta debe ser uno de los revisores, si la revisión los define.
    if (review.reviewers.length && !review.reviewers.includes(author)) {
      return NextResponse.json({ error: "Elige quién comenta." }, { status: 400 });
    }

    const { count } = await supabase
      .from("content_review_comments")
      .select("id", { count: "exact", head: true })
      .eq("review_id", review.id);
    if ((count ?? 0) >= MAX_COMMENTS_PER_REVIEW) {
      return NextResponse.json({ error: "Se alcanzó el máximo de comentarios." }, { status: 429 });
    }

    const { error } = await supabase.from("content_review_comments").insert({
      review_id: review.id,
      client_id: review.client_id,
      item_id: itemId,
      author,
      verdict,
      body: texto,
    });
    if (error) {
      console.error("[revision/comentar] insert:", error);
      return NextResponse.json({ error: "No se pudo guardar." }, { status: 500 });
    }

    // Aviso al equipo. Nunca bloquea la respuesta al cliente.
    const canal = SLACK_CHANNELS.includes(review.slack_channel as SlackChannel)
      ? (review.slack_channel as SlackChannel)
      : "leads";
    const etiqueta = { aprobado: "✅ Aprobado", cambios: "✏️ Pide cambios", comentario: "💬 Comentario" }[verdict];
    const pieza = item ? `${item.n ? `${item.n}. ` : ""}${item.titulo}` : "Comentario general";
    await notifySlack(canal, {
      text: `${etiqueta} — ${author} en «${review.title}»`,
      body: [`*Pieza:* ${slackEscape(pieza)}`, texto ? `> ${slackEscape(texto).replace(/\n/g, "\n> ")}` : ""]
        .filter(Boolean)
        .join("\n"),
      button: { label: "Abrir la revisión", url: `https://www.fishflow.mx/revision/${review.public_token}` },
    });

    const comments = await loadComments(supabase, review.id);
    return NextResponse.json({ ok: true, comments });
  } catch (e) {
    console.error("[revision/comentar]", e);
    return NextResponse.json({ error: "Algo salió mal." }, { status: 500 });
  }
}
