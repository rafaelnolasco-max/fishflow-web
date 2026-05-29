import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const THERAPYOS_CLIENT_ID = 'd4e5f6a7-b8c9-4012-def0-123456789abc'
const ANDRES_PATIENT_ID   = 'a1b2c3d4-e5f6-4789-0abc-def123456002'

// ─── Prompt clínico ────────────────────────────────────────────────────────────
const CLINICAL_PROMPT = `Eres un asistente clínico para el psicoterapeuta Mario Citalán.
Recibirás la transcripción de una sesión terapéutica entre Mario y su paciente Rafa.
Analiza la transcripción y devuelve ÚNICAMENTE un JSON válido con esta estructura exacta:

{
  "session_title": "Título breve y evocador de la sesión (máx 60 caracteres)",
  "clinical_summary": "Nota clínica para expediente del terapeuta. Lenguaje técnico-clínico. 150-250 palabras.",
  "patient_summary": "Resumen en lenguaje sencillo para que el paciente entienda lo trabajado. 80-120 palabras.",
  "briefing_next": "Preparación para la próxima sesión: hilos abiertos, preguntas clave, áreas a profundizar. 80-150 palabras.",
  "topics": [
    {
      "tipo": "principal|laboral|familiar|clinico|insight",
      "label": "Nombre corto del tema",
      "descripcion": "Descripción del tema en 2-4 oraciones"
    }
  ],
  "emotional_state": {
    "ansiedad": "Baja|Moderada|Alta",
    "sobriedad": "Estable|En riesgo|No aplica",
    "energia_vital": "Baja|Media|Alta",
    "madurez_emocional": "En proceso|Consolidando|Alta",
    "notas_emocionales": "Observación libre sobre el estado emocional general del paciente en esta sesión. 2-3 oraciones."
  },
  "patterns_detected": [
    {
      "emoji": "emoji representativo",
      "es_nuevo": true|false,
      "descripcion": "Descripción del patrón observado. Indicar si es nuevo o recurrente. 2-3 oraciones."
    }
  ],
  "commitments": [
    "Compromiso o tarea concreta que el paciente asumió durante la sesión"
  ]
}

Devuelve SOLO el JSON. Sin explicaciones, sin markdown, sin bloques de código.`

