// app/api/o/[slug]/route.ts
// Módulo Reputación — canal QR (inbound). API pública del comensal, sin login.
//
// Por qué existe: un café no tiene lista de contactos que cargar. El QR pegado en
// el mostrador o en la bolsa de café la fabrica. El slug del touchpoint es la
// credencial; no hay cuenta ni contraseña que pedirle a quien se acaba de tomar
// un americano.
//
// Quien contesta NO está autenticado, así que la RLS de review_responses no
// aplica: todo pasa por service role. El slug solo resuelve a un client_id y a
// un touchpoint activo; nunca se acepta un client_id que venga del cuerpo.
//
// GET  → { business, brandColor, logoUrl, privacyUrl, incentiveText,
//          collectContact, reviewLink, touchpoint, questions }
// POST → crea o actualiza la review_response. Ver ACCIONES abajo.
//
// Regla dura del módulo: el CTA a Google se le muestra a TODOS, sin importar el
// CSAT. Filtrar por sentimiento es review gating y viola la política de Google.
// google_cta_shown es la bitácora que lo demuestra respuesta por respuesta.

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";

// Lazy init: instanciar a nivel de módulo con envs faltantes tumba `next build`.
let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

type Touchpoint = {
  id: string;
  client_id: string;
  slug: string;
  label: string;
  kind: string;
};

type Settings = {
  business_display_name: string | null;
  review_link: string | null;
  google_place_id: string | null;
  brand_color: string | null;
  logo_url: string | null;
  privacy_url: string | null;
  incentive_text: string | null;
  collect_contact: boolean | null;
  alert_threshold: number | null;
  alert_email: string | null;
};

// Misma normalización que components/reviews/ReviewsTab.tsx, para que el dedupe
// por (client_id, contact_phone) funcione igual entre el canal QR y el outbound.
function normalizePhone(raw: string): string {
  const digits = raw.trim().replace(/\D/g, "");
  return digits.startsWith("52") ? `+${digits}` : `+52${digits}`;
}

function telefonoValido(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}

// Nunca se guarda la IP cruda. El hash sirve para detectar abuso del mismo
// dispositivo, no para identificar a nadie.
function hashIp(req: NextRequest): string | null {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip");
  if (!ip) return null;
  const sal = process.env.REVIEW_IP_SALT ?? "fishflow-canal-qr";
  return createHash("sha256").update(`${sal}:${ip}`).digest("hex").slice(0, 32);
}

async function touchpointPorSlug(slug: string): Promise<Touchpoint | null> {
  if (!slug || slug.length > 40) return null;
  const { data, error } = await admin()
    .from("review_touchpoints")
    .select("id, client_id, slug, label, kind")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    console.error("[api/o] lookup touchpoint:", error);
    return null;
  }
  return (data as Touchpoint | null) ?? null;
}

