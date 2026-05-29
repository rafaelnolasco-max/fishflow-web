import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const BELANGE_CLIENT_ID = "33933663-79d2-4caa-86fe-7ea046082b7f";

const STOCK_ALERT_EMAILS = [
  "rafaelnolasco@gmail.com",
  "belangestudio@gmail.com",
];

async function makeSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    }
  );
}

async function sendStockAlert(productName: string, brand: string | null, newQty: number, minStock: number) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "FishFlow <noreply@fishflow.mx>",
        to: STOCK_ALERT_EMAILS,
        subject: `⚠️ Stock bajo: ${productName} — Belange Studio`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
            <h2 style="color:#FF7200;margin-bottom:4px">Stock bajo</h2>
            <p style="color:#555;margin-top:0">Belange Studio — alerta automática de FishFlow</p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr>
                <td style="padding:8px;color:#888;font-size:13px">Producto</td>
                <td style="padding:8px;font-weight:700">${productName}${brand ? ` (${brand})` : ""}</td>
              </tr>
              <tr style="background:#f8f8f6">
                <td style="padding:8px;color:#888;font-size:13px">Stock actual</td>
                <td style="padding:8px;font-weight:700;color:#c0392b">${newQty} unidad${newQty !== 1 ? "es" : ""}</td>
              </tr>
              <tr>
                <td style="padding:8px;color:#888;font-size:13px">Mínimo definido</td>
                <td style="padding:8px">${minStock} unidad${minStock !== 1 ? "es" : ""}</td>
              </tr>
            </table>
            <p style="font-size:13px;color:#888">Este aviso se generó automáticamente al registrar una venta.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
            <p style="font-size:11px;color:#bbb">FishFlow — Automatización para Belange Studio</p>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error("[inventory] Error enviando alerta de stock:", err);
  }
}

// ─── GET /api/belange/inventory ───────────────────────────────────────────────
export async function GET() {
  const supabase = await makeSupabase();
  const { data, error } = await supabase
    .from("belange_inventory")
    .select("id, name, brand, category, suggested_price, stock_qty, min_stock, active, created_at, updated_at")
    .eq("client_id", BELANGE_CLIENT_ID)
    .eq("active", true)
    .order("category", { ascending: true })
    .order("name",     { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data });
}

// ─── POST /api/belange/inventory ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await makeSupabase();
  const body = await req.json();

  // ── Agregar producto nuevo al catálogo ──
  if (body.action === "add_product") {
    const { name, brand, category, cost, suggested_price, stock_qty = 0, min_stock = 2 } = body;
    if (!name) return NextResponse.json({ error: "name requerido" }, { status: 400 });

    const { data, error } = await supabase
      .from("belange_inventory")
      .insert({
        client_id: BELANGE_CLIENT_ID,
        name: name.trim(),
        brand: brand?.trim() || null,
        category: category || null,
        cost: cost || null,
        suggested_price: suggested_price || null,
        stock_qty,
        min_stock,
      })
      .select("id, name, brand, category, suggested_price, stock_qty, min_stock, active, created_at, updated_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ product: data });
  }

  // ── Actualizar datos de un producto ──
  if (body.action === "update_product") {
    const { product_id, name, brand, category, cost, suggested_price, min_stock } = body;
    if (!product_id) return NextResponse.json({ error: "product_id requerido" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (name            !== undefined) patch.name            = name?.trim() || null;
    if (brand           !== undefined) patch.brand           = brand?.trim() || null;
    if (category        !== undefined) patch.category        = category || null;
    if (cost            !== undefined) patch.cost            = cost || null;
    if (suggested_price !== undefined) patch.suggested_price = suggested_price || null;
    if (min_stock       !== undefined) patch.min_stock       = min_stock;

    const { data, error } = await supabase
      .from("belange_inventory")
      .update(patch)
      .eq("id", product_id)
      .eq("client_id", BELANGE_CLIENT_ID)
      .select("id, name, brand, category, suggested_price, stock_qty, min_stock, active, created_at, updated_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ product: data });
  }

  // ── Descontar / sumar stock ──
  if (body.action === "adjust_stock") {
    const { product_id, delta } = body;
    if (!product_id || delta === undefined) {
      return NextResponse.json({ error: "product_id y delta requeridos" }, { status: 400 });
    }

    const { data: current, error: fetchErr } = await supabase
      .from("belange_inventory")
      .select("id, name, brand, stock_qty, min_stock, suggested_price")
      .eq("id", product_id)
      .eq("client_id", BELANGE_CLIENT_ID)
      .single();

    if (fetchErr || !current) {
      return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
    }

    const newQty = Math.max(0, current.stock_qty + delta);
    const { data: updated, error: updateErr } = await supabase
      .from("belange_inventory")
      .update({ stock_qty: newQty })
      .eq("id", product_id)
      .select("id, name, brand, stock_qty, min_stock, suggested_price")
      .single();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    const isLow = newQty <= current.min_stock;
    if (isLow && delta < 0) {
      await sendStockAlert(current.name, current.brand, newQty, current.min_stock);
    }

    return NextResponse.json({ product: updated, low_stock: isLow });
  }

  // ── Dar de baja (desactivar) un producto ──
  if (body.action === "deactivate") {
    const { product_id } = body;
    if (!product_id) return NextResponse.json({ error: "product_id requerido" }, { status: 400 });

    const { data, error } = await supabase
      .from("belange_inventory")
      .update({ active: false })
      .eq("id", product_id)
      .eq("client_id", BELANGE_CLIENT_ID)
      .select("id, name")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ product: data });
  }

  return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
}
