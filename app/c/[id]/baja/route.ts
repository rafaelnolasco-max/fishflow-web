// /c/<id>/baja — darse de baja de una campaña.
// GET muestra un botón de confirmación (los filtros de correo abren las ligas
// solos; si GET diera de baja, se darían de baja clientes que nunca lo pidieron).
// POST da de baja: lo usa el botón y también Gmail/Outlook con
// List-Unsubscribe-Post (one-click).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function pagina(negocio: string, cuerpo: string) {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Baja · ${esc(negocio)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;background:#f6f7f9;color:#1f2933}
.card{max-width:380px;width:calc(100% - 32px);background:#fff;border-radius:16px;padding:30px 24px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.08)}
h1{font-size:19px;margin:0 0 10px}p{font-size:15px;line-height:1.5;color:#52606d;margin:0 0 20px}
button{width:100%;background:#1f2933;color:#fff;border:0;border-radius:10px;padding:14px;font-size:16px;font-weight:600;cursor:pointer}</style>
</head><body><div class="card">${cuerpo}</div></body></html>`;
  return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function buscar(id: string) {
  if (!UUID.test(id)) return null;
  const { data } = await db()
    .from("campaign_recipients")
    .select("id,stage,unsubscribed_at,campaigns(clients(name))")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const negocio =
    (data.campaigns as unknown as { clients: { name: string } | null } | null)?.clients?.name ?? "nosotros";
  return { ...data, negocio };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await buscar(id);
  if (!r) return pagina("FishFlow", "<h1>Liga no disponible</h1><p>Revisa que esté completa.</p>");
  if (r.unsubscribed_at) return pagina(r.negocio, `<h1>Listo</h1><p>Ya no recibirás estos correos de ${esc(r.negocio)}.</p>`);
  return pagina(
    r.negocio,
    `<h1>¿Dejar de recibir estos correos?</h1><p>${esc(r.negocio)} no te volverá a escribir por esta campaña.</p>
<form method="post"><button type="submit">Sí, darme de baja</button></form>`,
  );
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await buscar(id);
  if (!r) return pagina("FishFlow", "<h1>Liga no disponible</h1><p>Revisa que esté completa.</p>");
  if (!r.unsubscribed_at) {
    const now = new Date().toISOString();
    const { error } = await db()
      .from("campaign_recipients")
      .update({ unsubscribed_at: now, stage: "baja", stage_updated_at: now, stage_updated_by: "el cliente (liga de baja)", updated_at: now })
      .eq("id", r.id);
    if (error) console.error("[c/id/baja]", error);
  }
  return pagina(r.negocio, `<h1>Listo</h1><p>Ya no recibirás estos correos de ${esc(r.negocio)}.</p>`);
}
