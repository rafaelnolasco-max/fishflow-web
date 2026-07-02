import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { ENLACE_CLIENT_ID } from '@/lib/supabase'

export const runtime = 'nodejs'

// Captura del Top 20 clientes por vendedor de Enlace Integral Seguros
// (/demos/enlaceintegral/top-clientes). Guarda cada cliente en
// insurance_vendor_top_clients con service role — nunca toca git, nunca es público.

const ADMIN_TO = ['raf@fishflow.mx', 'rafaelnolasco@gmail.com']
const MAX_CLIENTS = 20

type ClienteInput = {
  nombre?: string
  telefono?: string
  email?: string
  ciudad?: string
  estado?: string
  cp?: string
  genero?: string
  nacimiento?: string
}

function clean(v: unknown) {
  return String(v ?? '').trim()
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const vendorName = clean(body.vendedor)
    const clientesRaw: ClienteInput[] = Array.isArray(body.clientes) ? body.clientes : []

    if (!vendorName) {
      return NextResponse.json({ error: 'Falta el nombre del vendedor.' }, { status: 400 })
    }

    // Solo filas con los 3 campos obligatorios completos
    const rows = clientesRaw
      .slice(0, MAX_CLIENTS)
      .map((c) => ({
        client_id: ENLACE_CLIENT_ID,
        vendor_name: vendorName,
        client_name: clean(c.nombre),
        phone: clean(c.telefono),
        email: clean(c.email).toLowerCase(),
        city: clean(c.ciudad) || null,
        state: clean(c.estado) || null,
        postal_code: clean(c.cp) || null,
        gender: clean(c.genero) || null,
        birth_date_or_age: clean(c.nacimiento) || null,
        source: 'web_form' as const,
      }))
      .filter((r) => r.client_name && r.phone && r.email)

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No hay clientes con nombre, teléfono y email completos.' },
        { status: 400 }
      )
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { error } = await supabase.from('insurance_vendor_top_clients').insert(rows)
    if (error) {
      console.error('[demo/enlace-top-clientes] Supabase insert error:', error)
      return NextResponse.json({ error: 'Error al guardar. Intenta de nuevo.' }, { status: 500 })
    }

    // Aviso best-effort a Rafa — no bloquea la respuesta si falla
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      try {
        const resend = new Resend(resendKey)
        await resend.emails.send({
          from: 'Enlace Integral <recibos@fishflow.mx>',
          to: ADMIN_TO,
          subject: `Top clientes recibido — ${vendorName} (${rows.length})`,
          html: `<p>El vendedor <strong>${vendorName}</strong> envió <strong>${rows.length}</strong> clientes desde el formulario en línea.</p>`,
        })
      } catch (e) {
        console.error('[demo/enlace-top-clientes] email error:', e)
      }
    }

    return NextResponse.json({ ok: true, saved: rows.length })
  } catch (err: unknown) {
    console.error('[demo/enlace-top-clientes] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al procesar.' }, { status: 500 })
  }
}
