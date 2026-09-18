/**
 * Plantilla de correo con la marca del CLIENTE.
 *
 * Regla (18-sep-2026): todo correo que sale a nombre de un cliente — acuses a
 * sus prospectos, avisos a su equipo, resúmenes — pasa por `emailUI(marca)`.
 * Igual que con los remitentes (lib/email.ts), nunca se arma el HTML de marca
 * a mano dentro de una ruta: se agrega la marca a `EMAIL_BRANDS`.
 *
 * Referencia de diseño: el newsletter de Mario (app/api/newsletter/send). Se
 * migra a esta base cuando se vuelva a tocar.
 *
 * Decisiones:
 *  - Tablas, no divs: Outlook y parte de Gmail ignoran flex, grid y max-width.
 *  - Encabezado BLANCO: los logos de los clientes están dibujados para fondo
 *    claro (grises, degradados a blanco). El color de la marca va en la barra
 *    de abajo del logo.
 *  - Los logos se sirven desde fishflow.mx (`public/clients/<slug>/`), no del
 *    sitio del cliente: el correo no depende de que su hosting esté arriba (ver
 *    la caída de sparc.mx de sep-2026). Se exportan a 3x para pantallas retina.
 *  - Si el cliente de correo bloquea imágenes (Gmail lo hace con remitentes
 *    nuevos), el `alt` se pinta con el color y la fuente de la marca.
 *  - Lo que recibe el cliente final (`audiencia: 'externo'`) NO menciona a
 *    FishFlow. Los avisos internos llevan una línea discreta al pie.
 */

const ORIGIN = 'https://www.fishflow.mx'

export type EmailBrand = {
  nombre: string
  logo: { src: string; width: number; height: number; alt: string }
  /** Nombre en texto junto al logo. Solo cuando el logo es un isotipo sin nombre. */
  wordmark?: { titulo: string; subtitulo: string }
  /**
   * 'claro' (default): fondo blanco, para logos dibujados sobre claro.
   * 'oscuro': fondo `color.oscuro`, para logos dibujados sobre oscuro (Mario).
   */
  encabezado?: 'claro' | 'oscuro'
  /** Firma al cierre de los correos al cliente final (ver `ui.firma()`). */
  firma?: { nombre: string; rol: string }
  color: {
    /** Barra de marca, títulos de sección y botón principal. */
    primario: string
    /** Segundo tramo de la barra y detalles. NO usar para texto chico. */
    acento: string
    /** Versión del acento con contraste suficiente para texto chico. */
    acentoTexto: string
    tinta: string
    gris: string
    linea: string
    papel: string
    suave: string
    /** Fondo del encabezado cuando `encabezado: 'oscuro'`. */
    oscuro?: string
    /** Fondo del botón principal. Default: `primario`. */
    boton?: string
  }
  fuente: {
    titulos: string
    cuerpo: string
    /** Subtítulo del wordmark. Default: `cuerpo`. */
    detalle?: string
    googleFonts: string
  }
  sitio: { url: string; etiqueta: string }
  /** Línea legal del pie en correos al cliente final. Texto plano. */
  pieLegal: string
  privacidad?: string
}

