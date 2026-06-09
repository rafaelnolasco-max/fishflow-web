// app/resumen/[token]/route.ts
// SieckVet — Resumen público de consulta veterinaria.
// Sin autenticación: se accede por public_token (no adivinable) vía service-role.
// Devuelve HTML autónomo con branding de veterinaria, para abrir/compartir.

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
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(iso));
}

function speciesIcon(s: string | null): string {
  if (s === "perro") return "🐕";
  if (s === "gato") return "🐈";
  return "🐾";
}

function page(body: string, title = "Resumen de consulta · SieckVet"): string {
  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;800&family=Inter:wght@400;500;600&display=swap');
  :root{ --teal:#0E7C7B; --teal-dark:#085656; --mint:#E6F4F3; --cream:#F4F7F6;
    --ink:#1F2A2A; --muted:#6B7A79; --border:#DDE6E5; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--cream);font-family:Inter,system-ui,sans-serif;color:var(--ink);
    line-height:1.6;padding:32px 16px 64px;-webkit-font-smoothing:antialiased}
  .card{max-width:600px;margin:0 auto;background:#fff;border:1px solid var(--border);
    border-radius:18px;overflow:hidden;box-shadow:0 14px 40px rgba(14,124,123,.10)}
  .head{background:var(--teal);color:#fff;padding:26px 28px;display:flex;align-items:center;gap:14px}
  .logo{width:46px;height:46px;border-radius:12px;background:rgba(255,255,255,.18);
    display:grid;place-items:center;font-size:24px}
  .head h1{font-family:'Plus Jakarta Sans',Inter,sans-serif;font-size:20px;font-weight:800}
  .head p{font-size:13px;opacity:.9}
  .body{padding:26px 28px}
  .greet{font-size:15px;margin-bottom:6px}
  .meta{font-size:13px;color:var(--muted);margin-bottom:20px}
  .row{display:flex;gap:13px;padding:14px 16px;background:var(--cream);border-radius:12px;
    border-left:3px solid var(--teal);margin-bottom:11px}
  .row .ic{font-size:18px}
  .row .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--teal-dark);
    font-weight:600;margin-bottom:3px}
  .row .val{font-size:14px;color:var(--ink)}
  .note{margin-top:20px;font-size:12px;color:var(--muted);background:var(--mint);
    border-radius:10px;padding:12px 14px;line-height:1.5}
  .foot{text-align:center;padding:18px;font-size:12px;color:var(--muted);border-top:1px solid var(--border)}
  .empty{max-width:480px;margin:60px auto;text-align:center;color:var(--muted)}
  .empty .ic{font-size:42px;margin-bottom:12px}
</style></head><body>${body}</body></html>`;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const html404 = page(`<div class="empty"><div class="ic">🐾</div>
    <h2 style="font-family:'Plus Jakarta Sans',Inter,sans-serif">Resumen no disponible</h2>
    <p style="margin-top:8px">Este enlace no es válido o el resumen aún no está listo.</p></div>`);

  if (!token || token.length < 10) {
    return new NextResponse(html404, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const { data: s } = await supabaseAdmin
    .from("vet_visit_summaries")
    .select("id, raw_summary, owner_summary, approved_at, sent_at, appointment:vet_appointments(scheduled_at, reason, pet:vet_pets(name, species, owner_name), vet:vet_vets(name))")
    .eq("public_token", token)
    .maybeSingle();

  // Solo visible cuando el veterinario lo aprobó (o ya se envió).
  if (!s || (!s.approved_at && !s.sent_at)) {
    return new NextResponse(html404, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  const appt = Array.isArray(s.appointment) ? s.appointment[0] : s.appointment;
  const pet = appt ? (Array.isArray(appt.pet) ? appt.pet[0] : appt.pet) : null;
  const vet = appt ? (Array.isArray(appt.vet) ? appt.vet[0] : appt.vet) : null;
  const raw = (s.raw_summary ?? {}) as Record<string, string>;

  const ownerFirst = (pet?.owner_name ?? "").split(" ")[0];
  const rows = [
    { ic: "🔍", lbl: "Motivo de consulta", val: raw.motivo },
    { ic: "💊", lbl: "Diagnóstico / Observaciones", val: raw.diagnostico },
    { ic: "📋", lbl: "Indicaciones", val: raw.indicaciones },
    { ic: "📅", lbl: "Próxima cita recomendada", val: raw.proxima_cita },
  ].filter((r) => r.val);

  const body = `<div class="card">
    <div class="head">
      <div class="logo">${speciesIcon(pet?.species ?? null)}</div>
      <div>
        <h1>SieckVet</h1>
        <p>Resumen de consulta veterinaria</p>
      </div>
    </div>
    <div class="body">
      <p class="greet">Hola ${esc(ownerFirst || pet?.owner_name)}, aquí el resumen de la consulta de
        <strong>${esc(pet?.name ?? "tu mascota")}</strong>${vet?.name ? ` con ${esc(vet.name)}` : ""}:</p>
      <p class="meta">${esc(fmtFecha(appt?.scheduled_at ?? null))}</p>
      ${rows.map((r) => `<div class="row"><span class="ic">${r.ic}</span>
        <div><div class="lbl">${r.lbl}</div><div class="val">${esc(r.val).replace(/\n/g, "<br>")}</div></div></div>`).join("")}
      <div class="note">📌 Este es un resumen de la consulta para tu referencia. El expediente clínico oficial lo conserva la veterinaria. Ante cualquier duda o si notas algo fuera de lo normal, contacta a la clínica.</div>
    </div>
    <div class="foot">SieckVet · Gestión clínica veterinaria</div>
  </div>`;

  return new NextResponse(page(body), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
