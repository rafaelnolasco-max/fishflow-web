// /c/<id> — botón de WhatsApp de un correo de campaña.
// Registra el clic y manda a wa.me con el mensaje ya escrito. Mismo criterio
// que /r/<token>: el registro nunca debe tumbar el redirect.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { notifySlack, slackEscape, type SlackChannel } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANALES: SlackChannel[] = ["leads", "alertas", "enlace", "mario"];

function noDisponible() {
  return NextResponse.json({ error: "Link no disponible" }, { status: 404 });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID.test(id)) return noDisponible();

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: r } = await db
    .from("campaign_recipients")
    .select("id,name,owner,segment,monthly_amount,stage,wa_url,wa_clicked_at,wa_click_count,campaigns(name,slack_channel,clients(slug))")
    .eq("id", id)
    .maybeSingle();
  if (!r?.wa_url || !/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(r.wa_url)) return noDisponible();

  try {
    const now = new Date().toISOString();
    const primero = !r.wa_clicked_at;
    await db
      .from("campaign_recipients")
      .update({
        wa_clicked_at: r.wa_clicked_at ?? now,
        wa_click_count: (r.wa_click_count ?? 0) + 1,
        // Solo sube de "enviado" a "interesado"; nunca pisa lo que el equipo ya movió.
        ...(r.stage === "enviado" ? { stage: "interesado", stage_updated_at: now, stage_updated_by: "clic en WhatsApp" } : {}),
        updated_at: now,
      })
      .eq("id", r.id);

    const camp = r.campaigns as unknown as { name: string; slack_channel: string | null; clients: { slug: string } | null } | null;
    if (primero && camp) {
      const canal = CANALES.includes(camp.slack_channel as SlackChannel) ? (camp.slack_channel as SlackChannel) : "leads";
      const monto = r.monthly_amount ? `$${Number(r.monthly_amount).toLocaleString("es-MX")} al mes` : null;
      await notifySlack(canal, {
        text: `💬 ${r.name} picó WhatsApp — ${camp.name}`,
        body: [r.owner ? `*Asesora:* ${slackEscape(r.owner)}` : "", monto ? `*Aportación:* ${monto}` : "", r.segment ? `*Mensaje:* ${slackEscape(r.segment)}` : ""]
          .filter(Boolean)
          .join("\n"),
        button: { label: "Ver en el panel", url: `https://www.fishflow.mx/app/${camp.clients?.slug ?? ""}` },
      });
    }
  } catch (e) {
    console.error("[c/id] no se pudo registrar el clic:", e);
  }

  const res = NextResponse.redirect(r.wa_url, 302);
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
