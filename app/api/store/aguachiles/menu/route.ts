// app/api/store/aguachiles/menu/route.ts
// Disponibilidad y precio vigente del menú de Los Aguachiles. La página pública
// lo consulta al abrir: si Chiva pausó un platillo desde el panel, desaparece
// del sitio sin tener que volver a publicarlo.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { AGUACHILES_CLIENT_ID } from "@/lib/storeAguachiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await db
    .from("store_products")
    .select("id, price, active")
    .eq("client_id", AGUACHILES_CLIENT_ID);
  if (error || !data) {
    console.error("[aguachiles/menu]", error);
    return NextResponse.json({ error: "menu_no_disponible" }, { status: 500 });
  }
  return NextResponse.json(
    { productos: data.map((p) => ({ id: p.id, precio: Number(p.price), activo: p.active })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