function noEncontrado() {
  return NextResponse.json(
    { error: "Este código no es válido o fue desactivado." },
    { status: 404, headers: NO_STORE },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — configuración de la encuesta
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const tp = await touchpointPorSlug(slug);
  if (!tp) return noEncontrado();

  const [{ data: settings }, { data: questions }] = await Promise.all([
    admin()
      .from("review_settings")
      .select(
        "business_display_name, review_link, google_place_id, brand_color, logo_url, privacy_url, incentive_text, collect_contact, alert_threshold, alert_email",
      )
      .eq("client_id", tp.client_id)
      .maybeSingle(),
    // Las preguntas se filtran por el tipo de punto: el QR del mostrador y el de
    // la bolsa de café se escanean en momentos distintos y no preguntan lo mismo.
    // touchpoint_kind NULL = la pregunta aplica a todos los puntos.
    admin()
      .from("review_questions")
      .select("id, position, kind, role, label_high, label_low, options, required, touchpoint_kind")
      .eq("client_id", tp.client_id)
      .eq("active", true)
      .or(`touchpoint_kind.is.null,touchpoint_kind.eq.${tp.kind}`)
      .order("position", { ascending: true }),
  ]);

  const s = (settings ?? null) as Settings | null;

  // El enlace de reseña se arma con el place_id si no viene explícito.
  const reviewLink =
    s?.review_link ??
    (s?.google_place_id
      ? `https://search.google.com/local/writereview?placeid=${s.google_place_id}`
      : null);

  return NextResponse.json(
    {
      business: s?.business_display_name ?? "este negocio",
      brandColor: s?.brand_color ?? null,
      logoUrl: s?.logo_url ?? null,
      privacyUrl: s?.privacy_url ?? null,
      incentiveText: s?.incentive_text ?? null,
      collectContact: s?.collect_contact ?? true,
      reviewLink,
      touchpoint: { label: tp.label, kind: tp.kind },
      questions: questions ?? [],
    },
    { headers: NO_STORE },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — acciones del flujo
//
//   start    { csat }                      → crea la fila, devuelve responseId
//   answers  { responseId, answers[] }     → guarda respuestas por pregunta
//   detail   { responseId, comment?, attribution? }
//   contact  { responseId, phone, consent } → solo con consent crea el review_request
//   finish   { responseId, outcome }        → 'google' | 'private'
// ─────────────────────────────────────────────────────────────────────────────
type Body = {
  action?: string;
  responseId?: string;
  csat?: number;
  comment?: string;
  attribution?: string;
  productRef?: string;
  phone?: string;
  consent?: boolean;
  outcome?: string;
  answers?: Array<{ questionId?: string; text?: string; choice?: string[] }>;
};

function malaPeticion(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400, headers: NO_STORE });
}

// Revalida que la respuesta pertenezca al touchpoint del slug. Sin esto, alguien
// con un responseId ajeno podría escribirle encima desde otro QR.
async function respuestaDelTouchpoint(responseId: string, tp: Touchpoint) {
  if (!responseId || responseId.length < 30) return null;
  const { data } = await admin()
    .from("review_responses")
    .select("id, client_id, touchpoint_id, csat, comment, contact_phone")
    .eq("id", responseId)
    .eq("touchpoint_id", tp.id)
    .maybeSingle();
  return data ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const tp = await touchpointPorSlug(slug);
  if (!tp) return noEncontrado();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return malaPeticion("Cuerpo inválido.");
  }

  const db = admin();

  // ── start ─────────────────────────────────────────────────────────────────
  if (body.action === "start") {
    const csat = Number(body.csat);
    if (!Number.isInteger(csat) || csat < 1 || csat > 5) {
      return malaPeticion("La calificación debe ir de 1 a 5.");
    }
    const { data, error } = await db
      .from("review_responses")
      .insert({
        client_id: tp.client_id,
        touchpoint_id: tp.id,
        csat,
        ip_hash: hashIp(req),
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[api/o] start:", error);
      return NextResponse.json({ error: "No se pudo guardar." }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ responseId: data.id }, { headers: NO_STORE });
  }

  const responseId = String(body.responseId ?? "");
  const actual = await respuestaDelTouchpoint(responseId, tp);
  if (!actual) return malaPeticion("Respuesta no encontrada.");

  // ── answers ───────────────────────────────────────────────────────────────
  if (body.action === "answers") {
    const filas = (body.answers ?? [])
      .filter((a) => a.questionId)
      .map((a) => ({
        client_id: tp.client_id,
        response_id: responseId,
        question_id: a.questionId!,
        value_text: a.text?.slice(0, 2000) ?? null,
        value_choice: a.choice?.slice(0, 20) ?? null,
      }));
    if (filas.length) {
      const { error } = await db.from("review_answers").insert(filas);
      if (error) {
        console.error("[api/o] answers:", error);
        return NextResponse.json({ error: "No se pudo guardar." }, { status: 500, headers: NO_STORE });
      }
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  // ── detail: comentario libre y atribución ─────────────────────────────────
  if (body.action === "detail") {
    const patch: Record<string, unknown> = {};
    if (typeof body.comment === "string") patch.comment = body.comment.slice(0, 2000);
    if (typeof body.attribution === "string") patch.attribution = body.attribution.slice(0, 120);
    // Qué mezcla se llevó. Es el dato que habilita la recompra a 21 días.
    if (typeof body.productRef === "string") patch.product_ref = body.productRef.slice(0, 120);
    if (Object.keys(patch).length) {
      const { error } = await db.from("review_responses").update(patch).eq("id", responseId);
      if (error) {
        console.error("[api/o] detail:", error);
        return NextResponse.json({ error: "No se pudo guardar." }, { status: 500, headers: NO_STORE });
      }
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  // ── contact ───────────────────────────────────────────────────────────────
  // Sin consentimiento explícito NO se guarda el teléfono. La respuesta sí se
  // conserva: el dueño necesita el dato aunque el cliente no quiera que le hablen.
  if (body.action === "contact") {
    if (!body.consent) return NextResponse.json({ ok: true, saved: false }, { headers: NO_STORE });
    const raw = String(body.phone ?? "");
    if (!telefonoValido(raw)) return malaPeticion("El teléfono no parece válido.");
    const phone = normalizePhone(raw);

    const { error } = await db
      .from("review_responses")
      .update({ contact_phone: phone, consent: true, consent_at: new Date().toISOString() })
      .eq("id", responseId);
    if (error) {
      console.error("[api/o] contact:", error);
      return NextResponse.json({ error: "No se pudo guardar." }, { status: 500, headers: NO_STORE });
    }

    // Con consentimiento, el contacto entra a la cola outbound que ya opera el
    // resto del módulo. contact_name es NOT NULL en review_requests y el flujo
    // del QR no pide nombre: se guarda un genérico y el dueño lo edita si quiere.
    const { data: existente } = await db
      .from("review_requests")
      .select("id")
      .eq("client_id", tp.client_id)
      .eq("contact_phone", phone)
      .maybeSingle();

    if (!existente) {
      const { error: errReq } = await db.from("review_requests").insert({
        client_id: tp.client_id,
        contact_name: "Cliente del QR",
        contact_phone: phone,
        source: "qr",
        stage: 0,
        status: (actual.csat ?? 5) <= 2 ? "negative_feedback" : "active",
        response_id: responseId,
      });
      if (errReq) console.error("[api/o] crear review_request:", errReq);
    }

    return NextResponse.json({ ok: true, saved: true }, { headers: NO_STORE });
  }

  // ── finish ────────────────────────────────────────────────────────────────
  if (body.action === "finish") {
    const outcome = body.outcome === "google" ? "google" : "private";
    const { error } = await db
      .from("review_responses")
      .update({
        outcome,
        // Siempre true: el CTA se le mostró a esta persona, haya calificado 1 o 5.
        google_cta_shown: true,
        google_cta_clicked: outcome === "google",
        completed_at: new Date().toISOString(),
      })
      .eq("id", responseId);
    if (error) {
      console.error("[api/o] finish:", error);
      return NextResponse.json({ error: "No se pudo guardar." }, { status: 500, headers: NO_STORE });
    }

    await alertarSiAplica(tp, responseId);
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  }

  return malaPeticion("Acción desconocida.");
}

// Alerta al dueño cuando el CSAT queda en o por debajo del umbral. Se encola en
// la tabla genérica `notifications`; no se crea tabla nueva para esto.
async function alertarSiAplica(tp: Touchpoint, responseId: string) {
  const db = admin();
  const [{ data: r }, { data: s }] = await Promise.all([
    db
      .from("review_responses")
      .select("csat, comment, attribution, product_ref, contact_phone, started_at")
      .eq("id", responseId)
      .maybeSingle(),
    db
      .from("review_settings")
      .select("alert_threshold, alert_email, business_display_name")
      .eq("client_id", tp.client_id)
      .maybeSingle(),
  ]);

  const umbral = s?.alert_threshold ?? 2;
  if (!r?.csat || r.csat > umbral) return;
  if (!s?.alert_email) return;

  const cuerpo = [
    `CSAT ${r.csat}/5 · ${tp.label} · ${new Date(r.started_at as string).toLocaleString("es-MX")}`,
    r.attribution ? `Llegó por: ${r.attribution}` : null,
    r.product_ref ? `Mezcla: ${r.product_ref}` : null,
    r.comment ? `"${r.comment}"` : "(sin comentario)",
    r.contact_phone ? `Contacto: ${r.contact_phone}` : "(sin contacto)",
  ]
    .filter(Boolean)
    .join("\n");

  const { error } = await db.from("notifications").insert({
    client_id: tp.client_id,
    channel: "email",
    provider: "resend",
    recipient: s.alert_email,
    body: cuerpo,
    status: "queued",
    related_entity_type: "review_response",
    related_entity_id: responseId,
  });
  if (error) console.error("[api/o] alerta:", error);
}
