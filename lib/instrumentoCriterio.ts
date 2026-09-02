// FishFlow — Instrumento "Arquitectura Mental y del Criterio"
// ─────────────────────────────────────────────────────────────────────────────
// Los 30 reactivos, sus 6 dimensiones y los 5 perfiles, EXTRAÍDOS del
// cuestionario que ya corre en mariocitalan.net (sitio-hostinger/cuestionario.html).
// No se retipearon a mano: se sacaron del HTML con un script para que digan
// exactamente lo mismo que contestaron las 41 personas que ya pasaron por ahí.
//
// ⚠️ Este archivo y ese HTML son la MISMA escala. Si allá cambia un reactivo o
// un rango de perfil, aquí también — o el antes/después compara peras con
// manzanas. Los backfills (scripts/backfill-assessments-*.ts) avisan cuando el
// perfil calculado no coincide con el guardado, que es la red de seguridad.

export const INSTRUMENTO_CRITERIO = "criterio_v1";

/** 30 reactivos × escala 1-5. */
export const CRITERIO_MAX = 150;
export const CRITERIO_MIN = 30;
/** 5 reactivos por dimensión. */
export const CRITERIO_MAX_DIMENSION = 25;

/** De "Nunca" (1) a "Casi siempre" (5). El índice + 1 es el valor. */
export const ESCALA: string[] = [
  "Nunca",
  "Rara vez",
  "Algunas veces",
  "Frecuentemente",
  "Casi siempre",
];

export type DimensionCriterio = {
  nombre: string;
  /** Etiqueta corta para gráficas y tablas: el nombre largo no cabe. */
  corta: string;
  items: string[];
};

export const DIMENSIONES: DimensionCriterio[] = [
  {
    nombre: "Capacidad para sostenerte frente a la adversidad",
    corta: "Adversidad",
    items: [
      "Cuando enfrento dificultades importantes, confío en mi capacidad para salir adelante.",
      "Mi valor personal no depende solamente de la opinión de otras personas.",
      "Mantengo una imagen bastante clara de quién soy, incluso en momentos difíciles.",
      "Los errores afectan mi estado de ánimo, pero no destruyen mi confianza.",
      "Suelo ser perseverante aun cuando las circunstancias se complican.",
    ],
  },
  {
    nombre: "Capacidad para aprender, adaptarte y evolucionar",
    corta: "Adaptación",
    items: [
      "Soy capaz de modificar mis opiniones cuando encuentro nueva información que esté bien respaldada.",
      "Me adapto relativamente rápido a los cambios inesperados.",
      "Escucho diferentes puntos de vista sin sentirme amenazado/a de manera inmediata.",
      "Cuando una estrategia deja de funcionar, busco alternativas.",
      "Estoy dispuesto a cuestionar ideas que he mantenido durante mucho tiempo.",
    ],
  },
  {
    nombre: "Alineación entre lo que piensas, sientes, valoras y haces",
    corta: "Congruencia",
    items: [
      "Mis decisiones suelen estar alineadas con mis valores personales.",
      "Actúo de manera congruente incluso cuando nadie me observa.",
      "Lo que pienso, siento y hago suele estar razonablemente alineado.",
      "Reconozco mis errores sin tener la necesidad de justificarme de manera constante.",
      "Me siento auténtico en la mayoría de las áreas de mi vida.",
    ],
  },
  {
    nombre: "Capacidad para mantener el equilibrio bajo presión",
    corta: "Equilibrio",
    items: [
      "Puedo tomar decisiones importantes sin que mis emociones me dominen.",
      "Cuando atravieso periodos difíciles, recupero el equilibrio emocional en un tiempo razonable.",
      "Tolero la incertidumbre sin paralizarme.",
      "Aunque el estrés me afecta, generalmente logro manejarlo adecuadamente.",
      "No necesito tener todo bajo control para sentirme seguro/a.",
    ],
  },
  {
    nombre: "Calidad de tus procesos de análisis y toma de decisiones",
    corta: "Decisión",
    items: [
      "Antes de decidir, considero las posibles consecuencias de mis acciones.",
      "Distingo con claridad lo urgente de lo verdaderamente importante.",
      "Mantengo mi criterio incluso cuando otras personas piensan diferente.",
      "Analizo la información antes de sacar conclusiones.",
      "Mis decisiones suelen estar basadas en principios y no únicamente en comodidad o impulso.",
    ],
  },
  {
    nombre: "Claridad respecto al rumbo que deseas construir",
    corta: "Rumbo",
    items: [
      "Tengo claro el tipo de vida que quiero construir.",
      "Mis objetivos actuales tienen sentido para mí.",
      "Sé cuáles son mis prioridades en esta etapa de mi vida.",
      "Mis decisiones diarias contribuyen al alcance de mis metas de largo plazo.",
      "Siento que estoy avanzando en una dirección que me hará feliz.",
    ],
  },
];

export type PerfilCriterio = { nombre: string; corto: string; min: number; max: number; ruta: string };

/** Rangos tal cual están en cuestionario.html. El puntaje NO se le muestra a la persona. */
export const PERFILES_CRITERIO: PerfilCriterio[] = [
  { nombre: "Arquitectura Emergente",         corto: "Emergente",      min: 30,  max: 69,  ruta: "Asesoría en estructuración" },
  { nombre: "Arquitectura en Desarrollo",     corto: "En Desarrollo",  min: 70,  max: 89,  ruta: "Fortalecimiento — Etapa 1" },
  { nombre: "Arquitectura en Consolidación",  corto: "Consolidación",  min: 90,  max: 109, ruta: "Fortalecimiento — Etapa 2" },
  { nombre: "Arquitectura Funcional",         corto: "Funcional",      min: 110, max: 129, ruta: "Alto Desempeño" },
  { nombre: "Arquitectura de Alto Desempeño", corto: "Alto Desempeño", min: 130, max: 150, ruta: "Criterio Ejecutivo" },
];

export function perfilPara(puntaje: number): PerfilCriterio | null {
  return PERFILES_CRITERIO.find((p) => puntaje >= p.min && puntaje <= p.max) ?? null;
}

/** Lista plana de los 30, en el mismo orden en que se aplican. */
export const REACTIVOS: { dimension: string; texto: string }[] = DIMENSIONES.flatMap((d) =>
  d.items.map((texto) => ({ dimension: d.nombre, texto })),
);
