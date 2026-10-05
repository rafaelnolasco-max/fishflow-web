/**
 * Motor de CFDI — el ÚNICO lugar donde FishFlow timbra, cancela o resuelve la
 * llave de Facturapi. Las rutas (/api/invoices, /api/invoices/lukon, auto,
 * cancel, pdf, xml) son delgadas y llaman aquí.
 *
 * Modelo:
 *   - Un emisor = una fila de `invoice_orgs` = una organización en Facturapi
 *     con su propio RFC y CSD. FishFlow es un emisor más (client 'fishflow').
 *   - La llave vive en Vault y solo sale por la RPC `cfdi_org_api_key`, que
 *     ejecuta únicamente service_role. Nunca en variables de entorno por
 *     cliente ni en la tabla.
 *   - `invoice_orgs.modo` decide test/live. En test el correo va SOLO a la
 *     copia interna (bcc_email) con "[PRUEBA]": un CFDI de prueba no tiene
 *     validez y no debe llegarle al cliente final.
 *
 * Reglas que no se negocian:
 *   1. Un pago se timbra una vez. Antes de llamar a Facturapi se inserta la
 *      fila en 'pending'; el índice único `invoices_una_por_transaccion` hace
 *      que un segundo disparo choque.
 *   2. Si Facturapi no contesta (timeout) la fila se queda en 'pending' con el
 *      motivo. No se marca 'error' porque el CFDI pudo haberse timbrado: un
 *      reintento ciego emitiría dos facturas por el mismo pago.
 *   3. Cada concepto declara si su importe trae IVA (`iva_incluido`, default
 *      true = lo que pagó el cliente). El total del correo sale de lo que
 *      regresa Facturapi, nunca de una multiplicación local.
 *   4. Nada después del timbrado tumba la respuesta: el CFDI ya existe ante el
 *      SAT aunque falle la descarga o el correo.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { descargarCfdi, rutasDescarga, nombreArchivoCfdi } from '@/lib/facturapi'
import { sendEmail, REPLY_TO, type Adjunto, type SenderKey } from '@/lib/email'
import { plantillaCfdi, asuntoCfdi, marcaPorClave, type DatosCfdi } from '@/lib/cfdiEmail'

const FACTURAPI = 'https://www.facturapi.io/v2'

/** FishFlow como emisor de sí misma (tabla clients, slug 'fishflow'). */
export const FISHFLOW_CLIENT_ID = 'b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42'

/** RFC genérico del SAT para público en general. */
const RFC_PUBLICO_GENERAL = 'XAXX010101000'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type Receptor = {
  rfc: string
  razon_social: string
  regimen_fiscal: string
  cp: string
  email?: string | null
  cfdi_use?: string | null
}

export type Concepto = {
  descripcion: string
  /** Precio unitario. Con IVA si `iva_incluido` (default), antes de IVA si no. */
  importe: number
  cantidad?: number
  /**
   * true (default): el importe es lo que pagó el cliente, IVA adentro — pagos
   * con tarjeta, OXXO, transferencia del recibo.
   * false: precio antes de IVA, como cotiza contabilidad (17,500 + IVA).
   */
  iva_incluido?: boolean
  product_key?: string
  unit_key?: string
  unit_name?: string
}

export type Origen = 'manual' | 'auto' | 'autoservicio'

export type CodigoCfdi =
  | 'ORG_NOT_FOUND'
  | 'ORG_INACTIVE'
  | 'ORG_KEY_MISSING'
  | 'DATOS_INVALIDOS'
  | 'YA_FACTURADA'
  | 'TRANSACCION_NO_ENCONTRADA'
  | 'TRANSACCION_NO_PAGADA'
  | 'SIN_DATOS_FISCALES'
  | 'AUTO_DESACTIVADO'
  | 'FACTURAPI_ERROR'
  | 'FACTURAPI_TIMEOUT'
  | 'DB_ERROR'

export type ResultadoCorreo = { enviado: boolean; motivo?: string; destinatario?: string }

