// Parser de los listados PDF de COFEPRIS (Alopáticos, Revocados, Cancelados).
//
// Los PDFs son tablas con celdas centradas vertical y horizontalmente, así que
// el texto plano pierde las columnas. Aquí se usan las posiciones de pdf.js:
//   1. Las columnas salen de los centros X de los encabezados de cada página.
//   2. Cada renglón lo ancla el folio (columna 0). Su Y es el centro del renglón.
//   3. Las líneas de cada columna se reparten entre renglones en bloques
//      contiguos, minimizando la distancia del centro del bloque al centro del
//      renglón (programación dinámica). Así una celda de 4 líneas no se "roba"
//      líneas del renglón vecino.

export type Tipo = "autorizado" | "revocado" | "cancelado";

export interface Registro {
  folio: string;
  titular: string | null;
  denominacion_distintiva: string | null;
  denominacion_generica: string | null;
  clasificacion: string | null;
  forma_farmaceutica: string | null;
  vigencia: string | null; // YYYY-MM-DD
  motivo: string | null;
  raw: string;
}

export interface ResultadoParseo {
  registros: Registro[];
  declarados: number | null;
  declaradoEsIncremento: boolean;
  fechaActualizacion: string | null; // YYYY-MM-DD
  paginas: number;
  avisos: string[];
}

interface Item { x: number; y: number; w: number; s: string }

const FOLIO_RE = /^(\d{1,6}[A-Z]{1,2}\/?\d{2,6}|\d{5,6})(\s*SSA(\s*[IVX]+)?)?$/;
const HEADER_RE = /^(registro|sanitario|ssa|titular|o representante legal|representante|legal|denominaci[oó]n|distintiva|gen[eé]rica|clasificaci[oó]n|art[ií]culo|226|lgs|forma|farmac[eé]utica|vigencia|motivo|sanitario \/ ssa|registro sanitario|titular o representante legal|clasificación artículo 226 lgs)/i;
const FOOTER_RE = /(fecha de actualizaci[oó]n|comisi[oó]n de autorizaci[oó]n|registros sanitarios de medicamentos|el contenido de esta secci[oó]n|debido a que se encuentra|comentarios:|^\d+ de \d+$|^p[aá]gina \d+ de \d+)/i;

const MESES: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", sept: "09", oct: "10", nov: "11", dic: "12",
};

export function parseVigencia(s: string | null): string | null {
  if (!s) return null;
  const m = s.trim().toLowerCase().match(/^(\d{1,2})[-/ ]([a-z]{3,4})[-/ ](\d{4})$/);
  if (m && MESES[m[2]]) return `${m[3]}-${MESES[m[2]]}-${m[1].padStart(2, "0")}`;
  const n = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (n) return `${n[3]}-${n[2].padStart(2, "0")}-${n[1].padStart(2, "0")}`;
  return null;
}

const limpia = (s: string) => s.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").replace(/\s*\/\s*/g, " / ").trim();

