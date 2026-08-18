/**
 * Helpers de Facturapi.
 *
 * ⚠️ Facturapi NO devuelve `pdf_url` ni `xml_url` al crear la factura — ese
 * campo simplemente no existe en la respuesta de `POST /v2/invoices`. Guardarlo
 * tal cual deja las columnas en NULL (era el bug de la tabla `invoices`).
 * Los archivos se bajan aparte, autenticados, con los endpoints de abajo.
 */

const FACTURAPI_BASE = 'https://www.facturapi.io/v2'

export type CfdiFiles = {
  pdf: Buffer | null
  xml: Buffer | null
}

async function descargar(
  facturapiId: string,
  formato: 'pdf' | 'xml',
  apiKey: string
): Promise<Buffer | null> {
  try {
    const res = await fetch(`${FACTURAPI_BASE}/invoices/${facturapiId}/${formato}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // Sin timeout explícito un cuelgue de Facturapi se come el maxDuration
      // completo de la ruta y el usuario ve la página colgada.
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.error(`[facturapi] ${formato.toUpperCase()} ${facturapiId}: HTTP ${res.status}`)
      return null
    }
    return Buffer.from(await res.arrayBuffer())
  } catch (err) {
    console.error(`[facturapi] ${formato.toUpperCase()} ${facturapiId}:`, err)
    return null
  }
}

/**
 * Baja el PDF y el XML de un CFDI ya timbrado.
 *
 * No lanza: si alguno falla devuelve `null` en ese campo para que el flujo que
 * llama decida. El CFDI ya está timbrado ante el SAT — un fallo de descarga
 * nunca debe tumbar la operación.
 */
export async function descargarCfdi(
  facturapiId: string,
  apiKey: string
): Promise<CfdiFiles> {
  const [pdf, xml] = await Promise.all([
    descargar(facturapiId, 'pdf', apiKey),
    descargar(facturapiId, 'xml', apiKey),
  ])
  return { pdf, xml }
}

/**
 * Rutas internas de descarga (proxy autenticado que no expone la API key).
 * Es lo que se guarda en `invoices.pdf_url` / `invoices.xml_url`.
 */
export function rutasDescarga(invoiceId: string) {
  return {
    pdf_url: `/api/invoices/${invoiceId}/pdf`,
    xml_url: `/api/invoices/${invoiceId}/xml`,
  }
}

/** Nombre de archivo legible para los adjuntos del correo. */
export function nombreArchivoCfdi(
  serieFolio: string | null | undefined,
  uuid: string | null | undefined,
  ext: 'pdf' | 'xml'
): string {
  const base = serieFolio?.trim() || uuid?.slice(0, 8) || 'cfdi'
  return `CFDI-${base}.${ext}`
}
