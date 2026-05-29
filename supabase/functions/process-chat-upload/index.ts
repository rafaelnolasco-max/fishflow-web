// Supabase Edge Function — process-chat-upload
// Parsea el .txt exportado de WhatsApp, clasifica mensajes con Claude API,
// inserta en sparc_chat_messages y genera sparc_daily_summaries.
//
// Invocación: POST /functions/v1/process-chat-upload
// Body: { upload_id: string }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Priority = 'urgent' | 'medium' | 'low'
type Category = 'estructural' | 'mantenimiento' | 'administrativo' | 'pagos' | 'seguridad' | 'social'

interface ParsedMessage {
  sender_name: string
  sent_at: Date
  message_text: string
}

interface ClassifiedMessage extends ParsedMessage {
  priority: Priority
  category: Category
  ai_summary: string
  is_actionable: boolean
}

interface DailyCount {
  total: number
  urgent: number
  medium: number
  low: number
  actionable: string[]
}

// ─── Parser de WhatsApp ───────────────────────────────────────────────────────
// Formato: [M/D/YY, H:MM:SS] Nombre: mensaje
// También maneja: [MM/DD/YYYY, HH:MM:SS] para exports más nuevos

const MSG_REGEX = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?)\]\s(.+?):\s([\s\S]*)$/

const SYSTEM_PATTERNS = [
  /Messages and calls are end-to-end encrypted/i,
  /added you/i,
  /created this group/i,
  /changed their phone number/i,
  /left$/i,
  /was added$/i,
  /^null$/i,
]

const MEDIA_PATTERNS = [
  /image omitted/i,
  /audio omitted/i,
  /video omitted/i,
  /document omitted/i,
  /sticker omitted/i,
  /GIF omitted/i,
]

function parseDate(dateStr: string, timeStr: string): Date | null {
  try {
    // Normalizar: M/D/YY → MM/DD/YYYY
    const [month, day, year] = dateStr.split('/')
    const fullYear = year.length === 2 ? `20${year}` : year
    // Quitar AM/PM si existe (formato 12h)
    const cleanTime = timeStr.replace(/\s?[AP]M$/i, '').trim()
    const iso = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${cleanTime}`
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

function isSystemMessage(sender: string, text: string): boolean {
  // Mensajes del sistema usan el nombre del grupo como sender
  if (SYSTEM_PATTERNS.some(p => p.test(text))) return true
  if (SYSTEM_PATTERNS.some(p => p.test(sender))) return true
  return false
}

function isMediaOnly(text: string): boolean {
  return MEDIA_PATTERNS.some(p => p.test(text.trim()))
}

function parseWhatsAppChat(rawText: string): ParsedMessage[] {
  const lines = rawText.split('\n')
  const messages: ParsedMessage[] = []
  let current: ParsedMessage | null = null

  for (const line of lines) {
    const match = line.match(MSG_REGEX)

    if (match) {
      // Guardar el mensaje anterior si existe
      if (current) {
        const text = current.message_text.trim()
        if (text && !isSystemMessage(current.sender_name, text) && !isMediaOnly(text)) {
          messages.push(current)
        }
      }

      const [, dateStr, timeStr, sender, text] = match
      const sent_at = parseDate(dateStr, timeStr)
      if (!sent_at) continue

      // Limpiar el sender (quitar ~ y caracteres especiales de Unicode)
      const cleanSender = sender.replace(/^~\s*/, '').replace(/[‎‏‪-‮]/g, '').trim()

      current = {
        sender_name: cleanSender,
        sent_at,
        message_text: text.replace(/[‎‏]/g, '').trim(),
      }
    } else if (current && line.trim()) {
      // Línea de continuación (mensaje multilinea)
      current.message_text += '\n' + line.replace(/[‎‏]/g, '').trim()
    }
  }

  // Último mensaje
  if (current) {
    const text = current.message_text.trim()
    if (text && !isSystemMessage(current.sender_name, text) && !isMediaOnly(text)) {
      messages.push(current)
    }
  }

  return messages
}

// ─── Clasificador con Claude API ─────────────────────────────────────────────

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages'
const BATCH_SIZE = 40

async function classifyBatch(
  messages: ParsedMessage[],
  anthropicKey: string
): Promise<ClassifiedMessage[]> {
  const messagesForPrompt = messages.map((m, i) =>
    `[${i}] ${m.sender_name}: ${m.message_text.substring(0, 300)}`
  ).join('\n')

  const prompt = `Eres el asistente de un administrador de edificio residencial en México.
Analiza estos mensajes de un grupo de WhatsApp de vecinos y clasifica cada uno.

MENSAJES:
${messagesForPrompt}

INSTRUCCIONES:
- priority: "urgent" si hay emergencia estructural, fuga, falla eléctrica, problema de seguridad o riesgo inmediato. "medium" si hay queja, solicitud de reparación, mantenimiento pendiente o tema administrativo que requiere acción. "low" para conversación social, opiniones, reacciones o información general.
- category: "estructural" (grietas, trabes, daños físicos), "mantenimiento" (reparaciones, instalaciones), "administrativo" (asamblea, reglamento, pagos de mantenimiento), "pagos" (cuotas, cobros, facturas), "seguridad" (accesos, vigilancia, robos), "social" (conversación, saludos, opiniones sin acción requerida).
- ai_summary: resumen en máximo 15 palabras en español.
- is_actionable: true solo si requiere acción concreta del administrador.

Responde ÚNICAMENTE con un JSON array con exactamente ${messages.length} objetos, en el mismo orden:
[{"priority":"...","category":"...","ai_summary":"...","is_actionable":false}, ...]`

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Claude API error: ${response.status} — ${err}`)
  }

  const data = await response.json()
  const content = data.content?.[0]?.text ?? '[]'

  // Extraer JSON del response (puede venir con texto antes/después)
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('Claude no devolvió JSON válido')

  const classifications = JSON.parse(jsonMatch[0])

  return messages.map((msg, i) => ({
    ...msg,
    priority: (classifications[i]?.priority ?? 'low') as Priority,
    category: (classifications[i]?.category ?? 'social') as Category,
    ai_summary: classifications[i]?.ai_summary ?? '',
    is_actionable: classifications[i]?.is_actionable ?? false,
  }))
}

