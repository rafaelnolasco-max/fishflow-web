import { NextResponse } from "next/server";
import { correrRecordatorios } from "@/lib/trufaRecordatorios";

export const runtime = "nodejs";
export const maxDuration = 120;

// Recordatorios del carnet de Trufa. Lo dispara el cron de Vercel (ver
// vercel.json), no un Edge Function de Supabase: el remitente vive en
// lib/email.ts y RESEND_API_KEY ya está en Vercel, así que llevarlo a Supabase
// obligaría a duplicar la llave y la plantilla para un trabajo que son dos
// consultas y un correo. La regla del CLAUDE.md apunta al trabajo pesado
// atado a Storage, que no es este caso.
//
// Mismo candado que /api/cron/enlace-digest.
//
// ?dry=1 corre todo sin mandar nada ni marcar nada. Es la forma de ver a quién
// le tocaría hoy sin gastarle un correo a nadie.

export async function GET(req: Request) {
  // Falla CERRADO, a diferencia de los otros dos crons. Ahí un `if (secret)`
  // solo deja la ruta abierta; aquí la ruta MANDA CORREOS a clientes finales,
  // así que sin llave configurada no corre. Verificado el 15-sep-2026: en
  // producción CRON_SECRET no estaba puesta y la ruta respondía a cualquiera.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[trufa-recordatorios] CRON_SECRET no configurada — no se envía nada");
    return NextResponse.json(
      { error: "CRON_SECRET no configurada en el entorno" }, { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const resultado = await correrRecordatorios({ dryRun });
  return NextResponse.json({ ...resultado, dryRun }, { status: resultado.ok ? 200 : 500 });
}
