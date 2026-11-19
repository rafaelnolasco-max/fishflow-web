// /api/whatsapp/plantillas — solo Rafa (admin). Plantillas de la línea FishFlow en Meta.
//   GET                → estado de las plantillas (nombre, categoría, estado, motivo de rechazo).
//   POST {name}        → da de alta una plantilla del catálogo de abajo para aprobación.
// Las plantillas se aprueban en WhatsApp Manager; aquí solo se crean y se consultan.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/apiAuth";
import { WA_GRAPH_VERSION } from "@/lib/whatsapp";

const CATALOGO: Record<string, Record<string, unknown>> = {
  // Resumen semanal de flotillas de LUKON (lib/fleetWhatsApp.ts). 6 variables.
  resumen_flotilla_semanal: {
    name: "resumen_flotilla_semanal",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "Hola {{1}}, ya está el resumen semanal de la flotilla {{2}} ({{3}}): {{4}} km recorridos, {{5}} unidades trabajando y {{6}} puntos para atender. Toca Ver detalle o responde con cualquier pregunta sobre tus unidades.",
        example: { body_text: [["Alejandro", "Grupo SELOME", "9 nov al 15 nov", "7,856", "16 de 22", "7"]] },
      },
      { type: "FOOTER", text: "LUKON · Siempre Inteligente. Siempre Seguro." },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Ver detalle" }] },
    ],
  },
};

function env() {
  const token = process.env.WHATSAPP_TOKEN, waba = process.env.WHATSAPP_WABA_ID;
  return token && waba ? { token, waba } : null;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const e = env();
  if (!e) return NextResponse.json({ error: "Faltan WHATSAPP_TOKEN o WHATSAPP_WABA_ID" }, { status: 500 });
  const res = await fetch(`https://graph.facebook.com/${WA_GRAPH_VERSION}/${e.waba}/message_templates?fields=name,status,category,language,rejected_reason&limit=100`, {
    headers: { Authorization: `Bearer ${e.token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const e = env();
  if (!e) return NextResponse.json({ error: "Faltan WHATSAPP_TOKEN o WHATSAPP_WABA_ID" }, { status: 500 });
  const { name } = await req.json().catch(() => ({ name: "" }));
  const tpl = CATALOGO[String(name)];
  if (!tpl) return NextResponse.json({ error: `Plantilla desconocida. Disponibles: ${Object.keys(CATALOGO).join(", ")}` }, { status: 400 });
  const res = await fetch(`https://graph.facebook.com/${WA_GRAPH_VERSION}/${e.waba}/message_templates`, {
    method: "POST", headers: { Authorization: `Bearer ${e.token}`, "Content-Type": "application/json" }, body: JSON.stringify(tpl),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