export type ResultadoCfdi =
  | {
      ok: true
      invoice_id: string
      facturapi_id: string
      uuid_sat: string
      total: number
      modo: 'test' | 'live'
      pdf_url: string
      xml_url: string
      email: ResultadoCorreo
    }
  | {
      ok: false
      code: CodigoCfdi
      error: string
      status: number
      invoice_id?: string
      details?: unknown
    }

type Org = {
  id: string
  client_id: string
  modo: 'test' | 'live'
  active: boolean
  emisor_cp: string | null
  serie: string | null
  sat_product_key: string
  sat_unit_key: string
  payment_form_default: string
  cfdi_use_default: string
  marca_correo: string
  auto_al_pagar: boolean
  bcc_email: string | null
}

type Emisor = { org: Org; apiKey: string; nombre: string; emailFrom: string | null; replyTo: string | null }

// ─── Infra ────────────────────────────────────────────────────────────────────

let _admin: SupabaseClient | null = null
function admin(): SupabaseClient {
  // Perezoso: instanciarlo a nivel de módulo rompe `next build` sin el secreto.
  if (!_admin) {
    _admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  }
  return _admin
}

function falla(code: CodigoCfdi, error: string, status: number, extra: Partial<ResultadoCfdi> = {}): ResultadoCfdi {
  return { ok: false, code, error, status, ...extra } as ResultadoCfdi
}

const ORG_COLS =
  'id, client_id, modo, active, emisor_cp, serie, sat_product_key, sat_unit_key, payment_form_default, cfdi_use_default, marca_correo, auto_al_pagar, bcc_email'

/** Resuelve el emisor y su llave. Falla cerrado. */
export async function obtenerEmisor(
  emisorClientId: string
): Promise<{ ok: true; emisor: Emisor } | { ok: false; res: ResultadoCfdi }> {
  const sb = admin()
  const { data: org, error } = await sb
    .from('invoice_orgs')
    .select(ORG_COLS)
    .eq('client_id', emisorClientId)
    .maybeSingle<Org>()

  if (error) return { ok: false, res: falla('DB_ERROR', error.message, 500) }
  if (!org) {
    return { ok: false, res: falla('ORG_NOT_FOUND', 'Facturación no habilitada para este emisor', 404) }
  }
  if (!org.active) {
    return { ok: false, res: falla('ORG_INACTIVE', 'La facturación de este emisor aún no está activa', 503) }
  }

  const { data: apiKey, error: keyErr } = await sb.rpc('cfdi_org_api_key', { p_org_id: org.id })
  if (keyErr || !apiKey) {
    return {
      ok: false,
      res: falla('ORG_KEY_MISSING', `Falta la llave de Facturapi (${org.modo}) de este emisor`, 503),
    }
  }

  const { data: cli } = await sb
    .from('clients')
    .select('name, email_from, email_reply_to')
    .eq('id', emisorClientId)
    .maybeSingle()

  return {
    ok: true,
    emisor: {
      org,
      apiKey: apiKey as string,
      nombre: cli?.name ?? '',
      emailFrom: cli?.email_from ?? null,
      replyTo: cli?.email_reply_to ?? null,
    },
  }
}

/**
 * Llave para operar sobre una factura ya existente (PDF, XML, cancelar).
 * Las facturas viejas (sin emisor_org_id) salieron de la llave global.
 */
export async function llaveDeFactura(inv: { emisor_org_id: string | null }): Promise<string | null> {
  if (!inv.emisor_org_id) return process.env.FACTURAPI_SECRET_KEY ?? null
  const { data } = await admin().rpc('cfdi_org_api_key', { p_org_id: inv.emisor_org_id })
  return (data as string | null) ?? null
}

// ─── Validación ───────────────────────────────────────────────────────────────

const RFC_RE = /^([A-ZÑ&]{3,4})(\d{6})([A-Z\d]{3})$/

