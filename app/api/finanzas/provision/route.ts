import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

// ─── FishFlow Finanzas (B2C) — provisión self-service ─────────────────────────
// Crea (una sola vez) el cliente + acceso + config para un usuario registrado.
// Idempotente: si el usuario ya tiene su cliente de finanzas, lo regresa.
// Onboarding sin tocar código ni Supabase manualmente.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Slug de Rafa — su cliente personal no cuenta como cliente B2C
const RAFA_SLUG = "rafa";

export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    // ── ¿Ya tiene cliente de finanzas? ────────────────────────────────────
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("user_client_access")
      .select("client_id, clients!inner(id, slug, vertical)")
      .eq("user_id", user.id);
    if (exErr) {
      console.error("finanzas provision lookup:", exErr);
      return NextResponse.json({ error: "Error de datos" }, { status: 500 });
    }
    type Row = { client_id: string; clients: { id: string; slug: string | null; vertical: string | null } };
    const found = (existing as unknown as Row[] | null)?.find(
      r => r.clients?.vertical === "finance" && r.clients?.slug !== RAFA_SLUG
    );
    if (found) return NextResponse.json({ client_id: found.client_id, created: false });

    // ── Crear cliente nuevo ───────────────────────────────────────────────
    const slug = `fin-${randomBytes(4).toString("hex")}`;
    const { data: client, error: cliErr } = await supabaseAdmin
      .from("clients")
      .insert({
        name: `Finanzas — ${user.email}`,
        slug,
        vertical: "finance",
        api_key: randomBytes(32).toString("hex"),
        gateway_primary: "none",
        connection_type: "api",
        factura_auto: false,
        active: true,
      })
      .select("id")
      .single();
    if (cliErr || !client) {
      console.error("finanzas provision client:", cliErr);
      return NextResponse.json({ error: "Error al crear cuenta" }, { status: 500 });
    }

    const startMonth = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }).slice(0, 7) + "-01";
    const [accessRes, cfgRes] = await Promise.all([
      supabaseAdmin.from("user_client_access").insert({
        user_id: user.id, client_id: client.id, role: "admin",
      }),
      supabaseAdmin.from("finance_config").insert({
        client_id: client.id,
        monthly_cap: 20000,
        fx_rate: 1,
        buckets: [],
        start_month: startMonth,
        extra_labels: [],
        onboarded: false,
      }),
    ]);
    if (accessRes.error || cfgRes.error) {
      console.error("finanzas provision access/config:", accessRes.error, cfgRes.error);
      // rollback best-effort para no dejar cliente huérfano
      // (primero config por el FK, luego el cliente)
      await supabaseAdmin.from("finance_config").delete().eq("client_id", client.id);
      await supabaseAdmin.from("clients").delete().eq("id", client.id);
      return NextResponse.json({ error: "Error al crear cuenta" }, { status: 500 });
    }

    return NextResponse.json({ client_id: client.id, created: true });
  } catch (e) {
    console.error("finanzas provision:", e);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}