export const EMAIL_BRANDS = {
  /** Paleta y tipografía de enlaceintegralseguros.com (fishflow-clients/enlace). */
  enlace: {
    nombre: 'Enlace Integral Seguros',
    logo: {
      src: `${ORIGIN}/clients/enlace/email-logo.png`,
      width: 180,
      height: 64,
      alt: 'Enlace Integral Seguros',
    },
    color: {
      primario: '#064A4F',
      acento: '#0FB8B8',
      acentoTexto: '#0A6A6F',
      tinta: '#13282B',
      gris: '#5B6B6E',
      linea: '#DCE9E9',
      papel: '#F6FBFB',
      suave: '#E3F4F4',
    },
    fuente: {
      titulos: "'Libre Franklin', 'Helvetica Neue', Arial, sans-serif",
      cuerpo: "'Libre Franklin', 'Helvetica Neue', Arial, sans-serif",
      googleFonts: 'https://fonts.googleapis.com/css2?family=Libre+Franklin:wght@400;600;700&display=swap',
    },
    sitio: { url: 'https://enlaceintegralseguros.com', etiqueta: 'enlaceintegralseguros.com' },
    pieLegal: 'Enlace Integral Seguros · Distribuidor Autorizado Allianz',
  },

  /**
   * Paleta de sparcgroup.mx: azul PMS 641C, verde PMS 7739C, Jost + Inter.
   * Solo el isotipo (edificios): el logo completo es vertical y en un
   * encabezado de correo queda ilegible. El nombre va en texto a un lado.
   */
  sparc: {
    nombre: 'SPARC Administración',
    logo: {
      src: `${ORIGIN}/clients/sparc/email-isotipo.png`,
      width: 64,
      height: 52,
      // Vacío a propósito: el nombre ya va en texto al lado (wordmark). Con alt,
      // si el cliente bloquea imágenes se leería "SPARC SPARC".
      alt: '',
    },
    wordmark: { titulo: 'SPARC', subtitulo: 'Administración' },
    color: {
      primario: '#0065A1',
      acento: '#2C9A42',
      acentoTexto: '#217634',
      tinta: '#0E1D28',
      gris: '#5C6E7C',
      linea: '#E1E9F0',
      papel: '#F7FAFC',
      suave: '#EDF5FA',
    },
    fuente: {
      titulos: "'Jost', 'Helvetica Neue', Arial, sans-serif",
      cuerpo: "'Inter', 'Helvetica Neue', Arial, sans-serif",
      googleFonts: 'https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&family=Inter:wght@400;600&display=swap',
    },
    sitio: { url: 'https://www.sparcgroup.mx', etiqueta: 'sparcgroup.mx' },
    pieLegal: 'SPARC · Servicios Profesionales en Administración Residencial y Comercial',
    privacidad: 'https://www.sparcgroup.mx/aviso-de-privacidad.html',
  },

  /**
   * Mario Citalán — misma identidad que mariocitalan.net y que su newsletter
   * (app/api/newsletter/send). El logo Dr. Mente está dibujado sobre oscuro,
   * por eso su encabezado va en el navy del sitio. Fraunces solo carga en
   * algunos clientes (Apple Mail sí, Gmail no); la pila cae a Georgia.
   */
  mario: {
    nombre: 'Mario Citalán',
    logo: {
      src: `${ORIGIN}/clients/mariocitalan/email-logo.png`,
      width: 48,
      height: 48,
      alt: 'Dr. Mente',
    },
    wordmark: { titulo: 'Mario Citalán', subtitulo: 'Arquitectura del Criterio' },
    encabezado: 'oscuro',
    firma: { nombre: 'Mario Citalán', rol: 'Médico y psicoterapeuta · Ciudad de México' },
    color: {
      primario: '#2A6AAE',
      acento: '#67D4E8',
      acentoTexto: '#2A6AAE',
      tinta: '#0F1A24',
      gris: '#6B7784',
      linea: '#DCE4EC',
      papel: '#F4F7FA',
      suave: '#EEF3F8',
      oscuro: '#0F1A24',
      boton: '#0F1A24',
    },
    fuente: {
      titulos: "'Fraunces', Georgia, 'Times New Roman', serif",
      cuerpo: "'Inter', -apple-system, 'Segoe UI', Arial, sans-serif",
      detalle: "'JetBrains Mono', ui-monospace, 'Courier New', monospace",
      googleFonts:
        'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;600&family=JetBrains+Mono:wght@500&display=swap',
    },
    sitio: { url: 'https://mariocitalan.net', etiqueta: 'mariocitalan.net' },
    pieLegal: 'Mario Citalán · Arquitectura del Criterio · Ciudad de México',
    privacidad: 'https://mariocitalan.net/aviso-de-privacidad.html',
  },
} satisfies Record<string, EmailBrand>

export type EmailBrandKey = keyof typeof EMAIL_BRANDS

export function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type Boton = { texto: string; href: string; estilo?: 'primario' | 'secundario' }

export type LayoutOpts = {
  /** 'externo' = cliente final del cliente (sin FishFlow). 'interno' = su equipo. */
  audiencia: 'externo' | 'interno'
  /** Lo que se ve en la bandeja junto al asunto. Texto plano. */
  preheader: string
  /** Rótulo chico sobre el título, ej. "Nuevo prospecto". Texto plano. */
  etiqueta?: string
  /** Texto plano. */
  titulo: string
  /** Texto plano. */
  subtitulo?: string
  /** HTML armado con los helpers de `emailUI`. */
  cuerpo: string
  /** Nota chica al pie. Texto plano. */
  nota?: string
}

/**
 * Helpers de maquetado atados a una marca.
 *
 *   const ui = emailUI('sparc')
 *   const html = ui.layout({ audiencia: 'externo', titulo: '…', cuerpo: ui.p('…') })
 *
 * `p()` recibe HTML (para permitir <strong> y ligas): escapar con `escHtml`
 * todo lo que venga del usuario. `dato()`, `tabla()` y `lista()` escapan solos.
 */
