// Monitor normativo de /app/regintel — lógica pura (sin red ni base de datos).
// Todo lo que decide algo vive aquí para poder probarlo con instantáneas
// guardadas (fixtures). index.ts solo orquesta: lee, guarda y avisa.

import { parseHTML } from "npm:linkedom@0.18.5";

// ─── Tipos ─────────────────────────────────────────────────────────────────────
export type Organismo = "DOF" | "COFEPRIS" | "ARCSA";
export type Edicion = "MAT" | "VES" | "EXT";

export interface NotaDof { codigo: string; fecha: string; edicion: Edicion; dependencia: string | null; titulo: string; url: string }
export interface DocInventario { id: string; titulo: string; url: string; categoria: string | null; subcategoria: string | null; fecha?: string | null }
export interface Noticia { id: string; titulo: string; url: string; fecha: string; tipo: string | null }

export interface Lectura<T> {
  ok: boolean;                 // ¿fue una lectura real y completa?
  datos: T;
  error?: string;              // por qué no se considera lectura real
  verificacion?: "verificada" | "no_verificada";
}

// ─── Utilidades de texto y fecha ───────────────────────────────────────────────
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", ordm: "º", ordf: "ª", laquo: "«", raquo: "»", iexcl: "¡", iquest: "¿", deg: "°", ndash: "–", mdash: "—", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…", bull: "•", middot: "·" };
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e] ?? m;
  });
}
export const limpia = (s: string) => decode(s.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ")).replace(/[\u200b\u00a0]/g, " ").replace(/\s+/g, " ").trim();
export const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const MESES: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
/** "1 de octubre de 2026", "1 de octubre , 2026" → "2026-10-01" */
export function fechaEs(s: string): string | null {
  const m = norm(s).match(/(\d{1,2})\s+de\s+([a-z]+)\s*(?:de|,)\s*(\d{4})/);
  if (!m || !MESES[m[2]]) return null;
  return `${m[3]}-${String(MESES[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
/** Fecha calendario en CDMX (sin horario de verano desde 2022). */
export function hoyCdmx(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function sumarDias(iso: string, d: number): string {
  const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10);
}
export function diasEntre(a: string, b: string): number {
  return Math.round((new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime()) / 86_400_000);
}
export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Detecta la página de desafío anti-bot (Imperva) que gob.mx sirve con 200. */
export const esDesafio = (html: string) => /Challenge Validation|_Incapsula_Resource|incap_ses_/i.test(html) && html.length < 20_000;

// ─── Ventana de fechas ─────────────────────────────────────────────────────────
/**
 * Fechas a revisar del DOF: hoy y los 3 días anteriores (CDMX). En la primera
 * corrida, 30 días hacia atrás. Más los días que fallaron y siguen pendientes.
 */
export function ventanaDof(hoy: string, primera: boolean, fallidos: string[] = []): string[] {
  const n = primera ? 30 : 3;
  const s = new Set<string>();
  for (let i = n; i >= 0; i--) s.add(sumarDias(hoy, -i));
  for (const f of fallidos) if (diasEntre(f, hoy) <= 15) s.add(f);
  return [...s].sort();
}

// ─── DOF ───────────────────────────────────────────────────────────────────────
export const urlIndiceDof = (fecha: string, ed: Edicion) =>
  `https://dof.gob.mx/index_113.php?year=${fecha.slice(0, 4)}&month=${fecha.slice(5, 7)}&day=${fecha.slice(8, 10)}&edicion=${ed}`;
export const urlNotaDof = (codigo: string, fecha: string) => `https://dof.gob.mx/nota_detalle.php?codigo=${codigo}&fecha=${dmy(fecha)}`;
export const urlSidof = (codigo: string) => `https://sidof.segob.gob.mx/notas/docFuente/${codigo}`;

/**
 * Lee el índice de una fecha y edición. "No hay datos" o una edición
 * extraordinaria que no existe (302 → Error.php) son normales: estado sin_datos.
 */
export function parseIndiceDof(html: string, fecha: string, ed: Edicion, status = 200, redirect: string | null = null):
  { estado: "ok" | "sin_datos" | "error"; notas: NotaDof[]; error?: string } {
  if (status === 302 || status === 301) {
    if (/Error\.php/i.test(redirect ?? "") && ed === "EXT") return { estado: "sin_datos", notas: [] };
    return { estado: "error", notas: [], error: `redirección inesperada a ${redirect}` };
  }
  if (status !== 200) return { estado: "error", notas: [], error: `HTTP ${status}` };
  if (!html || html.length < 500) return { estado: "error", notas: [], error: "respuesta vacía" };
  if (/No hay datos para la fecha seleccionada/i.test(html)) return { estado: "sin_datos", notas: [] };

  const sinComentarios = html.replace(/<!--[\s\S]*?-->/g, "");
  const marcas: { pos: number; dep: string }[] = [];
  for (const m of sinComentarios.matchAll(/class="subtitle_azul"[^>]*>([\s\S]*?)<\/td>/g)) {
    marcas.push({ pos: m.index!, dep: limpia(m[1]) });
  }
  const notas: NotaDof[] = [];
  const vistos = new Set<string>();
  for (const m of sinComentarios.matchAll(/<a href="\/?nota_detalle\.php\?codigo=(\d+)&(?:amp;)?fecha=([\d/]+)"[^>]*class="enlaces"[^>]*>([\s\S]*?)<\/a>/g)) {
    const codigo = m[1];
    if (vistos.has(codigo)) continue;
    vistos.add(codigo);
    const dep = [...marcas].reverse().find((x) => x.pos < m.index!)?.dep ?? null;
    notas.push({ codigo, fecha, edicion: ed, dependencia: dep, titulo: limpia(m[3]), url: urlNotaDof(codigo, fecha) });
  }
  if (!notas.length) return { estado: "error", notas: [], error: "el índice no trae notas ni el aviso de 'No hay datos' (¿cambió el formato?)" };
  return { estado: "ok", notas };
}

/** Texto de la nota (DOF o SIDOF). Recorta al cuerpo y limita tamaño para el clasificador. */
export function textoNota(html: string): string | null {
  let h = html;
  const i = h.search(/id=["']DivDetalleNota["']/);
  if (i >= 0) h = h.slice(h.lastIndexOf("<", i));
  h = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  const t = limpia(h);
  return t.length > 400 ? t : null;
}
/** Para el clasificador: inicio (objeto y considerandos) + final (transitorios: vigencia). */
export function recorteParaLlm(texto: string, cabeza = 9000, cola = 3500): string {
  if (texto.length <= cabeza + cola + 200) return texto;
  return texto.slice(0, cabeza) + "\n[…]\n" + texto.slice(-cola);
}

// ─── gob.mx: páginas con adjuntos (Documentos de Medicamentos, Formatos) ──────
const GENERICO = /^(pdf|formato|descargar|descarga|ver|aqu[ií]|liga|enlace|word|excel|docx?|xlsx?|instructivo|gu[ií]a|english|espa[ñn]ol|\W*)$/i;

/**
 * Inventario de una página de gob.mx: un renglón por /cms/uploads/attachment/file/<ID>/.
 * Título: el texto del enlace si dice algo; si no ("PDF", "Formato"), el del renglón.
 */
export function parseAdjuntosGobmx(html: string): Lectura<DocInventario[]> {
  if (esDesafio(html)) return { ok: false, datos: [], error: "gob.mx respondió con el desafío anti-bot (Challenge Validation)" };
  // deno-lint-ignore no-explicit-any
  const { document } = parseHTML(html.includes("<html") ? html : `<html><body>${html}</body></html>`) as any;
  const docs: DocInventario[] = [];
  const vistos = new Set<string>();
  let categoria: string | null = null;
  // Recorremos en orden de documento para heredar el encabezado vigente.
  const nodos = document.querySelectorAll("h1,h2,h3,h4,h5,th,a[href*='/cms/uploads/attachment/file/']");
  for (const n of nodos as unknown as any[]) {
    const tag = n.tagName.toLowerCase();
    if (tag !== "a") {
      const t = limpia(n.textContent ?? "");
      if (t && t.length < 160 && tag !== "th") categoria = t;
      continue;
    }
    const href = n.getAttribute("href") ?? "";
    const m = href.match(/\/cms\/uploads\/attachment\/file\/(\d+)\/([^?#"]+)/);
    if (!m || vistos.has(m[1])) continue;
    vistos.add(m[1]);
    let titulo = limpia(n.textContent ?? "");
    let sub: string | null = null;
    const tr = n.closest("tr");
    if (tr) {
      const primera = tr.querySelector("td");
      const nombre = primera ? limpia(primera.textContent ?? "") : "";
      const encabezado = (() => {
        const celda = n.closest("td");
        if (!celda) return null;
        const idx = [...tr.children].indexOf(celda);
        const th = tr.closest("table")?.querySelectorAll("thead th")[idx];
        return th ? limpia(th.textContent ?? "") : null;
      })();
      if (GENERICO.test(titulo) || titulo.length < 4) titulo = nombre && encabezado ? `${nombre} — ${encabezado}` : nombre || titulo;
      sub = encabezado;
    } else if (GENERICO.test(titulo) || titulo.length < 4) {
      const p = n.closest("li,p,div");
      titulo = p ? limpia(p.textContent ?? "") : titulo;
    }
    if (!titulo || GENERICO.test(titulo)) titulo = decodeURIComponent(m[2]).replace(/[_]+/g, " ").replace(/\.\w+$/, "");
    const url = href.startsWith("http") ? href : `https://www.gob.mx${href.startsWith("/") ? "" : "/"}${href}`;
    docs.push({ id: m[1], titulo, url, categoria, subcategoria: sub });
  }
  if (!docs.length) return { ok: false, datos: [], error: "la página no trae adjuntos (¿cambió el formato o no cargó?)" };
  return { ok: true, datos: docs };
}

// ─── COFEPRIS: portada (comunicados con fecha verificable) ────────────────────
/**
 * Prueba de vejez: si lo más reciente tiene más de 30 días o hay marcadores de
 * 2018 (comunicados 018–023, administración 2012–2018), la portada es una copia
 * cacheada: "no verificada" y no se reporta nada de ahí.
 */
export function parsePortadaCofepris(html: string, hoy: string): Lectura<Noticia[]> {
  if (esDesafio(html)) return { ok: false, datos: [], error: "gob.mx respondió con el desafío anti-bot (Challenge Validation)" };
  const texto = limpia(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " "));
  const marcadores2018 =
    /\b2012\s*[-–]\s*2018\b/.test(texto) ||
    /comunicado\s*(?:no\.?\s*)?0?(18|19|20|21|22|23)\s*\/\s*2018/i.test(texto) ||
    /\b0(18|19|20|21|22|23)\/2018\b/.test(texto);

  // deno-lint-ignore no-explicit-any
  const { document } = parseHTML(html.includes("<html") ? html : `<html><body>${html}</body></html>`) as any;
  const items: Noticia[] = [];
  const vistos = new Set<string>();
  for (const a of document.querySelectorAll("a[href]") as unknown as any[]) {
    const href = a.getAttribute("href") ?? "";
    if (!/\/cofepris\/(?:es\/)?(articulos|prensa)\//.test(href)) continue; // solo comunicados
    const url = href.split("?")[0];
    if (vistos.has(url)) continue;
    const bloque = limpia(a.textContent ?? "");
    const fecha = fechaEs(bloque) ?? fechaEs(limpia(a.parentElement?.textContent ?? ""));
    if (!fecha) continue;                        // sin fecha verificable → no entra
    vistos.add(url);
    const titulo = limpia(a.querySelector("h1,h2,h3,h4,h5,.news-title,.slide-title")?.textContent ?? "") ||
      a.querySelector("img")?.getAttribute("alt") || bloque.replace(/\b\d{1,2} de \w+ de \d{4}.*$/i, "").trim();
    items.push({ id: url, titulo: limpia(titulo), url: url.startsWith("http") ? url : `https://www.gob.mx${url}`, fecha, tipo: "Comunicado" });
  }
  const masReciente = items.map((i) => i.fecha).sort().at(-1) ?? null;
  if (marcadores2018) return { ok: false, datos: [], verificacion: "no_verificada", error: "la portada muestra contenido de la administración 2012–2018 (copia cacheada)" };
  if (!masReciente) return { ok: false, datos: [], verificacion: "no_verificada", error: "la portada no trae comunicados con fecha verificable" };
  if (diasEntre(masReciente, hoy) > 30) {
    return { ok: false, datos: [], verificacion: "no_verificada", error: `el comunicado más reciente es del ${masReciente} (más de 30 días): posible copia cacheada` };
  }
  return { ok: true, datos: items, verificacion: "verificada" };
}

// ─── ARCSA ─────────────────────────────────────────────────────────────────────
/**
 * Documentos vigentes. El inventario es el id= de cada download.php con su
 * categoría y subcategoría. Las secciones "colapsadas" vienen en el HTML; se
 * leen todas.
 */
export function parseArcsaDocumentos(html: string): Lectura<DocInventario[]> {
  if (!html || html.length < 5000) return { ok: false, datos: [], error: "respuesta vacía o incompleta" };
  const re = /<li\b([^>]*)>|<\/li>|<a\s+href="([^"]*download\.php\?id=(\d+)&(?:amp;)?force=0)"[^>]*title="([^"]*)"/g;
  const pila: { cat: string | null }[] = [];
  const docs: DocInventario[] = [];
  const vistos = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("</li")) { pila.pop(); continue; }
    if (m[1] !== undefined) {
      let cat: string | null = null;
      if (/id="cat-\d+"/.test(m[1])) {
        const resto = html.slice(re.lastIndex, re.lastIndex + 400);
        const t = resto.match(/<a[^>]*>([\s\S]*?)<\/a>/);
        cat = t ? limpia(t[1]).replace(/^\+\s*/, "") : null;
      }
      pila.push({ cat });
      continue;
    }
    const id = m[3];
    if (vistos.has(id)) continue;
    vistos.add(id);
    const cats = pila.map((p) => p.cat).filter(Boolean) as string[];
    docs.push({
      id,
      titulo: limpia(m[4]).replace(/^Ver\s+/i, ""),
      url: decode(m[2]),
      categoria: cats[0] ?? null,
      subcategoria: cats.length > 1 ? cats.slice(1).join(" › ") : null,
    });
  }
  if (docs.length < 20) return { ok: false, datos: docs, error: `solo se leyeron ${docs.length} documentos (¿la página no cargó completa?)` };
  return { ok: true, datos: docs };
}

export function parseArcsaNoticias(html: string): Lectura<Noticia[]> {
  const items: Noticia[] = [];
  for (const m of html.matchAll(/<a href="(https:\/\/www\.controlsanitario\.gob\.ec\/[^"]+)">\s*<span class="time">([^<]+)<\/span>\s*<br>\s*<span class="titulo"\s*>([\s\S]*?)<\/span>/g)) {
    const fecha = fechaEs(m[2]);
    if (!fecha) continue;
    items.push({ id: m[1], url: m[1], fecha, titulo: limpia(m[3]), tipo: "Noticia" });
  }
  if (!items.length) return { ok: false, datos: [], error: "no se encontraron noticias con fecha (¿cambió el formato?)" };
  return { ok: true, datos: items };
}

// ─── Inventario: línea base, novedades, bajas y reemplazos ────────────────────
export interface PrevDoc { id: string; titulo: string | null; categoria: string | null; subcategoria?: string | null; estado: string }
export interface Diff {
  lineaBase: boolean;
  nuevos: DocInventario[];
  desaparecidos: string[];
  reemplazos: { de: string; a: string }[];
  sospechosa?: string;          // lectura que no se acepta (se cae medio inventario)
}

const CODIGO_DOC = /\b([A-Z]{1,3}-[A-Z](?:\.\d+)+-[A-Z]{1,6}-\d{2})\b/;
const tokens = (s: string) => new Set(norm(s).replace(/\bv\d+(\.\d+)?\b|\b\d{4}\b|\b\d+\b|[^a-z0-9 ]/g, " ").split(" ").filter((t) => t.length > 2));
export function similitud(a: string, b: string): number {
  const ca = a.match(CODIGO_DOC)?.[1], cb = b.match(CODIGO_DOC)?.[1];
  if (ca && cb) return ca === cb ? 1 : 0.1;
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * prev = inventario guardado (null si la fuente nunca se ha leído bien).
 * La primera lectura exitosa fija la línea base y no genera novedades.
 * Una categoría que no aparece en la lectura nueva NO produce bajas.
 */
export function diffInventario(prev: PrevDoc[] | null, actual: DocInventario[], umbral = 0.6): Diff {
  if (!prev || !prev.length) return { lineaBase: true, nuevos: [], desaparecidos: [], reemplazos: [] };
  const vigentesPrev = prev.filter((p) => p.estado !== "desaparecido" && p.estado !== "reemplazado");
  if (actual.length < vigentesPrev.length * 0.6) {
    return { lineaBase: false, nuevos: [], desaparecidos: [], reemplazos: [], sospechosa: `se leyeron ${actual.length} documentos contra ${vigentesPrev.length} del inventario: lectura incompleta` };
  }
  const idsActual = new Set(actual.map((d) => d.id));
  const idsPrev = new Set(prev.map((p) => p.id));
  const seccion = (d: { categoria: string | null; subcategoria?: string | null }) => `${d.categoria ?? ""}|${d.subcategoria ?? ""}`;
  const catsActual = new Set(actual.map(seccion));
  const nuevos = actual.filter((d) => !idsPrev.has(d.id));
  const bajas = vigentesPrev.filter((p) => !idsActual.has(p.id) && catsActual.has(seccion(p)));
  const reemplazos: { de: string; a: string }[] = [];
  const usados = new Set<string>();
  for (const n of nuevos) {
    let mejor: { id: string; s: number } | null = null;
    for (const b of bajas) {
      if (usados.has(b.id) || seccion(b) !== seccion(n)) continue;
      const s = similitud(b.titulo ?? "", n.titulo);
      if (s >= umbral && (!mejor || s > mejor.s)) mejor = { id: b.id, s };
    }
    if (mejor) { usados.add(mejor.id); reemplazos.push({ de: mejor.id, a: n.id }); }
  }
  return { lineaBase: false, nuevos, desaparecidos: bajas.filter((b) => !usados.has(b.id)).map((b) => b.id), reemplazos };
}

// ─── Salud de la fuente ────────────────────────────────────────────────────────
export interface EstadoFuente {
  last_checked: string | null; last_check_attempt: string | null; last_check_error: string | null;
  consecutive_failures: number; verificacion: "sin_leer" | "verificada" | "no_verificada";
}
/** Un fallo de lectura NUNCA es "sin novedades": no toca last_checked y suma fallas. */
export function aplicarLectura(prev: EstadoFuente, ok: boolean, ahora: string, error?: string, verificacion?: "verificada" | "no_verificada"): EstadoFuente {
  if (ok) return { last_checked: ahora, last_check_attempt: ahora, last_check_error: null, consecutive_failures: 0, verificacion: verificacion ?? "verificada" };
  return {
    last_checked: prev.last_checked, last_check_attempt: ahora, last_check_error: error ?? "falla de lectura",
    consecutive_failures: prev.consecutive_failures + 1, verificacion: verificacion ?? prev.verificacion,
  };
}
export const esPuntoCiego = (lastChecked: string | null, ahora: Date) =>
  !lastChecked || ahora.getTime() - new Date(lastChecked).getTime() > 7 * 86_400_000;

// ─── Criterios: prefiltro determinista ─────────────────────────────────────────
const DEP_SALUD = /secretar[ií]a de salud|consejo de salubridad general|comisi[oó]n federal para la protecci[oó]n contra riesgos sanitarios/i;
export const PALABRAS = /cofepris|medicament|vacuna|biol[oó]gic|biotecnol|dispositivo[s]? m[eé]dico|registro[s]? sanitario|mol[eé]culas nuevas|insumos para la salud/i;
const FUERTES = /registro[s]? sanitario|mol[eé]culas nuevas|medicament|vacuna|biol[oó]gic|biotecnol|dispositivo[s]? m[eé]dico|cofepris|buenas pr[aá]cticas de fabricaci[oó]n|insumos para la salud/i;

export interface Prefiltro { pasa: boolean; motivo?: string }

export function prefiltroDof(n: { dependencia: string | null; titulo: string }): Prefiltro {
  const t = n.titulo;
  if (!DEP_SALUD.test(n.dependencia ?? "") && !PALABRAS.test(t)) {
    return { pasa: false, motivo: `Fuera del ámbito sanitario: ${n.dependencia ?? "dependencia no identificada"}, sin palabras clave de insumos para la salud.` };
  }
  if (/convenio/i.test(t) && /transferencia|ministraci[oó]n|recursos presupuestarios|subsidio/i.test(t) && !FUERTES.test(t)) {
    return { pasa: false, motivo: "Convenio de transferencia de recursos entre la Secretaría de Salud y una entidad federativa: no toca el registro sanitario." };
  }
  if (/delega(n|ci[oó]n)? (de )?(la )?(facultad|firma)|suplencia/i.test(t) && !FUERTES.test(t)) {
    return { pasa: false, motivo: "Aviso administrativo (delegación de firma o suplencia)." };
  }
  return { pasa: true };
}

const ARCSA_FUERA = /alimento|cosm[eé]tic|higiene|plaguicida|bares escolares|tabaco|desechos|alimentaci[oó]n colectiva/i;
export function prefiltroInventario(org: Organismo, d: { titulo: string; categoria: string | null; subcategoria: string | null }): Prefiltro {
  const ctx = `${d.categoria ?? ""} ${d.subcategoria ?? ""}`;
  if (org === "ARCSA" && ARCSA_FUERA.test(ctx) && !FUERTES.test(d.titulo)) {
    return { pasa: false, motivo: `Sección de ARCSA fuera de criterio: ${d.categoria}.` };
  }
  if (/tabaco|cosm[eé]tic|perfumer[ií]a|alimento|plaguicida/i.test(d.titulo) && !FUERTES.test(d.titulo)) {
    return { pasa: false, motivo: "Documento de alimentos, cosméticos, tabaco o plaguicidas." };
  }
  return { pasa: true };
}
export function prefiltroNoticia(n: { titulo: string }): Prefiltro {
  if (/clausur|decomis|asegur|operativo|clandestin|irregular|alerta sanitaria|retiro del mercado|falsificad/i.test(n.titulo) && !/registro sanitario|lineamiento|norma|gu[ií]a|reglament|requisit/i.test(n.titulo)) {
    return { pasa: false, motivo: "Acción de vigilancia puntual (operativo, clausura, decomiso o alerta)." };
  }
  if (!PALABRAS.test(n.titulo) && !/regulaci|norma|lineamiento|gu[ií]a|reglament|tr[aá]mite|ensayo cl[ií]nico|autoriza/i.test(n.titulo)) {
    return { pasa: false, motivo: "Noticia sin relación con trámites de registro sanitario." };
  }
  return { pasa: true };
}

export const portafolioDe = (texto: string) => (/vacuna|biol[oó]gic|biotecnol|biosimilar|biocomparable/i.test(texto) ? "Vx" : null);

// ─── Clasificador (LLM) ────────────────────────────────────────────────────────
export const TEMAS = ["registro_sanitario", "via_abreviada_reliance", "modificaciones_registro", "prorroga", "moleculas_nuevas", "norma_guia_lineamiento", "formato_tramite", "bpm_previo_registro", "terceros_autorizados", "otro"] as const;

export interface Clasificacion {
  incluir: boolean; motivo: string; tema: string; titulo_breve: string; resumen: string;
  fecha_vigencia: string | null; accion: string | null; plazo_dias: number | null; prioridad: 1 | 2 | 3;
}

export const CRITERIOS = `ENTRA solo lo que toca medicamentos, vacunas, biológicos/biotecnológicos o dispositivos médicos en materia de: registro sanitario (nuevos, requisitos, vías de registro, reliance o vías abreviadas), modificaciones a las condiciones del registro, prórrogas, Comité de Moléculas Nuevas, y normas, guías, instructivos, lineamientos, circulares y formatos que afecten esos trámites (incluidos los requisitos previos al registro, como buenas prácticas de fabricación de fabricantes extranjeros, y los terceros autorizados que dictaminan para esos trámites).
NO ENTRA: convenios y convenios modificatorios de transferencia de recursos entre la Secretaría de Salud y los estados; avisos puramente administrativos (delegaciones de firma); inspecciones, clausuras, aseguramientos y alertas puntuales; normas de salud pública sin efecto en el registro (por ejemplo, normas de prevención o control de una enfermedad); alimentos, cosméticos y tabaco.
La exclusión no aplica si el documento sí toca un tema de la lista de inclusión.`;

export function promptClasificador(d: { organismo: Organismo; pais: string; dependencia: string | null; titulo: string; categoria?: string | null; fecha: string | null; texto: string | null }): string {
  return `Eres analista de asuntos regulatorios de una farmacéutica en ${d.pais === "EC" ? "Ecuador" : "México"}. Decide si este documento oficial cambia el trabajo del área de registro sanitario.

CRITERIOS
${CRITERIOS}

DOCUMENTO
Fuente: ${d.organismo}
Dependencia: ${d.dependencia ?? "—"}
Sección: ${d.categoria ?? "—"}
Fecha de publicación: ${d.fecha ?? "—"}
Título oficial: ${d.titulo}
${d.texto ? `Texto (puede venir recortado):\n"""\n${d.texto}\n"""` : "Texto: no disponible; decide solo con el título y la sección."}

Responde SOLO con un objeto JSON, sin texto alrededor:
{"incluir": true|false,
 "motivo": "una frase: por qué entra o por qué no, citando el criterio",
 "tema": uno de ${JSON.stringify(TEMAS)},
 "titulo_breve": "máximo 12 palabras, en español llano",
 "resumen": "1 o 2 líneas en español llano sobre qué implica para el área. No copies el título.",
 "fecha_vigencia": "AAAA-MM-DD si el texto la dice o se puede calcular (p. ej. 'al día siguiente de su publicación'), si no null",
 "accion": "qué debe hacer el área, en una frase, o null si no entra",
 "plazo_dias": número de días naturales para hacerlo o null,
 "prioridad": 1 (urgente: cambia requisitos o plazos vigentes), 2 (relevante) o 3 (informativo)}`;
}

export function parseClasificacion(raw: string): Clasificacion {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("el clasificador no devolvió JSON");
  const j = JSON.parse(m[0]);
  if (typeof j.incluir !== "boolean") throw new Error("JSON sin 'incluir'");
  const fv = typeof j.fecha_vigencia === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.fecha_vigencia) ? j.fecha_vigencia : null;
  const pr = [1, 2, 3].includes(j.prioridad) ? j.prioridad : 2;
  const breve = String(j.titulo_breve ?? "").split(/\s+/).slice(0, 14).join(" ");
  return {
    incluir: j.incluir, motivo: String(j.motivo ?? "").slice(0, 500), tema: TEMAS.includes(j.tema) ? j.tema : "otro",
    titulo_breve: breve, resumen: String(j.resumen ?? "").slice(0, 400), fecha_vigencia: fv,
    accion: j.accion ? String(j.accion).slice(0, 300) : null,
    plazo_dias: Number.isFinite(j.plazo_dias) && j.plazo_dias > 0 ? Math.min(365, Math.round(j.plazo_dias)) : null, prioridad: pr,
  };
}

/** El resumen nunca puede ser el título copiado. */
export function resumenValido(resumen: string, titulo: string): boolean {
  if (!resumen || resumen.length < 25) return false;
  return similitud(resumen, titulo) < 0.75 && !norm(titulo).startsWith(norm(resumen).slice(0, 60));
}

// ─── Avisos ────────────────────────────────────────────────────────────────────
export interface ItemAviso { titulo_breve: string | null; titulo_oficial: string; resumen: string | null; url: string | null; prioridad: number | null; organismo: Organismo; origen: string; accion: string | null; plazo: string | null; verificacion: string }

/** Solo se avisa si hay al menos un hallazgo NUEVO dentro de criterios. */
export function debeAvisar(nuevosIncluidos: ItemAviso[]): boolean { return nuevosIncluidos.length > 0; }

/**
 * Excepción: ninguna de las tres fuentes (DOF, COFEPRIS, ARCSA) se pudo leer
 * durante 3 corridas seguidas → un solo aviso. `corridas` va de la más
 * reciente a la más vieja; cada una dice qué organismos leyó y si ya avisó bloqueo.
 */
export function debeAvisarBloqueo(corridas: { organismosOk: number; aviso: string | null }[]): boolean {
  if (corridas.length < 3) return false;
  const ult = corridas.slice(0, 3);
  if (ult.some((c) => c.organismosOk > 0)) return false;
  // ¿ya se avisó en esta racha?
  for (const c of corridas) { if (c.organismosOk > 0) break; if (c.aviso === "bloqueo") return false; }
  return true;
}

export function ordenarParaAviso<T extends { prioridad: number | null; plazo: string | null }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (a.prioridad ?? 2) - (b.prioridad ?? 2) || (a.plazo ?? "9999").localeCompare(b.plazo ?? "9999"));
}

// ─── Alertas operativas (solo a Rafa) ──────────────────────────────────────────
/** Traduce la respuesta del servicio de desbloqueo (ZenRows) a una causa accionable. */
export function errorDesbloqueo(status: number, cuerpo: string): string {
  const c = norm(cuerpo.slice(0, 600));
  if (status === 402 || /credit|usage limit|quota|subscription|plan/.test(c)) return `ZenRows: créditos agotados o plan vencido (HTTP ${status}). Hay que recargar o contratar el plan.`;
  if (status === 401 || /api ?key|unauthori[sz]ed|invalid key/.test(c)) return `ZenRows: llave inválida o revocada (HTTP ${status}). Revisar el secreto GOBMX_FETCH_TEMPLATE en Supabase.`;
  if (status === 429 || /too many|rate limit|concurren/.test(c)) return `ZenRows: límite de peticiones (HTTP ${status}). Se reintenta en la siguiente corrida.`;
  if (status === 422 || /blocked|could not|failed to|antibot|captcha/.test(c)) return `ZenRows no logró pasar el filtro de gob.mx (HTTP ${status}). Si se repite, subir la página a mano mientras se ajusta.`;
  return `ZenRows respondió HTTP ${status}${cuerpo ? `: ${cuerpo.replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
}

export const FALLAS_PARA_AVISAR = 2;

export interface FuenteAlerta { clave: string; nombre: string; consecutive_failures: number; last_check_error: string | null; last_checked: string | null; alerta_enviada_en: string | null }

/**
 * Qué avisarle a Rafa al cerrar una corrida:
 *  - caídas: fuentes con 2+ fallas seguidas que aún no tienen aviso abierto.
 *  - recuperadas: fuentes con aviso abierto que ya leyeron bien.
 * Una fuente caída se avisa una sola vez hasta que se recupere.
 */
export function alertasOperativas(fuentes: FuenteAlerta[]): { caidas: FuenteAlerta[]; recuperadas: FuenteAlerta[] } {
  return {
    caidas: fuentes.filter((f) => f.consecutive_failures >= FALLAS_PARA_AVISAR && !f.alerta_enviada_en),
    recuperadas: fuentes.filter((f) => f.consecutive_failures === 0 && !!f.alerta_enviada_en),
  };
}

/**
 * Vigilante externo: la última corrida programada (lun-vie 21:15 CDMX) anterior a `ahora`.
 * Si no hay una corrida terminada desde entonces (con margen), el monitor no corrió.
 */
export function ultimaCorridaProgramada(ahora: Date): Date {
  // CDMX es UTC-6 fijo desde 2022: 21:15 CDMX = 03:15 UTC del día siguiente.
  const t = new Date(ahora.getTime());
  for (let i = 0; i < 8; i++) {
    const c = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - i, 3, 15));
    const diaCdmx = new Date(c.getTime() - 6 * 3600_000).getUTCDay(); // día de la semana en CDMX
    if (c <= ahora && diaCdmx >= 1 && diaCdmx <= 5) return c;
  }
  throw new Error("sin corrida programada en 8 días");
}