// ─── Generador de resúmenes diarios ──────────────────────────────────────────

async function generateDailySummary(
  date: string,
  messages: ClassifiedMessage[],
  anthropicKey: string
): Promise<{ executive_summary: string; action_items: string[] }> {
  const urgentMessages = messages.filter(m => m.priority === 'urgent')
  const actionableMessages = messages.filter(m => m.is_actionable)

  const context = [
    ...urgentMessages.map(m => `[URGENTE] ${m.sender_name}: ${m.message_text.substring(0, 200)}`),
    ...actionableMessages
      .filter(m => m.priority !== 'urgent')
      .map(m => `[ACCIÓN] ${m.sender_name}: ${m.message_text.substring(0, 200)}`),
  ].slice(0, 20).join('\n')

  if (!context.trim()) {
    return {
      executive_summary: 'Sin mensajes urgentes ni acciones pendientes este día.',
      action_items: [],
    }
  }

  const prompt = `Eres el asistente de un administrador de edificio en México.
Genera un resumen ejecutivo del día ${date} basado en estos mensajes del grupo de vecinos:

${context}

Responde en JSON con este formato exacto:
{
  "executive_summary": "Resumen en 2-3 oraciones del estado del edificio y temas principales del día.",
  "action_items": ["Acción concreta 1", "Acción concreta 2"]
}

Máximo 5 action items. Solo incluir acciones reales y concretas para el administrador.`

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) return { executive_summary: 'Error generando resumen.', action_items: [] }

  const data = await response.json()
  const content = data.content?.[0]?.text ?? '{}'
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { executive_summary: content.substring(0, 300), action_items: [] }

  const result = JSON.parse(jsonMatch[0])
  return {
    executive_summary: result.executive_summary ?? '',
    action_items: Array.isArray(result.action_items) ? result.action_items : [],
  }
}

