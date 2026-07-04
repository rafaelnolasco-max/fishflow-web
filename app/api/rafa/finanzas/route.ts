import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// ─── Chat financiero personal de Rafa (/app/rafa) ────────────────────────────
// Responde preguntas sobre el histórico de gastos y registra movimientos
// por lenguaje natural ("350 gasolina ayer").

const RAFA_CLIENT_ID = "40ee7b1f-ef78-4632-a9ea-0468e26320e1";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

interface ChatMsg { role: "user" | "assistant"; content: string; }

function systemPrompt(today: string): string {
  return `Eres el asistente financiero personal de Rafa. Tienes su registro completo de ingresos y gastos desde enero 2025 (en CSV al final).

Contexto clave:
- Cubetas de gasto: fijo, placer, futuro (ahorro/inversión), extraordinario (gastos grandes únicos, con categoría), ingreso.
- Hasta abril 2026 Rafa tenía salario de Amdocs ("Day job") — ingresos y ahorro altos. Desde mayo 2026 vive de rentas, FishFlow y Lukon; su plan de "futuro" actual es ~$13,000/mes. No compares el presente contra la época de Amdocs sin mencionar ese contexto.
- Tope de gasto mensual actual: $125,000 MXN.
- Los movimientos con fecha día 01 de meses históricos suelen ser "mes correcto, día desconocido". Los marcados "(mes n/r)" son gastos del año sin mes registrado — al analizarlos por mes, acláralo.

Reglas de respuesta:
1. Si Rafa pregunta algo sobre sus finanzas: responde en español, directo, con cifras en formato $12,345. Máximo ~120 palabras. Sin listas a menos que pida un desglose.
2. Si Rafa quiere REGISTRAR un gasto o ingreso (ej: "350 gasolina ayer", "registra 200 de café", "ingreso 5000 de Lukon hoy"), responde ÚNICAMENTE con este JSON, sin texto adicional:
{"action":"insert","tx":{"tx_date":"YYYY-MM-DD","tx_type":"fijo|placer|futuro|extraordinario|ingreso","concept":"...","category":null,"amount":123}}
- Hoy es ${today}. "ayer" = día anterior. Sin fecha explícita = hoy.
- Infiere tx_type por el concepto (café/comida/diversión→placer; gasolina/servicios/casa→fijo; ahorro/inversión→futuro; gasto grande único→extraordinario con category VACACIONES|CASA PICHI|SALUD/MEDICAMENTOS|AUTO IONIQ|OTRO; dinero recibido→ingreso).
3. Si el registro es ambiguo (falta monto), pide el dato faltante en una línea.`;
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth: token del usuario + acceso al cliente rafa ──────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: access, error: accessErr } = await supabaseAdmin
      .from("user_client_access").select("user_id")
      .eq("user_id", user.id).eq("client_id", RAFA_CLIENT_ID).maybeSingle();
    if (accessErr || !access) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

    const { messages } = (await req.json()) as { messages: ChatMsg[] };
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) {
      return NextResponse.json({ error: "Mensajes inválidos" }, { status: 400 });
    }

    // ── Datos: todo el histórico en CSV compacto ──────────────────────────
    // OJO: Supabase regresa máx. 1000 filas por request — paginar siempre.
    interface TxRow { tx_date: string; tx_type: string; concept: string; category: string | null; amount: number; }
    const all: TxRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: txErr } = await supabaseAdmin
        .from("finance_transactions")
        .select("tx_date, tx_type, concept, category, amount")
        .eq("client_id", RAFA_CLIENT_ID)
        .order("tx_date").order("created_at")
        .range(from, from + PAGE - 1);
      if (txErr) {
        console.error("finanzas chat txs:", txErr);
        return NextResponse.json({ error: "Error de datos" }, { status: 500 });
      }
      all.push(...((page ?? []) as TxRow[]));
      if (!page || page.length < PAGE) break;
    }

    const rango = all.length
      ? `Cobertura del registro: ${all[0].tx_date} a ${all[all.length - 1].tx_date} (${all.length} movimientos).`
      : "El registro está vacío.";
    const csv = "fecha,tipo,concepto,categoria,monto\n" + all
      .map(t => `${t.tx_date},${t.tx_type},"${String(t.concept).replace(/"/g, "'")}",${t.category ?? ""},${t.amount}`)
      .join("\n");

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: systemPrompt(today) + "\n\n=== REGISTRO COMPLETO ===\n" + rango + "\n" + csv,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text).join("").trim();

    // ── ¿Es una instrucción de registro? ──────────────────────────────────
    const jsonMatch = text.match(/\{[\s\S]*"action"\s*:\s*"insert"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as {
          tx: { tx_date: string; tx_type: string; concept: string; category: string | null; amount: number };
        };
        const tx = parsed.tx;
        const validTypes = ["ingreso", "fijo", "placer", "futuro", "extraordinario"];
        if (!tx || !validTypes.includes(tx.tx_type) || !tx.concept || !(tx.amount > 0)
            || !/^\d{4}-\d{2}-\d{2}$/.test(tx.tx_date)) {
          return NextResponse.json({ reply: "No pude interpretar el registro. ¿Me das monto, concepto y tipo?" });
        }
        const { error: insErr } = await supabaseAdmin.from("finance_transactions").insert({
          client_id: RAFA_CLIENT_ID,
          tx_date: tx.tx_date,
          tx_type: tx.tx_type,
          concept: tx.concept.slice(0, 120),
          category: tx.tx_type === "extraordinario" ? (tx.category ?? "OTRO") : null,
          amount: tx.amount,
        });
        if (insErr) {
          console.error("finanzas chat insert:", insErr);
          return NextResponse.json({ reply: "Error al guardar el movimiento. Intenta de nuevo." });
        }
        const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;
        return NextResponse.json({
          reply: `Registrado: ${tx.concept} — ${fmt(tx.amount)} (${tx.tx_type}, ${tx.tx_date})`,
          inserted: true,
        });
      } catch {
        return NextResponse.json({ reply: "No pude interpretar el registro. ¿Me das monto, concepto y tipo?" });
      }
    }

    return NextResponse.json({ reply: text });
  } catch (e) {
    console.error("finanzas chat:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
