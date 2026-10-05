// app/api/invoices/[id]/xml/route.ts
// Proxy de descarga del XML. Ver la nota del PDF.

import { NextRequest, NextResponse } from 'next/server'
import { descargarArchivo } from '@/lib/cfdi'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await descargarArchivo(id, 'xml')
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return new NextResponse(r.buffer, {
    headers: {
      'Content-Type': 'application/xml',
      'Content-Disposition': `attachment; filename="${r.nombre}"`,
    },
  })
}
