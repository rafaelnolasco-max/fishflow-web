/**
 * CORS para los endpoints públicos que consumen las landings de clientes
 * hospedadas en OTRO dominio (repo `fishflow-clients`, un proyecto Vercel por
 * cliente).
 *
 * Contexto: la landing de Enlace vive en enlaceintegralseguros.com, pero sus
 * formularios pegan a las rutas de fishflow.mx. El primer intento fue un
 * rewrite en el `vercel.json` de la landing (`/api/demo/*` → fishflow.mx) para
 * que el navegador lo viera como mismo origen. No funcionó ni con comodín ni
 * con rutas explícitas: Vercel simplemente no aplicaba la regla. Así que el
 * formulario ahora llama la URL absoluta y el permiso se da aquí, que es
 * determinista y no depende del enrutador de Vercel.
 *
 * Ojo: fishflow-web corre con `trailingSlash: true`. Las llamadas desde fuera
 * DEBEN incluir la diagonal final (`/api/demo/enlace-lead/`), porque un 308 en
 * medio de una petición CORS se pierde el preflight y falla.
 */

const ALLOWED_ORIGINS = [
  'https://enlaceintegralseguros.com',
  'https://www.enlaceintegralseguros.com',
  'https://enlace-integral.vercel.app',
  'https://fishflow.mx',
  'https://www.fishflow.mx',
]

/** Previews de Vercel del proyecto de Enlace: enlace-integral-<hash>.vercel.app */
const PREVIEW_ORIGIN = /^https:\/\/enlace-integral-[a-z0-9-]+\.vercel\.app$/

/**
 * Encabezados CORS para un origen dado.
 * Si el origen no está permitido devuelve {} — el navegador bloquea y el
 * servidor no se entera de nada más.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {}
  const permitido = ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN.test(origin)
  if (!permitido) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** Respuesta al preflight (OPTIONS) que manda el navegador antes del POST. */
export function preflight(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get('origin')),
  })
}
