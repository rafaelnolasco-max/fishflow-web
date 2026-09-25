/**
 * Envío manual desde la bandeja de WhatsApp del /admin. Solo Rafa.
 * body: { to: string, text: string }  → texto libre (ventana de 24 h)
 *       { to: string, template: string, params?: string[] } → plantilla
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/apiAuth'
import { sendText, sendTemplate } from '@/lib/whatsapp'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const b = (await req.json().catch(() => null)) as
    | { to?: string; text?: string; template?: string; params?: string[] }
    | null
  if (!b?.to) return NextResponse.json({ error: 'Falta destinatario' }, { status: 400 })

  const res = b.template
    ? await sendTemplate({ to: b.to, name: b.template, params: b.params ?? [] })
    : b.text?.trim()
      ? await sendText({ to: b.to, body: b.text.trim() })
      : null
  if (!res) return NextResponse.json({ error: 'Mensaje vacío' }, { status: 400 })
  if (!res.ok) {
    const err = res.error as { error?: { message?: string; code?: number } } | string
    const msg = typeof err === 'string' ? err : err?.error?.message ?? 'Meta rechazó el envío'
    return NextResponse.json({ error: msg, code: typeof err === 'string' ? null : err?.error?.code }, { status: 502 })
  }
  return NextResponse.json({ ok: true, id: res.waMessageId })
}
