import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_UPLOAD_MIME,
  FINANCE_BUCKET,
  LOW_CONFIDENCE,
  MAX_UPLOAD_BYTES,
  VISION_MIME,
  aCentavos,
  conceptoLegible,
  dedupeHash,
  financeAdmin,
  merchantKey,
  parseLectura,
  type LecturaCaptura,
  type TxType,
} from "@/lib/finanzasCaptura";

export const runtime = "nodejs";
// Mirar un screenshot con 15 renglones y devolverlos estructurados no cabe en
// los 10 s por omisión.
export const maxDuration = 120;

// ════════════════════════════════════════════════════════════════════════════
// Finanzas — leer el screenshot del app del banco
// ════════════════════════════════════════════════════════════════════════════
// Esta ruta reemplaza el trabajo de teclear cada consumo. Recibe la foto de los
// movimientos del día, devuelve BORRADORES clasificados y no toca
// finance_transactions: eso pasa en /captura/confirmar, con el usuario viendo.
//
// Tres cuidados:
//  1) El bucket es PRIVADO. El screenshot trae los últimos 4 de la tarjeta y
//     a veces el saldo.
//  2) Los PAGOS a la tarjeta no son gastos ni ingresos. Si se colaran, cada
//     corte inflaría el mes al doble.
//  3) Las reglas del usuario ganan contra el modelo, siempre. El modelo es el
//     respaldo para comercios que nunca ha visto.

const VISION_MODEL = "claude-sonnet-4-6";

