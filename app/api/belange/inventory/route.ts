import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const BELANGE_CLIENT_ID = "33933663-79d2-4caa-86fe-7ea046082b7f";

// Correos que reciben alerta de stock bajo
const STOCK_ALERT_EMAILS = [
  "rafaelnolasco@gmail.com",
  // Alberto — agregar cuando Rafa confirme su email
];

function makeSupabase() {
  const cookieStore = cookies();
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

// ─── GET /api/belange/inventory ───────────────────────────────────────────────
// Devuelve el catálogo activo de productos. SIN el campo cost.
export async function GET() {
  const supabase = makeSupabase();
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
// Acciones:
//   { action: "add_product", name, brand, category, suggested_price, stock_qty, min_stock }
//   { action: "adjust_stock", product_id, delta }   — delta positivo = entrada, negativo = venta
export async function POST(req: NextRequest) {
  const supabase = makeSupabase();
  const body = await req.json();

  if (body.action === "add_product") {
    const { name, brand, category, suggested_price, stock_qty = 0, min_stock = 2 } = body;
    if (!name) return NextResponse.json({ error: "name requerido" }, { status: 400 });

    const { data, error } = await supabase
      .from("belange_inventory")
      .insert({
        client_id: BELANGE_CLIENT_ID,
        name: name.trim(),
        brand: brand?.trim() || null,
        category: category || null,
        suggested_price: suggested_price || null,
        stock_qty,
        min_stock,
      })
      .select("id, name, brand, category, suggested_price, stock_qty, min_stock, active, created_at, updated_at")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ product: data });
  }

  if (body.action === "adjust_stock") {
    const { product_id, delta } = body;
    if (!product_id || delta === undefined) {
      return NextResponse.json({ error: "product_id y delta requeridos" }, { status: 400 });
    }

    // Leer stock actual
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

    // ── Verificar stock bajo y enviar alerta ──────────────────────────────────
    const isLow = newQty <= current.min_stock;
    if (isLow && delta < 0) {
      // Solo alerta cuando baja (no cuando se recibe mercancía)
      try {
        const resend = new Resend(process.env.RESEND_API_KEY!);
        await resend.emails.send({
          from: "FishFlow <noreply@fishflow.mx>",
          to: STOCK_ALERT_EMAILS,
          subject: `⚠️ Stock bajo: ${current.name} — Belange Studio`,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
              <h2 style="color:#FF7200;margin-bottom:4px">Stock bajo</h2>
              <p style="color:#555;margin-top:0">Belange Studio — alerta automática de FishFlow</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0">
                <tr><td style="padding:8px;color:#888;font-size:13px">Producto</td>
                    <td style="padding:8px;font-weight:700">${current.name}${current.brand ? ` (${current.brand})` : ""}</td></tr>
                <tr style="background:#f8f8f6">
                    <td style="padding:8px;color:#888;font-size:13px">Stock actual</td>
                    <td style="padding:8px;font-weight:700;color:#c0392b">${newQty} unidad${newQty !== 1 ? "es" : ""}</td></tr>
                <tr><td style="padding:8px;color:#888;font-size:13px">Mínimo definido</td>
                    <td style="padding:8px">${current.min_stock} unidad${current.min_stock !== 1 ? "es" : ""}</td></tr>
              </table>
              <p style="font-size:13px;color:#888">Este aviso se generó automáticamente al registrar una venta.</p>
              <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
              <p style="font-size:11px;color:#bbb">FishFlow — Automatización para Belange Studio</p>
            </div>
          `,
        });
      } catch (emailErr) {
        // No bloquear la respuesta si falla el email
        console.error("[inventory] Error enviando alerta de stock:", emailErr);
      }
    }

    return NextResponse.json({ product: updated, low_stock: isLow });
  }

  return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
}
