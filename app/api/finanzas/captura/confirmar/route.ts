import { NextRequest, NextResponse } from "next/server";
import { TX_TYPES, aCentavos, financeAdmin, type TxType } from "@/lib/finanzasCaptura";

export const runtime = "nodejs";

// ════════════════════════════════════════════════════════════════════════════
// Finanzas — confirmar los movimientos leídos del screenshot
// ════════════════════════════════════════════════════════════════════════════
// Aquí es donde los borradores se vuelven gastos de verdad, y donde la app
// aprende: cada rubro que el usuario corrige se guarda como regla para ese
// comercio, así que el mismo cargo ya no le vuelve a preguntar.
//
// Una decisión que importa: NO se crea regla para "extraordinario". Ese rubro
// depende del monto y de la intención, no del comercio — una regla
// "amazon → extraordinario" mandaría ahí cada compra de $200.

interface Ajuste {
  id: string;
  tx_type?: string;
  category?: string | null;
  concept?: string;
  amount?: number;      // MXN, si el usuario corrigió la conversión
  fx_rate?: number;     // tipo de cambio que el usuario dejó en la hoja
  descartar?: boolean;
}

interface Borrador {
  id: string;
  tx_date: string;
  merchant_key: string;
  concept: string;
  amount_original: number;
  currency: string;
  amount: number | null;
  fx_rate_used: number | null;
  tx_type: TxType | null;
  category: string | null;
  dedupe_hash: string;
  status: string;
}

const esTipo = (v: unknown): v is TxType =>
  typeof v === "string" && (TX_TYPES as readonly string[]).includes(v);

export async function POST(req: NextRequest) {
  try {
    const supabase = financeAdmin();

    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = (await req.json()) as {
      client_id?: string;
      capture_id?: string;
      movimientos?: Ajuste[];
    };
    const clientId = String(body.client_id ?? "");
    const captureId = String(body.capture_id ?? "");
    const ajustes = Array.isArray(body.movimientos) ? body.movimientos : [];

    if (!/^[0-9a-f-]{36}$/.test(clientId) || !/^[0-9a-f-]{36}$/.test(captureId)) {
      return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
    }
    if (ajustes.length === 0 || ajustes.length > 100) {
      return NextResponse.json({ error: "Nada que confirmar" }, { status: 400 });
    }

    const { data: access } = await supabase
      .from("user_client_access").select("user_id")
      .eq("user_id", user.id).eq("client_id", clientId).maybeSingle();
    if (!access) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

    // Se leen de la BD y NO del cuerpo de la petición: el monto y la fecha son
    // lo que se extrajo, no lo que el navegador diga que se extrajo.
    const { data: filas, error: selErr } = await supabase
      .from("finance_tx_drafts")
      .select("id, tx_date, merchant_key, concept, amount_original, currency, amount, fx_rate_used, tx_type, category, dedupe_hash, status")
      .eq("capture_id", captureId)
      .eq("client_id", clientId)
      .eq("status", "pending");
    if (selErr) {
      console.error("[finanzas/confirmar] select:", selErr);
      return NextResponse.json({ error: "Error al leer los borradores." }, { status: 500 });
    }

    const porId = new Map((filas ?? []).map(f => [f.id, f as Borrador]));

    let guardados = 0;
    let descartados = 0;
    let duplicados = 0;
    let reglas = 0;
    const sinRubro: string[] = [];

    for (const a of ajustes) {
      const b = porId.get(String(a.id ?? ""));
      if (!b) continue;

      if (a.descartar) {
        await supabase.from("finance_tx_drafts").update({ status: "discarded" }).eq("id", b.id);
        descartados++;
        continue;
      }

      const tipo: TxType | null = esTipo(a.tx_type) ? a.tx_type : b.tx_type;
      if (!tipo) { sinRubro.push(b.concept); continue; }

      const concepto = (a.concept?.trim() || b.concept).slice(0, 120);
      const esMxn = b.currency === "MXN";
      const montoMxn = Number.isFinite(a.amount) && Number(a.amount) > 0
        ? aCentavos(Number(a.amount))
        : (b.amount ?? b.amount_original);
      // Si el usuario ajustó el tipo de cambio en la hoja, se guarda ESE: es el
      // rastro de auditoría de cómo se llegó al monto en pesos.
      const tasa = Number.isFinite(a.fx_rate) && Number(a.fx_rate) > 0
        ? Number(a.fx_rate)
        : b.fx_rate_used;

      const { data: tx, error: insErr } = await supabase
        .from("finance_transactions")
        .insert({
          client_id:       clientId,
          tx_date:         b.tx_date,
          tx_type:         tipo,
          concept:         concepto,
          // El esquema solo guarda category en extraordinario.
          category:        tipo === "extraordinario" ? (a.category ?? b.category) : null,
          amount:          montoMxn,
          amount_original: b.amount_original,
          currency:        b.currency,
          fx_rate_used:    esMxn ? null : tasa,
          fx_estimated:    !esMxn,
          source:          "screenshot",
          merchant_key:    b.merchant_key,
          dedupe_hash:     b.dedupe_hash,
        })
        .select("id")
        .single();

      // 23505 = violación de índice único. El cargo ya estaba registrado: no es
      // un error que deba tirar el lote, es exactamente lo que dedupe evita.
      if (insErr) {
        if (insErr.code === "23505") {
          await supabase.from("finance_tx_drafts").update({ status: "duplicate" }).eq("id", b.id);
          duplicados++;
          continue;
        }
        console.error("[finanzas/confirmar] insert tx:", insErr);
        continue;
      }

      await supabase.from("finance_tx_drafts")
        .update({ status: "confirmed", tx_id: tx?.id ?? null, tx_type: tipo, concept: concepto })
        .eq("id", b.id);
      guardados++;

      // ── Aprendizaje ────────────────────────────────────────────────────
      if (tipo !== "extraordinario" && b.merchant_key && b.merchant_key !== "sin-comercio") {
        const { data: previa } = await supabase
          .from("finance_merchant_rules")
          .select("hit_count")
          .eq("client_id", clientId).eq("merchant_key", b.merchant_key)
          .maybeSingle();

        const { error: regErr } = await supabase.from("finance_merchant_rules").upsert({
          client_id:     clientId,
          merchant_key:  b.merchant_key,
          tx_type:       tipo,
          category:      null,
          concept_label: concepto,
          hit_count:     (previa?.hit_count ?? 0) + 1,
          updated_at:    new Date().toISOString(),
        }, { onConflict: "client_id,merchant_key" });
        if (regErr) console.error("[finanzas/confirmar] regla:", regErr);
        else reglas++;
      }
    }

    // La captura se cierra solo si ya no quedan pendientes.
    const { count: pendientes } = await supabase
      .from("finance_tx_drafts")
      .select("id", { count: "exact", head: true })
      .eq("capture_id", captureId).eq("status", "pending");

    if ((pendientes ?? 0) === 0) {
      await supabase.from("finance_captures")
        .update({ status: "reviewed", reviewed_at: new Date().toISOString() })
        .eq("id", captureId);
    }

    return NextResponse.json({
      ok: true,
      guardados,
      descartados,
      duplicados,
      reglas,
      pendientes: pendientes ?? 0,
      sin_rubro: sinRubro,
    });
  } catch (err) {
    console.error("[finanzas/confirmar] error:", err);
    return NextResponse.json({ error: "Error al confirmar." }, { status: 500 });
  }
}
