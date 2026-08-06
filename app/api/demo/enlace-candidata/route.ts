import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { sendEmail, REPLY_TO, enlaceNotifyTo } from '@/lib/email'
import { corsHeaders, preflight } from '@/lib/cors'

export const runtime = 'nodejs'
// El parseo del PDF + la llamada a Claude pueden pasar de los 10 s por defecto.
export const maxDuration = 60

/**
 * Recepción de candidatas/os desde la página /demos/enlaceintegral/unete.
 *
 * Flujo:
 *  1) Sube el CV al bucket privado `hiring-cv` (ruta {client_id}/{uuid}-archivo).
 *  2) Extrae el texto del CV (unpdf) para poder calificarlo.
 *  3) Inserta en `hiring_candidates` + `hiring_applications` (modelo HireFlow,
 *     multi-tenant por client_id — no crea tablas propias de Enlace).
 *  4) Califica con Claude Haiku contra `requirements_struct` de la vacante y
 *     guarda score, resumen y detalles en la application.
 *  5) Avisa por correo a Rafa y a Enlace.
 *
 * La calificación es best-effort: si la IA falla, la candidata queda guardada
 * sin score en lugar de perderse. Ese es el peor caso aceptable; perder un CV
 * que ya se pagó con pauta no lo es.
 */

const ENLACE_CLIENT_ID = 'e8094119-0414-4d46-8506-6ee1a52e852c'
const CV_BUCKET = 'hiring-cv'
const MAX_CV_BYTES = 8 * 1024 * 1024 // 8 MB — igual que el límite del bucket

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

type Scoring = {
  score: number
  resumen: string
  fortalezas: string[]
  banderas: string[]
  veredicto: 'alto' | 'medio' | 'bajo'
}

function esc(s: unknown) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Nombre de archivo seguro para Storage (sin acentos, espacios ni rutas). */
function safeFileName(name: string) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80) || 'cv.pdf'
}

/** Texto plano del CV. Solo PDF por ahora; Word queda para revisión manual. */
async function extractCvText(file: File, buf: ArrayBuffer): Promise<string> {
  if (file.type !== 'application/pdf') return ''
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buf))
    const { text } = await extractText(pdf, { mergePages: true })
    return (Array.isArray(text) ? text.join('\n') : text).slice(0, 24000)
  } catch (e) {
    console.error('[enlace-candidata] no se pudo leer el PDF:', e)
    return ''
  }
}

async function scoreCandidate(
  anthropic: Anthropic,
  requirements: unknown,
  cvText: string,
  form: Record<string, string>
): Promise<Scoring | null> {
  const system = `Eres el filtro de reclutamiento de Enlace Integral Seguros (CDMX), distribuidor autorizado de Allianz México.

Evalúas candidatas y candidatos a ASESOR DE SEGUROS: esquema 100% por comisiones, con capacitación y certificación AMIS incluidas. El puesto exige prospección propia, autogestión y trato directo con clientes.

Criterios y pesos (JSON):
${JSON.stringify(requirements)}

Reglas de evaluación:
- Califica de 0 a 100 ponderando los criterios por su peso.
- La experiencia previa en seguros suma, pero NO es indispensable: gente de ventas de otros giros suele desempeñarse bien.
- Valora evidencia concreta (metas cumplidas, cartera, años en el puesto) por encima de adjetivos del CV.
- Si el CV viene vacío o ilegible, califica solo con los datos del formulario y baja la confianza: score máximo 55.
- veredicto: "alto" >= 70, "medio" 45-69, "bajo" < 45.
- Sé honesto y directo. No inventes datos que no estén en el CV.
- NO consideres edad, sexo, estado civil, apariencia, religión ni origen. Si el CV los menciona, ignóralos: además de sesgado, es ilegal discriminar por eso.

Responde ÚNICAMENTE con JSON válido, sin texto alrededor:
{"score":número,"resumen":"3 líneas máximo en español","fortalezas":["..."],"banderas":["..."],"veredicto":"alto|medio|bajo"}`

  const userContent = `DATOS DEL FORMULARIO
${Object.entries(form).map(([k, v]) => `${k}: ${v || '—'}`).join('\n')}

TEXTO DEL CV
${cvText || '(no se pudo extraer texto del archivo)'}`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: userContent }],
    })
    const raw = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text).join('')
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
    const p = JSON.parse(json)
    return {
      score: Math.max(0, Math.min(100, Number(p.score) || 0)),
      resumen: String(p.resumen ?? '').trim(),
      fortalezas: Array.isArray(p.fortalezas) ? p.fortalezas.map(String) : [],
      banderas: Array.isArray(p.banderas) ? p.banderas.map(String) : [],
      veredicto: ['alto', 'medio', 'bajo'].includes(p.veredicto) ? p.veredicto : 'medio',
    }
  } catch (e) {
    console.error('[enlace-candidata] scoring falló:', e)
    return null
  }
}

