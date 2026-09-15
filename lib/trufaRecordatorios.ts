// FishFlow / Trufa — recordatorios del carnet
// ─────────────────────────────────────────────────────────────────────────────
// La promesa de Trufa no es guardar el carnet: es que no se te pase la fecha.
// Eso no se cumple con una pantalla, se cumple con un correo que llega cuando
// nadie abrió la app.
//
// Reglas que definen el producto, no el código:
//
//   · UN correo por dueño por día, con todas sus mascotas dentro. Con dos
//     perros y cuatro vacunas atrasadas, lo contrario son seis correos y una
//     baja.
//   · Le llega a TODOS los dueños de la mascota. Es para lo que existe
//     vet_pet_owners: si Martha lleva a Macario, Martha recibe el aviso.
//   · Tres toques por pendiente y se calla: 7 días antes, el día, 7 días
//     después. Lo vencido más viejo se junta en un resumen mensual — Macario
//     trae vacunas con 585 días de retraso y nadie aguanta que se lo repitan
//     cada mañana.
//   · Las fechas estimadas se avisan DICIENDO que son estimadas. El Cytopoint
//     no trae próxima fecha anotada; sale de la mediana de los intervalos
//     reales. Avisar sin decirlo sería vender certeza que no tenemos.

import { createClient } from "@supabase/supabase-js";
import { sendEmail, REPLY_TO } from "@/lib/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.fishflow.mx";

export type Etapa = "previo" | "hoy" | "tarde" | "mensual";

export type ItemAgenda = {
  kind: string; item_id: string; label: string;
  detail: string; due_on: string; estimated: boolean;
};

type Pendiente = ItemAgenda & { etapa: Etapa; petId: string; petName: string; dias: number };

export type ResultadoCron = {
  ok: boolean;
  mascotas: number;
  correos: number;
  pendientes: number;
  errores: string[];
};

const DIAS_PREVIO = 7;
const DIAS_TARDE = 7;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Hoy en CDMX. El cron corre en UTC; sin esto, entre las 18:00 y la medianoche
 *  la función cree que ya es mañana y los avisos salen un día antes. */