/** Agrupa centros de encabezado en columnas (encabezados de varias líneas). */
function columnasDesdeEncabezado(header: Item[]): number[] {
  const centros = header.map((h) => h.x + h.w / 2).sort((a, b) => a - b);
  const grupos: number[][] = [];
  for (const c of centros) {
    const g = grupos[grupos.length - 1];
    if (g && c - g[g.length - 1] < 28) g.push(c);
    else grupos.push([c]);
  }
  return grupos.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

/** Reparte líneas (ordenadas de arriba a abajo) en bloques contiguos por renglón. */
function repartir(lineas: Item[], centros: number[]): Item[][] {
  const n = lineas.length, m = centros.length;
  const out: Item[][] = centros.map(() => []);
  if (!n || !m) return out;
  // Agrupar primero items en la misma línea visual (misma Y ±2).
  const INF = 1e12;
  // dp[i][j]: costo mínimo usando las primeras i líneas en los primeros j renglones.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  const prev: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(-1));
  dp[0][0] = 0;
  const pref = [0];
  for (const l of lineas) pref.push(pref[pref.length - 1] + l.y);
  const VACIO = 40; // castigo por celda vacía
  for (let j = 1; j <= m; j++) {
    for (let i = 0; i <= n; i++) {
      // celda vacía
      if (dp[i][j - 1] + VACIO < dp[i][j]) { dp[i][j] = dp[i][j - 1] + VACIO; prev[i][j] = i; }
      for (let k = 0; k < i; k++) {
        if (dp[k][j - 1] >= INF) continue;
        const media = (pref[i] - pref[k]) / (i - k);
        // Las líneas de un bloque no pueden estar separadas por más de ~1.6 líneas.
        let ok = true;
        for (let t = k + 1; t < i; t++) if (lineas[t - 1].y - lineas[t].y > 26) { ok = false; break; }
        if (!ok) continue;
        const c = dp[k][j - 1] + Math.abs(media - centros[j - 1]) * 2;
        if (c < dp[i][j]) { dp[i][j] = c; prev[i][j] = k; }
      }
    }
  }
  let i = n;
  for (let j = m; j >= 1; j--) {
    const k = prev[i][j];
    out[j - 1] = lineas.slice(k, i);
    i = k;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export async function parsePdf(pdf: any, tipo: Tipo): Promise<ResultadoParseo> {
  const registros: Registro[] = [];
  const avisos: string[] = [];
  let declarados: number | null = null;
  let declaradoEsIncremento = false;
  let fechaActualizacion: string | null = null;
  let columnasPrevias: number[] | null = null;
  const conVigencia = tipo === "autorizado";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const it of tc.items) {
      const s = String(it.str ?? "").trim();
      if (!s) continue;
      items.push({ x: it.transform[4], y: it.transform[5], w: it.width ?? 0, s });
    }
    const textoPagina = items.map((i) => i.s).join(" ");
    const mDecl = textoPagina.match(/Se publican\s+(\d+)\s+registros?(\s+m[aá]s)?/i);
    if (mDecl) { declarados = parseInt(mDecl[1], 10); declaradoEsIncremento = !!mDecl[2]; }
    const mFecha = textoPagina.match(/Fecha de actualizaci[oó]n:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (mFecha) fechaActualizacion = parseVigencia(mFecha[1]);

    const folios = items.filter((i) => FOLIO_RE.test(i.s) && i.x < 90);
    if (!folios.length) continue;
    const yPrimerFolio = Math.max(...folios.map((f) => f.y));

    const header = items.filter((i) => i.y > yPrimerFolio && HEADER_RE.test(i.s) && !FOOTER_RE.test(i.s));
    let cols: number[] | null = header.length >= 5 ? columnasDesdeEncabezado(header) : columnasPrevias;
    if (!cols) { avisos.push(`Página ${p}: sin encabezado reconocible`); continue; }
    const esperadas = 7;
    if (cols.length !== esperadas) {
      avisos.push(`Página ${p}: ${cols.length} columnas en el encabezado (se esperaban ${esperadas})`);
      if (columnasPrevias && columnasPrevias.length === esperadas) cols = columnasPrevias;
      else continue;
    }
    columnasPrevias = cols;
    const cs: number[] = cols;
    const limites = cs.slice(0, -1).map((c: number, i: number) => (c + cs[i + 1]) / 2);
    const colDe = (it: Item) => {
      const cx = it.x + it.w / 2;
      let k = 0;
      while (k < limites.length && cx > limites[k]) k++;
      return k;
    };

    const yHeaderMin = header.length ? Math.min(...header.map((h) => h.y)) : Infinity;
    const yUltimoFolio = Math.min(...folios.map((f) => f.y));
    const contenido = items.filter((i) =>
      i.y < yHeaderMin - 2 && i.y > yUltimoFolio - 90 && !FOOTER_RE.test(i.s) && !(FOLIO_RE.test(i.s) && i.x < 90)
    );

    const filas = folios.slice().sort((a, b) => b.y - a.y);
    const centros = filas.map((f) => f.y);
    const porCol: Item[][] = cols.map(() => []);
    for (const it of contenido) {
      const c = colDe(it);
      if (c === 0) continue; // basura en la columna del folio
      porCol[c].push(it);
    }
    const celdas: string[][] = filas.map(() => cols!.map(() => ""));
    for (let c = 1; c < cols.length; c++) {
      // Juntar fragmentos que están en la misma línea visual.
      const ordenados = porCol[c].sort((a, b) => b.y - a.y || a.x - b.x);
      const lineas: Item[] = [];
      for (const it of ordenados) {
        const l = lineas[lineas.length - 1];
        if (l && Math.abs(l.y - it.y) < 2.5) { l.s += " " + it.s; }
        else lineas.push({ ...it });
      }
      const bloques = repartir(lineas, centros);
      bloques.forEach((b, r) => { celdas[r][c] = limpia(b.map((l) => l.s).join(" ")); });
    }

    filas.forEach((f, r) => {
      const c = celdas[r];
      const ultima = c[6] || null;
      registros.push({
        folio: f.s.replace(/\s+/g, " ").trim(),
        titular: c[1] || null,
        denominacion_distintiva: c[2] || null,
        denominacion_generica: c[3] || null,
        clasificacion: c[4] || null,
        forma_farmaceutica: c[5] || null,
        vigencia: conVigencia ? parseVigencia(ultima) : null,
        motivo: conVigencia ? null : ultima,
        raw: [f.s, ...c.slice(1)].join(" | "),
      });
      if (conVigencia && ultima && !parseVigencia(ultima)) avisos.push(`${f.s}: vigencia no reconocida "${ultima}"`);
    });
  }

  return { registros, declarados, declaradoEsIncremento, fechaActualizacion, paginas: pdf.numPages, avisos };
}