// ─── Handler principal ─────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Solo POST
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Verificar webhook secret de Fireflies
  const webhookSecret = Deno.env.get('FIREFLIES_WEBHOOK_SECRET')
  if (webhookSecret) {
    const signature = req.headers.get('x-fireflies-signature') ?? ''
    if (signature !== webhookSecret) {
      console.error('Invalid webhook signature')
      return new Response('Unauthorized', { status: 401 })
    }
  }

  let payload: FirefliesWebhook
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.log('Fireflies webhook received:', JSON.stringify({
    eventType: payload.eventType,
    meetingTitle: payload.meeting?.title,
    date: payload.meeting?.date,
  }))

  // Solo procesar transcripciones completadas
  if (payload.eventType !== 'meeting.transcribed') {
    return new Response(JSON.stringify({ skipped: true, reason: 'not a transcription event' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const transcript = payload.meeting?.transcript
  if (!transcript || transcript.trim().length < 100) {
    return new Response(JSON.stringify({ skipped: true, reason: 'transcript too short or empty' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Inicializar Supabase con service role
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Determinar fecha de la sesión
  const meetingDate = payload.meeting?.date
    ? new Date(payload.meeting.date).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0]

  // Buscar sesión existente para esa fecha
  const { data: existingSession } = await supabase
    .from('sessions')
    .select('id, session_number')
    .eq('client_id', THERAPYOS_CLIENT_ID)
    .eq('patient_id', ANDRES_PATIENT_ID)
    .eq('session_date', meetingDate)
    .eq('ai_processed', false)
    .maybeSingle()

  // Calcular número de sesión si hay que crear una nueva
  let sessionId: string
  let sessionNumber: number

  if (existingSession) {
    sessionId = existingSession.id
    sessionNumber = existingSession.session_number
    console.log(`Found existing session ${sessionId} (session #${sessionNumber})`)
  } else {
    // Obtener el número de sesión más alto y sumar 1
    const { data: lastSession } = await supabase
      .from('sessions')
      .select('session_number')
      .eq('client_id', THERAPYOS_CLIENT_ID)
      .eq('patient_id', ANDRES_PATIENT_ID)
      .order('session_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    sessionNumber = (lastSession?.session_number ?? 0) + 1
    console.log(`Creating new session #${sessionNumber} for ${meetingDate}`)

    const { data: newSession, error: createError } = await supabase
      .from('sessions')
      .insert({
        client_id: THERAPYOS_CLIENT_ID,
        patient_id: ANDRES_PATIENT_ID,
        session_number: sessionNumber,
        session_date: meetingDate,
        payment_status: 'pending',
        ai_processed: false,
      })
      .select('id')
      .single()

    if (createError || !newSession) {
      console.error('Error creating session:', createError)
      return new Response(JSON.stringify({ error: 'Failed to create session', detail: createError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    sessionId = newSession.id
  }

  // Llamar a Claude Sonnet para análisis clínico
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  console.log('Calling Claude Sonnet for clinical analysis...')
  let clinicalData: ClinicalAnalysis
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${CLINICAL_PROMPT}\n\n---TRANSCRIPCIÓN---\n${transcript}`,
          },
        ],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeJson = await claudeRes.json()
    const rawContent = claudeJson.content?.[0]?.text ?? ''
    clinicalData = JSON.parse(rawContent)
  } catch (err) {
    console.error('Claude analysis failed:', err)
    return new Response(JSON.stringify({ error: 'Claude analysis failed', detail: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Actualizar sesión con transcript + análisis clínico
  const { error: updateError } = await supabase
    .from('sessions')
    .update({
      transcript,
      session_title: clinicalData.session_title,
      clinical_summary: clinicalData.clinical_summary,
      patient_summary: clinicalData.patient_summary,
      briefing_next: clinicalData.briefing_next,
      topics: clinicalData.topics,
      emotional_state: clinicalData.emotional_state,
      patterns_detected: clinicalData.patterns_detected,
      commitments: clinicalData.commitments ?? [],
      raw_summary: payload.meeting?.summary ?? null,
      ai_processed: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)

  if (updateError) {
    console.error('Error updating session:', updateError)
    return new Response(JSON.stringify({ error: 'Failed to update session', detail: updateError }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Registrar en session_log
  await supabase.from('session_log').insert({
    session_id: sessionId,
    action: 'ai_processed',
    snapshot: {
      source: 'fireflies_webhook',
      meeting_title: payload.meeting?.title,
      meeting_date: meetingDate,
      session_number: sessionNumber,
    },
  })

  console.log(`✅ Session #${sessionNumber} processed successfully (id: ${sessionId})`)

  return new Response(
    JSON.stringify({
      ok: true,
      session_id: sessionId,
      session_number: sessionNumber,
      session_date: meetingDate,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})

// ─── Tipos ─────────────────────────────────────────────────────────────────────
interface FirefliesWebhook {
  eventType: string
  meeting?: {
    title?: string
    date?: string
    transcript?: string
    summary?: Record<string, unknown>
    participants?: string[]
    duration?: number
  }
}

interface ClinicalAnalysis {
  session_title: string
  clinical_summary: string
  patient_summary: string
  briefing_next: string
  topics: Array<{ tipo: string; label: string; descripcion: string }>
  emotional_state: {
    ansiedad: string
    sobriedad: string
    energia_vital: string
    madurez_emocional: string
    notas_emocionales: string
  }
  patterns_detected: Array<{ emoji: string; es_nuevo: boolean; descripcion: string }>
  commitments: string[]
}
