/**
 * Plantilla del correo con el CFDI (PDF + XML adjuntos).
 *
 * Parametrizada por marca desde el arranque: el pie y los colores NO son de
 * FishFlow. El cliente que recibe la factura es cliente de Lukon, no de
 * FishFlow — el correo tiene que verse de su proveedor.
 */

export type MarcaCorreo = {
  nombre: string
  /** Fondo del encabezado. */
  fondo: string
  /** Color de acento para montos y detalles. */
  acento: string
  /** Color del texto sobre el fondo del encabezado. */
  textoSobreFondo: string
  /** Línea de pie: razón social, domicilio o contacto. */
  pie: string
}

/** Lukon — colores tomados de su panel. No hay logo en el repo: wordmark. */
export const MARCA_LUKON: MarcaCorreo = {
  nombre: 'LUKON',
  fondo: '#0B0F14',
  acento: '#C8FF3D',
  textoSobreFondo: '#F2EEE6',
  pie: 'Lukon Telemática · Monte Ararat 48, Ecatepec, Estado de México',
}

export type DatosCfdi = {
  razonSocial: string
  rfc: string
  concepto: string
  /** Total con IVA, en pesos. */
  total: number
  uuid: string
  /** Fecha ya formateada para mostrar. */
  fecha: string
  /** Se anuncia en el cuerpo solo si de verdad van adjuntos. */
  adjuntos: string[]
}

const mxn = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n)

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function asuntoCfdi(marca: MarcaCorreo, datos: DatosCfdi): string {
  return `${marca.nombre} · Tu factura por ${mxn(datos.total)}`
}

export function plantillaCfdi(marca: MarcaCorreo, datos: DatosCfdi): string {
  const filas: Array<[string, string]> = [
    ['Razón social', datos.razonSocial],
    ['RFC', datos.rfc],
    ['Concepto', datos.concepto],
    ['Fecha', datos.fecha],
    ['Folio fiscal (UUID)', datos.uuid],
  ]

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">

        <tr><td style="background:${marca.fondo};padding:28px 32px;">
          <p style="margin:0;color:${marca.textoSobreFondo};font-size:22px;font-weight:800;letter-spacing:2px;">${esc(marca.nombre)}</p>
          <p style="margin:6px 0 0;color:${marca.acento};font-size:13px;font-weight:600;">Comprobante Fiscal Digital</p>
        </td></tr>

        <tr><td style="padding:32px;">
          <p style="margin:0 0 6px;color:#111827;font-size:16px;">Hola ${esc(datos.razonSocial)},</p>
          <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">
            Adjuntamos tu factura electrónica. Este comprobante ya está timbrado ante el SAT.
          </p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
            <tr><td>
              <p style="margin:0 0 4px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:700;">Total</p>
              <p style="margin:0;color:#111827;font-size:28px;font-weight:800;">${mxn(datos.total)}</p>
              <p style="margin:4px 0 0;color:#6b7280;font-size:12px;">IVA incluido</p>
            </td></tr>
          </table>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
            ${filas
              .map(
                ([k, v]) => `<tr>
              <td style="padding:8px 0;color:#6b7280;width:42%;vertical-align:top;">${esc(k)}</td>
              <td style="padding:8px 0;color:#111827;font-weight:600;word-break:break-all;">${esc(v)}</td>
            </tr>`
              )
              .join('')}
          </table>

          ${
            datos.adjuntos.length
              ? `<p style="margin:24px 0 0;color:#4b5563;font-size:13px;line-height:1.6;">
            Archivos adjuntos: <strong>${datos.adjuntos.map(esc).join('</strong> y <strong>')}</strong>.
            Guarda ambos: el XML es el comprobante con validez fiscal, el PDF es su representación impresa.
          </p>`
              : ''
          }

          <p style="margin:24px 0 0;color:#4b5563;font-size:13px;line-height:1.6;">
            Si algún dato es incorrecto, responde a este correo dentro del mes en curso para poder cancelar y reexpedir.
          </p>
        </td></tr>

        <tr><td style="background:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:11px;line-height:1.6;">${esc(marca.pie)}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}
