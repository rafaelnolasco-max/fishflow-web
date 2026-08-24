import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
// Tope explícito. Sin esto la función se queda con el default de la cuenta y el
// tablero puede pasar minutos en "Escribiendo…" si el modelo va lento o si el
// SDK entra a reintentar. 60 s es de sobra: Haiku responde en 6–10 s.
export const maxDuration = 60

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

  // ── JJ Laboral (vertical legal_laboral) ───────────────────────────────────
  // Salen de su propio feed: @jjlaboral publica infografías de derecho laboral
  // dirigidas al trabajador, con fundamento en la Ley Federal del Trabajo.
  derecho_explicado: `FORMATO: Tu derecho explicado.
Es su formato de mayor volumen (caja de ahorro, constancia laboral, vacaciones, prima de antigüedad).
El GANCHO afirma el derecho de frente, con un emoji temático al inicio y la palabra clave en mayúscula
(ej. "💰 ¡LA CAJA DE AHORRO ES TUYA!").
El PIE abre con uno o dos párrafos que explican cuándo aplica y qué suele pasar en la práctica; sigue con
3 a 5 renglones de "por qué importa" o "qué incluye", cada uno con viñeta 🔹 o ✅; remata con "⚖️ Recuerda:"
y una sola idea; cierra con el bloque del despacho, el contacto y la firma. De 130 a 200 palabras.`,

  mito_vs_realidad: `FORMATO: No te dejes engañar (comparativo).
Dos conceptos que el trabajador confunde y esa confusión le cuesta dinero (finiquito vs. liquidación,
renuncia vs. despido, incapacidad vs. permiso).
El GANCHO nombra los dos conceptos y advierte: "🔴 NO te dejes engañar: FINIQUITO y LIQUIDACIÓN no son lo mismo".
El PIE trata primero uno y luego el otro, cada bloque con su encabezado en su propio renglón y sus viñetas;
después va un renglón que empieza con "En resumen:" y separa los dos en una frase. Cierra con el bloque del
despacho, el contacto y la firma. En ARTE pide una imagen partida en dos columnas, una por concepto.
De 150 a 220 palabras.`,

  que_hacer_si: `FORMATO: Qué hacer si… (pasos).
Situación concreta que ya le está pasando al lector: le levantaron un acta administrativa, llegó el inspector,
lo despidieron, le quieren descontar algo.
El GANCHO plantea la situación en segunda persona: "📋 ¿Te entregaron un acta administrativa? Esto es lo que sigue".
El PIE da de 3 a 5 pasos, uno por renglón, numerados con 🔹 y redactados como acción ("Léela completa antes de
firmar", "Pide copia"). Incluye siempre un renglón de qué NO hacer con ❌. Advierte que los plazos legales
corren y que conviene asesorarse pronto, sin decir cuántos días si el dato no viene en el tema o las notas.
De 130 a 190 palabras.`,

  alerta_patron: `FORMATO: Lo que tu patrón no puede hacer.
Prácticas que se normalizaron en el centro de trabajo y no proceden (descuentos no autorizados, retener
documentos, condicionar el finiquito a firmar la renuncia, negar el equipo de protección).
El GANCHO abre con ⚠️ y nombra la práctica. El PIE explica en un párrafo por qué no procede, lista con ❌ de 3 a 4
prácticas del mismo tipo y con ✅ qué sí puede exigir el trabajador. Tono firme pero sin denigrar a las empresas:
el punto es la ley, no el enfrentamiento. De 120 a 180 palabras.`,

  fecha_clave: `FORMATO: Fecha clave del calendario laboral.
Aguinaldo, PTU, vacaciones, prima vacacional, salario mínimo, días de descanso obligatorio.
El GANCHO lleva 📅 y nombra la prestación con el periodo. El PIE explica a quién le toca, cómo se calcula en
palabras (sin inventar cifras ni fórmulas que no vengan en el tema o las notas) y qué hacer si no se la pagan.
IMPORTANTE: si el tema no trae montos, porcentajes ni fechas límite, no los inventes — descríbelo en general y
pide el dato en ARTE. De 120 a 180 palabras.`,

  pov_despacho: `FORMATO: Al frente de la cámara (video corto).
El abogado explica un punto en 30 a 45 segundos. El GANCHO es el rótulo que aparece sobre el video: una
pregunta corta que el trabajador se hace ("¿Me pueden despedir por un acta administrativa?").
En ARTE describe qué dice y qué muestra en cámara, en dos o tres beats. El PIE es breve, de 40 a 80 palabras:
la respuesta en corto, el bloque del despacho y el contacto. Sin lista de viñetas: aquí manda el video.`,

  // ── FishFlow (vertical automatizacion) ────────────────────────────────────
  // La casa publicando a la casa. Sale de docs/instagram-fishflowmx-lanzamiento.md
  // y de brand/verbal-identity.md: el post que funciona nombra un trabajo manual
  // que el dueño hace hoy y lo contrasta con el mismo trabajo ya corriendo solo.
  automatizacion_pyme: `FORMATO: Automatización que ya corre (feed FishFlow).
El GANCHO es lo único que se lee en la imagen: nombra el trabajo manual que el dueño hace hoy, en su idioma
y en segunda persona ("¿Cuántas horas pierdes confirmando citas por teléfono?"), o el resultado ya logrado en
un negocio real ("Belange ya no lleva su inventario en papel").
El PIE va en tres tiempos, de 70 a 120 palabras: primero cómo se hace hoy a mano y qué cuesta —tiempo, errores,
clientes que se pierden—; luego qué queda corriendo solo, dicho en lo que el dueño ve, no en cómo funciona por
dentro ("cada venta se registra sola", no "se implementa un pipeline"); y cierra invitando a la conversación,
nunca a la compra. Una idea por frase, de tú, sin jerga ni frases de catálogo ("soluciones integrales",
"transformación digital", "potenciar tu negocio").
El contacto es siempre y únicamente: 📩 raf@fishflow.mx — sin WhatsApp, sin teléfono, sin "link en bio".`,

  psicoeducacion: `FORMATO: Psicoeducación (carrusel).
Divulgación clara sobre un tema concreto (señales, mitos, qué sí y qué no). El gancho es el título de portada.
En el pie desarrolla de 3 a 5 puntos, uno por línea, cada uno como una lámina del carrusel. Sin numerar con
markdown: una idea por renglón. Aclara siempre que es información general, no un diagnóstico.`,
}