export function emailUI(marca: EmailBrandKey) {
  const b: EmailBrand = EMAIL_BRANDS[marca]
  const c = b.color
  const F = b.fuente.cuerpo
  const T = b.fuente.titulos

  const p = (html: string) =>
    `<p style="margin:0 0 16px;font-family:${F};font-size:15px;line-height:1.65;color:${c.tinta}">${html}</p>`

  const link = (texto: string, href: string) =>
    `<a href="${escHtml(href)}" style="color:${c.primario};font-weight:600;text-decoration:underline">${escHtml(texto)}</a>`

  /** Recuadro con borde de acento: el dato que el lector tiene que ver. */
  const dato = (etiqueta: string, valor: string) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px">
      <tr><td style="background:${c.suave};border-left:3px solid ${c.acento};padding:14px 18px">
        <div style="font-family:${F};font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${c.gris}">${escHtml(etiqueta)}</div>
        <div style="font-family:${T};font-size:19px;font-weight:600;color:${c.tinta};padding-top:4px;line-height:1.3">${escHtml(valor)}</div>
      </td></tr>
    </table>`

  /** Tabla etiqueta → valor. En móvil se apila. */
  const tabla = (filas: [string, string | null | undefined][]) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border-collapse:collapse">
      ${filas
        .map(
          ([k, v]) => `<tr>
        <td class="ff-k" width="170" style="width:170px;padding:9px 12px 9px 0;border-bottom:1px solid ${c.linea};vertical-align:top;font-family:${F};font-size:13px;color:${c.gris}">${escHtml(k)}</td>
        <td class="ff-v" style="padding:9px 0;border-bottom:1px solid ${c.linea};vertical-align:top;font-family:${F};font-size:15px;font-weight:600;color:${c.tinta}">${escHtml(v) || '—'}</td>
      </tr>`
        )
        .join('')}
    </table>`

  const lista = (items: string[]) =>
    items.length
      ? `<ul style="margin:6px 0 14px;padding-left:18px;font-family:${F};font-size:14px;line-height:1.55;color:${c.tinta}">${items
          .map((i) => `<li style="margin:0 0 4px">${escHtml(i)}</li>`)
          .join('')}</ul>`
      : `<p style="margin:6px 0 14px;font-family:${F};font-size:14px;color:${c.gris}">—</p>`

  /** Rótulo de sección dentro del cuerpo. */
  const rotulo = (texto: string) =>
    `<div style="font-family:${F};font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:${c.gris};padding-top:6px">${escHtml(texto)}</div>`

  /** Bloque sombreado. tono 'aviso' = fondo ámbar para algo que requiere atención. */
  const bloque = (html: string, tono: 'suave' | 'aviso' = 'suave') => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
      <tr><td style="background:${tono === 'aviso' ? '#FFF6E5' : c.papel};border:1px solid ${tono === 'aviso' ? '#F1DDB3' : c.linea};border-radius:8px;padding:18px 20px">${html}</td></tr>
    </table>`

  /** Botones "a prueba de Outlook": celda con fondo + liga con padding. */
  const botones = (lista: Boton[]) => {
    const celdas = lista
      .filter((x) => x.href)
      .map((x) => {
        const sec = x.estilo === 'secundario'
        const fondo = c.boton ?? c.primario
        return `<td style="padding:0 10px 10px 0">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="border-radius:8px;background:${sec ? '#FFFFFF' : fondo};border:1.5px solid ${fondo}">
              <a href="${escHtml(x.href)}" style="display:inline-block;padding:12px 22px;font-family:${F};font-size:14px;font-weight:700;color:${sec ? fondo : '#FFFFFF'};text-decoration:none;border-radius:8px">${escHtml(x.texto)}</a>
            </td>
          </tr></table>
        </td>`
      })
      .join('')
    return celdas
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 10px"><tr>${celdas}</tr></table>`
      : ''
  }

  const oscuro = b.encabezado === 'oscuro'
  const fondoEncabezado = oscuro ? c.oscuro ?? c.tinta : '#FFFFFF'

  /** Cierre firmado ("Un abrazo, …") para correos al cliente final. */
  const firma = (despedida = 'Un abrazo,') =>
    b.firma
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 0">
      <tr><td style="border-top:1px solid ${c.linea};padding-top:18px">
        <div style="font-family:${F};font-size:14px;color:${c.gris};padding-bottom:4px">${escHtml(despedida)}</div>
        <div style="font-family:${T};font-size:18px;color:${c.tinta}">${escHtml(b.firma.nombre)}</div>
        <div style="font-family:${F};font-size:13px;color:${c.gris};padding-top:3px">${escHtml(b.firma.rol)}</div>
      </td></tr>
    </table>`
      : ''

  const encabezado = () => {
    const img = `<img src="${b.logo.src}" width="${b.logo.width}" height="${b.logo.height}" alt="${escHtml(b.logo.alt)}"
      style="display:block;width:${b.logo.width}px;height:${b.logo.height}px;border:0;outline:none;font-family:${T};font-size:18px;font-weight:600;color:${c.primario}">`
    const wm = b.wordmark
      ? `<td style="vertical-align:middle;padding-left:14px">
          <div style="font-family:${T};font-size:${oscuro ? '20px' : '22px'};font-weight:500;letter-spacing:${oscuro ? '0' : '.2em'};color:${oscuro ? '#FFFFFF' : c.primario};line-height:1.15">${escHtml(b.wordmark.titulo)}</div>
          <div style="font-family:${b.fuente.detalle ?? T};font-size:${oscuro ? '10px' : '12px'};font-weight:400;letter-spacing:${oscuro ? '.2em' : '.14em'};text-transform:uppercase;color:${oscuro ? c.acento : c.acentoTexto};padding-top:${oscuro ? '5px' : '3px'}">${escHtml(b.wordmark.subtitulo)}</div>
        </td>`
      : ''
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle"><a href="${b.sitio.url}" style="text-decoration:none">${img}</a></td>${wm}
    </tr></table>`
  }

  const pie = (o: LayoutOpts) => {
    const chico = `font-family:${F};font-size:12px;line-height:1.6;color:${c.gris}`
    const nota = o.nota ? `<p style="margin:0 0 10px;${chico}">${escHtml(o.nota)}</p>` : ''
    if (o.audiencia === 'interno') {
      return `${nota}<p style="margin:0;${chico}">Aviso automático para el equipo de ${escHtml(b.nombre)} · FishFlow</p>`
    }
    const ligas = [
      `<a href="${b.sitio.url}" style="color:${c.gris};text-decoration:underline">${escHtml(b.sitio.etiqueta)}</a>`,
      b.privacidad
        ? `<a href="${b.privacidad}" style="color:${c.gris};text-decoration:underline">Aviso de privacidad</a>`
        : '',
    ]
      .filter(Boolean)
      .join(' &nbsp;·&nbsp; ')
    return `${nota}<p style="margin:0 0 6px;${chico}">${escHtml(b.pieLegal)}</p><p style="margin:0;${chico}">${ligas}</p>`
  }

  const layout = (o: LayoutOpts) => `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escHtml(o.titulo)}</title>
<link href="${b.fuente.googleFonts}" rel="stylesheet">
<style>
  @media (max-width:620px) {
    .ff-outer { padding:0 !important; }
    .ff-card { width:100% !important; border-left:0 !important; border-right:0 !important; }
    .ff-px { padding-left:20px !important; padding-right:20px !important; }
    .ff-title { font-size:22px !important; }
    .ff-k { display:block !important; width:auto !important; padding:10px 0 0 !important; border-bottom:0 !important; }
    .ff-v { display:block !important; padding:2px 0 10px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${c.papel};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escHtml(o.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.papel}">
  <tr><td align="center" class="ff-outer" style="padding:28px 14px">
    <table role="presentation" class="ff-card" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:600px;max-width:100%;background:#FFFFFF;border:1px solid ${c.linea}">
      <tr><td class="ff-px" style="padding:24px 32px 20px;background:${fondoEncabezado}">${encabezado()}</td></tr>
      <tr><td style="padding:0;font-size:0;line-height:0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="72%" height="4" style="height:4px;background:${c.primario};font-size:0;line-height:0">&nbsp;</td>
          <td height="4" style="height:4px;background:${c.acento};font-size:0;line-height:0">&nbsp;</td>
        </tr></table>
      </td></tr>
      <tr><td class="ff-px" style="padding:30px 32px 4px">
        ${o.etiqueta ? `<div style="font-family:${F};font-size:11px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:${c.acentoTexto};padding-bottom:8px">${escHtml(o.etiqueta)}</div>` : ''}
        <h1 class="ff-title" style="margin:0;font-family:${T};font-size:25px;font-weight:600;line-height:1.25;color:${c.tinta}">${escHtml(o.titulo)}</h1>
        ${o.subtitulo ? `<p style="margin:6px 0 0;font-family:${F};font-size:14px;color:${c.gris}">${escHtml(o.subtitulo)}</p>` : ''}
      </td></tr>
      <tr><td class="ff-px" style="padding:20px 32px 26px">${o.cuerpo}</td></tr>
      <tr><td class="ff-px" style="padding:18px 32px 22px;background:${c.papel};border-top:1px solid ${c.linea}">${pie(o)}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`

  return { marca: b, p, link, dato, tabla, lista, rotulo, bloque, botones, firma, layout }
}
