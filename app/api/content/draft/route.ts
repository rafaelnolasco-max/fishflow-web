import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

// ─────────────────────────────────────────────────────────────────────────────
// Borrador de post para redes sociales, con la voz del cliente.
// La IA no publica nada: propone un texto que el cliente edita y aprueba en su
// tablero. El arte se produce en Canva a partir del CSV que exporta el tablero.
//
// El perfil de voz vive en content_settings.voice_profile (editable sin deploy).
// ─────────────────────────────────────────────────────────────────────────────

// Formatos por vertical. El front manda el id; si no existe, cae en genérico.
const FORMATOS: Record<string, string> = {
  pregunta_consulta: `FORMATO: Pregunta de consulta.
Abre con una pregunta textual que un paciente haría, entre comillas y en lenguaje de paciente (no de manual).
Luego ánclala en consulta, desmonta el juicio fácil que la persona se hace, explica el mecanismo con su nombre
técnico aterrizado, y cierra abriendo salida. Es el formato más largo: entre 120 y 180 palabras de pie.`,

  reflexion: `FORMATO: Reflexión tipográfica.
El gancho es lo único que se lee en la imagen y debe sostenerse solo: una o dos frases que reencuadran una idea.
Contrapón dos ideas o dale la vuelta a una creencia común. El pie es corto, de 40 a 80 palabras, y desarrolla
por qué esa frase es cierta.`,

  pov: `FORMATO: POV de consulta (video corto).
El gancho es el rótulo que aparece sobre el video, siempre empieza con "POV:". Es humor cálido y cómplice sobre
la vida real de la consulta, nunca a costa del paciente. En ARTE describe qué hace ella en cámara, gesto por gesto.
El pie es breve, de 30 a 60 palabras.`,

  personal: `FORMATO: Personal.
Ella se muestra fuera del rol clínico: lo que escucha, lee o hace, su consultorio, su rutina. Conecta con su
trabajo sin forzarlo. Primera persona, tono de sobremesa. Pie de 60 a 100 palabras.`,

  // ── Tinto Sentido (vertical experiencias) ─────────────────────────────────
  // Salen de su propio feed. El orden refleja lo que le funciona: la invitación
  // a evento es su post de mayor alcance (43 likes) y el brindis tipográfico el
  // de menor (2 likes), aunque se conserva porque es barato de producir.
  invitacion_experiencia: `FORMATO: Invitación a experiencia.
Es su publicación de mayor alcance y tiene estructura fija; respétala al pie de la letra.
El GANCHO es el título del evento en mayúsculas, entre emojis (ej. "🥃✨ ALMARAZ WHISKY EXPERIENCE ✨🥃").
El PIE va así, en este orden y con línea en blanco entre bloques:
una o dos líneas de promesa de lo que van a vivir; luego "La experiencia incluye:" con 3 a 5 líneas abiertas
con emoji; luego "📍 fecha | hora" y la locación; luego "💲 Inversión:" con los precios en formato
"1 pax → $1,200" y, si hay preventa, "🔥 Early Access hasta el [fecha]"; luego "⚠️ Cupo limitado";
y cierra con "Reserva aquí:" y "📲 wa.me/5658204023".
Usa ÚNICAMENTE los datos que vengan en el tema o las notas. Cualquier dato que falte lo dejas fuera y lo
pides en ARTE: nunca inventes precio, fecha, hora, cupo ni locación.`,

  asi_se_vivio: `FORMATO: Así se vivió (recap de la experiencia).
Va sobre foto o video real de los invitados, y es su segundo formato de mayor alcance.
El gancho abre con "Así se vivió" o "Así fue" y el nombre de la experiencia, o con una imagen sonora del momento
("Shakers sonando, entre risas y creatividad"). El pie agradece a quien vino, en plural y con 💜, y remata con
su movimiento firma ("confirmamos que no es solo tomar… es vivir la experiencia"). Cierra con pregunta corta que
invita a la siguiente: "¿Vienes al siguiente? 👀". De 50 a 90 palabras. Si hubo marca aliada, etiquétala.`,

  colaboracion: `FORMATO: Colaboración con marca aliada.
El protagonista es el destilado o la marca invitada (@ginebradoblecara, @whisky_almaraz, @reaparecemezcal),
y Tinto Sentido es quien la pone en escena. Gancho corto y con actitud, se vale el guiño en inglés de dos a
cuatro palabras ("Classic drink. Cool vibe. Great gin."). El pie da una línea de carácter de la marca y una de
por qué encaja con la experiencia. Es el formato más breve: de 25 a 50 palabras. Etiqueta siempre a la marca.
No inventes notas de cata, procesos ni premios: si el tema no te los da, habla de la sensación y del momento.`,

  detras_barra: `FORMATO: Detrás de la barra.
El proyecto y su gente, no el producto: quién arma las experiencias, cómo nació, la comunidad que se formó.
Primera persona del plural, tono de agradecimiento genuino sin cursilería, 💜 al cierre. El gancho arranca con
"Detrás de Tinto Sentido…" o equivalente. De 50 a 90 palabras. Sin llamado a vender: aquí solo se construye
cercanía. Es el formato para cuando no hay evento próximo que anunciar.`,

  viernes_brindis: `FORMATO: Brindis del viernes (tipográfico).
El gancho es lo único que se lee en la imagen y debe sostenerse solo: una frase corta sobre el placer de brindar
o de cerrar la semana. El pie es muy breve, de 20 a 40 palabras, y termina en una pregunta de dos o tres opciones
que se contesta en comentarios ("¿Tinto, rosado o blanco?"). Este formato rinde poco alcance: úsalo para mantener
presencia, no para vender.`,

  psicoeducacion: `FORMATO: Psicoeducación (carrusel).
Divulgación clara sobre un tema concreto (señales, mitos, qué sí y qué no). El gancho es el título de portada.
En el pie desarrolla de 3 a 5 puntos, uno por línea, cada uno como una lámina del carrusel. Sin numerar con
markdown: una idea por renglón. Aclara siempre que es información general, no un diagnóstico.`,
}

