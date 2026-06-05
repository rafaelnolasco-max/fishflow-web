import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { Resend } from 'resend'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const resend     = new Resend(process.env.RESEND_API_KEY!)

// ─── Tipos Vapi ───────────────────────────────────────────────────────────────

interface VapiWebhookPayload {
  message: {
    type: string
    call?: { id: string; status: string; endedReason?: string; duration?: number }
    endedReason?: string
    transcript?: string
    durationSeconds?: number
    artifact?: { transcript?: string; summary?: string; recordingUrl?: string }
  }
}

// ─── Detección de intención con Claude Haiku ──────────────────────────────────

async function detectIntent(
  transcript: string
): Promise<'confirmed' | 'cancelled' | 'rescheduled' | 'no_response'> {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{
        role: 'user',
        content: `Analiza este transcript de una llamada de confirmación de cita médica.
Responde ÚNICAMENTE con una de estas 4 palabras exactas:
- confirmed   → el paciente dijo que sí asistirá
- cancelled   → el paciente canceló o dijo que no puede ir
- rescheduled → el paciente quiere cambiar la fecha/hora
- no_response → no hubo respuesta clara o la llamada no fue contestada

Transcript:
${transcript}

Respuesta (una palabra):`,
      }],
    })

    const raw = (msg.content[0] as { text: string }).text.trim().toLowerCase()
    if (['confirmed', 'cancelled', 'rescheduled', 'no_response'].includes(raw)) {
      return raw as 'confirmed' | 'cancelled' | 'rescheduled' | 'no_response'
    }
    return 'no_response'
  } catch (e) {
    console.error('[vapi/webhook] Error en detección de intención:', e)
    return 'no_response'
  }
}

// ─── Mapear endedReason → call status ────────────────────────────────────────

function mapCallStatus(endedReason?: string): string {
  if (!endedReason) return 'completed'
  const r = endedReason.toLowerCase()
  if (r.includes('failed'))    return 'failed'
  if (r.includes('no-answer') || r.includes('customer-did-not-answer')) return 'no_answer'
  if (r.includes('busy'))      return 'busy'
  return 'completed'
}

// ─── Mapear outcome → appointment status ─────────────────────────────────────

function mapAppointmentStatus(outcome: string): string | null {
  switch (outcome) {
    case 'confirmed':   return 'confirmed'
    case 'cancelled':   return 'cancelled'
    case 'rescheduled': return 'rescheduled'
    default:            return null
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let payload: VapiWebhookPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  const { message } = payload

  // Solo procesar end-of-call-report
  if (message.type !== 'end-of-call-report') {
    return NextResponse.json({ received: true })
  }

  const callId = message.call?.id
  if (!callId) {
    return NextResponse.json({ error: 'call.id faltante' }, { status: 400 })
  }

  const endedReason    = message.endedReason ?? message.call?.endedReason
  const transcript     = message.artifact?.transcript ?? message.transcript ?? null
  const durationSecs   = message.durationSeconds ?? message.call?.duration ?? null
  const callStatus     = mapCallStatus(endedReason)

  // ── Detectar intención del paciente en el transcript ──────────────────────
  let outcome: string
  if (transcript && transcript.trim().length > 20) {
    outcome = await detectIntent(transcript)
  } else {
    // Sin transcript = no contestó
    outcome = callStatus === 'no_answer' ? 'no_response' : 'no_response'
  }

  // ── Buscar call_log ───────────────────────────────────────────────────────
  const { data: callLog, error: logFindErr } = await supabaseAdmin
    .from('call_logs')
    .select('id, appointment_id, client_id')
    .eq('provider_call_id', callId)
    .single()

  if (logFindErr || !callLog) {
    console.error('[vapi/webhook] call_log no encontrado para call_id:', callId)
    return NextResponse.json({ received: true })
  }

  // ── Actualizar call_log ───────────────────────────────────────────────────
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

  if (logUpdateErr) console.error('[vapi/webhook] Error actualizando call_log:', logUpdateErr)

  // ── Actualizar appointment si hay intención clara ─────────────────────────
  const appointmentStatus = mapAppointmentStatus(outcome)
  if (appointmentStatus) {
    const { error: apptUpdateErr } = await supabaseAdmin
      .from('appointments')
      .update({ status: appointmentStatus })
      .eq('id', callLog.appointment_id)

    if (apptUpdateErr) console.error('[vapi/webhook] Error actualizando appointment:', apptUpdateErr)

    // ── Notificar a Karla por email ─────────────────────────────────────────
    try {
      const { data: appt } = await supabaseAdmin
        .from('appointments')
        .select('patient_name, appointment_date, appointment_time, doctor_name')
        .eq('id', callLog.appointment_id)
        .single()

      if (appt) {
        const [y, m, d] = appt.appointment_date.split('-').map(Number)
        const dateStr = new Date(y, m - 1, d).toLocaleDateString('es-MX', {
          weekday: 'long', day: 'numeric', month: 'long',
        })
        const timeStr = appt.appointment_time.slice(0, 5)

        const isConfirmed = appointmentStatus === 'confirmed'
        const emoji       = isConfirmed ? '✅' : appointmentStatus === 'cancelled' ? '❌' : '🔄'
        const accion      = isConfirmed ? 'confirmó' : appointmentStatus === 'cancelled' ? 'canceló' : 'quiere reagendar'

        await resend.emails.send({
          from:    'CANE Neurofeedback <raf@fishflow.mx>',
          to:      ['karlaalonsoruiz@gmail.com'],
          subject: `${emoji} ${appt.patient_name} ${accion} su cita del ${dateStr}`,
          html: `
            <div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;padding:24px">
              <h2 style="color:#2A9D8F;margin-bottom:4px">CANE Neurofeedback</h2>
              <p style="color:#6B7280;font-size:14px;margin-top:0">Confirmación automática de cita</p>
              <div style="background:#F0FDF9;border:1px solid #A7F3D0;border-radius:8px;padding:16px;margin:20px 0">
                <p style="margin:0;font-size:16px;font-weight:600;color:#1A1A2E">
                  ${emoji} ${appt.patient_name} <strong>${accion}</strong>
                </p>
              </div>
              <table style="width:100%;font-size:14px;color:#374151">
                <tr><td style="padding:6px 0;color:#6B7280">Fecha</td><td style="font-weight:600">${dateStr}</td></tr>
                <tr><td style="padding:6px 0;color:#6B7280">Hora</td><td style="font-weight:600">${timeStr}</td></tr>
                <tr><td style="padding:6px 0;color:#6B7280">Doctor</td><td style="font-weight:600">${appt.doctor_name ?? '—'}</td></tr>
              </table>
              <p style="font-size:12px;color:#9CA3AF;margin-top:24px">
                Este aviso fue generado automáticamente por FishFlow.<br>
                <a href="https://fishflow.mx/app/cane" style="color:#2A9D8F">Ver todas las citas →</a>
              </p>
            </div>
          `,
        })
      }
    } catch (emailErr) {
      console.error('[vapi/webhook] Error enviando email:', emailErr)
    }
  }

  console.log(`[vapi/webhook] call_id=${callId} | outcome=${outcome} | status=${callStatus} | transcript=${transcript ? 'sí' : 'no'}`)

  return NextResponse.json({ received: true })
}
