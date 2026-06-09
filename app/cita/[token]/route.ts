// app/cita/[token]/route.ts
// SieckVet — Confirmación pública de cita (sin login, por public_token).
// GET  → muestra la cita + botones Confirmar / Pedir reagendar.
// POST → procesa la acción (form submit) y devuelve el agradecimiento.
// Se usa POST para la acción para que un prefetch de email no confirme solo.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function esc(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtFecha(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function speciesIcon(s: string | null): string {
  if (s === "perro") return "🐕";
  if (s === "gato") return "🐈";
  return "🐾";
}

function shell(inner: string, title = "Confirma tu cita · SieckVet"): string {
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;800&family=Inter:wght@400;500;600&display=swap');
  :root{ --teal:#0E7C7B; --teal-dark:#085656; --mint:#E6F4F3; --cream:#F4F7F6;
    --ink:#1F2A2A; --muted:#6B7A79; --border:#DDE6E5; --amber:#D98A3D; --alert:#C0564E; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--cream);font-family:Inter,system-ui,sans-serif;color:var(--ink);
    line-height:1.6;padding:32px 16px 64px;-webkit-font-smoothing:antialiased}
  .card{max-width:520px;margin:0 auto;background:#fff;border:1px solid var(--border);
    border-radius:18px;overflow:hidden;box-shadow:0 14px 40px rgba(14,124,123,.10)}
  .head{background:var(--teal);color:#fff;padding:26px 28px;display:flex;align-items:center;gap:14px}
  .logo{width:46px;height:46px;border-radius:12px;background:rgba(255,255,255,.18);
    display:grid;place-items:center;font-size:24px}
  .head h1{font-family:'Plus Jakarta Sans',Inter,sans-serif;font-size:20px;font-weight:800}
  .head p{font-size:13px;opacity:.9}
  .body{padding:26px 28px}
  .detail{background:var(--cream);border-radius:12px;border-left:3px solid var(--teal);
    padding:16px 18px;margin:8px 0 22px;font-size:15px}
  .detail .when{font-weight:600;font-size:16px;text-transform:capitalize}
  .detail .sub{font-size:13px;color:var(--muted);margin-top:4px}
  .btns{display:flex;flex-direction:column;gap:10px}
  button{font-family:inherit;font-size:15px;font-weight:700;border:none;border-radius:10px;
    padding:14px;cursor:pointer;width:100%}
  .b-yes{background:var(--teal);color:#fff}
  .b-no{background:#fff;color:var(--amber);border:1px solid var(--amber)}
  .banner{padding:14px 16px;border-radius:10px;font-size:14px;margin-bottom:18px}
  .ok{background:var(--mint);color:var(--teal-dark)}
  .warn{background:#FDF1E3;color:#8A5A1F}
  .foot{text-align:center;padding:18px;font-size:12px;color:var(--muted);border-top:1px solid var(--border)}
  .big{font-size:42px;text-align:center;margin-bottom:10px}
  h2{font-family:'Plus Jakarta Sans',Inter,sans-serif;font-size:18px;text-align:center;margin-bottom:6px}
  .center{text-align:center;color:var(--muted)}
</style></head><body>${inner}</body></html>`;
}

function notFound(): NextResponse {
  const inner = `<div class="card"><div class="body" style="padding:48px 28px">
    <div class="big">🐾</div><h2>Cita no disponible</h2>
    <p class="center">Este enlace no es válido o la cita ya no está activa.</p>
  </div><div class="foot">SieckVet</div></div>`;
  return new NextResponse(shell(inner), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

type ApptRow = {
  id: string; status: string; confirmation_status: string; scheduled_at: string; reason: string | null;
  pet: { name: string; species: string; owner_name: string } | { name: string; species: string; owner_name: string }[] | null;
  vet: { name: string } | { name: string }[] | null;
};

async function fetchAppt(token: string): Promise<ApptRow | null> {
  const { data } = await supabaseAdmin
    .from("vet_appointments")
    .select("id, status, confirmation_status, scheduled_at, reason, pet:vet_pets(name, species, owner_name), vet:vet_vets(name)")
    .eq("public_token", token)
    .maybeSingle();
  return (data as ApptRow | null) ?? null;
}

function renderHeader(species: string | null): string {
  return `<div class="head"><div class="logo">${speciesIcon(species)}</div>
    <div><h1>SieckVet</h1><p>Confirmación de cita</p></div></div>`;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 10) return notFound();

  const a = await fetchAppt(token);
  if (!a || a.status === "cancelled") return notFound();

  const pet = Array.isArray(a.pet) ? a.pet[0] : a.pet;
  const vet = Array.isArray(a.vet) ? a.vet[0] : a.vet;
  const ownerFirst = (pet?.owner_name ?? "").split(" ")[0];

  const detail = `<div class="detail">
    <div class="when">${esc(fmtFecha(a.scheduled_at))}</div>
    <div class="sub">${esc(pet?.name ?? "")}${vet?.name ? ` · ${esc(vet.name)}` : ""}${a.reason ? ` · ${esc(a.reason)}` : ""}</div>
  </div>`;

  // Si ya respondió, mostramos el estado en lugar de los botones.
  if (a.confirmation_status === "confirmed" || a.confirmation_status === "reschedule_requested") {
    const msg = a.confirmation_status === "confirmed"
      ? `<div class="banner ok">✓ Ya confirmaste esta cita. ¡Te esperamos!</div>`
      : `<div class="banner warn">📋 Ya nos pediste reagendar. La clínica te contactará para ajustar la fecha.</div>`;
    const inner = `<div class="card">${renderHeader(pet?.species ?? null)}<div class="body">
      <p>Hola ${esc(ownerFirst || pet?.owner_name)},</p>${detail}${msg}
      <p class="center" style="font-size:13px">¿Necesitas cambiar tu respuesta? Contacta a la clínica.</p>
    </div><div class="foot">SieckVet</div></div>`;
    return new NextResponse(shell(inner), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }

  const inner = `<div class="card">${renderHeader(pet?.species ?? null)}<div class="body">
    <p>Hola ${esc(ownerFirst || pet?.owner_name)}, tienes esta cita agendada en SieckVet:</p>
    ${detail}
    <form method="POST" class="btns">
      <button class="b-yes" name="action" value="confirm" type="submit">✓ Confirmar asistencia</button>
      <button class="b-no" name="action" value="reschedule" type="submit">📅 No puedo, quiero reagendar</button>
    </form>
  </div><div class="foot">SieckVet · Gestión clínica veterinaria</div></div>`;
  return new NextResponse(shell(inner), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 10) return notFound();

  const a = await fetchAppt(token);
  if (!a || a.status === "cancelled") return notFound();

  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const newStatus = action === "confirm" ? "confirmed"
    : action === "reschedule" ? "reschedule_requested" : null;
  if (!newStatus) return notFound();

  await supabaseAdmin
    .from("vet_appointments")
    .update({ confirmation_status: newStatus })
    .eq("id", a.id);

  const pet = Array.isArray(a.pet) ? a.pet[0] : a.pet;
  const ownerFirst = (pet?.owner_name ?? "").split(" ")[0];

  const inner = newStatus === "confirmed"
    ? `<div class="card">${renderHeader(pet?.species ?? null)}<div class="body" style="padding:40px 28px">
        <div class="big">✅</div><h2>¡Cita confirmada!</h2>
        <p class="center">Gracias ${esc(ownerFirst)}. Te esperamos el ${esc(fmtFecha(a.scheduled_at))}.</p>
      </div><div class="foot">SieckVet</div></div>`
    : `<div class="card">${renderHeader(pet?.species ?? null)}<div class="body" style="padding:40px 28px">
        <div class="big">📅</div><h2>Solicitud recibida</h2>
        <p class="center">Gracias ${esc(ownerFirst)}. La clínica te contactará para reagendar la cita de ${esc(pet?.name ?? "tu mascota")}.</p>
      </div><div class="foot">SieckVet</div></div>`;

  return new NextResponse(shell(inner), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
