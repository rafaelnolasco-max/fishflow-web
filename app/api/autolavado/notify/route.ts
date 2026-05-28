import { NextRequest, NextResponse } from "next/server";

// ─── Twilio SMS — Autolavado ──────────────────────────────────────────────────
// Variables de entorno requeridas:
//   TWILIO_ACCOUNT_SID   — Account SID de Twilio
//   TWILIO_AUTH_TOKEN    — Auth Token de Twilio
//   TWILIO_FROM_NUMBER   — Número Twilio con formato E.164, ej: +15005550006

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

type NotifyEvent = "entrada" | "listo";

interface NotifyPayload {
  evento:    NotifyEvent;
  tel:       string;          // Número del cliente en formato local MX, ej: 5512345678
  folio:     string;          // Ej: "AL-0042"
  paquete:   string;          // Ej: "Lavado Básico"
  es_gratis: boolean;
}

function buildMessage(payload: NotifyPayload): string {
  const { evento, folio, paquete, es_gratis } = payload;

  if (evento === "entrada") {
    if (es_gratis) {
      return `¡Felicidades! 🎉 Tu folio ${folio} (${paquete}) es tu LAVADA GRATIS por tu lealtad. ¡Gracias por preferirnos!`;
    }
    return `Tu vehículo ingresó al autolavado. Folio: ${folio} — ${paquete}. Te avisamos cuando esté listo.`;
  }

  if (evento === "listo") {
    if (es_gratis) {
      return `✅ Tu vehículo está listo para recoger. Folio: ${folio} — recuerda que esta lavada fue GRATIS. ¡Hasta pronto!`;
    }
    return `✅ Tu vehículo ya está listo. Folio: ${folio}. Puedes pasar a recogerlo. ¡Gracias!`;
  }

  return `Actualización de tu servicio. Folio: ${folio}.`;
}

function toE164Mexico(tel: string): string {
  // Acepta formatos: 5512345678 (10 dígitos), 015512345678 (12), +525512345678 (13)
  const digits = tel.replace(/\D/g, "");
  if (digits.startsWith("52") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+52${digits.slice(1)}`;
  return `+${digits}`; // fallback
}

export async function POST(req: NextRequest) {
  // ── Validar credenciales Twilio ───────────────────────────────────────────
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    console.error("[autolavado/notify] Faltan variables de entorno de Twilio");
    return NextResponse.json(
      { error: "Configuración de Twilio incompleta en servidor" },
      { status: 500 }
    );
  }

  // ── Parsear body ──────────────────────────────────────────────────────────
  let payload: NotifyPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const { evento, tel, folio, paquete, es_gratis } = payload;

  // ── Validaciones básicas ──────────────────────────────────────────────────
  if (!evento || !tel || !folio || !paquete) {
    return NextResponse.json(
      { error: "Faltan campos requeridos: evento, tel, folio, paquete" },
      { status: 400 }
    );
  }

  if (!["entrada", "listo"].includes(evento)) {
    return NextResponse.json(
      { error: `Evento desconocido: ${evento}` },
      { status: 400 }
    );
  }

  // ── Construir y enviar SMS vía Twilio REST API ────────────────────────────
  const toNumber  = toE164Mexico(tel);
  const body      = buildMessage({ evento, tel, folio, paquete, es_gratis: !!es_gratis });

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const creds     = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

  const formData  = new URLSearchParams();
  formData.append("From", TWILIO_FROM_NUMBER);
  formData.append("To",   toNumber);
  formData.append("Body", body);

  let twilioRes: Response;
  try {
    twilioRes = await fetch(twilioUrl, {
      method:  "POST",
      headers: {
        Authorization:  `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });
  } catch (err) {
    console.error("[autolavado/notify] Error de red al llamar Twilio:", err);
    return NextResponse.json({ error: "Error de red con Twilio" }, { status: 502 });
  }

  const twilioData = await twilioRes.json();

  if (!twilioRes.ok) {
    console.error("[autolavado/notify] Twilio respondió error:", twilioData);
    return NextResponse.json(
      { error: "Twilio rechazó el mensaje", detail: twilioData },
      { status: twilioRes.status }
    );
  }

  return NextResponse.json({
    ok:    true,
    sid:   twilioData.sid,
    to:    toNumber,
    evento,
  });
}