function normalizarReceptor(r: Receptor, org: Org): { ok: true; r: Required<Receptor> } | { ok: false; error: string } {
  const rfc = (r.rfc ?? '').toUpperCase().replace(/\s+/g, '')
  if (!RFC_RE.test(rfc)) return { ok: false, error: 'RFC con formato inválido' }

  // Público en general: el SAT exige nombre, régimen, uso y CP fijos (CP = el del emisor).
  if (rfc === RFC_PUBLICO_GENERAL) {
    if (!org.emisor_cp) return { ok: false, error: 'El emisor no tiene CP para facturar a público en general' }
    return {
      ok: true,
      r: {
        rfc,
        razon_social: 'PUBLICO EN GENERAL',
        regimen_fiscal: '616',
        cp: org.emisor_cp,
        email: r.email?.trim() || null,
        cfdi_use: 'S01',
      } as Required<Receptor>,
    }
  }

  const razon = (r.razon_social ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  const cp = (r.cp ?? '').trim()
  const regimen = (r.regimen_fiscal ?? '').trim()
  if (!razon) return { ok: false, error: 'Razón social requerida' }
  if (!/^\d{5}$/.test(cp)) return { ok: false, error: 'Código postal fiscal inválido' }
  if (!/^\d{3}$/.test(regimen)) return { ok: false, error: 'Régimen fiscal inválido' }

  return {
    ok: true,
    r: {
      rfc,
      razon_social: razon,
      regimen_fiscal: regimen,
      cp,
      email: r.email?.trim() || null,
      cfdi_use: (r.cfdi_use || org.cfdi_use_default).trim(),
    } as Required<Receptor>,
  }
}

// ─── Emitir ───────────────────────────────────────────────────────────────────

export type EmitirArgs = {
  emisorClientId: string
  /** Cliente de FishFlow que recibe (solo cuando FishFlow factura a su cliente). */
  receptorClientId?: string | null
  receptor: Receptor
  conceptos: Concepto[]
  paymentForm?: string | null
  transactionId?: string | null
  origen: Origen
  enviarCorreo?: boolean
}

export async function emitirCfdi(args: EmitirArgs): Promise<ResultadoCfdi> {
  const r0 = await obtenerEmisor(args.emisorClientId)
  if (!r0.ok) return r0.res
  const { org, apiKey } = r0.emisor

  const norm = normalizarReceptor(args.receptor, org)
  if (!norm.ok) return falla('DATOS_INVALIDOS', norm.error, 400)
  const receptor = norm.r

  const conceptos = args.conceptos.filter((c) => c.descripcion?.trim() && Number(c.importe) > 0)
  if (!conceptos.length) return falla('DATOS_INVALIDOS', 'Se requiere al menos un concepto con importe', 400)
  // Total con IVA, solo para la fila 'pending'; el definitivo lo regresa Facturapi.
  const importeTotal = conceptos.reduce(
    (s, c) => s + Number(c.importe) * (c.cantidad ?? 1) * (c.iva_incluido === false ? 1.16 : 1),
    0
  )

  const esFishflow = args.emisorClientId === FISHFLOW_CLIENT_ID
  const paymentForm = args.paymentForm || org.payment_form_default
  const sb = admin()

  // ── 1. Candado: la fila nace en 'pending' antes de tocar Facturapi ─────────
  const { data: fila, error: lockErr } = await sb
    .from('invoices')
    .insert({
      client_id: esFishflow ? (args.receptorClientId ?? null) : args.emisorClientId,
      invoice_layer: esFishflow ? 'fishflow' : 'client',
      emisor_org_id: org.id,
      transaction_id: args.transactionId ?? null,
      status: 'pending',
      cfdi_type: 'I',
      modo: org.modo,
      origen: args.origen,
      amount: importeTotal,
      currency: 'MXN',
      concepto: conceptos.map((c) => c.descripcion.trim()).join(' · ').slice(0, 500),
      receptor_rfc: receptor.rfc,
      receptor_razon: receptor.razon_social,
      receptor_regimen: receptor.regimen_fiscal,
      receptor_cp: receptor.cp,
      receptor_email: receptor.email,
      cfdi_use: receptor.cfdi_use,
      payment_form: paymentForm,
    })
    .select('id')
    .single()

  if (lockErr) {
    if (lockErr.code === '23505') {
      const { data: previa } = await sb
        .from('invoices')
        .select('id')
        .eq('transaction_id', args.transactionId!)
        .not('emisor_org_id', 'is', null)
        .in('status', ['pending', 'valid'])
        .maybeSingle()
      return falla('YA_FACTURADA', 'Este pago ya tiene factura', 409, { invoice_id: previa?.id })
    }
    return falla('DB_ERROR', lockErr.message, 500)
  }
  const invoiceId = fila.id as string

  // ── 2. Timbrar ─────────────────────────────────────────────────────────────
  const cuerpo = {
    customer: {
      legal_name: receptor.razon_social,
      tax_id: receptor.rfc,
      tax_system: receptor.regimen_fiscal,
      email: receptor.email || undefined,
      address: { zip: receptor.cp },
    },
    items: conceptos.map((c) => ({
      quantity: c.cantidad ?? 1,
      product: {
        description: c.descripcion.trim(),
        product_key: c.product_key || org.sat_product_key,
        unit_key: c.unit_key || org.sat_unit_key,
        unit_name: c.unit_name || 'SERVICIO',
        price: Number(c.importe),
        tax_included: c.iva_incluido !== false,
        taxes: [{ type: 'IVA', rate: 0.16 }],
      },
    })),
    payment_form: paymentForm,
    payment_method: 'PUE',
    use: receptor.cfdi_use,
    ...(org.serie ? { series: org.serie } : {}),
  }

  let data: Record<string, any>
  try {
    const res = await fetch(`${FACTURAPI}/invoices`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30_000),
    })
    data = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Rechazo explícito: no se timbró nada. Se libera el candado.
      await sb
        .from('invoices')
        .update({ status: 'error', error_message: String(data?.message ?? `HTTP ${res.status}`).slice(0, 1000) })
        .eq('id', invoiceId)
      return falla('FACTURAPI_ERROR', data?.message ?? 'Facturapi rechazó la factura', 502, {
        invoice_id: invoiceId,
        details: data,
      })
    }
  } catch (err) {
    // Timeout o red: NO sabemos si se timbró. El candado se queda puesto.
    await sb
      .from('invoices')
      .update({ error_message: `Sin respuesta de Facturapi (${String(err).slice(0, 200)}) — verificar en el dashboard antes de reintentar` })
      .eq('id', invoiceId)
    return falla('FACTURAPI_TIMEOUT', 'Facturapi no respondió; revisa en su panel antes de reintentar', 504, {
      invoice_id: invoiceId,
    })
  }

  const rutas = rutasDescarga(invoiceId)
  const total = Number(data.total ?? importeTotal)
  const folio = data.folio_number != null ? String(data.folio_number) : null

  await sb
    .from('invoices')
    .update({
      status: 'valid',
      facturapi_id: data.id,
      uuid_sat: data.uuid,
      subtotal: data.subtotal ?? null,
      total,
      serie: data.series ?? org.serie,
      folio,
      error_message: null,
      ...rutas,
    })
    .eq('id', invoiceId)

  // ── 3. Guardar al receptor para la próxima (facturación automática) ────────
  if (receptor.email && receptor.rfc !== RFC_PUBLICO_GENERAL) {
    await guardarReceptor(args.emisorClientId, receptor).catch((e) =>
      console.error('[cfdi] guardar receptor:', e)
    )
  }

  // ── 4. Correo con PDF + XML (nunca tumba la respuesta) ─────────────────────
  let email: ResultadoCorreo = { enviado: false, motivo: 'omitido' }
  if (args.enviarCorreo !== false) {
    email = await enviarCfdi({
      emisor: r0.emisor,
      invoiceId,
      facturapiId: data.id,
      uuid: data.uuid ?? '',
      folio: [data.series ?? org.serie, folio].filter(Boolean).join('-') || null,
      receptor,
      concepto: conceptos.map((c) => c.descripcion.trim()).join(' · '),
      total,
    }).catch((e) => {
      console.error('[cfdi] correo:', e)
      return { enviado: false, motivo: 'error_inesperado' }
    })
  }

  return {
    ok: true,
    invoice_id: invoiceId,
    facturapi_id: data.id,
    uuid_sat: data.uuid,
    total,
    modo: org.modo,
    pdf_url: rutas.pdf_url,
    xml_url: rutas.xml_url,
    email,
  }
}

