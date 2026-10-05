// Pruebas de aceptación del monitor normativo (punto 8 de la especificación).
// Corren contra instantáneas guardadas en ./fixtures, nunca contra el estado en vivo:
//   deno test -A supabase/functions/regintel-normativo/test/
// Las decisiones del clasificador vienen de respuestas reales de Claude grabadas
// en fixtures/clasificador_grabado.json (ver el campo _origen de ese JSON).

import { assert, assertEquals, assertFalse, assertMatch } from "jsr:@std/assert@1";
import * as L from "../logic.ts";

const F = (n: string) => Deno.readTextFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const grabado: Record<string, L.Clasificacion> = (() => {
  try { return JSON.parse(F("clasificador_grabado.json")); } catch { return {}; }
})();

/** Prefiltro determinista + clasificador grabado = decisión final del monitor. */
function decision(n: L.NotaDof): { incluir: boolean; etapa: "prefiltro" | "clasificador"; motivo: string } {
  const p = L.prefiltroDof(n);
  if (!p.pasa) return { incluir: false, etapa: "prefiltro", motivo: p.motivo! };
  const c = grabado[n.codigo];
  if (!c) throw new Error(`Falta la respuesta grabada del clasificador para ${n.codigo}. Regrábala desde una corrida de prueba (ver _origen en el JSON)`);
  return { incluir: c.incluir, etapa: "clasificador", motivo: c.motivo };
}
const nota = (archivo: string, fecha: string, codigo: string) => {
  const r = L.parseIndiceDof(F(archivo), fecha, "MAT");
  assertEquals(r.estado, "ok");
  const n = r.notas.find((x) => x.codigo === codigo);
  assert(n, `la nota ${codigo} debe estar en el índice ${archivo}`);
  return n!;
};

// ── DOF ───────────────────────────────────────────────────────────────────────
Deno.test("DOF 02/09/2026: 5797710 (vía abreviada ANVISA) entra en criterios", () => {
  const n = nota("dof_20260902_MAT.html", "2026-09-02", "5797710");
  assertEquals(n.dependencia, "SECRETARIA DE SALUD");
  assertMatch(n.titulo, /v[ií]a regulatoria abreviada/i);
  assertEquals(n.url, "https://dof.gob.mx/nota_detalle.php?codigo=5797710&fecha=02/09/2026");
  const d = decision(n);
  assert(d.incluir, d.motivo);
  assertEquals(d.etapa, "clasificador");
});

Deno.test("DOF 02/09/2026: 5797711 (lineamientos de Terceros Autorizados) entra en criterios", () => {
  const n = nota("dof_20260902_MAT.html", "2026-09-02", "5797711");
  const d = decision(n);
  assert(d.incluir, d.motivo);
});

Deno.test("DOF 01/10/2026: 5800053 (PROY-NOM-027-SSA-2026, lepra) queda descartada con motivo", () => {
  const n = nota("dof_20261001_MAT.html", "2026-10-01", "5800053");
  assertMatch(n.titulo, /PROY-NOM-027-SSA-2026/);
  const d = decision(n);
  assertFalse(d.incluir);
  assert(d.motivo.length > 15, "el descarte guarda su motivo");
});

Deno.test("DOF 29/09/2026: 5799786 (convenio modificatorio Salud–CDMX) queda descartada con motivo", () => {
  const n = nota("dof_20260929_MAT.html", "2026-09-29", "5799786");
  const d = decision(n);
  assertFalse(d.incluir);
  assertEquals(d.etapa, "prefiltro");
  assertMatch(d.motivo, /transferencia de recursos/i);
});

Deno.test("DOF: 'No hay datos' y una edición extraordinaria inexistente son normales, no error", () => {
  assertEquals(L.parseIndiceDof(F("dof_20260902_VES.html"), "2026-09-02", "VES").estado, "sin_datos");
  assertEquals(L.parseIndiceDof("", "2026-09-02", "EXT", 302, "https://dof.gob.mx/Error.php").estado, "sin_datos");
  assertEquals(L.parseIndiceDof("", "2026-09-02", "MAT", 302, "https://dof.gob.mx/Error.php").estado, "error");
});

Deno.test("DOF: el cuerpo de la nota se lee completo y la dependencia sale del encabezado de sección", () => {
  const t = L.textoNota(F("nota_5797710.html"));
  assert(t && t.length > 2000);
  assertMatch(t!, /Agencia Nacional de Vigilancia Sanitaria/);
  const deps = new Set(L.parseIndiceDof(F("dof_20260902_MAT.html"), "2026-09-02", "MAT").notas.map((n) => n.dependencia));
  assert(deps.has("SECRETARIA DE HACIENDA Y CREDITO PUBLICO") && deps.has("SECRETARIA DE SALUD"));
});

