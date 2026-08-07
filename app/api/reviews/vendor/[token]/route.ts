// app/api/reviews/vendor/[token]/route.ts
// Módulo Reputación — acceso de la vendedora a SU cola, sin login.
//
// Por qué existe: el link wa.me abre WhatsApp en el dispositivo que da clic, así
// que el mensaje sale del número de quien opera la página. Para que la reseña la
// pida la vendedora desde su propio número, ella necesita ver solo sus contactos
// desde su celular — sin cuenta ni contraseña.
//
// La vendedora NO está autenticada, así que la RLS de review_requests no aplica:
// todo pasa por service role y el token es la credencial. Cada operación revalida
// que el request pertenezca a la vendedora del token.
//
// GET   → { vendor, clientId, settings, requests }
// PATCH → { requestId, patch } — avanza etapa / cambia status / guarda borrador

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

// Solo estas columnas se pueden tocar desde la página pública. Cualquier otra
// (client_id, vendor_id, contact_phone…) se ignora en silencio.
const CAMPOS_PERMITIDOS = new Set([
  "stage",
  "status",
  "stage1_sent_at",
  "stage2_sent_at",
  "stage3_sent_at",
  "reply_1",
  "reply_2",
  "draft_2",
  "draft_3",
]);

const STATUS_VALIDOS = new Set([
  "active", "completed", "declined", "no_response", "negative_feedback",
]);

type Vendor = { id: string; client_id: string; name: string };

async function vendorPorToken(token: string): Promise<Vendor | null> {
  if (!token || token.length < 20) return null;
  const { data, error } = await admin()
    .from("review_vendors")
    .select("id, client_id, name")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    console.error("[reviews/vendor] lookup:", error);
    return null;
  }
  return (data as Vendor | null) ?? null;
}

function noEncontrado() {
  return NextResponse.json(
    { error: "Este enlace no es válido o fue desactivado." },
    { status: 404, headers: NO_STORE },
  );
}

// ─── GET: cola de la vendedora ───────────────────────────────────────────────
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const vendor = await vendorPorToken(token);
  if (!vendor) return noEncontrado();

  const [{ data: settings, error: e1 }, { data: requests, error: e2 }] = await Promise.all([
    admin()
      .from("review_settings")
      // ai_persona / ai_sensitive quedan fuera a propósito: son configuración
      // interna del cliente, la vendedora no tiene por qué verlas.
      .select("client_id, google_place_id, review_link, business_display_name, msg_template_1, msg_template_2, msg_template_3, review_goal, baseline_count")
      .eq("client_id", vendor.client_id)
      .maybeSingle(),
    admin()
      .from("review_requests")
      .select("*")
      .eq("vendor_id", vendor.id)
      .order("stage", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);

  if (e1) console.error("[reviews/vendor] settings:", e1);
  if (e2) {
    console.error("[reviews/vendor] requests:", e2);
    return NextResponse.json({ error: "No se pudo cargar tu lista." }, { status: 500, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      vendor: { id: vendor.id, name: vendor.name },
      clientId: vendor.client_id,
      settings: settings ?? null,
      requests: requests ?? [],
    },
    { headers: NO_STORE },
  );
}

// ─── PATCH: actualizar un contacto de la cola ────────────────────────────────
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const vendor = await vendorPorToken(token);
  if (!vendor) return noEncontrado();

  let body: { requestId?: string; patch?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400, headers: NO_STORE });
  }

  const { requestId, patch } = body;
  if (!requestId || !patch || typeof patch !== "object") {
    return NextResponse.json({ error: "requestId y patch son requeridos" }, { status: 400, headers: NO_STORE });
  }

  const limpio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!CAMPOS_PERMITIDOS.has(k)) continue;
    if (k === "status" && !STATUS_VALIDOS.has(String(v))) continue;
    if (k === "stage") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 3) continue;
      limpio[k] = n;
      continue;
    }
    limpio[k] = v;
  }
  if (Object.keys(limpio).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400, headers: NO_STORE });
  }
  limpio.updated_at = new Date().toISOString();

  // El .eq("vendor_id") es lo que impide que un token toque la cola de otra.
  const { data, error } = await admin()
    .from("review_requests")
    .update(limpio)
    .eq("id", requestId)
    .eq("vendor_id", vendor.id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("[reviews/vendor] update:", error);
    return NextResponse.json({ error: "No se pudo guardar el cambio." }, { status: 500, headers: NO_STORE });
  }
  if (!data) return noEncontrado();

  return NextResponse.json({ request: data }, { headers: NO_STORE });
}
