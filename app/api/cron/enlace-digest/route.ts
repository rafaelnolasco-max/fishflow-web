import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { ENLACE_CLIENT_ID } from '@/lib/supabase'

export const runtime = 'nodejs'

// Resumen diario de capturas de Enlace Integral Seguros.
//
// Antes cada contacto capturado disparaba su propio correo: las vendedoras llenan
// el formulario cliente por cliente, así que llegaron 89 avisos el 16-jul y 81 el
// 17-jul. Ahora sale un solo correo al final del día con el conteo por vendedora.
//
// Lo dispara el cron de Vercel (ver vercel.json) a las 02:00 UTC = 20:00 CDMX.
// Si no hubo capturas, no manda nada.

const ADMIN_TO = ['raf@fishflow.mx']
const TZ = 'America/Mexico_City'

function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

type Row = {
  vendor_name: string | null
  client_name: string | null
  email: string | null
  phone: string | null
  created_at: string
}

export async function GET(req: Request) {
  // El cron de Vercel manda el header Authorization con CRON_SECRET.
  // Si la variable existe, se exige; así el endpoint no queda abierto.
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[cron/enlace-digest] Falta SUPABASE_URL o SERVICE_ROLE_KEY')
    return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // Ventana: últimas 24 horas
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('insurance_vendor_top_clients')
    .select('vendor_name, client_name, email, phone, created_at')
    .eq('client_id', ENLACE_CLIENT_ID)
    .gte('created_at', desde)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[cron/enlace-digest] Supabase error:', error)
    return NextResponse.json({ error: 'Error al consultar' }, { status: 500 })
  }

  const rows = (data as Row[]) ?? []
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, sent: false, note: 'sin capturas en las últimas 24 h' })
  }

  // Conteo por vendedora
  const porVendedora = new Map<string, number>()
  for (const r of rows) {
    const v = (r.vendor_name || 'Sin asignar').trim()
    porVendedora.set(v, (porVendedora.get(v) ?? 0) + 1)
  }
  const ranking = [...porVendedora.entries()].sort((a, b) => b[1] - a[1])

  // Total acumulado, para dar contexto de avance
  const { count: total } = await supabase
    .from('insurance_vendor_top_clients')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', ENLACE_CLIENT_ID)

  const fecha = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ,
  })

  const filas = ranking
    .map(
      ([v, n]) => `<tr>
        <td style="padding:9px 0;border-bottom:1px solid #E2EAE5">${esc(v)}</td>
        <td style="padding:9px 0;border-bottom:1px solid #E2EAE5;text-align:right"><strong>${n}</strong></td>
      </tr>`
    )
    .join('')

  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1b2733">
    <div style="background:#212934;color:#fff;padding:22px 26px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#65BC7B">Enlace Integral Seguros</div>
      <div style="font-size:22px;margin-top:6px;font-weight:800">${rows.length} contactos capturados hoy</div>
      <div style="font-size:13px;margin-top:4px;opacity:.75">${esc(fecha)}</div>
    </div>
    <div style="padding:22px 26px;border:1px solid #E2EAE5;border-top:none">
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        <tr>
          <td style="padding:0 0 8px;color:#5d7080;font-size:12px;text-transform:uppercase;letter-spacing:.08em">Vendedora</td>
          <td style="padding:0 0 8px;color:#5d7080;font-size:12px;text-transform:uppercase;letter-spacing:.08em;text-align:right">Hoy</td>
        </tr>
        ${filas}
      </table>
      <p style="font-size:14px;color:#1b2733;margin:20px 0 0">
        Base total acumulada: <strong>${total ?? '—'}</strong> contactos.
      </p>
      <a href="https://www.fishflow.mx/app/enlace"
         style="display:inline-block;margin-top:18px;background:#65BC7B;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px">
        Ver el panel
      </a>
      <p style="font-size:12px;color:#5d7080;margin-top:20px">Resumen automático diario · FishFlow</p>
    </div>
  </div>`

  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.error('[cron/enlace-digest] RESEND_API_KEY no configurada')
    return NextResponse.json({ ok: false, note: 'email no configurado', capturas: rows.length })
  }

  const resend = new Resend(resendKey)
  const { error: mailErr } = await resend.emails.send({
    from: 'Enlace Integral <recibos@fishflow.mx>',
    to: ADMIN_TO,
    subject: `Enlace — ${rows.length} contactos capturados hoy`,
    html,
  })
  if (mailErr) {
    console.error('[cron/enlace-digest] email error:', mailErr)
    return NextResponse.json({ ok: false, error: 'Error al enviar' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, sent: true, capturas: rows.length, vendedoras: ranking.length })
}
