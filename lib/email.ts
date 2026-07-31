import { Resend } from 'resend'

/**
 * Remitentes centralizados de FishFlow.
 *
 * Todo el correo sale del dominio verificado `fishflow.mx` (DKIM + SPF en
 * `send.fishflow.mx`). El MX de la raíz apunta a Google Workspace — ahí se
 * RECIBE raf@fishflow.mx — por eso la capacidad de "receiving" de Resend está
 * deshabilitada a propósito. No la vuelvas a activar: rompería la recepción.
 *
 * Regla: nunca escribas un `from` literal en una ruta. Agrégalo aquí.
 *
 * Buzones en uso (todos alias de salida, no reciben):
 *   recibos@  → transaccional con el que el cliente puede interactuar
 *   noreply@  → notificaciones automáticas que no esperan respuesta
 *
 * Nota de reputación: si el newsletter de Mario crece, sus envíos de marketing
 * deben migrar a un subdominio propio (news.fishflow.mx) para que las quejas de
 * spam no degraden la entrega de los recibos transaccionales de los demás
 * clientes. Hoy el volumen no lo amerita.
 */
export const SENDERS = {
  /** Genérico FishFlow — avisos internos y leads de la landing. */
  fishflow: 'FishFlow <recibos@fishflow.mx>',
  /** Genérico FishFlow — notificaciones automáticas sin respuesta esperada. */
  fishflowNoreply: 'FishFlow <noreply@fishflow.mx>',

  /** Mario Citalán — cuestionarios, resultados y newsletter. */
  marioCitalan: 'Mario Citalán <mariocitalan@fishflow.mx>',
  /** TherapyOS — resúmenes de sesión a pacientes de Mario. */
  therapyos: 'TherapyOS · Mario Citalán <noreply@fishflow.mx>',

  cane: 'CANE Neurofeedback <raf@fishflow.mx>',
  sieckvet: 'SieckVet <noreply@fishflow.mx>',
  enlace: 'Enlace Integral <recibos@fishflow.mx>',
  rmz: 'Cocinas y Closets RMZ <recibos@fishflow.mx>',
} as const

export type SenderKey = keyof typeof SENDERS

/** Buzón real de Rafa — usar como replyTo, nunca como from. */
export const REPLY_TO = 'raf@fishflow.mx'

/**
 * Instancia de Resend creada bajo demanda.
 *
 * El SDK truena en el constructor si no hay API key, y a nivel de módulo eso
 * tumba `next build`. Siempre instanciar dentro del handler.
 *
 * @returns null si RESEND_API_KEY no está configurada.
 */
export function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY
  if (!key) return null
  return new Resend(key)
}

type SendArgs = {
  from: SenderKey
  to: string | string[]
  subject: string
  html: string
  replyTo?: string
  /** Etiqueta para los logs, ej. 'demo/mario-criterio'. */
  tag?: string
}

/**
 * Envía un correo con un remitente del catálogo.
 *
 * No lanza: si falta la API key o Resend regresa error, lo registra y devuelve
 * ok:false. Los flujos que llaman aquí (recibos, avisos, leads) no deben
 * tumbar la request del usuario por un fallo de correo.
 */
export async function sendEmail({
  from,
  to,
  subject,
  html,
  replyTo,
  tag = 'email',
}: SendArgs): Promise<{ ok: boolean; error?: unknown }> {
  const resend = getResend()
  if (!resend) {
    console.error(`[${tag}] RESEND_API_KEY no configurada — correo omitido`)
    return { ok: false, error: 'missing_api_key' }
  }

  const { error } = await resend.emails.send({
    from: SENDERS[from],
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  })

  if (error) {
    console.error(`[${tag}] Resend error:`, error)
    return { ok: false, error }
  }
  return { ok: true }
}
