import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Env vars ──────────────────────────────────────────────────────────────────
const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Vapi
const VAPI_API_KEY         = Deno.env.get('VAPI_API_KEY') ?? ''
const VAPI_ASSISTANT_ID    = Deno.env.get('VAPI_ASSISTANT_ID') ?? ''
const VAPI_PHONE_NUMBER_ID = Deno.env.get('VAPI_PHONE_NUMBER_ID') ?? ''

// Twilio
const TWILIO_ACCOUNT_SID  = Deno.env.get('TWILIO_ACCOUNT_SID') ?? ''
const TWILIO_AUTH_TOKEN   = Deno.env.get('TWILIO_AUTH_TOKEN') ?? ''
const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER') ?? ''
const APP_URL             = Deno.env.get('NEXT_PUBLIC_APP_URL') ?? ''

// ─── Types ─────────────────────────────────────────────────────────────────────
interface Appointment {
  id: string
  client_id: string
  patient_name: string
  patient_phone: string
  doctor_name: string | null
  appointment_date: string   // 'YYYY-MM-DD'
  appointment_time: string   // 'HH:MM:SS'
  clients: {
    name: string
    voice_provider: 'vapi' | 'twilio' | null
  }
}

interface CallResult {
  call_id: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Formatea fecha para lectura natural en español MX */
function formatDate(dateStr: string): string {
  // dateStr viene como 'YYYY-MM-DD' — parsear sin timezone shift
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** Formatea hora 'HH:MM:SS' → 'HH:MM' */
function formatTime(timeStr: string): string {
  return timeStr.slice(0, 5)
}

// ─── Providers ─────────────────────────────────────────────────────────────────

async function triggerVapiCall(appt: Appointment): Promise<CallResult> {
  if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID || !VAPI_PHONE_NUMBER_ID) {
    throw new Error('VAPI_API_KEY, VAPI_ASSISTANT_ID o VAPI_PHONE_NUMBER_ID no configurados')
  }

  const res = await fetch('https://api.vapi.ai/call', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assistantId:   VAPI_ASSISTANT_ID,
      phoneNumberId: VAPI_PHONE_NUMBER_ID,
      customer: {
        number: appt.patient_phone,
        name: appt.patient_name,
      },
      assistantOverrides: {
        variableValues: {
          patient_name:     appt.patient_name,
          doctor_name:      appt.doctor_name ?? 'tu especialista',
          appointment_date: formatDate(appt.appointment_date),
          appointment_time: formatTime(appt.appointment_time),
        },
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Vapi error ${res.status}: ${body}`)
  }

  const data = await res.json()
  return { call_id: data.id }
}

async function triggerTwilioCall(appt: Appointment): Promise<CallResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    throw new Error('Credenciales Twilio no configuradas')
  }

  // Webhook TwiML — Next.js route que devuelve el script de la llamada
  const webhookUrl = `${APP_URL}/api/twilio/voice-call?appointment_id=${appt.id}`

  const body = new URLSearchParams({
    To:     appt.patient_phone,
    From:   TWILIO_PHONE_NUMBER,
    Url:    webhookUrl,
    Method: 'POST',
  })

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    },
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Twilio error ${res.status}: ${body}`)
  }

  const data = await res.json()
  return { call_id: data.sid }
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Solo POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  let appointment_id: string
  try {
    const body = await req.json()
    appointment_id = body.appointment_id
  } catch {
    return new Response(JSON.stringify({ error: 'Body JSON inválido' }), { status: 400 })
  }

  if (!appointment_id) {
    return new Response(JSON.stringify({ error: 'appointment_id requerido' }), { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── 1. Obtener cita + config del cliente ──────────────────────────────────
  const { data: appt, error: apptErr } = await supabase
    .from('appointments')
    .select('*, clients(name, voice_provider)')
    .eq('id', appointment_id)
    .single<Appointment>()

  if (apptErr || !appt) {
    return new Response(
      JSON.stringify({ error: 'Cita no encontrada', detail: apptErr?.message }),
      { status: 404 },
    )
  }

  // ── 2. Elegir proveedor ───────────────────────────────────────────────────
  const provider: 'vapi' | 'twilio' = appt.clients.voice_provider ?? 'vapi'

  // ── 3. Disparar llamada ───────────────────────────────────────────────────
  let callResult: CallResult
  try {
    if (provider === 'vapi') {
      callResult = await triggerVapiCall(appt)
    } else {
      callResult = await triggerTwilioCall(appt)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[trigger-appointment-call] Error ${provider}:`, msg)

    // Registrar intento fallido en call_logs
    await supabase.from('call_logs').insert({
      appointment_id,
      client_id:  appt.client_id,
      provider,
      status:     'failed',
      outcome:    'error',
      raw_webhook: { error: msg },
    })

    return new Response(JSON.stringify({ error: msg }), { status: 502 })
  }

  // ── 4. Registrar en call_logs ─────────────────────────────────────────────
  const { error: logErr } = await supabase.from('call_logs').insert({
    appointment_id,
    client_id:        appt.client_id,
    provider,
    provider_call_id: callResult.call_id,
    status:           'initiated',
  })

  if (logErr) console.error('[trigger-appointment-call] Error al insertar call_log:', logErr)

  // ── 5. Marcar cita como llamada enviada ───────────────────────────────────
  const { error: updateErr } = await supabase
    .from('appointments')
    .update({ confirmation_method: 'voice_call' })
    .eq('id', appointment_id)

  if (updateErr) console.error('[trigger-appointment-call] Error al actualizar appointment:', updateErr)

  return new Response(
    JSON.stringify({
      success:  true,
      provider,
      call_id:  callResult.call_id,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