async function guardarReceptor(emisorClientId: string, r: Required<Receptor>) {
  const sb = admin()
  const email = r.email!.toLowerCase()
  const datos = {
    rfc: r.rfc,
    razon_social: r.razon_social,
    regimen_fiscal: r.regimen_fiscal,
    cp: r.cp,
    cfdi_use: r.cfdi_use,
    updated_at: new Date().toISOString(),
  }
  const { data: previo } = await sb
    .from('invoice_receptores')
    .select('id')
    .eq('emisor_client_id', emisorClientId)
    .ilike('email', email)
    .maybeSingle()
  if (previo) await sb.from('invoice_receptores').update(datos).eq('id', previo.id)
  else await sb.from('invoice_receptores').insert({ emisor_client_id: emisorClientId, email, ...datos })
}

/** Remitente de respaldo por marca cuando el emisor no trae `clients.email_from`. */
const SENDER_POR_MARCA: Record<string, SenderKey> = {
  fishflow: 'fishflowFacturacion',
  lukon: 'lukonFacturacion',
}

async function enviarCfdi(p: {
  emisor: Emisor
  invoiceId: string
  facturapiId: string
  uuid: string
  folio: string | null
  receptor: Required<Receptor>
  concepto: string
  total: number
}): Promise<ResultadoCorreo> {
  const { org } = p.emisor
  const prueba = org.modo === 'test'

  // En prueba el CFDI no vale: solo a la copia interna.
  const destinatario = prueba ? org.bcc_email : p.receptor.email
  if (!destinatario) {
    return { enviado: false, motivo: prueba ? 'sin_copia_interna' : 'sin_correo_del_receptor' }
  }

  const { pdf, xml } = await descargarCfdi(p.facturapiId, p.emisor.apiKey)
  if (!pdf && !xml) return { enviado: false, motivo: 'no_se_pudo_descargar_el_cfdi' }

  const adjuntos: Adjunto[] = []
  if (pdf) adjuntos.push({ filename: nombreArchivoCfdi(p.folio, p.uuid, 'pdf'), content: pdf })
  if (xml) adjuntos.push({ filename: nombreArchivoCfdi(p.folio, p.uuid, 'xml'), content: xml })

  const marca = marcaPorClave(org.marca_correo, p.emisor.nombre)
  const datos: DatosCfdi = {
    razonSocial: p.receptor.razon_social,
    rfc: p.receptor.rfc,
    concepto: p.concepto,
    total: p.total,
    uuid: p.uuid,
    fecha: new Date().toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Mexico_City',
    }),
    adjuntos: adjuntos.map((a) => a.filename),
  }

  const envio = await sendEmail({
    from: SENDER_POR_MARCA[org.marca_correo] ?? 'fishflowFacturacion',
    fromAddress: p.emisor.emailFrom,
    to: destinatario,
    bcc: !prueba && org.bcc_email && org.bcc_email !== destinatario ? org.bcc_email : undefined,
    replyTo: p.emisor.replyTo ?? REPLY_TO,
    subject: (prueba ? '[PRUEBA — sin validez fiscal] ' : '') + asuntoCfdi(marca, datos),
    html: plantillaCfdi(marca, datos),
    attachments: adjuntos,
    tag: `cfdi/${org.marca_correo}`,
  })

  if (!envio.ok) return { enviado: false, motivo: 'resend_error' }

  await admin()
    .from('invoices')
    .update({ email_sent_at: new Date().toISOString(), email_to: destinatario })
    .eq('id', p.invoiceId)

  return { enviado: true, destinatario }
}

