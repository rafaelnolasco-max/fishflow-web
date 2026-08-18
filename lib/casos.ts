/**
 * Casos de éxito publicados en /casos.
 *
 * REGLA: aquí solo van hechos verificables. Ningún porcentaje ni métrica
 * inventada. Si una medición todavía no cierra, se declara en
 * `medicionEnCurso` en vez de estimarla.
 */

export type Metrica = {
  valor: string;
  label: string;
  nota?: string;
};

export type Caso = {
  slug: string;
  cliente: string;
  contacto: string;
  sector: string;
  ciudad: string;
  logo?: string;
  sitio?: string;
  /** Gancho corto que diferencia este caso de los otros dos. */
  angulo: string;
  /** Una línea para la tarjeta de la landing y del índice. */
  resumen: string;
  antes: string[];
  implementado: { t: string; d: string }[];
  resultados: Metrica[];
  medicionEnCurso?: string;
  cita?: { texto: string; autor: string; puesto: string };
  modulos: string[];
  /**
   * Operación en la que FishFlow es socio, no un cliente externo.
   * Se declara visiblemente en la tarjeta y en el detalle: esconderlo
   * contamina la credibilidad de los casos que sí son de terceros.
   */
  propio?: boolean;
  /**
   * `false` = construido pero todavía NO listado en la landing, en /casos ni
   * en el sitemap. Se voltea a `true` cuando lo que promete el caso ya corre
   * en producción y está verificado. Nunca publicar por adelantado.
   */
  publicado?: boolean;
};

