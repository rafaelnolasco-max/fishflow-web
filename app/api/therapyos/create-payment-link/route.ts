import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { MercadoPagoConfig, Preference } from "mercadopago";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { session_id, patient_name, amount } = body as {
      session_id: string;
      patient_name: string;
      amount: number | null;
    };

    if (!session_id || !patient_name) {
      return NextResponse.json(
        { error: "Faltan campos: session_id, patient_name" },
        { status: 400 }
      );
    }

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: "El paciente no tiene tarifa configurada. Actualiza session_fee en la tabla patients." },
        { status: 400 }
      );
    }

    // ── Obtener sesión y client_id ─────────────────────────────────────────────
    const { data: session, error: sessionErr } = await supabaseAdmin
      .from("sessions")
      .select("id, client_id, session_number, session_date")
      .eq("id", session_id)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json({ error: "Sesión no encontrada" }, { status: 404 });
    }

    // ── Obtener access token de MP del cliente (Mario) ─────────────────────────
    const { data: clientRecord } = await supabaseAdmin
      .from("clients")
      .select("mp_access_token, name")
      .eq("id", session.client_id)
      .single();

    const mpToken = clientRecord?.mp_access_token ?? process.env.MP_ACCESS_TOKEN_DEFAULT;

    if (!mpToken) {
      return NextResponse.json(
        {
          error:
            "Token de Mercado Pago no configurado. " +
            "Agrega mp_access_token en la tabla clients para este terapeuta, " +
            "o configura MP_ACCESS_TOKEN_DEFAULT en variables de entorno.",
        },
        { status: 400 }
      );
    }

    // ── Crear preference en Mercado Pago ──────────────────────────────────────
    const mp = new MercadoPagoConfig({ accessToken: mpToken });
    const preferenceClient = new Preference(mp);

    const preference = await preferenceClient.create({
      body: {
        items: [
          {
            id: session_id,
            title: `Sesión #${session.session_number} · ${patient_name}`,
            description: `Sesión terapéutica del ${new Date(session.session_date).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`,
            quantity: 1,
            unit_price: amount,
            currency_id: "MXN",
          },
        ],
        statement_descriptor: "TherapyOS",
        external_reference: session_id,
        // Configura tus URLs de callback aquí
        // back_urls: {
        //   success: `https://fishflow.mx/app/therapyos?payment=success`,
        //   failure: `https://fishflow.mx/app/therapyos?payment=failure`,
        // },
      },
    });

    const paymentLink = preference.init_point ?? preference.sandbox_init_point;

    if (!paymentLink) {
      return NextResponse.json(
        { error: "Mercado Pago no devolvió un link de pago" },
        { status: 502 }
      );
    }

    // ── Guardar link en la sesión ──────────────────────────────────────────────
    await supabaseAdmin
      .from("sessions")
      .update({ payment_link: paymentLink, payment_status: "pending" })
      .eq("id", session_id);

    return NextResponse.json({ payment_link: paymentLink, preference_id: preference.id });

  } catch (err) {
    console.error("create-payment-link error:", err);
    return NextResponse.json(
      { error: "Error al crear link de pago", detail: String(err) },
      { status: 500 }
    );
  }
}