function adminHtml(d: Record<string, string>, s: Scoring | null, cvUrl: string | null) {
  const color = !s ? '#5d7080' : s.veredicto === 'alto' ? '#0FB8B8' : s.veredicto === 'medio' ? '#D69E2E' : '#B05252'
  const row = (k: string, v: string) =>
    `<tr><td style="padding:7px 0;color:#5d7080;width:170px">${k}</td><td style="padding:7px 0"><strong>${esc(v) || '—'}</strong></td></tr>`
  const list = (items: string[]) =>
    items.length
      ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:14px">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
      : '<div style="font-size:14px;color:#5d7080">—</div>'

  return `
  <div style="font-family:Inter,Arial,sans-serif;max-width:580px;margin:0 auto;color:#13282B">
    <div style="background:#064A4F;color:#fff;padding:22px 26px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7FE3E3">Enlace Integral · Nueva candidatura</div>
      <div style="font-size:22px;margin-top:6px;font-weight:800">${esc(d.nombre)} quiere ser asesor</div>
    </div>
    ${s ? `
    <div style="padding:18px 26px;background:#F6FBFB;border:1px solid #DCE9E9;border-top:none">
      <div style="display:inline-block;background:${color};color:#fff;font-weight:800;font-size:26px;padding:10px 18px;border-radius:10px">${s.score}</div>
      <span style="margin-left:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;font-size:12px;color:${color}">Prioridad ${esc(s.veredicto)}</span>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.55">${esc(s.resumen)}</p>
      <div style="margin-top:14px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5d7080">A favor</div>
      ${list(s.fortalezas)}
      <div style="margin-top:12px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#5d7080">A revisar</div>
      ${list(s.banderas)}
    </div>` : `
    <div style="padding:16px 26px;background:#FFF6E5;border:1px solid #DCE9E9;border-top:none;font-size:14px">
      El filtro automático no pudo evaluar este CV. Revísalo a mano.
    </div>`}
    <div style="padding:22px 26px;border:1px solid #DCE9E9;border-top:none">
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${row('Nombre', d.nombre)}
        ${row('WhatsApp', d.whatsapp)}
        ${row('Correo', d.email)}
        ${row('Ciudad', d.ciudad)}
        ${row('Experiencia en ventas', d.experiencia)}
        ${row('¿Ya vendió seguros?', d.seguros)}
        ${row('Disponibilidad', d.disponibilidad)}
        ${row('Por qué se interesa', d.motivacion)}
      </table>
      ${cvUrl ? `<a href="${cvUrl}" style="display:inline-block;margin-top:18px;background:#064A4F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px">Descargar CV</a>` : ''}
      <a href="https://wa.me/52${esc(d.whatsapp).replace(/\D/g, '')}" style="display:inline-block;margin:18px 0 0 8px;background:#25D366;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px">Escribirle</a>
      <p style="font-size:12px;color:#5d7080;margin-top:20px">El enlace del CV vence en 7 días. Después, descárgalo desde el panel. · FishFlow</p>
    </div>
  </div>`
}

// La página /unete vive en enlaceintegralseguros.com. Ver lib/cors.ts.
export async function OPTIONS(req: Request) {
  return preflight(req)
}

