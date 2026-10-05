// app/api/invoices/[id]/pdf/route.ts
// Proxy de descarga del PDF. La llave de Facturapi se resuelve por emisor
// (lib/cfdi.ts) y nunca llega al navegador. El id es un UUID no adivinable:
// es la liga que reciben el recibo y el correo.

import { NextRequest, NextResponse } from 'next/server'
import { descargarArchivo } from '@/lib/cfdi'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await descargarArchivo(id, 'pdf')
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return new NextResponse(r.buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${r.nombre}"`,
    },
  })
}