function systemPrompt(hoy: string, etiquetasExtra: string[], monedaDefault: string): string {
  const extras = etiquetasExtra.length ? etiquetasExtra.join(" | ") : "OTRO";
  return `Eres el motor de lectura de estados de cuenta de FishFlow Finanzas.

Recibes el SCREENSHOT de la lista de movimientos de una tarjeta, tomado del app
o del portal del banco, y devuelves cada cargo como un renglón estructurado.

Los rubros del usuario (campo tx_type) son estos y solo estos:
- "fijo": pagos obligatorios y recurrentes — servicios, suscripciones, gasolina,
  renta, telefonía, peajes, estacionamiento, farmacia de receta.
- "placer": gasto elegido para disfrutar — restaurantes, bares, cafés, ropa,
  entretenimiento, antojos, taxis de conveniencia.
- "futuro": ahorro, inversión o pago adelantado de deuda. Casi nunca aparece en
  una tarjeta de crédito.
- "extraordinario": gasto grande y NO mensual (mueble, viaje, equipo médico,
  reparación). Depende del monto y de la intención del usuario, no del comercio,
  así que úsalo solo si el cargo es claramente grande y único. Lleva category
  con uno de: ${extras}
- "ingreso": dinero que entra. NO aplica a cargos de tarjeta.

Reglas duras:
1. OMITE por completo, sin contarlos como ilegibles: pagos a la tarjeta
   ("PAGO RECIBIDO", "SU PAGO", "PAYMENT THANK YOU"), devoluciones, reversos,
   notas de crédito, intereses y comisiones del banco, y cualquier renglón con
   monto negativo. Un pago a la tarjeta NO es un gasto ni un ingreso: es un
   traslado entre cuentas del propio usuario.
2. NO inventes. Si no puedes leer un renglón con certeza, no lo adivines:
   súmalo a unreadable_rows y sigue.
3. merchant_raw va TAL CUAL aparece en pantalla, con su número de sucursal,
   ciudad y estado si los trae. La limpieza la hace el servidor.
4. currency: ⚠ NUNCA la deduzcas del país ni de la ciudad del comercio. Un
   cargo en "MCDONALD'S HOUSTON" dentro de una tarjeta mexicana viene en
   PESOS: el emisor ya lo convirtió. Usa un código distinto de
   "${monedaDefault}" SOLO si la pantalla lo dice con letras junto al monto
   (por ejemplo "USD 18.47" o "cargo en dólares"). Si únicamente ves el
   símbolo "$", la divisa es "${monedaDefault}". Equivocarte aquí multiplica
   el gasto por el tipo de cambio: es el peor error posible en esta tarea.
5. txn_state: "authorized" si el renglón dice pendiente, en trámite o
   pre-autorizado, o se ve en gris más claro que los demás; "posted" si ya
   está aplicado. Si no se distingue, usa "posted".
6. tx_date en formato YYYY-MM-DD. Hoy es ${hoy}. ⚠ Estas pantallas agrupan por
   día: hay un ENCABEZADO de fecha ("11 sep", "13 sep") y debajo la tarjeta con
   los cargos de ese día. Cada renglón hereda la fecha del encabezado que tiene
   ARRIBA, nunca la del encabezado que aparece más abajo. Los encabezados no
   traen año: usa el año que resulte más cercano a hoy sin quedar en el futuro.
   Si un renglón queda sin encabezado visible arriba, no lo adivines: cuéntalo
   en unreadable_rows.
7. Debajo de algunos comercios aparece, en azul, el nombre de un tarjetahabiente
   adicional (una persona). Eso NO es parte del comercio: no lo metas en
   merchant_raw ni lo uses para clasificar.
8. confidence de 0 a 1: qué tan seguro estás del conjunto monto + fecha +
   comercio + rubro de ESE renglón. Sé honesto: un ${LOW_CONFIDENCE} o menos
   manda el renglón al tope de la lista de revisión del usuario, que es
   exactamente lo que debe pasar cuando dudas.
9. Si la imagen no es una lista de movimientos bancarios, devuelve
   movimientos vacío y unreadable_rows 0.

Responde ÚNICAMENTE con JSON válido, sin markdown y sin texto alrededor:
{"card_last4":"1234","movimientos":[{"tx_date":"YYYY-MM-DD","merchant_raw":"...",
"amount":123.45,"currency":"MXN","txn_state":"posted","tx_type":"placer",
"confidence":0.9}],"unreadable_rows":0}`;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = financeAdmin();

    // ── Auth: mismo candado que /api/finanzas/chat ─────────────────────────
    const token = (req.headers.get("authorization") ?? "").replace("Bearer ", "");
    if (!token) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const form = await req.formData();
    const clientId = String(form.get("client_id") ?? "");
    const archivo = form.get("archivo");
    const fxManual = Number(form.get("fx_rate"));
    const monedaDefault = (String(form.get("currency_hint") ?? "MXN").toUpperCase().match(/^[A-Z]{3}$/)?.[0]) ?? "MXN";

    if (!/^[0-9a-f-]{36}$/.test(clientId)) {
      return NextResponse.json({ error: "Cliente inválido" }, { status: 400 });
    }
    const { data: access } = await supabase
      .from("user_client_access").select("user_id")
      .eq("user_id", user.id).eq("client_id", clientId).maybeSingle();
    if (!access) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

    // ── Validación del archivo ─────────────────────────────────────────────
    if (!(archivo instanceof File) || archivo.size === 0) {
      return NextResponse.json({ error: "Falta la imagen." }, { status: 400 });
    }
    if (archivo.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "La imagen no debe pesar más de 10 MB." }, { status: 400 });
    }
    if (!ALLOWED_UPLOAD_MIME.has(archivo.type)) {
      return NextResponse.json({ error: "Manda una captura de pantalla en JPG o PNG." }, { status: 400 });
    }
    if (!VISION_MIME.has(archivo.type)) {
      return NextResponse.json(
        { error: "Ese formato no se puede leer. Mándala como JPG o PNG." },
        { status: 400 },
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "Falta configurar la lectura por IA." }, { status: 503 });
    }

    // ── 1. Guardar la imagen antes de gastar el llamado al modelo ──────────
    const buf = await archivo.arrayBuffer();
    const ext = archivo.type === "image/png" ? "png" : archivo.type === "image/webp" ? "webp" : "jpg";
    const mes = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }).slice(0, 7);
    const path = `${clientId}/${mes}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(FINANCE_BUCKET)
      .upload(path, buf, { contentType: archivo.type, upsert: false });
    if (upErr) {
      console.error("[finanzas/captura] upload:", upErr);
      return NextResponse.json({ error: "No se pudo guardar la imagen." }, { status: 500 });
    }

    const { data: captura, error: capErr } = await supabase
      .from("finance_captures")
      .insert({ client_id: clientId, image_path: path, mime: archivo.type, size_bytes: archivo.size })
      .select("id")
      .single();
    if (capErr || !captura) {
      console.error("[finanzas/captura] insert captura:", capErr);
      return NextResponse.json({ error: "No se pudo registrar la captura." }, { status: 500 });
    }

    // ── 2. Contexto del usuario: tipo de cambio y etiquetas ────────────────
    const { data: cfg } = await supabase
      .from("finance_config").select("fx_rate, extra_labels")
      .eq("client_id", clientId).maybeSingle();
    const fx = Number.isFinite(fxManual) && fxManual > 0
      ? fxManual
      : Number(cfg?.fx_rate) > 0 ? Number(cfg?.fx_rate) : 17.5;
    const etiquetas: string[] = cfg?.extra_labels ?? [];
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

    // ── 3. Leer la imagen ──────────────────────────────────────────────────
    let lectura: LecturaCaptura | null = null;
    let fallo: string | null = null;
    let crudo = "";
    try {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        timeout: 90_000,
        maxRetries: 1,
      });
      const msg = await anthropic.messages.create({
        model: VISION_MODEL,
        max_tokens: 4000,
        system: systemPrompt(hoy, etiquetas, monedaDefault),
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: archivo.type as "image/jpeg" | "image/png" | "image/webp",
                data: Buffer.from(buf).toString("base64"),
              },
            },
            {
              type: "text",
              text: "Extrae los cargos de esta pantalla. Respeta los encabezados de fecha. Omite los pagos a la tarjeta (monto negativo o en verde) y las devoluciones. No conviertas monedas.",
            },
          ],
        }],
      });
      crudo = msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text).join("");
      lectura = parseLectura(crudo, monedaDefault);
      if (!lectura) fallo = "La respuesta del modelo no vino en el formato esperado.";
    } catch (e) {
      fallo = e instanceof Error ? e.message : "Falló la lectura";
      console.error("[finanzas/captura] IA:", fallo);
    }

    if (!lectura) {
      await supabase.from("finance_captures")
        .update({ status: "failed", model_error: fallo, model_raw: crudo ? { texto: crudo } : null })
        .eq("id", captura.id);
      return NextResponse.json(
        { error: "No pude leer la captura. Intenta con una foto más cerrada y sin recortar renglones." },
        { status: 422 },
      );
    }

    // ── 4. Normalizar, aplicar reglas, convertir y deduplicar ──────────────
    const claves = [...new Set(lectura.movimientos.map(m => merchantKey(m.merchant_raw)).filter(Boolean))];

    const { data: reglas } = claves.length
      ? await supabase
          .from("finance_merchant_rules")
          .select("merchant_key, tx_type, category, concept_label")
          .eq("client_id", clientId)
          .in("merchant_key", claves)
      : { data: [] as { merchant_key: string; tx_type: TxType; category: string | null; concept_label: string | null }[] };

    const porClave = new Map((reglas ?? []).map(r => [r.merchant_key, r]));

    const filas = await Promise.all(lectura.movimientos.map(async (m) => {
      const key = merchantKey(m.merchant_raw) || "sin-comercio";
      const regla = porClave.get(key);
      const esMxn = m.currency === "MXN";

      return {
        capture_id: captura.id,
        client_id: clientId,
        tx_date: m.tx_date,
        merchant_raw: m.merchant_raw,
        merchant_key: key,
        concept: (regla?.concept_label || conceptoLegible(key) || m.merchant_raw).slice(0, 120),
        amount_original: m.amount,
        currency: m.currency,
        amount: esMxn ? m.amount : aCentavos(m.amount * fx),
        fx_rate_used: esMxn ? null : fx,
        // La regla del usuario gana. El modelo es el respaldo.
        tx_type: regla?.tx_type ?? m.tx_type,
        category: regla?.category ?? null,
        // Una regla es certeza: no hay por qué mandar el renglón a revisión.
        confidence: regla ? 1 : m.confidence,
        rule_hit: Boolean(regla),
        txn_state: m.txn_state,
        dedupe_hash: await dedupeHash(m.tx_date, m.amount, m.currency, key),
      };
    }));

    // Duplicados contra lo ya confirmado y contra borradores todavía abiertos.
    const hashes = filas.map(f => f.dedupe_hash);
    const [yaConfirmados, yaEnBorrador] = await Promise.all([
      supabase.from("finance_transactions").select("dedupe_hash")
        .eq("client_id", clientId).in("dedupe_hash", hashes),
      supabase.from("finance_tx_drafts").select("dedupe_hash")
        .eq("client_id", clientId).eq("status", "pending").in("dedupe_hash", hashes),
    ]);
    const vistos = new Set([
      ...(yaConfirmados.data ?? []).map(r => r.dedupe_hash as string),
      ...(yaEnBorrador.data ?? []).map(r => r.dedupe_hash as string),
    ]);

    // Dentro del mismo screenshot también puede venir dos veces el mismo cargo.
    const enEsteLote = new Set<string>();
    const aInsertar = filas.map(f => {
      const repetido = vistos.has(f.dedupe_hash) || enEsteLote.has(f.dedupe_hash);
      enEsteLote.add(f.dedupe_hash);
      return { ...f, status: repetido ? "duplicate" : "pending" };
    });

    if (aInsertar.length) {
      const { error: insErr } = await supabase.from("finance_tx_drafts").insert(aInsertar);
      if (insErr) {
        console.error("[finanzas/captura] insert borradores:", insErr);
        await supabase.from("finance_captures")
          .update({ status: "failed", model_error: insErr.message, model_raw: lectura })
          .eq("id", captura.id);
        return NextResponse.json({ error: "No se pudieron guardar los movimientos." }, { status: 500 });
      }
    }

    await supabase.from("finance_captures").update({
      status: "extracted",
      model_raw: lectura,
      rows_found: aInsertar.length,
      rows_unreadable: lectura.unreadable_rows,
      card_last4: lectura.card_last4,
    }).eq("id", captura.id);

    // Devolver los borradores con id, en el orden en que deben revisarse.
    const { data: borradores } = await supabase
      .from("finance_tx_drafts")
      .select("*")
      .eq("capture_id", captura.id)
      .order("status")
      .order("confidence", { ascending: true })
      .order("tx_date", { ascending: false });

    const dup = aInsertar.filter(f => f.status === "duplicate").length;

    return NextResponse.json({
      ok: true,
      capture_id: captura.id,
      card_last4: lectura.card_last4,
      fx_rate: fx,
      nuevos: aInsertar.length - dup,
      duplicados: dup,
      ilegibles: lectura.unreadable_rows,
      borradores: borradores ?? [],
    });
  } catch (err) {
    console.error("[finanzas/captura] error:", err);
    return NextResponse.json({ error: "Error al procesar la captura." }, { status: 500 });
  }
}
