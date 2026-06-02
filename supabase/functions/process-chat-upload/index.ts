// Supabase Edge Function — process-chat-upload
// Parsea el .txt exportado de WhatsApp, transcribe audios con Whisper,
// clasifica mensajes con Claude API, inserta en sparc_chat_messages
// y genera sparc_daily_summaries.
//
// Invocación: POST /functions/v1/process-chat-upload
// Body: { upload_id: string, audio_files?: { filename: string, storage_path: string }[] }

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
// Formato Android: [M/D/YY, H:MM:SS] Nombre: mensaje
// Formato iOS:     DD/MM/YYYY, H:MM a. m. - Nombre: mensaje

// Android: [9/19/17, 17:22:49] o [10/24/17, 11:00:20]
const MSG_REGEX_ANDROID = /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?)\]\s(.+?):\s([\s\S]*)$/

// iOS: 24/11/2020, 10:37 a. m. - Nombre: mensaje
// También: 24/11/2020, 10:37 a. m. - (espacio fino entre a. m.)
const MSG_REGEX_IOS = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?\s?(?:a\.\s?m\.|p\.\s?m\.|AM|PM)?)\s?[-–]\s(.+?):\s([\s\S]*)$/

const SYSTEM_PATTERNS = [
  /Messages and calls are end-to-end encrypted/i,
  /Los mensajes y las llamadas están cifrados/i,
  /added you/i,
  /Se te añadió/i,
  /created this group/i,
  /creó el grupo/i,
  /changed their phone number/i,
  /cambió su número/i,
  /left$/i,
  /abandonó el grupo/i,
  /was added$/i,
  /^null$/i,
  /Más información$/i,
]

const MEDIA_PATTERNS = [
  /image omitted/i,
  /audio omitted/i,
  /video omitted/i,
  /document omitted/i,
  /sticker omitted/i,
  /GIF omitted/i,
  /\<imagen omitida\>/i,
  /\<audio omitido\>/i,
  /\<video omitido\>/i,
  /\<documento omitido\>/i,
  /\<sticker omitido\>/i,
]