// ─── Handler principal ────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { upload_id } = await req.json()
    if (!upload_id) throw new Error('upload_id requerido')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY no configurada')

    // 1. Obtener el upload
    const { data: upload, error: uploadErr } = await supabase
      .from('sparc_chat_uploads')
      .select('*')
      .eq('id', upload_id)
      .single()

    if (uploadErr || !upload) throw new Error('Upload no encontrado')
    if (upload.processed) throw new Error('Este upload ya fue procesado')

    // 2. Parsear el chat
    const parsed = parseWhatsAppChat(upload.raw_text)
    if (parsed.length === 0) throw new Error('No se encontraron mensajes válidos')

    // Calcular rango de fechas
    const dates = parsed.map(m => m.sent_at).sort((a, b) => a.getTime() - b.getTime())
    const dateStart = dates[0].toISOString().split('T')[0]
    const dateEnd = dates[dates.length - 1].toISOString().split('T')[0]

    // Actualizar upload con conteo y fechas
    await supabase
      .from('sparc_chat_uploads')
      .update({
        total_messages: parsed.length,
        date_range_start: dateStart,
        date_range_end: dateEnd,
      })
      .eq('id', upload_id)

    // 3. Clasificar en batches
    const classified: ClassifiedMessage[] = []
    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = parsed.slice(i, i + BATCH_SIZE)
      const result = await classifyBatch(batch, anthropicKey)
      classified.push(...result)
    }

    // 4. Insertar mensajes en BD
    const messageRows = classified.map(m => ({
      upload_id,
      building_id: upload.building_id,
      client_id: upload.client_id,
      sender_name: m.sender_name,
      sent_at: m.sent_at.toISOString(),
      message_text: m.message_text,
      priority: m.priority,
      category: m.category,
      ai_summary: m.ai_summary,
      is_actionable: m.is_actionable,
    }))

    const { error: insertErr } = await supabase
      .from('sparc_chat_messages')
      .insert(messageRows)

    if (insertErr) throw new Error(`Error insertando mensajes: ${insertErr.message}`)

    // 5. Generar resúmenes diarios agrupando por fecha
    const byDate = new Map<string, ClassifiedMessage[]>()
    for (const msg of classified) {
      const day = msg.sent_at.toISOString().split('T')[0]
      if (!byDate.has(day)) byDate.set(day, [])
      byDate.get(day)!.push(msg)
    }

    const summaryRows = []
    for (const [day, msgs] of byDate.entries()) {
      const counts: DailyCount = {
        total: msgs.length,
        urgent: msgs.filter(m => m.priority === 'urgent').length,
        medium: msgs.filter(m => m.priority === 'medium').length,
        low: msgs.filter(m => m.priority === 'low').length,
        actionable: msgs.filter(m => m.is_actionable).map(m => m.ai_summary),
      }

      const { executive_summary, action_items } = await generateDailySummary(day, msgs, anthropicKey)

      summaryRows.push({
        building_id: upload.building_id,
        upload_id,
        client_id: upload.client_id,
        summary_date: day,
        total_messages: counts.total,
        urgent_count: counts.urgent,
        medium_count: counts.medium,
        low_count: counts.low,
        executive_summary,
        action_items,
      })
    }

    const { error: summaryErr } = await supabase
      .from('sparc_daily_summaries')
      .insert(summaryRows)

    if (summaryErr) throw new Error(`Error insertando resúmenes: ${summaryErr.message}`)

    // 6. Marcar upload como procesado
    const { error: updateErr } = await supabase
      .from('sparc_chat_uploads')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('id', upload_id)

    if (updateErr) throw new Error(`Error actualizando upload: ${updateErr.message}`)

    return new Response(
      JSON.stringify({
        success: true,
        upload_id,
        stats: {
          messages_parsed: parsed.length,
          messages_classified: classified.length,
          days_processed: byDate.size,
          date_range: `${dateStart} → ${dateEnd}`,
          urgent: classified.filter(m => m.priority === 'urgent').length,
          medium: classified.filter(m => m.priority === 'medium').length,
          low: classified.filter(m => m.priority === 'low').length,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('process-chat-upload error:', err)
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