export const CASOS: Caso[] = [
  {
    slug: "cane-neurofeedback",
    cliente: "CANE · Neurofeedback",
    contacto: "Psic. Karla Alonso",
    sector: "Salud mental y neurofeedback",
    ciudad: "Narvarte, Ciudad de México",
    sitio: "https://www.cane-neurofeedback.com.mx",
    angulo: "Presencia digital y reputación",
    resumen:
      "De no controlar ni su propia ficha de Google a tener sitio propio, tablero de reseñas y contenido publicándose solo.",
    antes: [
      "Sin sitio web propio: toda la captación dependía de referencias y de redes sociales.",
      "Su ficha en Google Maps era un registro duplicado y sin reclamar, que ella no administraba.",
      "No existía ningún proceso para pedirle una reseña a un paciente después de su sesión.",
      "El contenido de redes se publicaba a mano, cuando quedaba tiempo entre consultas.",
    ],
    implementado: [
      {
        t: "Sitio propio en producción",
        d: "Landing con dominio propio, medición conectada y actualizaciones incluidas.",
      },
      {
        t: "Ficha de Google corregida y bajo su control",
        d: "Identificamos el registro duplicado que le estaba robando reseñas y dejamos activa la ficha correcta.",
      },
      {
        t: "Tablero de reseñas con su cartera cargada",
        d: "34 pacientes listos para recibir la secuencia de solicitud por WhatsApp, sin escribir un mensaje a mano.",
      },
      {
        t: "Calendario de contenido programado",
        d: "Publicaciones cargadas por adelantado y publicándose solas en el horario definido.",
      },
    ],
    resultados: [
      { valor: "34", label: "pacientes en la cola de reseñas", nota: "cargados y listos para la secuencia" },
      { valor: "12", label: "publicaciones programadas", nota: "del 18 de agosto al 10 de septiembre de 2026" },
      { valor: "1", label: "ficha de Google recuperada", nota: "antes no controlaba la suya" },
    ],
    modulos: ["Sitio web", "Reputación", "Contenido"],
  },
  {
    slug: "mario-citalan",
    cliente: "Mario Citalán",
    contacto: "Mario Citalán",
    sector: "Formación, desarrollo humano y terapia",
    ciudad: "Ciudad de México",
    logo: "/mariocitalan/dr-mente-logo.png",
    angulo: "IA que te devuelve horas",
    resumen:
      "Un WordPress viejo se convirtió en un ecosistema de captación completo, con la IA transcribiendo y resumiendo cada sesión.",
    antes: [
      "Sitio en WordPress heredado, sin embudo de captación ni medición.",
      "Las notas de cada sesión se escribían a mano, después de terminar el día.",
      "Sin lista de correo propia y sin forma de saber quién había levantado la mano.",
      "Las solicitudes de servicio llegaban dispersas entre WhatsApp, correo y mensajes de redes.",
    ],
    implementado: [
      {
        t: "Ecosistema de 7 páginas",
        d: "Embudo completo, del primer contacto hasta la solicitud de servicio.",
      },
      {
        t: "Alta al newsletter y formularios de servicio",
        d: "Cuatro formularios que avisan al instante y responden al prospecto en automático, con aviso de privacidad publicado.",
      },
      {
        t: "Panel de prospectos",
        d: "Cada solicitud queda registrada, clasificada y con seguimiento visible en un solo tablero.",
      },
      {
        t: "Transcripción y resumen de sesiones con IA",
        d: "El audio de la sesión se transcribe y se resume solo; las notas dejan de ser trabajo nocturno.",
      },
    ],
    resultados: [
      { valor: "7", label: "páginas del embudo", nota: "antes: un sitio estático sin ruta de conversión" },
      { valor: "4", label: "formularios con respuesta automática", nota: "aviso inmediato y acuse al prospecto" },
      { valor: "0", label: "notas de sesión escritas a mano", nota: "la transcripción y el resumen son automáticos" },
    ],
    modulos: ["Sitio web", "Captación", "IA aplicada"],
  },
  {
    slug: "enlace-integral",
    cliente: "Enlace Integral Seguros",
    contacto: "Ivonne Cruz",
    sector: "Agencia de seguros",
    ciudad: "Coyoacán, Ciudad de México",
    logo: "/clients/enlace/logo.png",
    sitio: "https://enlaceintegralseguros.com",
    angulo: "Escala comercial",
    resumen:
      "Cuarenta vendedoras, una cartera de cientos de clientes y tres dominios peleándose entre sí, ordenados en una sola operación.",
    antes: [
      "Tres dominios muy parecidos activos al mismo tiempo, compitiendo entre ellos en Google.",
      "Sitio en WordPress sin medición propia ni públicos publicitarios.",
      "La cartera de las 40 vendedoras vivía en hojas de cálculo, sin usarse para nada más.",
      "Reputación en Google prácticamente inexistente para el tamaño de la operación.",
    ],
    implementado: [
      {
        t: "Un solo dominio, y los otros redirigiendo",
        d: "Se definió el dominio canónico y los demás dejaron de dividir el tráfico.",
      },
      {
        t: "Medición y públicos de Meta",
        d: "Píxel propio en operación, con público personalizado de 432 personas y su similar al 1 % listos para pautar.",
      },
      {
        t: "Módulo de reputación con IA",
        d: "405 clientes cargados en la cola de reseñas; la IA redacta el seguimiento a partir de lo que responde cada persona.",
      },
      {
        t: "Presencia comercial consolidada",
        d: "Landing nueva y página de Facebook confirmada y publicando bajo la misma identidad.",
      },
    ],
    resultados: [
      { valor: "405", label: "clientes en la cola de reseñas", nota: "de la cartera de sus 40 vendedoras" },
      { valor: "432", label: "personas en su público personalizado", nota: "más su público similar al 1 %" },
      { valor: "3 → 1", label: "dominios consolidados", nota: "un solo sitio canónico" },
    ],
    medicionEnCurso:
      "Punto de partida congelado el 13 de agosto de 2026: 4.8 ★ con 5 reseñas en Google. El corte a 30 días es el 12 de septiembre de 2026 y el comparativo se publica esa misma semana.",
    modulos: ["Sitio web", "Reputación", "Medición y públicos"],
  },
  {
    slug: "lukon",
    cliente: "Lukon Telemática",
    contacto: "Alejandro Almaraz",
    sector: "Telemetría GPS para flotillas",
    ciudad: "Ecatepec, Estado de México",
    angulo: "Facturación que se manda sola",
    propio: true,
    // ⚠️ Se publica hasta que el envío del CFDI esté verificado en producción.
    publicado: false,
    resumen:
      "Timbrar, descargar, adjuntar y redactar el correo era un trámite manual por cada factura. Hoy es un clic.",
    antes: [
      "Cada CFDI se timbraba y después había que descargar el PDF y el XML a mano para poder mandarlos.",
      "El correo con la factura salía cuando alguien se acordaba, desde una cuenta genérica y no desde la marca.",
      "Los archivos vivían en el escritorio de quien facturaba, sin registro central de qué se envió y a quién.",
      "No había forma de responder \"¿ya le mandamos su factura?\" sin buscar en la bandeja de salida.",
    ],
    implementado: [
      {
        t: "Timbrado del CFDI desde el panel",
        d: "Con la clave SAT correcta para servicios de rastreo satelital, sin salir de la plataforma.",
      },
      {
        t: "Envío automático al timbrar",
        d: "El PDF y el XML se adjuntan y salen solos en el mismo paso. Ya no hay descarga manual.",
      },
      {
        t: "Correo con su propia marca",
        d: "Sale de su dominio verificado y las respuestas llegan directo a quien atiende facturación.",
      },
      {
        t: "Registro central de cada factura",
        d: "Receptor, folio fiscal y momento de envío quedan guardados: se puede comprobar qué se mandó y cuándo.",
      },
    ],
    resultados: [
      { valor: "1 clic", label: "del timbrado al correo enviado", nota: "antes: timbrar, descargar, adjuntar y redactar" },
      { valor: "2 de 2", label: "archivos adjuntos automáticos", nota: "PDF y XML, los dos que exige el SAT" },
      { valor: "0", label: "facturas enviadas a mano", nota: "el paso manual desapareció del proceso" },
    ],
    medicionEnCurso:
      "El flujo quedó construido el 18 de agosto de 2026. El volumen de facturas enviadas en automático se publica después del primer mes completo de operación.",
    modulos: ["Facturación CFDI", "Cobro en línea", "Reputación"],
  },
];

/** Los que sí se muestran al público. Usar SIEMPRE esta lista, no `CASOS`. */
export const CASOS_PUBLICOS: Caso[] = CASOS.filter((c) => c.publicado !== false);

export function getCaso(slug: string): Caso | undefined {
  return CASOS.find((c) => c.slug === slug);
}