const FORMATO_GENERICO = `FORMATO: Publicación de feed.
Un gancho que se sostenga solo en la imagen y un pie que lo desarrolle en 60 a 120 palabras.`

// Reglas extra por vertical. Se eligen con content_settings.guardrails
// ('salud' | 'legal' | NULL). Compatibilidad hacia atrás: si guardrails viene
// NULL y sensitive = true, se aplican las de salud, que es lo que hacía antes.
const REGLAS_SALUD = `
CUIDADO CLÍNICO (obligatorio, esta cuenta es de un servicio de salud):
- No diagnostiques ni sugieras que el lector "tiene" un trastorno. Habla de señales y de experiencias comunes.
- No prometas resultados, tiempos de mejoría ni curas. Nada de "en 3 sesiones", "se elimina", "desaparece".
- No cuentes casos de pacientes reales ni cites testimonios. Los ejemplos van en general: "hay quien...".
- No des instrucciones que sustituyan tratamiento, ni recomiendes suspender medicación.
- Si el tema toca ideación suicida, autolesión o crisis, no lo trates como contenido de feed: devuelve un pie
  que invite a buscar atención profesional inmediata y avisa en ARTE que este tema requiere revisión humana.`

// Vertical legal. El riesgo aquí no es clínico sino de exactitud y de promesa:
// una cifra inventada (salario mínimo, días de vacaciones, monto de
// indemnización) o un número de artículo que no existe se publica como si fuera
// la ley y el despacho la firma.
const REGLAS_LEGAL = `
CUIDADO JURÍDICO (obligatorio, esta cuenta es de un despacho de abogados):
- Publicas información general, no asesoría sobre un caso. Nunca le digas al lector qué debe hacer en SU caso
  concreto: explica cómo funciona el derecho e invítalo a una asesoría, porque el resultado depende de sus
  pruebas y de su contrato.
- NO inventes cifras, plazos, porcentajes ni números de artículo. Salario mínimo, UMA, días de vacaciones,
  días de aguinaldo, montos de indemnización y fechas de reforma solo se mencionan si vienen en el tema o en
  las notas. Si no vienen, describe el derecho sin la cifra y pide el dato en ARTE.
- No prometas resultados, montos ni tiempos de un juicio. Nada de "te van a pagar", "lo ganas seguro",
  "se resuelve en tres meses".
- No cuentes casos, clientes, empresas ni contrapartes reales, ni siquiera anonimizados.
- No sugieras simular hechos, ocultar o retener documentos, ni ninguna vía para cobrar algo que no corresponde.
- No denigres a los patrones ni a las empresas como grupo. El enfoque es la ley, no el enfrentamiento.
- Si el tema toca acoso sexual, violencia o riesgo a la integridad, trátalo con sobriedad, sin detalle morboso,
  y remite a asesoría y a la autoridad competente.`

