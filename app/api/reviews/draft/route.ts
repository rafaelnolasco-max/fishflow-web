import { NextRequest, NextResponse } from 'next/server'
import { requireClientAccess } from '@/lib/apiAuth'
import { vendorPorToken } from '@/lib/reviewVendors'
import { generateReviewDraft } from '@/lib/reviewDraft'

// ─── Handler ─────────────────────────────────────────────────────────────────
// Genera el borrador del mensaje 2 (pedir reseña) o 3 (mandar link) tomando en
// cuenta la respuesta que el cliente dio por WhatsApp (pegada a mano en el
// tablero). Solo redacta el texto; el envío sigue siendo manual por wa.me.

export async function POST(req: NextRequest) {
  try {
    const { clientId, stage, reply, contactName, vendorToken } = await req.json()

    // stage = etapa ACTUAL del request. 1 = saludo enviado → generar msg 2.
    // 2 = petición enviada → generar msg 3 (con link).
    const stg = Number(stage)
    if (!clientId || (stg !== 1 && stg !== 2)) {
      return NextResponse.json(
        { error: 'clientId y stage (1 o 2) son requeridos' },
        { status: 400 }
      )
    }
    if (!reply?.trim()) {
      return NextResponse.json(
        { error: 'Pega la respuesta del cliente para generar el mensaje' },
        { status: 400 }
      )
    }

    // ── Candado: dos credenciales válidas ────────────────────────────────────
    // Sin esto, cualquiera con un client_id (que viaja en el HTML del tablero)
    // podía gastar tokens de Anthropic y sacar la voz —ai_persona— del negocio.
    //
    // Pero la página de la vendedora (/resenas/[token]) es pública y sin login,
    // y desde ahí también se generan estos borradores: ahí la credencial es el
    // token. Cuando viene, el cliente se resuelve DESDE el token y se ignora el
    // del body — si no, el token de una vendedora serviría para pedir borradores
    // con la voz de otro cliente.
    let clienteAutorizado = String(clientId)
    if (vendorToken) {
      const vendor = await vendorPorToken(String(vendorToken))
      if (!vendor) {
        return NextResponse.json(
          { error: 'Este enlace no es válido o fue desactivado.' },
          { status: 401 }
        )
      }
      clienteAutorizado = vendor.client_id
    } else {
      const auth = await requireClientAccess(clienteAutorizado)
      if (!auth.ok) return auth.response
    }

    const result = await generateReviewDraft({
      clientId: clienteAutorizado,
      stg: stg as 1 | 2,
      reply: reply.trim(),
      contactName,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    const draft = result.draft

    return NextResponse.json({ draft })
  } catch (err: any) {
    console.error('[reviews/draft] Error:', err?.message ?? err)
    return NextResponse.json(
      { error: 'Error al generar el mensaje. Intenta de nuevo.' },
      { status: 500 }
    )
  }
}