Deno.test("DOF: ventana móvil de hoy + 3 días; recupera días fallidos; primera corrida = 30 días", () => {
  assertEquals(L.ventanaDof("2026-10-02", false), ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  assert(L.ventanaDof("2026-10-02", false, ["2026-09-24"]).includes("2026-09-24"));
  assertEquals(L.ventanaDof("2026-10-02", true).length, 31);
  // Lunes 21:15 CDMX revisa viernes a lunes: cubre lo que salga en sábado.
  assertEquals(L.ventanaDof("2026-10-05", false)[0], "2026-10-02");
  assertEquals(L.hoyCdmx(new Date("2026-10-02T03:30:00Z")), "2026-10-01"); // 21:30 CDMX
});

// ── COFEPRIS ──────────────────────────────────────────────────────────────────
Deno.test("Formatos Vigentes: el ID nuevo 1103837 (FF-COFEPRIS-01 v2.0) es novedad y el resto no", () => {
  const a = L.parseAdjuntosGobmx(F("cofepris_formatos_A.html"));
  const b = L.parseAdjuntosGobmx(F("cofepris_formatos_B.html"));
  assert(a.ok && b.ok);
  const prev = a.datos.map((d) => ({ ...d, estado: "linea_base" }));
  const diff = L.diffInventario(prev, b.datos);
  assertEquals(diff.nuevos.map((n) => n.id), ["1103837"]);
  assertMatch(diff.nuevos[0].titulo, /FF-COFEPRIS-01/);
  assertEquals(diff.nuevos[0].url, "https://www.gob.mx/cms/uploads/attachment/file/1103837/FF-COFEPRIS-01_v2.0_18SEP2026.docx");
});

Deno.test("Portada de COFEPRIS con marcadores de 2018 → no verificada y sin hallazgos", () => {
  const r = L.parsePortadaCofepris(F("cofepris_portada_2018.html"), "2026-10-01");
  assertFalse(r.ok);
  assertEquals(r.verificacion, "no_verificada");
  assertEquals(r.datos.length, 0);
  const actual = L.parsePortadaCofepris(F("cofepris_portada_actual.html"), "2026-10-01");
  assert(actual.ok);
  assertEquals(actual.datos.length, 1, "solo comunicados con fecha verificable; la galería no cuenta");
  // Portada vieja sin marcadores, pero con lo más reciente > 30 días: tampoco se verifica.
  assertFalse(L.parsePortadaCofepris(F("cofepris_portada_actual.html"), "2026-11-15").ok);
});

Deno.test("Un 403 o el desafío anti-bot de gob.mx no actualiza lastChecked, sube consecutiveFailures y no es 'sin novedades'", () => {
  const antes: L.EstadoFuente = { last_checked: "2026-09-28T03:15:00Z", last_check_attempt: "2026-09-28T03:15:00Z", last_check_error: null, consecutive_failures: 0, verificacion: "verificada" };
  const lectura = L.parseAdjuntosGobmx(F("gobmx_desafio.html"));
  assertFalse(lectura.ok);
  const despues = L.aplicarLectura(antes, lectura.ok, "2026-10-01T03:15:00Z", lectura.error);
  assertEquals(despues.last_checked, antes.last_checked);
  assertEquals(despues.consecutive_failures, 1);
  assertEquals(despues.last_check_attempt, "2026-10-01T03:15:00Z");
  assertMatch(despues.last_check_error!, /anti-bot/);
  assertEquals(L.parseIndiceDof("Forbidden", "2026-10-01", "MAT", 403).estado, "error");
  // Sin lectura no hay diff: el inventario ni siquiera se compara.
  const otra = L.aplicarLectura(despues, false, "2026-10-02T03:15:00Z", "HTTP 403");
  assertEquals(otra.consecutive_failures, 2);
  // Punto ciego: última lectura buena de hace más de 7 días.
  assert(L.esPuntoCiego(antes.last_checked, new Date("2026-10-06T00:00:00Z")));
  assertFalse(L.esPuntoCiego(antes.last_checked, new Date("2026-10-01T00:00:00Z")));
});

// ── ARCSA ─────────────────────────────────────────────────────────────────────
Deno.test("ARCSA: 14955 → 16057 en la misma categoría con título parecido es REEMPLAZO, no baja + alta", () => {
  const a = L.parseArcsaDocumentos(F("arcsa_docs_A.html"));
  const b = L.parseArcsaDocumentos(F("arcsa_docs_B.html"));
  assert(a.ok && b.ok);
  const diff = L.diffInventario(a.datos.map((d) => ({ ...d, estado: "linea_base" })), b.datos);
  assertEquals(diff.reemplazos, [{ de: "14955", a: "16057" }]);
  assertEquals(diff.desaparecidos, [], "14955 no cuenta como baja");
  assertEquals(diff.nuevos.map((n) => n.id), ["16057"]);
});

Deno.test("ARCSA: 16080 (IE-B.3.4.2-LF-02, BPM de laboratorios extranjeros) se lee aunque esté en sección colapsada", () => {
  const b = L.parseArcsaDocumentos(F("arcsa_docs_B.html"));
  const d = b.datos.find((x) => x.id === "16080");
  assert(d, "16080 debe estar en el inventario");
  assertMatch(d!.titulo, /IE-B\.3\.4\.2-LF-02/);
  assertEquals(d!.categoria, "Buenas Prácticas para Establecimientos Farmacéuticos");
  assert(new Set(b.datos.map((x) => x.categoria)).has("Productos Biológicos"), "las secciones colapsadas también se leen");
  assert(b.datos.length > 300);
});

Deno.test("ARCSA: una sección que no cargó no produce bajas", () => {
  const a = L.parseArcsaDocumentos(F("arcsa_docs_A.html")).datos;
  const sinBiologicos = a.filter((d) => d.categoria !== "Productos Biológicos");
  const diff = L.diffInventario(a.map((d) => ({ ...d, estado: "linea_base" })), sinBiologicos);
  assertEquals(diff.desaparecidos, []);
  // Y si se cae medio inventario, la lectura entera se rechaza.
  assert(L.diffInventario(a.map((d) => ({ ...d, estado: "linea_base" })), a.slice(0, 50)).sospechosa);
});

// ── Arranque y avisos ─────────────────────────────────────────────────────────
Deno.test("Primera corrida sin inventario previo: línea base, sin novedades y sin aviso", () => {
  for (const archivo of ["arcsa_docs_B.html", "cofepris_formatos_B.html"]) {
    const docs = archivo.startsWith("arcsa") ? L.parseArcsaDocumentos(F(archivo)).datos : L.parseAdjuntosGobmx(F(archivo)).datos;
    const diff = L.diffInventario(null, docs);
    assert(diff.lineaBase);
    assertEquals(diff.nuevos.length, 0);
  }
  assertFalse(L.debeAvisar([]));
});

Deno.test("Avisos: solo con hallazgos nuevos; bloqueo solo tras 3 corridas sin leer ninguna fuente, una vez", () => {
  assertFalse(L.debeAvisarBloqueo([{ organismosOk: 0, aviso: null }, { organismosOk: 0, aviso: null }]));
  assert(L.debeAvisarBloqueo([{ organismosOk: 0, aviso: null }, { organismosOk: 0, aviso: null }, { organismosOk: 0, aviso: null }, { organismosOk: 2, aviso: null }]));
  assertFalse(L.debeAvisarBloqueo([{ organismosOk: 0, aviso: null }, { organismosOk: 0, aviso: "bloqueo" }, { organismosOk: 0, aviso: null }, { organismosOk: 0, aviso: null }]));
  assertFalse(L.debeAvisarBloqueo([{ organismosOk: 1, aviso: null }, { organismosOk: 0, aviso: null }, { organismosOk: 0, aviso: null }]));
  const orden = L.ordenarParaAviso([{ prioridad: 3, plazo: null }, { prioridad: 1, plazo: "2026-10-30" }, { prioridad: 1, plazo: "2026-10-10" }]);
  assertEquals(orden[0].plazo, "2026-10-10");
});

Deno.test("Clasificador: el resumen nunca es el título copiado y el JSON se valida", () => {
  const t = "Acuerdo por el que se emiten los Lineamientos para las Solicitudes de Autorización de Tercero, sus modificaciones y prórroga de su vigencia.";
  assertFalse(L.resumenValido(t, t));
  assert(L.resumenValido("Cambian los requisitos para que un tercero autorizado dictamine trámites ante COFEPRIS; revisar contratos vigentes.", t));
  const c = L.parseClasificacion('```json\n{"incluir": true, "motivo": "x", "tema": "inventado", "titulo_breve": "a b", "resumen": "r", "fecha_vigencia": "mañana", "accion": null, "plazo_dias": 30, "prioridad": 7}\n```');
  assertEquals(c.tema, "otro");
  assertEquals(c.fecha_vigencia, null);
  assertEquals(c.prioridad, 2);
  for (const [cod, g] of Object.entries(grabado).filter(([k]) => !k.startsWith("_"))) assert(g.incluir ? g.titulo_breve.split(" ").length <= 14 : true, cod);
});

// ── A prueba de fallas ────────────────────────────────────────────────────────
Deno.test("Errores de ZenRows salen con causa accionable", () => {
  assertMatch(L.errorDesbloqueo(402, '{"title":"Usage limit reached"}'), /créditos agotados/);
  assertMatch(L.errorDesbloqueo(401, '{"title":"API key is not valid"}'), /llave inválida/);
  assertMatch(L.errorDesbloqueo(429, "Too Many Requests"), /límite de peticiones/);
  assertMatch(L.errorDesbloqueo(422, '{"title":"Could not get content. Request blocked"}'), /no logró pasar el filtro/);
});

Deno.test("Aviso a Rafa: tras 2 fallas seguidas, una sola vez, y otro al recuperarse", () => {
  const base = { nombre: "x", last_check_error: "e", last_checked: null };
  const r = L.alertasOperativas([
    { ...base, clave: "una_falla", consecutive_failures: 1, alerta_enviada_en: null },
    { ...base, clave: "caida", consecutive_failures: 2, alerta_enviada_en: null },
    { ...base, clave: "ya_avisada", consecutive_failures: 5, alerta_enviada_en: "2026-10-01T03:20:00Z" },
    { ...base, clave: "recuperada", consecutive_failures: 0, alerta_enviada_en: "2026-10-01T03:20:00Z" },
    { ...base, clave: "sana", consecutive_failures: 0, alerta_enviada_en: null },
  ]);
  assertEquals(r.caidas.map((f) => f.clave), ["caida"]);
  assertEquals(r.recuperadas.map((f) => f.clave), ["recuperada"]);
});

Deno.test("Vigilante: la última corrida programada respeta lun-vie 21:15 CDMX", () => {
  // Martes 6-oct 09:00 CDMX → lunes 5-oct 21:15 CDMX (06-oct 03:15 UTC)
  assertEquals(L.ultimaCorridaProgramada(new Date("2026-10-06T15:00:00Z")).toISOString(), "2026-10-06T03:15:00.000Z");
  // Lunes 5-oct 09:00 CDMX → viernes 2-oct 21:15 CDMX (03-oct 03:15 UTC), no el fin de semana
  assertEquals(L.ultimaCorridaProgramada(new Date("2026-10-05T15:00:00Z")).toISOString(), "2026-10-03T03:15:00.000Z");
});

Deno.test("ARCSA: un documento que se cae un día y su versión nueva que sube al siguiente cuentan como REEMPLAZO", () => {
  const prev = [
    { id: "14441", titulo: "IE-B.3.4.2-LF-01_BPM Lab. Farma. V5.0", categoria: "BPM", subcategoria: "Instructivos", estado: "desaparecido" },
    { id: "9000", titulo: "Otro instructivo", categoria: "BPM", subcategoria: "Instructivos", estado: "linea_base" },
  ];
  const actual = [
    { id: "9000", titulo: "Otro instructivo", url: "", categoria: "BPM", subcategoria: "Instructivos" },
    { id: "16102", titulo: "IE-B.3.4.2-LF-01 Certificación de BPM Laboratorios Farmacéuticos Nacionales", url: "", categoria: "BPM", subcategoria: "Instructivos" },
  ];
  assertEquals(L.diffInventario(prev, actual).reemplazos, [{ de: "14441", a: "16102" }]);
});

Deno.test("Línea base: lo publicado en los últimos 30 días se revisa igual (caso 16080, subido 3 h antes de la línea base)", () => {
  const b = L.parseArcsaDocumentos(F("arcsa_docs_B.html")).datos;
  const top = L.candidatosRetro(b, 40);
  assert(top.includes("16080"), "16080 está entre los IDs más recientes");
  assertEquals(top.length, 40);
  assert(L.dentroDeVentana("2026-10-01T16:54:20Z", "2026-10-01"));
  assert(L.dentroDeVentana("2026-09-25T22:10:07Z", "2026-10-01"));
  assertFalse(L.dentroDeVentana("2026-07-01T00:00:00Z", "2026-10-01"));
});

Deno.test("retro: mes de carga desde la ruta de WordPress", () => {
  assertEquals(L.mesDeRuta("https://www.controlsanitario.gob.ec/wp-content/uploads/downloads/2026/10/IE-B.3.4.2-LF-02.pdf"), "2026-10-01T12:00:00.000Z");
  assertEquals(L.mesDeRuta("https://x/download.php?id=1"), null);
});
