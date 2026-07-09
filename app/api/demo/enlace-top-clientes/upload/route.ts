import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import * as XLSX from 'xlsx'
import { ENLACE_CLIENT_ID } from '@/lib/supabase'

export const runtime = 'nodejs'

// Sube el Excel de la plantilla "Top 20 Clientes" y lo parsea a
// insurance_vendor_top_clients. Acepta ligeras variaciones de formato:
// busca la fila del vendedor y el encabezado por texto, no por posición fija.

const ADMIN_TO = ['raf@fishflow.mx', 'rafaelnolasco@gmail.com']
const MAX_CLIENTS = 50

const HEADER_MAP: { match: RegExp; key: string }[] = [
  { match: /nombre completo/i, key: 'client_name' },
  { match: /tel[eé]fono/i, key: 'phone' },
  { match: /email|correo/i, key: 'email' },
  { match: /ciudad/i, key: 'city' },
  { match: /estado/i, key: 'state' },
  { match: /c[oó]digo postal|cp\b/i, key: 'postal_code' },
  { match: /g[eé]nero/i, key: 'gender' },
  { match: /nacimiento|edad/i, key: 'birth_date_or_age' },
  // Campos Avatar CRM (HubSpot). Orden importa: "independiente" va antes que
  // "dependientes" y que "profesión" porque "INDEPENDIENTE O PROFESIONISTA"
  // contiene ambas como substring.
  { match: /independiente/i, key: 'occupation_type' },
  { match: /profesi[oó]n/i, key: 'profession' },
  { match: /\bdependientes?\b/i, key: 'dependents' },
  { match: /color/i, key: 'color' },
  { match: /ingreso/i, key: 'income' },
  { match: /relevante/i, key: 'relevant_note' },
  { match: /producto/i, key: 'products' },
]

function cellStr(v: unknown) {
  return String(v ?? '').trim()
}

function findVendorName(rows: unknown[][]): string {
  for (const row of rows) {
    const first = cellStr(row[0])
    if (/nombre del vendedor/i.test(first)) {
      for (let c = 1; c < row.length; c++) {
        const v = cellStr(row[c])
        if (v) return v
      }
    }
  }
  return ''
}

function findHeaderRow(rows: unknown[][]): number {
  for (let r = 0; r < rows.length; r++) {
    const rowText = rows[r].map(cellStr).join(' ').toLowerCase()
    if (rowText.includes('nombre completo') && (rowText.includes('teléfono') || rowText.includes('telefono'))) {
      return r
    }
  }
  return -1
}

export async function POST(req: Request) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    const vendorOverride = cellStr(form.get('vendedor'))

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No se recibió el archivo.' }, { status: 400 })
    }

    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })

    // Preferir hoja "Top 20 Clientes"; si no existe, tomar la última hoja
    const sheetName =
      wb.SheetNames.find((n) => /top\s*20/i.test(n)) ?? wb.SheetNames[wb.SheetNames.length - 1]
    const ws = wb.Sheets[sheetName]
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

    const vendorName = vendorOverride || findVendorName(rows)
    if (!vendorName) {
      return NextResponse.json(
        { error: 'No se encontró el nombre del vendedor en el Excel. Escríbelo en el formulario.' },
        { status: 400 }
      )
    }

    const headerRowIdx = findHeaderRow(rows)
    if (headerRowIdx === -1) {
      return NextResponse.json(
        { error: 'No se reconoció el formato del Excel. Usa la plantilla original.' },
        { status: 400 }
      )
    }

    const headerRow = rows[headerRowIdx].map(cellStr)
    const colIndex: Record<string, number> = {}
    headerRow.forEach((h, i) => {
      const found = HEADER_MAP.find((m) => m.match.test(h))
      if (found) colIndex[found.key] = i
    })

    const dataRows = rows.slice(headerRowIdx + 1, headerRowIdx + 1 + MAX_CLIENTS)
    const parsed = dataRows.map((row) => ({
      client_id: ENLACE_CLIENT_ID,
      vendor_name: vendorName,
      client_name: cellStr(row[colIndex.client_name]),
      phone: cellStr(row[colIndex.phone]),
      email: cellStr(row[colIndex.email]).toLowerCase(),
      city: cellStr(row[colIndex.city]) || null,
      state: cellStr(row[colIndex.state]) || null,
      postal_code: cellStr(row[colIndex.postal_code]) || null,
      gender: cellStr(row[colIndex.gender]) || null,
      birth_date_or_age: cellStr(row[colIndex.birth_date_or_age]) || null,
      color: cellStr(row[colIndex.color]) || null,
      occupation_type: cellStr(row[colIndex.occupation_type]) || null,
      profession: cellStr(row[colIndex.profession]) || null,
      income: cellStr(row[colIndex.income]) || null,
      dependents: cellStr(row[colIndex.dependents]) || null,
      relevant_note: cellStr(row[colIndex.relevant_note]) || null,
      products: cellStr(row[colIndex.products]) || null,
      source: 'excel_upload' as const,
    }))

    let validRows = parsed.filter((r) => r.client_name && r.phone && r.email)

    if (validRows.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron clientes con nombre, teléfono y email completos.' },
        { status: 400 }
      )
    }

    // Dedupe dentro del mismo archivo
    const seen = new Set<string>()
    validRows = validRows.filter((r) => {
      const key = `${r.phone}|${r.email}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Dedupe contra lo ya guardado de este vendedor
    const { data: existing, error: fetchErr } = await supabase
      .from('insurance_vendor_top_clients')
      .select('phone, email')
      .eq('client_id', ENLACE_CLIENT_ID)
      .eq('vendor_name', vendorName)
    if (fetchErr) {
      console.error('[demo/enlace-top-clientes/upload] Supabase fetch error:', fetchErr)
      return NextResponse.json({ error: 'Error al guardar. Intenta de nuevo.' }, { status: 500 })
    }
    const existingKeys = new Set(
      (existing ?? []).flatMap((e) => [e.phone, e.email].filter(Boolean))
    )
    const newRows = validRows.filter((r) => !existingKeys.has(r.phone) && !existingKeys.has(r.email))
    const duplicates = validRows.length - newRows.length

    if (newRows.length === 0) {
      return NextResponse.json(
        { error: 'Estos clientes ya estaban guardados para este vendedor.' },
        { status: 400 }
      )
    }

    const { error } = await supabase.from('insurance_vendor_top_clients').insert(newRows)
    if (error) {
      console.error('[demo/enlace-top-clientes/upload] Supabase insert error:', error)
      return NextResponse.json({ error: 'Error al guardar. Intenta de nuevo.' }, { status: 500 })
    }

    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      try {
        const resend = new Resend(resendKey)
        await resend.emails.send({
          from: 'Enlace Integral <recibos@fishflow.mx>',
          to: ADMIN_TO,
          subject: `Top clientes recibido (Excel) — ${vendorName} (${newRows.length})`,
          html: `<p>El vendedor <strong>${vendorName}</strong> subió un Excel con <strong>${newRows.length}</strong> clientes nuevos.${duplicates > 0 ? ` (${duplicates} ya estaban guardados y se ignoraron)` : ''}</p>`,
        })
      } catch (e) {
        console.error('[demo/enlace-top-clientes/upload] email error:', e)
      }
    }

    return NextResponse.json({ ok: true, saved: newRows.length, duplicates, vendor: vendorName })
  } catch (err: unknown) {
    console.error('[demo/enlace-top-clientes/upload] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Error al procesar el archivo.' }, { status: 500 })
  }
}
