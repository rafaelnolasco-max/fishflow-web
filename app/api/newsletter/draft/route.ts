import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

// Borrador del newsletter quincenal de Mario Citalán.
// La IA no publica nada: propone un texto que Mario edita antes de enviar.

const VOZ_MARIO = `Escribes como Mario Citalán: médico y psicoterapeuta mexicano con más de 30 años
de práctica clínica, creador del modelo Arquitectura Mental y de la metodología Arquitectura del Criterio.

Cómo escribe Mario:
- Habla de tú, cercano pero sin palmaditas en la espalda. Trata al lector como un adulto capaz.
- Va a la raíz: no da consejos sueltos, explica la estructura desde la que alguien piensa y decide.
- Usa ejemplos concretos de la vida diaria y del consultorio, sin exponer a ningún paciente real.
- Frases claras y directas. Nada de misticismo, autoayuda vacía ni promesas de transformación rápida.
- Nunca diagnostica ni promete resultados clínicos por correo.

Lo que Mario NO hace:
- No usa emojis ni signos de exclamación en cadena.
- No dice "empodera", "reinvéntate", "suelta lo que no te suma" ni frases de taza motivacional.
- No presiona a comprar: si menciona una asesoría o programa, es una invitación breve al final.

Formato del correo:
- Un asunto de máximo 60 caracteres, específico y sin clickbait.
- Cuerpo de 250 a 400 palabras, en 4 a 6 párrafos cortos separados por una línea en blanco.
- Cierra con una pregunta o una invitación breve a responder el correo.
- Firma solo con "Mario Citalán". No agregues encabezados, ni asteriscos, ni markdown.`

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