// ─── Facturar un pago (auto y autoservicio) ───────────────────────────────────

/** Forma de pago SAT a partir de cómo se cobró. */
export function formaPagoDeTransaccion(provider: string | null, method: string | null): string | null {
  const m = (method ?? '').toLowerCase()
  if (provider === 'stripe') return m === 'oxxo' ? '01' : '04'
  if (provider === 'mercadopago') {
    if (m.includes('debit')) return '28'
    if (m.includes('credit')) return '04'
    if (m === 'account_money') return '06'
    if (m === 'ticket' || m.includes('oxxo')) return '01'
    if (m.includes('transfer') || m === 'bank_transfer') return '03'
  }
  return null
}

type Txn = {
  id: string
  client_id: string
  amount: number
  currency: string | null
  status: string
  service: string | null
  provider: string | null
  payment_method: string | null
  metadata: Record<string, any> | null
}

/**
 * ¿Quién emite este pago?
 *   - Cobros que FishFlow hace a sus clientes (`created_from = admin_panel`)
 *     → emite FishFlow y el receptor es el cliente.
 *   - Cualquier otro cobro (panel de Lukon, tiendas) → emite el dueño del pago.
 */
function resolverPartes(t: Txn): { emisorClientId: string; receptorClientId: string | null } {
  const deFishflow = t.metadata?.created_from === 'admin_panel' || t.client_id === FISHFLOW_CLIENT_ID
  return deFishflow
    ? { emisorClientId: FISHFLOW_CLIENT_ID, receptorClientId: t.client_id === FISHFLOW_CLIENT_ID ? null : t.client_id }
    : { emisorClientId: t.client_id, receptorClientId: null }
}