export function hoyCDMX(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function etapaDe(dias: number): Etapa | null {
  if (dias === DIAS_PREVIO) return "previo";
  if (dias === 0) return "hoy";
  if (dias === -DIAS_TARDE) return "tarde";
  return null;
}

const fmt = (iso: string) => {
  const M = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${M[m - 1]} ${y}`;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ─── Correo ───────────────────────────────────────────────────────────────────
function fila(p: Pendiente): string {
  const color = p.dias < 0 ? "#C2552E" : p.dias <= 7 ? "#E0A33E" : "#5F8A6A";
  const cuando =
    p.dias === 0 ? "Es hoy"
    : p.dias > 0 ? `En ${p.dias} día${p.dias === 1 ? "" : "s"}`
    : `Vencida hace ${Math.abs(p.dias)} días`;
  return `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid #F0E8DC;">
        <div style="font:600 15px/1.4 -apple-system,Segoe UI,sans-serif;color:#1F1714;">
          ${esc(p.petName)} · ${esc(p.label)}
        </div>
        <div style="font:400 13px/1.5 -apple-system,Segoe UI,sans-serif;color:#8E7D6D;margin-top:3px;">
          ${esc(p.detail)}${p.estimated ? " · fecha estimada con su historial" : ""}
        </div>
      </td>
      <td align="right" style="padding:14px 0;border-bottom:1px solid #F0E8DC;white-space:nowrap;vertical-align:top;">
        <div style="font:700 13px/1.4 -apple-system,Segoe UI,sans-serif;color:#1F1714;">${fmt(p.due_on)}</div>
        <div style="font:700 12px/1.4 -apple-system,Segoe UI,sans-serif;color:${color};margin-top:3px;">${cuando}</div>
      </td>
    </tr>`;
}

export function construirCorreo(nombre: string, proximos: Pendiente[], vencidos: Pendiente[]): {
  subject: string; html: string;
} {
  const principal = proximos[0] ?? vencidos[0];
  const subject = proximos.length
    ? `${principal.petName}: ${principal.label.toLowerCase()} ${principal.dias === 0 ? "es hoy" : `en ${principal.dias} días`}`
    : `${principal.petName} trae ${vencidos.length} pendiente${vencidos.length === 1 ? "" : "s"} atrasado${vencidos.length === 1 ? "" : "s"}`;

  const bloque = (titulo: string, items: Pendiente[]) => items.length
    ? `<div style="font:700 11px/1.4 -apple-system,Segoe UI,sans-serif;letter-spacing:.09em;
            text-transform:uppercase;color:#8E7D6D;margin:26px 0 4px;">${titulo}</div>
       <table width="100%" cellpadding="0" cellspacing="0">${items.map(fila).join("")}</table>`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#F6F0E8;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F6F0E8;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#FFFFFF;border:1px solid #E3D7C7;
             border-radius:14px;padding:32px;" cellpadding="0" cellspacing="0">
        <tr><td>
          <div style="font:800 22px/1.2 -apple-system,Segoe UI,sans-serif;color:#1F1714;
               letter-spacing:-.02em;">trufa</div>
          <div style="font:400 15px/1.6 -apple-system,Segoe UI,sans-serif;color:#1F1714;margin-top:20px;">
            Hola ${esc(nombre)}, esto es lo que sigue en el carnet.
          </div>
          ${bloque("Lo que viene", proximos)}
          ${bloque("Atrasado", vencidos)}
          <div style="margin-top:28px;">
            <a href="${APP_URL}/trufaapp/"
               style="display:inline-block;background:#C2552E;color:#FFF4EC;text-decoration:none;
                      font:700 14px/1 -apple-system,Segoe UI,sans-serif;padding:13px 22px;border-radius:9px;">
              Abrir el carnet
            </a>
          </div>
          <div style="font:400 12px/1.6 -apple-system,Segoe UI,sans-serif;color:#A2907E;margin-top:24px;">
            Te avisamos tres veces por pendiente y luego dejamos de escribirte: una semana
            antes, el día, y una semana después. Lo demás sigue en la app.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html };
}

// ─── Corrida ──────────────────────────────────────────────────────────────────
export async function correrRecordatorios(opts: { dryRun?: boolean } = {}): Promise<ResultadoCron> {
  const db = admin();
  const hoy = hoyCDMX();
  const errores: string[] = [];

  const { data: pets, error: petsErr } = await db
    .from("vet_pets").select("id, name, active").eq("active", true);
  if (petsErr) return { ok: false, mascotas: 0, correos: 0, pendientes: 0, errores: [petsErr.message] };

  // dueño (correo) → sus pendientes de todas sus mascotas
  const porDueno = new Map<string, { nombre: string; items: Pendiente[] }>();
  // lo que habría que anotar como enviado, por correo del dueño
  const aMarcar: { pet_id: string; item_kind: string; item_id: string; due_on: string; stage: Etapa; recipients: string[] }[] = [];
  let totalPendientes = 0;

  for (const pet of pets ?? []) {
    const { data: agenda, error: agErr } = await db.rpc("trufa_agenda", { p_pet_id: pet.id });
    if (agErr) { errores.push(`agenda ${pet.name}: ${agErr.message}`); continue; }

    const { data: duenos } = await db
      .from("vet_pet_owners").select("email, display_name").eq("pet_id", pet.id);
    const correos = (duenos ?? []).map(d => ({
      email: (d.email as string).toLowerCase(),
      nombre: (d.display_name as string | null) ?? (d.email as string).split("@")[0],
    }));
    if (correos.length === 0) continue;

    const { data: yaEnviados } = await db
      .from("vet_reminders_sent").select("item_id, due_on, stage").eq("pet_id", pet.id);
    const enviado = new Set((yaEnviados ?? []).map(r => `${r.item_id}|${r.due_on}|${r.stage}`));

    const items = (agenda ?? []) as ItemAgenda[];
    const vencidosViejos: Pendiente[] = [];

    for (const it of items) {
      const dias = diasEntre(hoy, it.due_on);
      const etapa = etapaDe(dias);

      if (etapa) {
        if (enviado.has(`${it.item_id}|${it.due_on}|${etapa}`)) continue;
        const p: Pendiente = { ...it, etapa, petId: pet.id, petName: pet.name, dias };
        totalPendientes += 1;
        for (const c of correos) {
          const slot = porDueno.get(c.email) ?? { nombre: c.nombre, items: [] };
          slot.items.push(p);
          porDueno.set(c.email, slot);
        }
        aMarcar.push({
          pet_id: pet.id, item_kind: it.kind, item_id: it.item_id,
          due_on: it.due_on, stage: etapa, recipients: correos.map(c => c.email),
        });
        continue;
      }

      // Lo atrasado de más de una semana se junta para el resumen mensual.
      if (dias < -DIAS_TARDE) {
        vencidosViejos.push({ ...it, etapa: "mensual", petId: pet.id, petName: pet.name, dias });
      }
    }

    // Resumen mensual: una vez al mes por mascota, y solo si hay algo atrasado.
    if (vencidosViejos.length > 0) {
      const mes = `${hoy.slice(0, 7)}-01`;
      if (!enviado.has(`${pet.id}|${mes}|mensual`)) {
        totalPendientes += vencidosViejos.length;
        for (const c of correos) {
          const slot = porDueno.get(c.email) ?? { nombre: c.nombre, items: [] };
          slot.items.push(...vencidosViejos);
          porDueno.set(c.email, slot);
        }
        aMarcar.push({
          pet_id: pet.id, item_kind: "resumen_vencidas", item_id: pet.id,
          due_on: mes, stage: "mensual", recipients: correos.map(c => c.email),
        });
      }
    }
  }

  // ── Envío: un correo por dueño ────────────────────────────────────────────
  let correosEnviados = 0;
  for (const [email, { nombre, items }] of porDueno) {
    if (items.length === 0) continue;
    const proximos = items.filter(i => i.dias >= 0).sort((a, b) => a.dias - b.dias);
    const vencidos = items.filter(i => i.dias < 0).sort((a, b) => a.dias - b.dias);
    const { subject, html } = construirCorreo(nombre, proximos, vencidos);

    if (opts.dryRun) { correosEnviados += 1; continue; }

    const res = await sendEmail({
      from: "trufa", to: email, subject, html, replyTo: REPLY_TO, tag: "trufa-recordatorio",
    });
    if (res.ok) correosEnviados += 1;
    else errores.push(`envío a ${email}: ${String(res.error)}`);
  }

  // Solo se marca lo enviado si de verdad salió algún correo: si Resend falló,
  // mañana se vuelve a intentar en vez de quedar marcado como avisado.
  if (!opts.dryRun && correosEnviados > 0 && aMarcar.length > 0) {
    const { error } = await db.from("vet_reminders_sent").upsert(aMarcar, {
      onConflict: "pet_id,item_id,due_on,stage", ignoreDuplicates: true,
    });
    if (error) errores.push(`registro: ${error.message}`);
  }

  return {
    ok: errores.length === 0,
    mascotas: (pets ?? []).length,
    correos: correosEnviados,
    pendientes: totalPendientes,
    errores,
  };
}
