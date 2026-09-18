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

  /**
   * Trufa — recordatorios del carnet a dueños de mascotas.
   * PENDIENTE: mover a trufa.com.mx en cuanto se compre el dominio. Un aviso de
   * Trufa firmado por fishflow.mx le dice al cliente final que la marca que le
   * vendimos no es la que le escribe.
   */
  trufa: 'Trufa <noreply@fishflow.mx>',

  /**
   * SPARC — dominio propio verificado en Resend (`sparcgroup.mx`, 10-sep-2026).
   * El acuse sale a nombre de SPARC, no de FishFlow: el prospecto acaba de
   * dejar sus datos en sparcgroup.mx y un correo de otro remitente se lee como
   * si lo hubieran vendido a un tercero.
   *
   * Alineacion DMARC: Resend firma DKIM con d=sparcgroup.mx (alinea con este
   * From) y el SPF se valida contra send.sparcgroup.mx, que es el Return-Path.
   * Por eso NO choca con el SPF de Google Workspace en la raiz del dominio.
   */
  sparc: 'SPARC Administracion <contacto@sparcgroup.mx>',

  cane: 'CANE Neurofeedback <raf@fishflow.mx>',
  sieckvet: 'SieckVet <noreply@fishflow.mx>',
  /**
   * Enlace Integral — dominio propio verificado en Resend
   * (`enlaceintegralseguros.com`, 17-sep-2026). Mismo criterio que SPARC: el
   * prospecto deja sus datos en la landing de Enlace y el acuse debe venir de
   * Enlace, no de su proveedor.
   *
   * Alineacion DMARC: Resend firma DKIM con d=enlaceintegralseguros.com y el
   * SPF se valida contra send.enlaceintegralseguros.com (Return-Path). El
   * correo real de la promotoria vive en enlaceintegralseguros.com.mx con
   * Google Workspace y NO se toca desde aqui.
   *
   * El buzon `contacto@` de este dominio no recibe: las respuestas van al
   * replyTo (ENLACE_DEFAULT_TO).
   */
  enlace: 'Enlace Integral Seguros <contacto@enlaceintegralseguros.com>',
  rmz: 'Cocinas y Closets RMZ <recibos@fishflow.mx>',

  /**
   * Lukon — único cliente con dominio propio verificado en Resend
   * (`gpslukon.com`, 14-ago-2026). Son el fallback: lo que manda de verdad es
   * `clients.email_from`, para que el flujo sirva a cualquier cliente que
   * traiga su propio dominio sin tocar este archivo.
   */
  lukonFacturacion: 'Lukon <facturacion@gpslukon.com>',
  lukonRecibos:     'Lukon <recibos@gpslukon.com>',
} as const

export type SenderKey = keyof typeof SENDERS

/** Buzón real de Rafa — usar como replyTo, nunca como from. */
export const REPLY_TO = 'raf@fishflow.mx'

/**
 * Destinatarios de los avisos que se le mandan a Enlace Integral (leads de la
 * landing y candidatas de /unete).
 *
 * OJO: `contacto@enlaceintegralseguros.com.mx` NO EXISTE — Resend lo rebotó con
 * "Recipient not found" en la prueba del 22-jul-2026. El buzón bueno que Ivonne
 * confirmó es `enlaceintegralseguros@gmail.com`. No volver a asumir `contacto@`.
 *
 * Se puede sobrescribir con la env `ENLACE_LEAD_TO` (coma-separada).
 * `ENLACE_LEAD_TO=""` apaga el aviso a Enlace y deja solo el de Rafa.
 */
export const ENLACE_DEFAULT_TO = 'enlaceintegralseguros@gmail.com'

/**
 * Buzon de SPARC que recibe los avisos de prospecto.
 * `contacto@sparcgroup.mx` es alias de coordinacionejecutiva@ (Monica) en
 * Google Workspace, dado de alta el 10-sep-2026. Se puede sobrescribir con la
 * env `SPARC_LEAD_TO` (coma-separada).
 */
export const SPARC_DEFAULT_TO = 'contacto@sparcgroup.mx'

/** Rafa siempre + SPARC (salvo que se apague por env). */
export function sparcNotifyTo(): string[] {
  const sparc = (process.env.SPARC_LEAD_TO ?? SPARC_DEFAULT_TO)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [REPLY_TO, ...sparc]
}

/** Rafa siempre + Enlace (salvo que se apague por env). */
export function enlaceNotifyTo(): string[] {
  const enlace = (process.env.ENLACE_LEAD_TO ?? ENLACE_DEFAULT_TO)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [REPLY_TO, ...enlace]
}

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

export type Adjunto = {
  filename: string
  content: Buffer
}

type SendArgs = {
  /** Remitente del catálogo. Se usa salvo que venga `fromAddress`. */
  from: SenderKey
  /**
   * Remitente literal que gana sobre `from`.
   *
   * ÚNICO uso permitido: remitentes que vienen de `clients.email_from`, es
   * decir configuración en base de datos, no una cadena escrita en la ruta.
   * La regla de no poner un `from` literal en una ruta sigue vigente.
   */
  fromAddress?: string | null
  to: string | string[]
  subject: string
  html: string
  replyTo?: string | null
  bcc?: string | string[]
  attachments?: Adjunto[]
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
  fromAddress,
  to,
  subject,
  html,
  replyTo,
  bcc,
  attachments,
  tag = 'email',
}: SendArgs): Promise<{ ok: boolean; error?: unknown }> {
  const resend = getResend()
  if (!resend) {
    console.error(`[${tag}] RESEND_API_KEY no configurada — correo omitido`)
    return { ok: false, error: 'missing_api_key' }
  }

  const { error } = await resend.emails.send({
    from: fromAddress || SENDERS[from],
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
    ...(bcc ? { bcc: Array.isArray(bcc) ? bcc : [bcc] } : {}),
    ...(attachments?.length
      ? {
          attachments: attachments.map((a) => ({
            filename: a.filename,
            content: a.content.toString('base64'),
          })),
        }
      : {}),
  })

  if (error) {
    console.error(`[${tag}] Resend error:`, error)
    return { ok: false, error }
  }
  return { ok: true }
}