async function receptorGuardado(emisorClientId: string, receptorClientId: string | null, email: string | null) {
  const sb = admin()

  // 1. FishFlow → su cliente: los datos fiscales viven en `clients`.
  if (receptorClientId) {
    const { data: c } = await sb
      .from('clients')
      .select('rfc, razon_social, regimen_fiscal, cp, email_factura')
      .eq('id', receptorClientId)
      .maybeSingle()
    if (c?.rfc && c.rfc !== RFC_PUBLICO_GENERAL && c.razon_social && c.regimen_fiscal && c.cp) {
      return {
        rfc: c.rfc,
        razon_social: c.razon_social,
        regimen_fiscal: c.regimen_fiscal,
        cp: c.cp,
        email: c.email_factura ?? email,
      } as Receptor
    }
  }

  // 2. Receptor que ya facturó antes con este emisor (por correo).
  if (email) {
    const { data: r } = await sb
      .from('invoice_receptores')
      .select('rfc, razon_social, regimen_fiscal, cp, cfdi_use, email')
      .eq('emisor_client_id', emisorClientId)
      .ilike('email', email.toLowerCase())
      .maybeSingle()
    if (r) return r as Receptor
  }
  return null
}

/**
 * Factura un pago de `pos_transactions`. El monto y el concepto salen SIEMPRE
 * de la transacción, nunca del body: así el autoservicio del recibo no puede
 * timbrar otra cantidad.
 */
export async function facturarTransaccion(
  transactionId: string,
  origen: 'auto' | 'autoservicio',
  receptorDado?: Receptor
): Promise<ResultadoCfdi> {
  const { data: t } = await admin()
    .from('pos_transactions')
    .select('id, client_id, amount, currency, status, service, provider, payment_method, metadata')
    .eq('id', transactionId)
    .maybeSingle<Txn>()

  if (!t) return falla('TRANSACCION_NO_ENCONTRADA', 'Pago no encontrado', 404)
  if (t.status !== 'paid') return falla('TRANSACCION_NO_PAGADA', 'El pago aún no está confirmado', 409)
  if ((t.currency ?? 'MXN').toUpperCase() !== 'MXN') {
    return falla('DATOS_INVALIDOS', 'Solo se factura en MXN', 400)
  }

  // Facturas de antes del motor (sin emisor_org_id) no entran al índice único
  // —hay duplicados históricos de mayo-2026— pero sí cuentan como facturado.
  const { data: previa } = await admin()
    .from('invoices')
    .select('id')
    .eq('transaction_id', t.id)
    .in('status', ['pending', 'valid'])
    .limit(1)
  if (previa?.length) {
    return falla('YA_FACTURADA', 'Este pago ya tiene factura', 409, { invoice_id: previa[0].id })
  }

  const { emisorClientId, receptorClientId } = resolverPartes(t)

  if (origen === 'auto') {
    const { data: org } = await admin()
      .from('invoice_orgs')
      .select('auto_al_pagar, active')
      .eq('client_id', emisorClientId)
      .maybeSingle()
    if (!org?.active || !org.auto_al_pagar) {
      return falla('AUTO_DESACTIVADO', 'La facturación automática no está activa para este emisor', 200)
    }
  }

  const payerEmail = (t.metadata?.payer_email ?? t.metadata?.customer_email ?? null) as string | null
  const receptor = receptorDado ?? (await receptorGuardado(emisorClientId, receptorClientId, payerEmail))
  if (!receptor) {
    return falla('SIN_DATOS_FISCALES', 'No hay datos fiscales del receptor para facturar en automático', 200)
  }
  if (!receptor.email && payerEmail) receptor.email = payerEmail

  return emitirCfdi({
    emisorClientId,
    receptorClientId,
    receptor,
    conceptos: [
      {
        descripcion: t.service ?? t.metadata?.description ?? 'Servicio',
        importe: Number(t.amount),
      },
    ],
    paymentForm: formaPagoDeTransaccion(t.provider, t.payment_method),
    transactionId: t.id,
    origen,
  })
}

