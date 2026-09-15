/**
 * Filtro antibot para los formularios públicos que viven fuera de fishflow.mx
 * (hoy: mariocitalan.net, hospedado en Hostinger).
 *
 * POR QUÉ EXISTE
 * --------------
 * Del 12 al 15 de septiembre de 2026 entraron 7 registros al panel de Mario con
 * nombre y mensaje de letras aleatorias ("vLkrnIngbqPrwWIFsQqtACWs"), teléfono
 * de 10 dígitos al azar... y correo REAL de un tercero
 * (claudio.zabaleta@lexmark.com, connie.kay@craneww.com, jbucog@sbcglobal.net).
 *
 * El correo válido no es señal de buena fe: es el objetivo. Son direcciones
 * cosechadas y el bot busca que el acuse automático de mariocitalan.net le
 * llegue a esas personas — list-bombing. El daño no es la basura en la tabla,
 * es que esas personas marquen el correo como spam y quemen la reputación del
 * remitente en Resend.
 *
 * Los 7 registros llegaron con `landing_url` y `referrer` en null y con dos
 * formularios distintos enviados con 4 segundos de diferencia: nunca abrieron
 * la página, postean directo al endpoint.
 *
 * LAS TRES CAPAS
 * --------------
 *   1. Honeypot  — `_hp` es un campo que el navegador esconde y ningún humano
 *                  ve. Si trae algo, quien llenó el formulario es un programa.
 *   2. Time-trap — `_ts` es el momento en que cargó la página. Menos de 3
 *                  segundos entre cargar y enviar no lo hace una persona.
 *   3. Origen    — un POST desde el navegador SIEMPRE manda `Origin`. Un curl
 *                  o un script de Python, no.
 *
 * QUÉ SE HACE CON UN BLOQUEO
 * --------------------------
 * Se responde 200 con el mismo cuerpo que un alta exitosa y no se guarda ni se
 * manda nada. Devolver 400 le enseña al bot qué campo cambiar; un 200 lo deja
 * creyendo que funcionó y no reintenta. El descarte queda en el log de Vercel
 * con el prefijo [antibot] para poder auditarlo.
 *
 * TOLERANCIA DURANTE EL DESPLIEGUE
 * --------------------------------
 * El sitio de Mario se sube a mano a Hostinger, así que el API se despliega
 * antes que el HTML y habrá horas —o navegadores con caché— mandando
 * formularios sin `_hp` ni `_ts`. Por eso la falta de `_ts` NO bloquea por sí
 * sola: bloquea cuando además falta el `Origin`, que es exactamente la firma
 * del POST directo. Una vez que las 8 páginas estén arriba en Hostinger se
 * puede poner EXIGIR_TS en true y cerrar también ese hueco.
 */

import { origenPermitido } from '@/lib/cors'

/** Mínimo entre cargar la página y enviar. Un humano no baja de esto. */
const MIN_MS = 3000

/** Máximo. Más allá es una pestaña olvidada o un `_ts` inventado. */
const MAX_MS = 12 * 60 * 60 * 1000

/**
 * Ponlo en true cuando las 8 páginas de mariocitalan.net ya carguen
 * assets/antibot.js en Hostinger. Entonces un envío sin `_ts` se bloquea
 * aunque traiga un Origin correcto.
 */
const EXIGIR_TS = false

export type Veredicto = { ok: true } | { ok: false; motivo: string }

/**
 * Revisa un envío de formulario público.
 *
 * @param req  la Request, para leer el header Origin
 * @param body el JSON ya parseado
 */
export function revisarAntibot(req: Request, body: unknown): Veredicto {
  const b = (body ?? {}) as Record<string, unknown>

  // 1. Honeypot. Cualquier contenido lo delata.
  const hp = (b._hp ?? '').toString().trim()
  if (hp) return { ok: false, motivo: 'honeypot' }

  // 3. Origen. Se evalúa antes que el tiempo porque decide qué tan estricto
  //    ser con un `_ts` ausente.
  const origin = req.headers.get('origin')
  if (origin && !origenPermitido(origin)) {
    return { ok: false, motivo: `origen no permitido: ${origin}` }
  }

  // 2. Time-trap.
  const tsRaw = b._ts
  const ts = typeof tsRaw === 'number' ? tsRaw : Number.parseInt(String(tsRaw ?? ''), 10)

  if (!Number.isFinite(ts) || ts <= 0) {
    // Sin marca de tiempo. Si además no hay Origin, no vino de un navegador:
    // es la firma exacta del bot del 12-sep.
    if (!origin) return { ok: false, motivo: 'sin _ts y sin Origin' }
    if (EXIGIR_TS) return { ok: false, motivo: 'sin _ts' }
    return { ok: true }
  }

  const delta = Date.now() - ts
  if (delta < MIN_MS) return { ok: false, motivo: `enviado en ${delta} ms` }
  if (delta > MAX_MS) return { ok: false, motivo: `_ts de hace ${Math.round(delta / 3600000)} h` }

  return { ok: true }
}

/** Deja el descarte en el log de Vercel, con el correo para poder auditarlo. */
export function logDescarte(ruta: string, motivo: string, email: unknown) {
  console.warn(`[antibot] ${ruta} descartado (${motivo}) — email: ${String(email ?? '—')}`)
}
