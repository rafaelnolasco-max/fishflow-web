// POST /api/telematica/bot  { client_id, messages: [{role, content}] }
// Bot de preguntas de una flotilla. Lectura: pasa el panel de LUKON y la vista por NIP
// de esa misma flotilla. Ver lib/fleetBot.ts.
import { NextRequest, NextResponse } from "next/server";
import { requireFleetAccess, supabaseAdmin } from "@/lib/telematicaAuth";
import { askFleetBot, type ChatMsg } from "@/lib/fleetBot";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { client_id?: string; messages?: ChatMsg[] };
  const clientId = body.client_id ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return NextResponse.json({ error: "Flotilla inválida" }, { status: 400 });
  const auth = await requireFleetAccess(clientId, { allowPin: true });
  if (!auth.ok) return auth.response;

  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return NextResponse.json({ error: "Escribe una pregunta" }, { status: 400 });
  }

  try {
    const reply = await askFleetBot(supabaseAdmin(), clientId, messages);
    return NextResponse.json({ reply });
  } catch (e) {
    console.error("[telematica/bot]", auth.email, e);
    return NextResponse.json({ error: "No pude contestar en este momento. Intenta de nuevo." }, { status: 500 });
  }
}
