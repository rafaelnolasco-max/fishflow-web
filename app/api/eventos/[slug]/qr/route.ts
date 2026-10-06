// GET /api/eventos/[slug]/qr/?f=<folio>&s=<firma> — PNG del QR para el correo.
// Exige la firma para que nadie genere QRs de folios ajenos.
import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { qrPayload, qrSig } from '@/lib/eventos'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const f = (req.nextUrl.searchParams.get('f') ?? '').toUpperCase()
  const s = (req.nextUrl.searchParams.get('s') ?? '').toUpperCase()
  if (!/^[A-Z0-9]{2,8}-\d{4,6}$/.test(f) || s !== qrSig(f)) return new NextResponse('no', { status: 404 })
  const png = await QRCode.toBuffer(qrPayload(f), { errorCorrectionLevel: 'M', margin: 2, width: 420 })
  return new NextResponse(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' },
  })
}
