// FishFlow — Motor de Programas · leer una invitación por su token
// ─────────────────────────────────────────────────────────────────────────────
// Pública a propósito: la persona todavía no tiene cuenta cuando abre su link.
// Por eso devuelve lo MÍNIMO para pintar la pantalla —nombre de pila, programa
// y si su evaluación sirve como paso 1— y nada más. Sin correo completo, sin
// teléfono, sin puntaje, sin perfil: quien tenga el link no es necesariamente
// la persona, y un token filtrado no debe convertirse en una ficha de nadie.

import { NextRequest, NextResponse } from "next/server";
import { adminDb, PROGRAMA_CLIENT_ID } from "@/lib/programa";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get("t") ?? "").trim();
  // 64 hex: dos uuid sin guiones. Un token corto ni se consulta.
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return NextResponse.json({ error: "Invitación no válida" }, { status: 400 });
  }

  const db = adminDb();

  const { data: enr, error } = await db
    .from("program_enrollments")
    .select("id, status, lead_id, program_id, client_id")
    .eq("invite_token", token)
    .eq("client_id", PROGRAMA_CLIENT_ID)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // El token se quema al aceptar, así que "no existe" y "ya se usó" son lo mismo
  // desde afuera: no se distingue para no confirmarle nada a quien tantea.
  if (!enr || enr.status !== "invitado") {
    return NextResponse.json({ error: "Esta invitación ya no está disponible" }, { status: 404 });
  }

  const [{ data: lead }, { data: prog }] = await Promise.all([
    db.from("leads").select("name, email").eq("id", enr.lead_id ?? "").maybeSingle(),
    db.from("programs").select("name, subtitle, steps_count").eq("id", enr.program_id).maybeSingle(),
  ]);

  // Solo el nombre de pila, y el correo enmascarado para que la persona
  // reconozca cuál es sin exponerlo a quien traiga el link de rebote.
  const nombre = (lead?.name ?? "").trim().split(" ")[0] ?? "";
  const correo = (lead?.email ?? "").trim();
  const i = correo.indexOf("@");
  const correoPista = i > 1 ? `${correo.slice(0, 2)}${"•".repeat(Math.max(i - 2, 1))}${correo.slice(i)}` : "";

  // ¿Su evaluación sirve como línea base? Misma regla que la RPC.
  const { count } = await db
    .from("assessments")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", enr.lead_id ?? "")
    .eq("instrument", "criterio_v1")
    .not("total_score", "is", null);

  return NextResponse.json({
    nombre,
    correoPista,
    programa: prog?.name ?? "",
    subtitulo: prog?.subtitle ?? "",
    pasos: prog?.steps_count ?? 0,
    pasoUnoHecho: (count ?? 0) > 0,
  });
}