function parseDate(dateStr: string, timeStr: string, isIOS = false): Date | null {
  try {
    const parts = dateStr.split('/')
    let day: string, month: string, year: string

    if (isIOS) {
      // iOS: DD/MM/YYYY
      ;[day, month, year] = parts
    } else {
      // Android: M/D/YY
      ;[month, day, year] = parts
    }

    const fullYear = year.length === 2 ? `20${year}` : year

    // Normalizar hora: quitar "a. m." / "p. m." y convertir a 24h
    let cleanTime = timeStr
      .replace(/\s?a\.\s?m\.?/i, ' AM')
      .replace(/\s?p\.\s?m\.?/i, ' PM')
      .replace(/ /g, ' ')  // espacio fino
      .trim()

    // Si tiene AM/PM, parsear manualmente
    const ampm = cleanTime.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s?(AM|PM)/i)
    if (ampm) {
      const [, time, period] = ampm
      const [h, m, s = '00'] = time.split(':')
      let hour = parseInt(h)
      if (period.toUpperCase() === 'PM' && hour !== 12) hour += 12
      if (period.toUpperCase() === 'AM' && hour === 12) hour = 0
      cleanTime = `${String(hour).padStart(2,'0')}:${m}:${s}`
    } else {
      // Ya está en 24h — agregar segundos solo si no los tiene
      if (!/\d{1,2}:\d{2}:\d{2}$/.test(cleanTime)) {
        cleanTime = cleanTime + ':00'
      }
    }

    const iso = `${fullYear}-${month.padStart(2,'0')}-${day.padStart(2,'0')}T${cleanTime}`
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

function detectFormat(rawText: string): 'android' | 'ios' {
  // iOS no usa corchetes — busca el patrón DD/MM/YYYY, H:MM - Nombre:
  const iosHits     = (rawText.match(/^\d{1,2}\/\d{1,2}\/\d{4},\s\d{1,2}:\d{2}\s(?:a\.|p\.)/m) ?? []).length
  const androidHits = (rawText.match(/^\[\d{1,2}\/\d{1,2}\/\d{2,4},/m) ?? []).length
  return iosHits > 0 && androidHits === 0 ? 'ios' : 'android'
}

function parseWhatsAppChat(rawText: string): ParsedMessage[] {
  // Normalizar line endings: quitar \r para manejar archivos CRLF (Windows/Android)
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const format = detectFormat(normalized)
  const MSG_REGEX = format === 'ios' ? MSG_REGEX_IOS : MSG_REGEX_ANDROID
  const isIOS = format === 'ios'

  const lines = normalized.split('\n')
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
      const sent_at = parseDate(dateStr, timeStr, isIOS)
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

// ─── Transcripción de audios con Whisper ─────────────────────────────────────
// Recibe un archivo de audio como ArrayBuffer y devuelve el transcript en texto.
// Modelo: whisper-1 (~$0.006 USD/min). Acepta .opus, .ogg, .m4a directamente.

const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions'

async function transcribeAudio(
  audioBuffer: ArrayBuffer,
  filename: string,
  openaiKey: string
): Promise<{ transcript: string; error?: string }> {
  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), filename)
  formData.append('model', 'whisper-1')
  formData.append('language', 'es')

  const response = await fetch(WHISPER_API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${openaiKey}` },
    body: formData,
  })

  if (!response.ok) {
    const errText = await response.text()
    const msg = `HTTP ${response.status}: ${errText.substring(0, 300)}`
    console.error(`Whisper error ${filename}: ${msg}`)
    return { transcript: '', error: msg }
  }

  const text = (await response.json()).text?.trim() ?? ''
  return { transcript: text }
}

// Construye un mapa filename → transcript. Retorna también los errores para diagnóstico.
async function buildAudioTranscripts(
  audioFiles: { filename: string; storage_path: string }[],
  supabaseClient: ReturnType<typeof createClient>,
  openaiKey: string | undefined
): Promise<{ map: Map<string, string>; errors: string[] }> {
  const map = new Map<string, string>()
  const errors: string[] = []

  if (!openaiKey || audioFiles.length === 0) return { map, errors }

  for (const audio of audioFiles) {
    try {
      const { data, error } = await supabaseClient.storage
        .from('sparc-audio')
        .download(audio.storage_path)

      if (error || !data) {
        const msg = `Storage error ${audio.filename}: ${error?.message ?? 'no data'}`
        console.error(msg); errors.push(msg); continue
      }

      const { transcript, error: whisperErr } = await transcribeAudio(await data.arrayBuffer(), audio.filename, openaiKey)
      if (whisperErr) errors.push(`${audio.filename}: ${whisperErr}`)
      if (transcript) {
        map.set(audio.filename, transcript)
        console.log(`Transcrito ${audio.filename}: "${transcript.substring(0, 60)}…"`)
      } else if (!whisperErr) {
        errors.push(`${audio.filename}: Whisper devolvió texto vacío`)
      }
    } catch (e: any) {
      const msg = `Excepción ${audio.filename}: ${e?.message ?? String(e)}`
      console.error(msg); errors.push(msg)
    }
  }

  return map
}

// Inyecta transcripts usando dos estrategias:
// 1. Match exacto por filename (PTT-xxx.opus archivo adjunto) — Android y algunos iOS
// 2. Match temporal por orden cronológico (<Multimedia omitido>) — iOS sin filename
function injectTranscripts(rawText: string, transcripts: Map<string, string>): { text: string; injected: number } {
  if (transcripts.size === 0) return { text: rawText, injected: 0 }

  const lines = rawText.split('\n')
  let injected = 0
  const usedFilenames = new Set<string>()

  // ── Paso 1: match exacto por filename ────────────────────────────────────────
  // Cubre: PTT-20260512-WA0024.opus (archivo adjunto) — Android / algunos iOS
  const pass1 = lines.map(line => {
    const fm = line.match(/([A-Za-z]+-\d{8}-(?:WA)?\d+\.(?:opus|ogg|m4a|mp3|aac))/i)
    if (fm) {
      const transcript = transcripts.get(fm[1])
      if (transcript) {
        usedFilenames.add(fm[1])
        const idx = line.indexOf(fm[1])
        const prefix = line.substring(0, idx)
        injected++
        return `${prefix.trimEnd()} [Audio transcrito]: ${transcript}`
      }
    }
    return line
  })

  // ── Paso 2: match temporal para <Multimedia omitido> ─────────────────────────
  // Cubre: <Multimedia omitido>, <Media omitted> — iOS exportado con archivos
  // Ordena los transcripts no usados por fecha+secuencia del filename (orden cronológico)
  const unusedPool = [...transcripts.entries()]
    .filter(([fn]) => !usedFilenames.has(fn))
    .map(([fn, tr]) => {
      const m = fn.match(/[-_](\d{8})[-_](?:WA)?(\d+)\./i)
      return { fn, tr, date: m ? m[1] : '0', seq: m ? parseInt(m[2]) : 0 }
    })
    .sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : a.seq - b.seq)

  let poolIdx = 0

  const pass2 = pass1.map(line => {
    if (line.includes('[Audio transcrito]')) return line
    // Detecta <Multimedia omitido>, <Media omitted>, <audio omitido>, audio omitted
    const isMedia = /<Multimedia omitido>|<Media omitted>|<audio omitido>|audio omitted|audio omitido/i.test(line)
    if (!isMedia || poolIdx >= unusedPool.length) return line
    const { tr } = unusedPool[poolIdx++]
    const markerIdx = line.search(/<[Mm]ultimedia|<[Mm]edia omitted|<[Aa]udio|[Aa]udio omitido|[Aa]udio omitted/i)
    const prefix = markerIdx > 0 ? line.substring(0, markerIdx) : line + ' '
    injected++
    return `${prefix.trimEnd()} [Audio transcrito]: ${tr}`
  })

  return { text: pass2.join('\n'), injected }
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
): Promise<{
  executive_summary: string
  action_items: string[]
  urgent_summary: string
  medium_summary: string
  low_summary: string
}> {
  const urgent  = messages.filter(m => m.priority === 'urgent')
  const medium  = messages.filter(m => m.priority === 'medium')
  const low     = messages.filter(m => m.priority === 'low')

  const urgentCtx = urgent.map(m => `- ${m.sender_name}: ${m.message_text.substring(0, 180)}`).slice(0, 15).join('\n')
  const mediumCtx = medium.map(m => `- ${m.sender_name}: ${m.message_text.substring(0, 180)}`).slice(0, 15).join('\n')
  const lowCtx    = low.map(m    => `- ${m.sender_name}: ${m.message_text.substring(0, 120)}`).slice(0, 10).join('\n')

  const hasContent = urgent.length > 0 || medium.length > 0

  if (!hasContent) {
    return {
      executive_summary: 'Sin mensajes urgentes ni acciones pendientes este día.',
      action_items: [],
      urgent_summary: urgent.length === 0 ? 'Sin mensajes urgentes.' : '',
      medium_summary: medium.length === 0 ? 'Sin temas de atención media.' : '',
      low_summary:    low.length    === 0 ? 'Sin mensajes de baja prioridad.' : '',
    }
  }

  const prompt = `Eres el asistente de un administrador de edificio residencial en México.
Analiza los mensajes del día ${date} y genera un reporte ejecutivo estructurado.

${urgent.length > 0 ? `MENSAJES URGENTES (${urgent.length}):\n${urgentCtx}` : 'MENSAJES URGENTES: ninguno'}

${medium.length > 0 ? `MENSAJES MEDIOS (${medium.length}):\n${mediumCtx}` : 'MENSAJES MEDIOS: ninguno'}

${low.length > 0 ? `MENSAJES BAJOS (${low.length}):\n${lowCtx}` : 'MENSAJES BAJOS: ninguno'}

Responde en JSON con este formato exacto (sin texto antes ni después):
{
  "executive_summary": "Resumen general del día en 2 oraciones. Qué pasó y cuál es el estado del edificio.",
  "urgent_summary": "Lo más crítico e inmediato. Si no hay urgentes, escribe: Sin situaciones urgentes este día.",
  "medium_summary": "Los temas que requieren seguimiento pero no son emergencia. Si no hay, escribe: Sin temas de atención media.",
  "low_summary": "Temas menores o conversación general relevante. Si no hay, escribe: Sin actividad de baja prioridad.",
  "action_items": ["Acción concreta 1 para el administrador", "Acción concreta 2"]
}

Reglas: máximo 5 action_items. Cada summary en 1-3 oraciones. En español. Orientado al administrador.`

  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) return {
    executive_summary: 'Error generando resumen.',
    action_items: [],
    urgent_summary: '', medium_summary: '', low_summary: '',
  }

  const data = await response.json()
  const content = data.content?.[0]?.text ?? '{}'
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return {
    executive_summary: content.substring(0, 300),
    action_items: [],
    urgent_summary: '', medium_summary: '', low_summary: '',
  }

  const result = JSON.parse(jsonMatch[0])
  return {
    executive_summary: result.executive_summary ?? '',
    action_items:      Array.isArray(result.action_items) ? result.action_items : [],
    urgent_summary:    result.urgent_summary  ?? '',
    medium_summary:    result.medium_summary  ?? '',
    low_summary:       result.low_summary     ?? '',
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
    const { upload_id, audio_files = [] } = await req.json()
    if (!upload_id) throw new Error('upload_id requerido')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY no configurada')

    // OPENAI_API_KEY es opcional — si no está, los audios se saltan sin abortar
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    // 1. Obtener el upload
    const { data: upload, error: uploadErr } = await supabase
      .from('sparc_chat_uploads')
      .select('*')
      .eq('id', upload_id)
      .single()

    if (uploadErr || !upload) throw new Error('Upload no encontrado')
    if (upload.processed) throw new Error('Este upload ya fue procesado')

    // 2. Transcribir audios (si los hay y hay key de OpenAI)
    let audioTranscripts = new Map<string, string>()
    let audiosTranscribed = 0
    let whisperErrors: string[] = []
    if (audio_files.length > 0) {
      console.log(`Transcribiendo ${audio_files.length} audios con Whisper…`)
      const result = await buildAudioTranscripts(audio_files, supabase, openaiKey)
      audioTranscripts = result.map
      whisperErrors = result.errors
      audiosTranscribed = audioTranscripts.size
      console.log(`Transcritos: ${audiosTranscribed}/${audio_files.length}, errores: ${whisperErrors.length}`)
      if (whisperErrors.length > 0) console.error('Whisper errors:', JSON.stringify(whisperErrors))
    }

    // 3. Inyectar transcripts en el raw_text antes de parsear
    const { text: enrichedText, injected: transcriptsInjected } = injectTranscripts(
      upload.raw_text,
      audioTranscripts
    )

    // 4. Parsear el chat (con transcripts ya inyectados)
    const parsed = parseWhatsAppChat(enrichedText)
    if (parsed.length === 0) throw new Error('No se encontraron mensajes válidos en el chat')

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

      const { executive_summary, action_items, urgent_summary, medium_summary, low_summary } = await generateDailySummary(day, msgs, anthropicKey)

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
        urgent_summary,
        medium_summary,
        low_summary,
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

    // 7. Limpiar audios de Storage (no los necesitamos después de transcribir)
    if (audio_files.length > 0) {
      const paths = audio_files.map((a: { storage_path: string }) => a.storage_path)
      const { error: storageErr } = await supabase.storage
        .from('sparc-audio')
        .remove(paths)
      if (storageErr) {
        console.error('Error limpiando audios de Storage:', storageErr.message)
        // No lanzar error — la limpieza es best-effort
      } else {
        console.log(`Eliminados ${paths.length} audios de Storage`)
      }
    }

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
          audios_found: audio_files.length,
          audios_transcribed: audiosTranscribed,
          transcripts_injected: transcriptsInjected,
          whisper_errors: whisperErrors,
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
