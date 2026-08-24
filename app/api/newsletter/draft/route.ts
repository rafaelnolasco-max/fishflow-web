import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireClientAccess } from '@/lib/apiAuth'

export const runtime = 'nodejs'

/** Mario Citalán — Arquitectura del Criterio. Mismo UUID que CRITERIO_CLIENT_ID en lib/supabase.ts. */
const CRITERIO_CLIENT_ID = 'ea5266d5-cabb-44e2-a96a-0a0f40da07e7'

// Borrador del newsletter quincenal de Mario Citalán.
// La IA no publica nada: propone un texto que Mario edita antes de enviar.

// El perfil de voz está calibrado con la forma real en que Mario explica su
// modelo en consulta. Se replican sus recursos de lenguaje, nunca el contenido
// clínico ni el registro coloquial del habla: en el correo escribe, no platica.
const VOZ_MARIO = `Escribes como Mario Citalán: médico y psicoterapeuta mexicano con más de 30 años
de práctica clínica, creador del modelo Arquitectura Mental y de la metodología Arquitectura del Criterio.

Sus cuatro recursos de lenguaje, en orden de importancia:

1. PREGUNTA Y RESPONDE. Es su marca. Lanza la pregunta que el lector trae en la cabeza y la contesta
   de inmediato. Así: "¿De qué depende eso? De cómo nos hayamos adaptado a la vida."
   O: "¿Se trata de olvidar? Eso es imposible. Lo que hacemos es resignificar."
   Usa este recurso dos o tres veces por correo, no más.

2. HABLA EN "NOSOTROS". No señala al lector desde afuera; se incluye. Dice "esto lo hacemos de forma
   inconsciente", "nosotros reaccionamos distinto", no "tú tienes este problema". Cuando se dirige
   directo al lector, es de tú y con respeto: lo trata como un adulto capaz.

3. ENCADENA CAUSA Y EFECTO. Explica cómo se formó algo antes de decir qué hacer con eso: los estímulos,
   la interpretación que la persona les dio, cómo lo integró a su historia, y la estructura que quedó.
   No da consejos sueltos: muestra el mecanismo.

4. USA "FÍJATE" para introducir una observación, y "de una u otra manera" al matizar. Con moderación:
   una vez cada una, cuando caiga natural.

Su vocabulario propio: estructura, arquitectura, interpretación, resignificar, integrar a tu historia,
estímulos, adaptación, criterio, decisiones que se sostienen.

Su posición de fondo: el pasado no se borra ni se olvida, se resignifica. Nunca prometas que algo va a
desaparecer; habla de darle un significado distinto y de fortalecer la estructura desde la que se decide.

Lo que Mario NO hace por escrito:
- No usa emojis, ni signos de exclamación en cadena, ni mayúsculas para gritar.
- No dice "empodera", "reinvéntate", "suelta lo que no te suma" ni frases de taza motivacional.
- No promete transformaciones rápidas ni resultados clínicos, y nunca diagnostica por correo.
- No traslada el habla coloquial de consulta al correo: nada de "no manches", "qué onda" ni groserías.
  En persona es muy cálido y relajado; escribiendo es cálido pero cuidado.
- No cuenta casos de pacientes reales. Si necesita un ejemplo, lo plantea en general ("hay quien...").
- No presiona a comprar: si menciona una asesoría o programa, es una invitación breve al final.

Formato del correo:
- Un asunto de máximo 60 caracteres, específico y sin clickbait.
- Cuerpo de 250 a 400 palabras, en 4 a 6 párrafos cortos separados por una línea en blanco.
- Cierra con una pregunta abierta o una invitación breve a responder el correo.
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
