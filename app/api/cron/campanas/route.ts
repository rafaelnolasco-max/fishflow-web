// Cron de campañas: cada día hábil manda la siguiente tanda (daily_limit) de
// cada campaña en status 'sending'. Cuando ya no queda nadie por enviar, la
// marca 'done'. Pausar = poner status 'paused' en la base.
// Tope duro: daily_limit por campaña en cualquier ventana de 20 h.
//
// Un correo por destinatario, nunca en copia. Reply-To al buzón real de la
// asesora; List-Unsubscribe para que Gmail ofrezca la baja de un clic.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getResend } from "@/lib/email";
import { bajaLink, renderRecipientHtml } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const resend = getResend();
  if (!resend) return NextResponse.json({ error: "Sin RESEND_API_KEY" }, { status: 500 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: campañas } = await db.from("campaigns").select("id,name,from_address,daily_limit").eq("status", "sending");
  const resumen: Record<string, { enviados: number; errores: number }> = {};

  for (const c of campañas ?? []) {
    // El ritmo vive en la base, no en quién llama: aunque el endpoint se dispare
    // varias veces, nunca salen más de daily_limit en 20 horas por campaña.
    const desde = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
    const { count: recientes } = await db
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .gte("sent_at", desde);
    const cupo = Math.max(0, c.daily_limit - (recientes ?? 0));
    if (cupo === 0) {
      resumen[c.name] = { enviados: 0, errores: 0 };
      continue;
    }

    const { data: lote } = await db
      .from("campaign_recipients")
      .select("id,name,email,subject,html,from_name,reply_to,stage")
      .eq("campaign_id", c.id)
      .is("sent_at", null)
      .is("unsubscribed_at", null)
      .neq("stage", "baja")
      .order("created_at", { ascending: true })
      .limit(cupo);

    let enviados = 0;
    let errores = 0;
    for (const r of lote ?? []) {
      // Apartar el renglón antes de mandar: si dos corridas se cruzan, solo una lo envía.
      const now = new Date().toISOString();
      const { data: apartado } = await db
        .from("campaign_recipients")
        .update({ sent_at: now, updated_at: now })
        .eq("id", r.id)
        .is("sent_at", null)
        .select("id");
      if (!apartado?.length) continue;

      const from = `${(r.from_name || "").replace(/[<>"]/g, "") || c.name} <${c.from_address}>`;
      const { error } = await resend.emails.send({
        from,
        to: [r.email],
        subject: r.subject,
        html: renderRecipientHtml(r.html, r.id),
        ...(r.reply_to ? { replyTo: r.reply_to } : {}),
        headers: {
          "List-Unsubscribe": `<${bajaLink(r.id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        tags: [{ name: "campaign", value: c.id }],
      });

      if (error) {
        errores++;
        console.error("[cron/campanas] envío", r.id, error);
        await db
          .from("campaign_recipients")
          .update({ stage: "error", send_error: String((error as { message?: string }).message ?? error).slice(0, 500), updated_at: now })
          .eq("id", r.id);
      } else {
        enviados++;
        if (r.stage === "pendiente") {
          await db.from("campaign_recipients").update({ stage: "enviado", updated_at: now }).eq("id", r.id);
        }
      }
      await pausa(600); // Resend: 2 peticiones por segundo
    }

    const { count } = await db
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id)
      .is("sent_at", null)
      .is("unsubscribed_at", null)
      .neq("stage", "baja");
    if ((count ?? 0) === 0) {
      await db.from("campaigns").update({ status: "done", updated_at: new Date().toISOString() }).eq("id", c.id);
    }
    resumen[c.name] = { enviados, errores };
  }

  return NextResponse.json({ ok: true, resumen });
}

export const GET = handler;
export const POST = handler;
