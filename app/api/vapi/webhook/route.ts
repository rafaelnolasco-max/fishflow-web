import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Tipos de eventos que envía Vapi ─────────────────────────────────────────

type VapiEventType =
  | 'call-started'
  | 'call-ended'
  | 'end-of-call-report'
  | 'hang'
  | 'speech-update'
  | 'transcript'
  | 'tool-calls'
  | 'status-update'

interface VapiWebhookPayload {
  message: {
    type: VapiEventType
    call?: {
      id: string
      status: string
      endedReason?: string
      duration?: number
    }
    // end-of-call-report
    endedReason?: string
    transcript?: string
    summary?: string
    durationSeconds?: number
    recordingUrl?: string
    stereoRecordingUrl?: string
    artifact?: {
      transcript?: string
      summary?: string
      recordingUrl?: string
    }
  }
}

// ─── Mapear endedReason de Vapi → outcome en call_logs ───────────────────────

function mapOutcome(endedReason?: string): string {
  if (!endedReason) return 'no_response'
  const r = endedReason.toLowerCase()
  if (r.includes('customer-did-not-answer') || r.includes('no-answer')) return 'no_response'
  if (r.includes('busy'))      return 'no_response'
  if (r.includes('failed'))    return 'error'
  if (r.includes('voicemail')) return 'no_response'
  // Para confirmaciones reales hay que analizar el transcript o usar tool-calls
  // Por defecto si la llamada terminó normalmente = no_response hasta que el webhook
  // de análisis de transcript actualice el outcome
  return 'no_response'
}

// ─── Mapear outcome → appointment status ─────────────────────────────────────

function mapAppointmentStatus(outcome: string): string | null {
  switch (outcome) {
    case 'confirmed':   return 'confirmed'
    case 'cancelled':   return 'cancelled'
    case 'rescheduled': return 'rescheduled'
    default:            return null  // no actualizar appointment si no hay respuesta clara
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let payload: VapiWebhookPayload

  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  const { message } = payload

  // Solo procesar end-of-call-report — ignorar el resto silenciosamente
  if (message.type !== 'end-of-call-report') {
    return NextResponse.json({ received: true })
  }

  const callId = message.call?.id
  if (!callId) {
    return NextResponse.json({ error: 'call.id faltante' }, { status: 400 })
  }

  // Extraer datos del reporte
  const endedReason    = message.endedReason ?? message.call?.endedReason
  const transcript     = message.artifact?.transcript ?? message.transcript ?? null
  const durationSecs   = message.durationSeconds ?? message.call?.duration ?? null
  const outcome        = mapOutcome(endedReason)
  const callStatus     = endedReason?.includes('failed') ? 'failed'
                       : endedReason?.includes('no-answer') ? 'no_answer'
                       : endedReason?.includes('busy') ? 'busy'
                       : 'completed'

  // ── 1. Buscar el call_log por provider_call_id ──────────────────────────────
  const { data: callLog, error: logFindErr } = await supabaseAdmin
    .from('call_logs')
    .select('id, appointment_id, client_id')
    .eq('provider_call_id', callId)
    .single()

  if (logFindErr || !callLog) {
    console.error('[vapi/webhook] call_log no encontrado para call_id:', callId)
    // Retornar 200 para que Vapi no reintente — el log puede no existir en tests
    return NextResponse.json({ received: true })
  }

  // ── 2. Actualizar call_log ──────────────────────────────────────────────────
  const { error: logUpdateErr } = await supabaseAdmin
    .from('call_logs')
    .update({
      status:           callStatus,
      outcome,
      transcript,
      duration_seconds: durationSecs ? Math.round(durationSecs) : null,
      completed_at:     new Date().toISOString(),
      raw_webhook:      message,
    })
    .eq('id', callLog.id)

  if (logUpdateErr) {
    console.error('[vapi/webhook] Error actualizando call_log:', logUpdateErr)
  }

  // ── 3. Actualizar appointment si hay outcome concreto ──────────────────────
  const appointmentStatus = mapAppointmentStatus(outcome)
  if (appointmentStatus) {
    const { error: apptUpdateErr } = await supabaseAdmin
      .from('appointments')
      .update({ status: appointmentStatus })
      .eq('id', callLog.appointment_id)

    if (apptUpdateErr) {
      console.error('[vapi/webhook] Error actualizando appointment:', apptUpdateErr)
    }
  }

  console.log(`[vapi/webhook] Procesado — call_id: ${callId}, outcome: ${outcome}, status: ${callStatus}`)

  return NextResponse.json({ received: true })
}