// Vertical propia. Aquí el riesgo no es clínico ni jurídico sino de marca: la
// tentación de anunciar un módulo que todavía no corre en ningún cliente. Un
// post así se convierte en una promesa que Rafa tiene que sostener en la
// siguiente junta de ventas.
const REGLAS_FISHFLOW = `
CUIDADO DE MARCA (obligatorio, esta cuenta es la de FishFlow):
- Solo se habla de lo que YA está corriendo en un cliente real. Si el tema propone una capacidad que no viene
  descrita como funcionando hoy, no la anuncies: escribe sobre el problema que resuelve y avisa en ARTE que
  falta confirmar si ya está en producción.
- Nunca menciones precios, montos, rangos ni "desde $". Tampoco descuentos ni promociones.
- No prometas resultados garantizados ni plazos exactos. El único marco de tiempo que se usa es que el valor
  se nota en las primeras semanas.
- No nombres clientes que no vengan en el tema o en las notas. Los que sí vienen se nombran tal cual se
  autorizaron (por ejemplo "Estética Belange CDMX").
- No inventes cifras de resultado (horas ahorradas, porcentajes, número de clientes) si no vienen en el tema.
- El único canal de contacto es raf@fishflow.mx. Nada de WhatsApp, teléfono ni "escríbeme por DM".
- Sin jerga de programador ni nombres de herramientas del stack: el lector es el dueño del negocio, no su
  proveedor de software.`

type Draft = {
  hook: string
  caption: string
  hashtags: string
  visual_note: string
}

/**
 * Corta la respuesta del modelo en sus cuatro campos.
 *
 * ⚠️ No volver al lookahead `(?=\n(?:GANCHO|...):|$)` con la bandera /m: en
 * multilínea el `$` cierra en el PRIMER salto de línea, así que el pie se
 * truncaba a su primera línea. Pasó desapercibido meses en CANE y salió a la
 * luz con el formato de invitación de Tinto Sentido, que es todo estructura.
 *
 * En vez de eso ubicamos cada etiqueta y cortamos entre marcas: determinista y
 * a prueba de pies de varios párrafos. Tolera los asteriscos que Haiku a veces
 * agrega (`**PIE:**`) y el preámbulo tipo "Claro, aquí va:". Si una etiqueta
 * viene repetida, gana la primera.
 */
function parseDraft(texto: string, fallbackHashtags: string): Draft {
  const MARCA = /^[ \t]*\*{0,2}(GANCHO|PIE|HASHTAGS|ARTE)\*{0,2}[ \t]*:[ \t]*\*{0,2}[ \t]*/gm
  const hits = [...texto.matchAll(MARCA)]
  const campos: Record<string, string> = {}

  hits.forEach((h, i) => {
    const etiqueta = h[1]
    if (campos[etiqueta] !== undefined) return
    const ini = (h.index ?? 0) + h[0].length
    const fin = i + 1 < hits.length ? (hits[i + 1].index ?? texto.length) : texto.length
    campos[etiqueta] = texto.slice(ini, fin).trim()
  })

  return {
    hook: campos.GANCHO ?? '',
    caption: campos.PIE ?? '',
    hashtags: campos.HASHTAGS || fallbackHashtags,
    visual_note: campos.ARTE ?? '',
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
      .select('brand_display_name, voice_profile, signature, default_hashtags, sensitive, guardrails')
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

    // Qué reglas de cuidado inyectar. La columna `guardrails` manda; si viene
    // vacía caemos al comportamiento histórico (sensitive = true ⇒ salud).
    const guardrails: string | null =
      settings?.guardrails ?? (settings?.sensitive === true ? 'salud' : null)
    const reglas =
      guardrails === 'legal'    ? REGLAS_LEGAL
      : guardrails === 'salud'  ? REGLAS_SALUD
      : guardrails === 'marca'  ? REGLAS_FISHFLOW
      : ''

    // ── 2. System prompt ──────────────────────────────────────────────────────
    const system = `${voz}

${FORMATOS[formato] ?? FORMATO_GENERICO}
${reglas}

SALIDA (exactamente estas cuatro etiquetas, en este orden, sin markdown ni asteriscos):
GANCHO: el texto que va DENTRO de la imagen. Corto, se lee de un vistazo, sin hashtags.
PIE: el texto de la publicación, listo para pegar. Párrafos cortos separados por una línea en blanco.
HASHTAGS: exactamente 5, en una sola línea, separados por espacio, con acentos donde corresponda.${
      hashtagsBase ? ` Parte de esta base y ajusta al tema: ${hashtagsBase}` : ''
    }
ARTE: una indicación breve para quien arma el diseño en Canva — qué imagen o fondo va, y cualquier aviso.`

    // ── 3. Haiku ──────────────────────────────────────────────────────────────
    // timeout/maxRetries explícitos: el default del SDK es 10 minutos con 2
    // reintentos, que es lo que convierte un mal rato del modelo en una página
    // colgada. Preferimos fallar en 35 s con un mensaje claro.
    const anthropic = new Anthropic({ apiKey, timeout: 35_000, maxRetries: 1 })
    const msg = await anthropic.messages.create({
      // 2000 y no 1200: el formato de invitación es todo estructura (qué
      // incluye, fecha, precios, cupo, reserva) y se cortaba a la mitad.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
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