export async function POST(req: Request) {
  const cors = corsHeaders(req.headers.get('origin'))
  try {
    const form = await req.formData()
    const get = (k: string) => (form.get(k) ?? '').toString().trim()

    const nombre = get('nombre')
    const whatsapp = get('whatsapp')
    const email = get('email').toLowerCase()
    const ciudad = get('ciudad')
    const experiencia = get('experiencia')
    const seguros = get('seguros')
    const disponibilidad = get('disponibilidad')
    const motivacion = get('motivacion')
    const linkedin = get('linkedin')
    const aviso = get('aviso')

    if (!nombre || !whatsapp || !email) {
      return NextResponse.json({ error: 'Falta nombre, WhatsApp o correo.' }, { status: 400, headers: cors })
    }
    if (aviso !== 'si') {
      return NextResponse.json({ error: 'Falta aceptar el aviso de privacidad.' }, { status: 400, headers: cors })
    }

    const cv = form.get('cv')
    const file = cv instanceof File && cv.size > 0 ? cv : null
    if (file) {
      if (file.size > MAX_CV_BYTES) {
        return NextResponse.json({ error: 'El CV no debe pesar más de 8 MB.' }, { status: 400, headers: cors })
      }
      if (!ALLOWED_MIME.has(file.type)) {
        return NextResponse.json({ error: 'El CV debe ser PDF o Word.' }, { status: 400, headers: cors })
      }
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1) Subir el CV
    let cvPath: string | null = null
    let cvBuf: ArrayBuffer | null = null
    if (file) {
      cvBuf = await file.arrayBuffer()
      const path = `${ENLACE_CLIENT_ID}/${crypto.randomUUID()}-${safeFileName(file.name)}`
      const { error } = await supabase.storage
        .from(CV_BUCKET)
        .upload(path, cvBuf, { contentType: file.type, upsert: false })
      if (error) console.error('[enlace-candidata] upload error:', error)
      else cvPath = path
    }

    // 2) Texto del CV
    const cvText = file && cvBuf ? await extractCvText(file, cvBuf) : ''

    // 3) Candidato + postulación
    const { data: candidate, error: candErr } = await supabase
      .from('hiring_candidates')
      .insert({
        client_id: ENLACE_CLIENT_ID,
        full_name: nombre,
        email,
        phone: whatsapp,
        linkedin_url: linkedin || null,
        cv_storage_path: cvPath,
        cv_text: cvText || null,
        source: 'enlace_unete',
      })
      .select('id')
      .single()

    if (candErr || !candidate) {
      console.error('[enlace-candidata] insert candidato:', candErr)
      return NextResponse.json({ error: 'No pudimos guardar tu postulación.' }, { status: 500, headers: cors })
    }

    const { data: position } = await supabase
      .from('hiring_positions')
      .select('id, requirements_struct')
      .eq('client_id', ENLACE_CLIENT_ID)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    // 4) Filtro con IA (best-effort)
    const datos = { nombre, ciudad, experiencia, seguros, disponibilidad, motivacion, linkedin }
    let scoring: Scoring | null = null
    if (process.env.ANTHROPIC_API_KEY && position) {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      scoring = await scoreCandidate(anthropic, position.requirements_struct, cvText, datos)
    }

    if (position) {
      const { error: appErr } = await supabase.from('hiring_applications').insert({
        client_id: ENLACE_CLIENT_ID,
        position_id: position.id,
        candidate_id: candidate.id,
        match_score: scoring?.score ?? null,
        match_summary: scoring?.resumen ?? null,
        match_details: scoring
          ? { fortalezas: scoring.fortalezas, banderas: scoring.banderas, veredicto: scoring.veredicto, formulario: datos }
          : { formulario: datos },
        current_stage: 1,
        status: 'active',
      })
      if (appErr) console.error('[enlace-candidata] insert postulación:', appErr)
    } else {
      console.error('[enlace-candidata] no hay vacante abierta para Enlace')
    }

    // 5) Aviso por correo con liga firmada al CV
    let cvUrl: string | null = null
    if (cvPath) {
      const { data: signed } = await supabase.storage
        .from(CV_BUCKET)
        .createSignedUrl(cvPath, 60 * 60 * 24 * 7)
      cvUrl = signed?.signedUrl ?? null
    }

    await sendEmail({
      from: 'enlace',
      to: enlaceNotifyTo(),
      replyTo: email || REPLY_TO,
      subject: `Candidata/o — ${nombre}${scoring ? ` · ${scoring.score}/100 (${scoring.veredicto})` : ''}`,
      html: adminHtml(
        { nombre, whatsapp, email, ciudad, experiencia, seguros, disponibilidad, motivacion },
        scoring,
        cvUrl
      ),
      tag: 'demo/enlace-candidata',
    })

    return NextResponse.json({ ok: true }, { headers: cors })
  } catch (err: any) {
    console.error('[enlace-candidata] Error:', err?.message ?? err)
    return NextResponse.json({ error: 'Error al procesar tu postulación.' }, { status: 500, headers: cors })
  }
}