const FORMATO_GENERICO = `FORMATO: Publicación de feed.
Un gancho que se sostenga solo en la imagen y un pie que lo desarrolle en 60 a 120 palabras.`

// Reglas extra para verticales de salud (content_settings.sensitive = true).
const REGLAS_SALUD = `
CUIDADO CLÍNICO (obligatorio, esta cuenta es de un servicio de salud):
- No diagnostiques ni sugieras que el lector "tiene" un trastorno. Habla de señales y de experiencias comunes.
- No prometas resultados, tiempos de mejoría ni curas. Nada de "en 3 sesiones", "se elimina", "desaparece".
- No cuentes casos de pacientes reales ni cites testimonios. Los ejemplos van en general: "hay quien...".
- No des instrucciones que sustituyan tratamiento, ni recomiendes suspender medicación.
- Si el tema toca ideación suicida, autolesión o crisis, no lo trates como contenido de feed: devuelve un pie
  que invite a buscar atención profesional inmediata y avisa en ARTE que este tema requiere revisión humana.`

type Draft = {
  hook: string
  caption: string
  hashtags: string
  visual_note: string
}

function parseDraft(texto: string, fallbackHashtags: string): Draft {
  const grab = (etiqueta: string) => {
    const re = new RegExp(
      `^${etiqueta}:\\s*([\\s\\S]*?)(?=\\n(?:GANCHO|PIE|HASHTAGS|ARTE):|$)`,
      'm'
    )
    return texto.match(re)?.[1]?.trim() ?? ''
  }
  return {
    hook: grab('GANCHO'),
    caption: grab('PIE'),
    hashtags: grab('HASHTAGS') || fallbackHashtags,
    visual_note: grab('ARTE'),
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const clientId = String(body.clientId ?? '').trim()
    const formato = String(body.format ?? 'reflexion').trim()
    const tema = String(body.topic ?? '').trim()
    const notas = String(body.notes ?? '').trim()

    if (!clientId) {
      return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 })
    }
    if (!tema) {
      return NextResponse.json({ error: 'Escribe de qué quieres hablar.' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      console.error('[content/draft] ANTHROPIC_API_KEY no configurada')
      return NextResponse.json({ error: 'IA no configurada.' }, { status: 500 })
    }

    // ── 1. Voz del cliente ────────────────────────────────────────────────────
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: settings, error: sErr } = await supabaseAdmin
      .from('content_settings')
      .select('brand_display_name, voice_profile, signature, default_hashtags, sensitive')
      .eq('client_id', clientId)
      .maybeSingle()

    if (sErr) {
      console.error('[content/draft] settings error:', sErr)
      return NextResponse.json({ error: 'No se pudo leer la configuración.' }, { status: 500 })
    }

    const voz = settings?.voice_profile?.trim()
    if (!voz) {
      return NextResponse.json(
        { error: 'Este cliente todavía no tiene un perfil de voz configurado.' },
        { status: 400 }
      )
    }

    const hashtagsBase = settings?.default_hashtags?.trim() ?? ''
    const sensible = settings?.sensitive === true

    // ── 2. System prompt ──────────────────────────────────────────────────────
    const system = `${voz}

${FORMATOS[formato] ?? FORMATO_GENERICO}
${sensible ? REGLAS_SALUD : ''}

SALIDA (exactamente estas cuatro etiquetas, en este orden, sin markdown ni asteriscos):
GANCHO: el texto que va DENTRO de la imagen. Corto, se lee de un vistazo, sin hashtags.
PIE: el texto de la publicación, listo para pegar. Párrafos cortos separados por una línea en blanco.
HASHTAGS: exactamente 5, en una sola línea, separados por espacio, con acentos donde corresponda.${
      hashtagsBase ? ` Parte de esta base y ajusta al tema: ${hashtagsBase}` : ''
    }
ARTE: una indicación breve para quien arma el diseño en Canva — qué imagen o fondo va, y cualquier aviso.`

    // ── 3. Haiku ──────────────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey })
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system,
      messages: [
        {
          role: 'user',
          content:
            `Escribe la publicación.\n\n` +
            `Tema: ${tema}\n` +
            (notas ? `Notas del cliente: ${notas}\n` : ''),
        },
      ],
    })

    const texto = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    const draft = parseDraft(texto, hashtagsBase)
    if (!draft.caption && !draft.hook) {
      return NextResponse.json(
        { error: 'No se pudo generar la publicación. Intenta de nuevo.' },
        { status: 502 }
      )
    }

    return NextResponse.json({ ok: true, ...draft })
  } catch (err: unknown) {
    console.error('[content/draft] Error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'No se pudo generar el borrador.' }, { status: 500 })
  }
}