// ─── Cancelar ─────────────────────────────────────────────────────────────────

export const MOTIVOS_CANCELACION = {
  '01': 'Comprobante emitido con errores con relación',
  '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en una factura global',
} as const
export type MotivoCancelacion = keyof typeof MOTIVOS_CANCELACION

export async function cancelarCfdi(
  invoiceId: string,
  motivo: MotivoCancelacion,
  sustitucionUuid?: string | null
): Promise<
  | { ok: true; status: string; cancel_status: string | null }
  | { ok: false; error: string; status: number }
> {
  if (!(motivo in MOTIVOS_CANCELACION)) return { ok: false, error: 'Motivo inválido', status: 400 }
  if (motivo === '01' && !sustitucionUuid) {
    return { ok: false, error: 'El motivo 01 requiere el UUID de la factura que la sustituye', status: 400 }
  }

  const sb = admin()
  const { data: inv } = await sb
    .from('invoices')
    .select('id, facturapi_id, emisor_org_id, status')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!inv?.facturapi_id) return { ok: false, error: 'Factura no encontrada', status: 404 }
  if (inv.status === 'cancelled') return { ok: false, error: 'La factura ya está cancelada', status: 409 }

  const apiKey = await llaveDeFactura(inv)
  if (!apiKey) return { ok: false, error: 'Sin llave de Facturapi para este emisor', status: 503 }

  const qs = new URLSearchParams({ motive: motivo })
  if (sustitucionUuid) qs.set('substitution', sustitucionUuid)

  const res = await fetch(`${FACTURAPI}/invoices/${inv.facturapi_id}?${qs}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: data?.message ?? 'Facturapi rechazó la cancelación', status: 502 }

  // Si el receptor debe aceptar, Facturapi la deja en cancellation_status 'pending'.
  const cancelada = data.status === 'canceled'
  await sb
    .from('invoices')
    .update({
      status: cancelada ? 'cancelled' : inv.status,
      cancel_status: data.cancellation_status ?? null,
      cancel_motivo: motivo,
      cancelled_at: cancelada ? new Date().toISOString() : null,
    })
    .eq('id', invoiceId)

  return { ok: true, status: cancelada ? 'cancelled' : inv.status, cancel_status: data.cancellation_status ?? null }
}

// ─── Descarga (proxy de PDF/XML) ──────────────────────────────────────────────

export async function descargarArchivo(
  invoiceId: string,
  formato: 'pdf' | 'xml'
): Promise<{ ok: true; buffer: ArrayBuffer; nombre: string } | { ok: false; status: number; error: string }> {
  const { data: inv } = await admin()
    .from('invoices')
    .select('facturapi_id, emisor_org_id, serie, folio, uuid_sat')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!inv?.facturapi_id) return { ok: false, status: 404, error: 'Factura no encontrada' }

  const apiKey = await llaveDeFactura(inv)
  if (!apiKey) return { ok: false, status: 503, error: 'Sin llave de Facturapi' }

  const res = await fetch(`${FACTURAPI}/invoices/${inv.facturapi_id}/${formato}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return { ok: false, status: 502, error: `Error al descargar ${formato.toUpperCase()}` }

  const folio = [inv.serie, inv.folio].filter(Boolean).join('-') || null
  return { ok: true, buffer: await res.arrayBuffer(), nombre: nombreArchivoCfdi(folio, inv.uuid_sat, formato) }
}
