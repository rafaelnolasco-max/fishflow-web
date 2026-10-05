import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireClientAccess } from '@/lib/apiAuth'
import { VOZ_MARIO } from '@/lib/vozMario'

export const runtime = 'nodejs'

/** Mario Citalán — Arquitectura del Criterio. Mismo UUID que CRITERIO_CLIENT_ID en lib/supabase.ts. */
const CRITERIO_CLIENT_ID = 'ea5266d5-cabb-44e2-a96a-0a0f40da07e7'

// Borrador del newsletter quincenal de Mario Citalán.
// La IA no publica nada: propone un texto que Mario edita antes de enviar.

// El perfil de voz vive en lib/vozMario.ts (compartido con las respuestas a solicitudes).

const AUDIENCIA: Record<string, string> = {
  todos: 'toda su lista: personas que hicieron alguna evaluación y aceptaron recibir sus publicaciones',
  atencion:
    'personas cuyo resultado fue Arquitectura de Actitud en Reconstrucción, Vulnerable o Arquitectura Emergente: hoy su estructura interna está frágil, puede que estén agotadas o con poca sensación de control. Escribe con especial cuidado y sin alarmarlas',
  seguimiento:
    'personas con resultado Actitud Funcional o Arquitectura en Consolidación: tienen recursos y ya hicieron trabajo personal, pero hay áreas claras por fortalecer',
  potencial:
    'personas con resultado Actitud Sólida, Arquitectura Funcional o de Alto Desempeño: base sólida, suelen tener responsabilidades de liderazgo y buscan optimizar decisiones',
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const tema = String(body.tema ?? '').trim()
    const audiencia = String(body.audiencia ?? 'todos')
    const notas = String(body.notas ?? '').trim()

    if (!tema) {
      return NextResponse.json({ error: 'Escribe de qué quieres hablar.' }, { status: 400 })
    }

    // Candado. El cliente va fijo y NO se lee del body: esta ruta escribe con
    // la voz de Mario y nada más, así que el permiso que hay que exigir es el
    // de su panel. Pasar el id por el body solo abriría la puerta a pedirlo con
    // el de otro cliente.
    const auth = await requireClientAccess(CRITERIO_CLIENT_ID)
    if (!auth.ok) return auth.response

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('[newsletter/draft] ANTHROPIC_API_KEY no configurada')
      return NextResponse.json({ error: 'IA no configurada.' }, { status: 500 })
    }

    const anthropic = new Anthropic({ apiKey })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: VOZ_MARIO,
      messages: [
        {
          role: 'user',
          content:
            `Escribe el correo quincenal.\n\n` +
            `Tema: ${tema}\n` +
            `Lectores: ${AUDIENCIA[audiencia] ?? AUDIENCIA.todos}\n` +
            (notas ? `Notas de Mario: ${notas}\n` : '') +
            `\nDevuelve exactamente este formato, sin nada más:\n` +
            `ASUNTO: <el asunto>\n\n<el cuerpo del correo>`,
        },
      ],
    })

    const texto = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    const m = texto.match(/^ASUNTO:\s*(.+?)\n+([\s\S]+)$/)
    const subject = m ? m[1].trim() : `Arquitectura del Criterio — ${tema}`
    const draft = m ? m[2].trim() : texto

    return NextResponse.json({ ok: true, subject, body: draft })
  } catch (err: unknown) {
    console.error('[newsletter/draft] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'No se pudo generar el borrador.' }, { status: 500 })
  }
}
