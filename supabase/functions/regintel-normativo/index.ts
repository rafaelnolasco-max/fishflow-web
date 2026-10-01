// Supabase Edge Function — regintel-normativo
// Monitor normativo de /app/regintel: DOF, COFEPRIS y ARCSA.
//
// Lo dispara pg_cron de lunes a viernes a las 21:15 CDMX (job
// `regintel-normativo-diario`) y el botón "Revisar ahora" del panel.
// Trabaja por fases encadenadas (límite de CPU de Edge Functions):
//   inicio      → abre una corrida
//   leer i      → lee UNA fuente (la i-ésima), actualiza su salud e inventario
//                 y deja candidatos en regintel_norm_items como `por_clasificar`
//   clasificar  → lee el documento completo y clasifica 2 candidatos con Claude
//   cerrar      → avisa (solo si hay hallazgos nuevos dentro de criterios, o el
//                 bloqueo de 3 corridas) y cierra la corrida
// Fases sueltas: `subir` (página guardada a mano de una fuente bloqueada) y
// `clasificar_prueba` (clasifica un texto sin escribir nada; para las pruebas).
//
// Auth: verify_jwt = false + cabecera x-regintel-token (mismo secreto del
// Vault que regintel-scan, RPC regintel_scan_token(), solo service_role).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getDocumentProxy } from "npm:unpdf@1.6.2";
import * as L from "./logic.ts";

const CLIENT_ID = "c2b2a692-7f39-42a1-841a-5ae31e21e851";
const AVISO_RAFA = "raf@fishflow.mx";
const FROM = "FishFlow · Monitor normativo <noreply@fishflow.mx>";
const PANEL_URL = "https://fishflow.mx/app/regintel";
const MODELO = "claude-sonnet-4-6";
const ORDEN = ["dof", "cofepris_portada", "cofepris_docs_med", "cofepris_formatos", "arcsa_docs", "arcsa_noticias"];

const UA = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9",
};

type Fuente = {
  id: string; clave: string; pais: string; organismo: L.Organismo; nombre: string; url: string; tipo: string;
  last_checked: string | null; last_check_attempt: string | null; last_check_error: string | null;
  consecutive_failures: number; verificacion: "sin_leer" | "verificada" | "no_verificada"; linea_base_en: string | null;
  alerta_enviada_en: string | null;
};
type Resultado = { ok: boolean; error?: string; candidatos: number; descartados: number; lineaBase?: number; nuevos?: number; reemplazos?: number; bajas?: number };

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

// ─── Red ───────────────────────────────────────────────────────────────────────
/** gob.mx bloquea servidores con un desafío anti-bot. Si hay un servicio de desbloqueo
 *  configurado (GOBMX_FETCH_TEMPLATE con {url}), se usa; si no, fetch directo. */
async function traerHtml(url: string): Promise<{ status: number; html: string; redirect: string | null; error?: string }> {
  const plantilla = Deno.env.get("GOBMX_FETCH_TEMPLATE");
  const viaProxy = plantilla && /(^|\.)gob\.mx\//.test(new URL(url).host + "/") && !/dof\.gob\.mx|sidof\.segob/.test(url);
  const destino = viaProxy ? plantilla!.replace("{url}", encodeURIComponent(url)) : url;
  let r: Response;
  try {
    r = await fetch(destino, { headers: viaProxy ? {} : UA, redirect: "manual", signal: AbortSignal.timeout(viaProxy ? 120_000 : 40_000) });
  } catch (e) {
    const msg = String(e).slice(0, 160);
    return { status: 0, html: "", redirect: null, error: viaProxy ? `ZenRows no respondió a tiempo (${msg})` : `sin respuesta (${msg})` };
  }
  const html = r.status >= 300 && r.status < 400 ? "" : await r.text();
  // Si el servicio de desbloqueo falla, se nombra la causa (créditos, llave, límite, filtro).
  const error = r.status === 200 ? undefined : viaProxy ? L.errorDesbloqueo(r.status, html) : `HTTP ${r.status}`;
  return { status: r.status, html, redirect: r.headers.get("location"), error };
}

async function textoDePdf(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(40_000) });
    if (!r.ok) { await r.body?.cancel(); return null; }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (new TextDecoder().decode(buf.slice(0, 5)) !== "%PDF-") return null;
    const pdf = await getDocumentProxy(buf);
    const partes: string[] = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 25); p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      partes.push(tc.items.map((i) => ("str" in i ? i.str : "")).join(" "));
    }
    const t = partes.join("\n").replace(/\s+/g, " ").trim();
    return t.length > 300 ? t : null;
  } catch { return null; }
}

async function textoDof(codigo: string, fecha: string | null): Promise<{ texto: string | null; url: string }> {
  if (fecha) {
    try {
      const r = await traerHtml(L.urlNotaDof(codigo, fecha));
      const t = r.status === 200 ? L.textoNota(r.html) : null;
      if (t) return { texto: t, url: L.urlNotaDof(codigo, fecha) };
    } catch { /* se intenta SIDOF */ }
  }
  try {
    const r = await traerHtml(L.urlSidof(codigo));
    const t = r.status === 200 ? L.textoNota(r.html) : null;
    if (t) return { texto: t, url: L.urlSidof(codigo) };
  } catch { /* sin texto */ }
  return { texto: null, url: fecha ? L.urlNotaDof(codigo, fecha) : L.urlSidof(codigo) };
}

// ─── Base de datos ─────────────────────────────────────────────────────────────
async function todas<T>(q: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await q().range(desde, desde + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function guardarSalud(sb: SupabaseClient, f: Fuente, ok: boolean, ahora: string, error?: string, verif?: "verificada" | "no_verificada", extra: Record<string, unknown> = {}) {
  const e = L.aplicarLectura(f, ok, ahora, error, verif);
  await sb.from("regintel_norm_fuentes").update({ ...e, ...extra }).eq("id", f.id);
  // Respaldo: una fuente de gob.mx que lleva 2 fallas seguidas abre la tarea manual en Consultas.
  if (!ok && f.organismo === "COFEPRIS" && e.consecutive_failures >= L.FALLAS_PARA_AVISAR) {
    await encolarConsulta(sb, f, `${f.nombre}: ${error ?? "no se pudo leer"} (${e.consecutive_failures} fallas seguidas)`);
  }
  return e;
}

/** Bloqueo que una persona puede resolver (anti-bot, CAPTCHA) → cola de Consultas, sin duplicar. */
async function encolarConsulta(sb: SupabaseClient, f: Fuente, motivo: string) {
  const { data } = await sb.from("regintel_consultas_manuales").select("id")
    .eq("client_id", CLIENT_ID).eq("origen", "normativo").eq("url", f.url).eq("estado", "pendiente").limit(1);
  if (data?.length) return;
  await sb.from("regintel_consultas_manuales").insert({
    client_id: CLIENT_ID, origen: "normativo", url: f.url, molecula: f.nombre, estado: "pendiente",
    motivo: `${motivo}. Abre la página en tu navegador, guárdala (Cmd+S, "Página web, solo HTML") y súbela en Fuentes → Monitor normativo.`,
  });
}

async function insertarItems(sb: SupabaseClient, filas: Record<string, unknown>[]) {
  for (let i = 0; i < filas.length; i += 200) {
    const { error } = await sb.from("regintel_norm_items").upsert(filas.slice(i, i + 200), { onConflict: "client_id,organismo,doc_ref", ignoreDuplicates: true });
    if (error) throw new Error("guardar candidatos: " + error.message);
  }
}

// ─── Lectores por tipo de fuente ───────────────────────────────────────────────
async function leerDof(sb: SupabaseClient, f: Fuente, corrida: string, ahora: string): Promise<Resultado> {
  const hoy = L.hoyCdmx(new Date(ahora));
  const { count } = await sb.from("regintel_norm_dias").select("fecha", { count: "exact", head: true }).eq("client_id", CLIENT_ID).eq("estado", "ok");
  const primera = !count;
  const { data: fallidos } = await sb.from("regintel_norm_dias").select("fecha").eq("client_id", CLIENT_ID).eq("estado", "error");
  const fechas = L.ventanaDof(hoy, primera, (fallidos ?? []).map((x) => x.fecha));

  const notas: L.NotaDof[] = [];
  const errores: string[] = [];
  let lecturas = 0;
  for (const fecha of fechas) {
    for (const ed of ["MAT", "VES", "EXT"] as L.Edicion[]) {
      let r: ReturnType<typeof L.parseIndiceDof>;
      try {
        const h = await traerHtml(L.urlIndiceDof(fecha, ed));
        r = h.status === 0 ? { estado: "error", notas: [], error: h.error } : L.parseIndiceDof(h.html, fecha, ed, h.status, h.redirect);
      } catch (e) { r = { estado: "error", notas: [], error: String(e).slice(0, 160) }; }
      if (r.estado === "error") errores.push(`${fecha} ${ed}: ${r.error}`); else lecturas++;
      notas.push(...r.notas);
      await sb.from("regintel_norm_dias").upsert({ client_id: CLIENT_ID, fecha, edicion: ed, estado: r.estado, notas: r.notas.length, error: r.error ?? null, revisado_en: ahora }, { onConflict: "client_id,fecha,edicion" });
    }
  }
  if (!lecturas) {
    await guardarSalud(sb, f, false, ahora, `No se pudo leer ningún índice: ${errores.slice(0, 2).join("; ")}`);
    return { ok: false, error: errores[0], candidatos: 0, descartados: 0 };
  }

  const codigos = notas.map((n) => n.codigo);
  const existentes = new Set<string>();
  for (let i = 0; i < codigos.length; i += 300) {
    const { data } = await sb.from("regintel_norm_items").select("doc_ref").eq("client_id", CLIENT_ID).eq("organismo", "DOF").in("doc_ref", codigos.slice(i, i + 300));
    for (const d of data ?? []) existentes.add(d.doc_ref);
  }
  const filas: Record<string, unknown>[] = [];
  let cand = 0, desc = 0;
  for (const n of notas) {
    if (existentes.has(n.codigo)) continue;
    existentes.add(n.codigo);
    const p = L.prefiltroDof(n);
    if (p.pasa) cand++; else desc++;
    filas.push({
      client_id: CLIENT_ID, fuente_id: f.id, corrida_id: corrida, organismo: "DOF", doc_ref: n.codigo,
      titulo_oficial: n.titulo, fecha_publicacion: n.fecha, url: n.url, dependencia: n.dependencia,
      decision: p.pasa ? "por_clasificar" : "descartar", etapa: p.pasa ? "clasificador" : "prefiltro",
      motivo: p.motivo ?? null, verificacion: "resumen_automatico", origen: primera ? "revision_inicial" : "diario",
      portafolio: L.portafolioDe(n.titulo),
    });
  }
  await insertarItems(sb, filas);
  await guardarSalud(sb, f, true, ahora, undefined, "verificada", {
    last_check_error: errores.length ? `Días con falla (se reintentan): ${errores.slice(0, 3).join("; ")}` : null,
    nota: primera ? `Revisión inicial de 30 días (${fechas[0]} a ${hoy}).` : null,
    linea_base_en: f.linea_base_en ?? ahora,
  });
  return { ok: true, candidatos: cand, descartados: desc, error: errores.length ? `${errores.length} índice(s) con falla` : undefined };
}

async function leerInventario(sb: SupabaseClient, f: Fuente, corrida: string, ahora: string, htmlManual?: string): Promise<Resultado> {
  let lectura: L.Lectura<L.DocInventario[]>;
  try {
    let html = htmlManual;
    if (html === undefined) {
      const h = await traerHtml(f.url);
      if (h.status !== 200) {
        const e = h.error ?? `HTTP ${h.status}`;
        await guardarSalud(sb, f, false, ahora, e);
        return { ok: false, error: e, candidatos: 0, descartados: 0 };
      }
      html = h.html;
    }
    lectura = f.organismo === "ARCSA" ? L.parseArcsaDocumentos(html) : L.parseAdjuntosGobmx(html);
  } catch (e) {
    lectura = { ok: false, datos: [], error: String(e).slice(0, 200) };
  }
  if (!lectura.ok) {
    await guardarSalud(sb, f, false, ahora, lectura.error);
    return { ok: false, error: lectura.error, candidatos: 0, descartados: 0 };
  }

  const prev = await todas<{ id: string; doc_id: string; titulo: string | null; categoria: string | null; subcategoria: string | null; estado: string }>(
    () => sb.from("regintel_norm_inventario").select("id,doc_id,titulo,categoria,subcategoria,estado").eq("fuente_id", f.id).order("doc_id"),
  );
  const diff = L.diffInventario(prev.length ? prev.map((p) => ({ ...p, id: p.doc_id })) : null, lectura.datos);
  if (diff.sospechosa) {
    await guardarSalud(sb, f, false, ahora, diff.sospechosa);
    return { ok: false, error: diff.sospechosa, candidatos: 0, descartados: 0 };
  }

  const reemplazaA = new Map(diff.reemplazos.map((r) => [r.a, r.de]));
  // Inventario. Dos lotes con columnas uniformes: si un upsert trae columnas
  // distintas por fila, PostgREST rellena con el default y pisaría el estado.
  const conocidos = new Set(prev.map((p) => p.doc_id));
  const comunes = (d: L.DocInventario) => ({
    client_id: CLIENT_ID, fuente_id: f.id, doc_id: d.id, titulo: d.titulo, url: d.url,
    categoria: d.categoria, subcategoria: d.subcategoria, last_seen: ahora,
  });
  const vigentes = lectura.datos.filter((d) => conocidos.has(d.id)).map(comunes);
  const altas = lectura.datos.filter((d) => !conocidos.has(d.id)).map((d) => ({
    ...comunes(d), first_seen: ahora, estado: diff.lineaBase ? "linea_base" : "nuevo",
    reemplaza_a: diff.lineaBase ? null : reemplazaA.get(d.id) ?? null,
  }));
  for (const lote of [vigentes, altas]) {
    for (let i = 0; i < lote.length; i += 300) {
      const { error } = await sb.from("regintel_norm_inventario").upsert(lote.slice(i, i + 300), { onConflict: "fuente_id,doc_id" });
      if (error) throw new Error("inventario: " + error.message);
    }
  }
  for (const r of diff.reemplazos) {
    await sb.from("regintel_norm_inventario").update({ estado: "reemplazado", reemplazado_por: r.a }).eq("fuente_id", f.id).eq("doc_id", r.de);
  }
  if (diff.desaparecidos.length) {
    await sb.from("regintel_norm_inventario").update({ estado: "desaparecido" }).eq("fuente_id", f.id).in("doc_id", diff.desaparecidos);
  }

  let cand = 0, desc = 0;
  if (!diff.lineaBase && diff.nuevos.length) {
    const { data: inv } = await sb.from("regintel_norm_inventario").select("id,doc_id").eq("fuente_id", f.id).in("doc_id", diff.nuevos.map((n) => n.id));
    const invId = new Map((inv ?? []).map((x) => [x.doc_id, x.id]));
    const filas = diff.nuevos.map((d) => {
      const p = L.prefiltroInventario(f.organismo, d);
      if (p.pasa) cand++; else desc++;
      return {
        client_id: CLIENT_ID, fuente_id: f.id, inventario_id: invId.get(d.id) ?? null, corrida_id: corrida, organismo: f.organismo,
        doc_ref: `${f.clave}:${d.id}`, titulo_oficial: d.titulo, url: d.url, dependencia: [d.categoria, d.subcategoria].filter(Boolean).join(" › ") || f.nombre,
        fecha_publicacion: L.hoyCdmx(new Date(ahora)), decision: p.pasa ? "por_clasificar" : "descartar", etapa: p.pasa ? "clasificador" : "prefiltro",
        motivo: p.motivo ?? null, verificacion: "resumen_automatico", origen: htmlManual ? "manual" : "diario",
        reemplaza_a: reemplazaA.get(d.id) ? `${f.clave}:${reemplazaA.get(d.id)}` : null, portafolio: L.portafolioDe(`${d.titulo} ${d.categoria ?? ""}`),
      };
    });
    await insertarItems(sb, filas);
  }
  await guardarSalud(sb, f, true, ahora, undefined, "verificada", {
    documentos: lectura.datos.length,
    linea_base_en: diff.lineaBase ? ahora : f.linea_base_en,
    nota: htmlManual ? "Última lectura desde una página guardada y subida a mano." : null,
  });
  return { ok: true, candidatos: cand, descartados: desc, lineaBase: diff.lineaBase ? lectura.datos.length : undefined, nuevos: diff.nuevos.length, reemplazos: diff.reemplazos.length, bajas: diff.desaparecidos.length };
}

async function leerNoticias(sb: SupabaseClient, f: Fuente, corrida: string, ahora: string, htmlManual?: string): Promise<Resultado> {
  const hoy = L.hoyCdmx(new Date(ahora));
  let lectura: L.Lectura<L.Noticia[]>;
  try {
    let html = htmlManual;
    if (html === undefined) {
      const h = await traerHtml(f.url);
      if (h.status !== 200) { const e = h.error ?? `HTTP ${h.status}`; await guardarSalud(sb, f, false, ahora, e); return { ok: false, error: e, candidatos: 0, descartados: 0 }; }
      html = h.html;
    }
    lectura = f.clave === "cofepris_portada" ? L.parsePortadaCofepris(html, hoy) : L.parseArcsaNoticias(html);
  } catch (e) { lectura = { ok: false, datos: [], error: String(e).slice(0, 200) }; }
  if (!lectura.ok) {
    await guardarSalud(sb, f, false, ahora, lectura.error, lectura.verificacion);
    return { ok: false, error: lectura.error, candidatos: 0, descartados: 0 };
  }
  const desde = L.sumarDias(hoy, -3);
  const recientes = lectura.datos.filter((n) => n.fecha >= desde && n.fecha <= hoy);
  let cand = 0, desc = 0;
  const filas = recientes.map((n) => {
    const p = L.prefiltroNoticia(n);
    if (p.pasa) cand++; else desc++;
    return {
      client_id: CLIENT_ID, fuente_id: f.id, corrida_id: corrida, organismo: f.organismo, doc_ref: n.url,
      titulo_oficial: n.titulo, fecha_publicacion: n.fecha, url: n.url, dependencia: f.nombre,
      decision: p.pasa ? "por_clasificar" : "descartar", etapa: p.pasa ? "clasificador" : "prefiltro", motivo: p.motivo ?? null,
      verificacion: "pista_no_verificada", origen: htmlManual ? "manual" : "diario", portafolio: L.portafolioDe(n.titulo),
    };
  });
  await insertarItems(sb, filas);
  await guardarSalud(sb, f, true, ahora, undefined, lectura.verificacion ?? "verificada", { documentos: lectura.datos.length, linea_base_en: f.linea_base_en ?? ahora });
  return { ok: true, candidatos: cand, descartados: desc };
}

// ─── Clasificador ──────────────────────────────────────────────────────────────
async function llamarClaude(prompt: string): Promise<L.Clasificacion> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("falta ANTHROPIC_API_KEY en los secretos de Supabase");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, max_tokens: 900, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`Claude HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return L.parseClasificacion(j.content?.map((c: { text?: string }) => c.text ?? "").join("") ?? "");
}

async function clasificarLote(sb: SupabaseClient, ahora: string, n = 2): Promise<number> {
  const { data: cola } = await sb.from("regintel_norm_items")
    .select("id,organismo,doc_ref,titulo_oficial,fecha_publicacion,url,dependencia,verificacion,intentos,fuente_id")
    .eq("client_id", CLIENT_ID).eq("decision", "por_clasificar").lt("intentos", 3)
    .order("created_at", { ascending: true }).limit(n);
  if (!cola?.length) return 0;
  const { data: fs } = await sb.from("regintel_norm_fuentes").select("id,pais,clave").eq("client_id", CLIENT_ID);
  const fuentes = new Map((fs ?? []).map((x) => [x.id, x]));
  for (const it of cola) {
    const fuente = fuentes.get(it.fuente_id);
    let texto: string | null = null;
    let url = it.url as string | null;
    let verif = it.verificacion as string;
    try {
      if (it.organismo === "DOF") {
        const t = await textoDof(it.doc_ref, it.fecha_publicacion);
        texto = t.texto; url = t.url;
      } else if (url && verif !== "pista_no_verificada" && (/\.pdf($|\?)/i.test(url) || /download\.php/.test(url))) {
        texto = await textoDePdf(url);
      }
      if (texto) verif = "documento_completo";
      const c = await llamarClaude(L.promptClasificador({
        organismo: it.organismo, pais: fuente?.pais ?? "MX", dependencia: it.dependencia, titulo: it.titulo_oficial,
        fecha: it.fecha_publicacion, texto: texto ? L.recorteParaLlm(texto) : null,
      }));
      const base = it.fecha_publicacion ?? L.hoyCdmx(new Date(ahora));
      await sb.from("regintel_norm_items").update({
        decision: c.incluir ? "incluir" : "descartar", etapa: "clasificador", motivo: c.motivo, tema: c.tema,
        titulo_breve: c.titulo_breve || null, resumen: L.resumenValido(c.resumen, it.titulo_oficial) ? c.resumen : null,
        fecha_vigencia: c.fecha_vigencia, accion: c.incluir ? c.accion : null,
        plazo: c.incluir && c.plazo_dias ? L.sumarDias(base, c.plazo_dias) : null, prioridad: c.prioridad,
        verificacion: verif, url, intentos: (it.intentos ?? 0) + 1, ultimo_error: null,
        portafolio: L.portafolioDe(`${it.titulo_oficial} ${(texto ?? "").slice(0, 4000)}`),
      }).eq("id", it.id);
    } catch (e) {
      await sb.from("regintel_norm_items").update({ intentos: (it.intentos ?? 0) + 1, ultimo_error: String(e).slice(0, 300) }).eq("id", it.id);
    }
  }
  return cola.length;
}

// ─── Avisos ────────────────────────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fechaLarga = (iso: string | null) => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "—";

function correoHallazgos(items: L.ItemAviso[], inicial: boolean): { asunto: string; html: string } {
  const orden = L.ordenarParaAviso(items);
  const top = orden[0];
  const asunto = inicial
    ? `Monitor normativo · Revisión inicial: ${items.length} documento(s) dentro de criterios`
    : `Monitor normativo · ${top.titulo_breve ?? top.titulo_oficial}${items.length > 1 ? ` (+${items.length - 1})` : ""}`;
  const fila = (i: L.ItemAviso) => `
    <tr><td style="padding:14px 0;border-bottom:1px solid #DCE5EC">
      <div style="font-size:11px;color:#65798A;text-transform:uppercase;letter-spacing:.08em">${esc(i.organismo)}${i.prioridad === 1 ? " · <b style='color:#B3261E'>Urgente</b>" : ""}</div>
      <div style="font-size:15px;font-weight:700;color:#12395C;margin:3px 0 4px">${esc(i.titulo_breve ?? i.titulo_oficial)}</div>
      <div style="font-size:13px;color:#152430;line-height:1.5">${esc(i.resumen ?? "Sin resumen automático: revisar el documento.")}</div>
      ${i.accion ? `<div style="font-size:12.5px;color:#152430;margin-top:6px"><b>Qué hacer:</b> ${esc(i.accion)}${i.plazo ? ` · antes del ${esc(fechaLarga(i.plazo))}` : ""}</div>` : ""}
      ${i.verificacion !== "documento_completo" ? `<div style="font-size:11.5px;color:#B35A12;margin-top:4px">${i.verificacion === "pista_no_verificada" ? "Pista no verificada: falta localizar el documento oficial." : "Solo resumen automático: no se pudo leer el documento completo."}</div>` : ""}
      ${i.url ? `<div style="margin-top:6px"><a href="${esc(i.url)}" style="font-size:12.5px;color:#12395C">Abrir en la fuente oficial</a></div>` : ""}
    </td></tr>`;
  const primera = inicial
    ? `Primera corrida del monitor: revisé los últimos 30 días del DOF con los criterios del área. Esto es lo que entra; desde mañana solo verás lo nuevo.`
    : `Lo más importante: ${esc(top.titulo_breve ?? top.titulo_oficial)}.`;
  return { asunto, html: `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#F4F7FA;font-family:Inter,system-ui,sans-serif;color:#152430">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0"><tr><td align="center">
  <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:6px;border:1px solid #DCE5EC">
  <tr><td style="background:#12395C;padding:18px 24px;color:#fff">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.75">Monitor normativo · DOF · COFEPRIS · ARCSA</div>
    <div style="font-size:16px;font-weight:700;margin-top:6px;line-height:1.35">${primera}</div>
  </td></tr>
  <tr><td style="padding:4px 24px 20px"><table width="100%" cellpadding="0" cellspacing="0">${orden.map(fila).join("")}</table>
    <p style="margin:22px 0 0"><a href="${PANEL_URL}" style="background:#12395C;color:#fff;text-decoration:none;padding:11px 20px;border-radius:5px;font-size:13px;font-weight:600">Abrir la bandeja</a></p>
  </td></tr>
  <tr><td style="padding:14px 24px;border-top:1px solid #DCE5EC;font-size:11px;color:#65798A">Monitor de inteligencia regulatoria operado por FishFlow. Información para uso interno del área.</td></tr>
  </table></td></tr></table></body></html>` };
}

async function enviar(sb: SupabaseClient, asunto: string, html: string, soloRafa = false): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { console.warn("[regintel-normativo] sin RESEND_API_KEY"); return false; }
  const { data: av } = soloRafa ? { data: [] as { email: string }[] } : await sb.from("regintel_avisos").select("email").eq("client_id", CLIENT_ID).eq("activo", true);
  const to = [...new Set([AVISO_RAFA, ...(av ?? []).map((a) => a.email as string).filter(Boolean)])];
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: FROM, to, reply_to: AVISO_RAFA, subject: asunto, html }),
  });
  if (!r.ok) console.error("[regintel-normativo] Resend:", await r.text());
  return r.ok;
}

async function cerrar(sb: SupabaseClient, corrida: string, ahora: string, enviarCorreos: boolean) {
  const { data: c } = await sb.from("regintel_norm_corridas").select("resumen").eq("id", corrida).single();
  const resumen = (c?.resumen ?? {}) as { fuentes?: Record<string, Resultado & { organismo: string }> };
  const fuentes = Object.values(resumen.fuentes ?? {});
  const organismosOk = new Set(fuentes.filter((r) => r.ok).map((r) => r.organismo)).size;

  const pendientes = await todas<L.ItemAviso & { id: string }>(() => sb.from("regintel_norm_items")
    .select("id,titulo_breve,titulo_oficial,resumen,url,prioridad,organismo,origen,accion,plazo,verificacion")
    .eq("client_id", CLIENT_ID).eq("decision", "incluir").is("avisado_en", null).order("id"));
  let aviso: "enviado" | "sin_novedad" | "bloqueo" | "omitido" = "sin_novedad";

  if (L.debeAvisar(pendientes)) {
    if (enviarCorreos) {
      const inicial = pendientes.some((p) => p.origen === "revision_inicial");
      const { asunto, html } = correoHallazgos(pendientes, inicial);
      if (await enviar(sb, asunto, html)) {
        aviso = "enviado";
        for (let i = 0; i < pendientes.length; i += 200) {
          await sb.from("regintel_norm_items").update({ avisado_en: ahora }).in("id", pendientes.slice(i, i + 200).map((p) => p.id));
        }
      }
    } else aviso = "omitido";
  } else {
    const { data: prev } = await sb.from("regintel_norm_corridas").select("aviso,resumen").eq("client_id", CLIENT_ID)
      .neq("id", corrida).not("fin", "is", null).order("inicio", { ascending: false }).limit(10);
    const historia = [{ organismosOk, aviso: null as string | null },
      ...(prev ?? []).map((p) => ({ organismosOk: Number((p.resumen as { organismosOk?: number })?.organismosOk ?? 0), aviso: p.aviso as string | null }))];
    if (L.debeAvisarBloqueo(historia)) {
      const causas = fuentes.filter((r) => !r.ok).map((r) => `<li>${esc((r as { nombre?: string }).nombre ?? "")}: ${esc(r.error)}</li>`).join("");
      if (enviarCorreos && await enviar(sb, "Monitor normativo · No se pudo leer ninguna fuente en 3 corridas",
        `<p style="font-family:Inter,sans-serif;font-size:14px">Llevamos tres corridas seguidas sin poder leer DOF, COFEPRIS ni ARCSA. Esto <b>no</b> significa que no haya novedades: el monitor está ciego hasta que se resuelva.</p><p style="font-family:Inter,sans-serif;font-size:13px">Causa probable por fuente:</p><ol style="font-family:Inter,sans-serif;font-size:13px">${causas}</ol><p style="font-family:Inter,sans-serif;font-size:13px"><a href="${PANEL_URL}">Abrir Fuentes</a></p>`)) aviso = "bloqueo";
    }
  }
  // Alertas operativas: solo a Rafa, una vez por caída y otra al recuperarse.
  let operativo: string | null = null;
  if (enviarCorreos) {
    const { data: fs } = await sb.from("regintel_norm_fuentes").select("id,clave,nombre,consecutive_failures,last_check_error,last_checked,alerta_enviada_en").eq("client_id", CLIENT_ID).eq("activo", true);
    const { caidas, recuperadas } = L.alertasOperativas((fs ?? []) as (L.FuenteAlerta & { id: string })[]);
    if (caidas.length || recuperadas.length) {
      const li = (f: L.FuenteAlerta) => `<li style="margin-bottom:8px"><b>${esc(f.nombre)}</b> — ${esc(f.last_check_error ?? "falla de lectura")}<br><span style="color:#65798A;font-size:12px">${f.consecutive_failures} falla(s) seguidas · última lectura buena: ${esc(f.last_checked ? new Date(f.last_checked).toLocaleString("es-MX", { timeZone: "America/Mexico_City" }) : "nunca")}</span></li>`;
      const asunto = caidas.length
        ? `Alerta técnica · Monitor normativo: ${caidas.length} fuente(s) sin leer — ${caidas.map((f) => f.nombre).join(", ")}`
        : `Resuelto · Monitor normativo: se recuperó ${recuperadas.map((f) => f.nombre).join(", ")}`;
      const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;color:#152430;line-height:1.5">
        <p>Aviso técnico (solo para ti; Yaz no lo recibe).</p>
        ${caidas.length ? `<p><b>No se pudieron leer en ${L.FALLAS_PARA_AVISAR} corridas seguidas:</b></p><ol>${caidas.map(li).join("")}</ol>
        <p>Mientras dure, esas fuentes no están cubiertas: una falla de lectura no es "sin novedades". Si es COFEPRIS, ya quedó la tarea en Consultas para subir la página a mano.</p>` : ""}
        ${recuperadas.length ? `<p><b>Ya se leen otra vez:</b> ${recuperadas.map((f) => esc(f.nombre)).join(", ")}.</p>` : ""}
        <p><a href="${PANEL_URL}">Abrir Fuentes en el panel</a></p></div>`;
      if (await enviar(sb, asunto, html, true)) {
        operativo = caidas.length ? "caida" : "recuperada";
        if (caidas.length) await sb.from("regintel_norm_fuentes").update({ alerta_enviada_en: ahora }).in("clave", caidas.map((f) => f.clave)).eq("client_id", CLIENT_ID);
        if (recuperadas.length) await sb.from("regintel_norm_fuentes").update({ alerta_enviada_en: null }).in("clave", recuperadas.map((f) => f.clave)).eq("client_id", CLIENT_ID);
      }
    }
  }

  const { count: desc } = await sb.from("regintel_norm_items").select("id", { count: "exact", head: true }).eq("corrida_id", corrida).eq("decision", "descartar");
  await sb.from("regintel_norm_corridas").update({
    fin: new Date().toISOString(), fuentes_ok: fuentes.filter((r) => r.ok).length, fuentes_fallidas: fuentes.filter((r) => !r.ok).length,
    nuevos: pendientes.length, descartados: desc ?? 0, aviso, resumen: { ...resumen, organismosOk, operativo },
  }).eq("id", corrida);
  return { aviso, nuevos: pendientes.length, organismosOk, operativo };
}

// ─── Servidor ──────────────────────────────────────────────────────────────────
type Body = { fase?: string; corrida?: string; i?: number; disparo?: "cron" | "manual" | "prueba"; clave?: string; html?: string; saltos?: number; noCorreo?: boolean; prueba?: Record<string, unknown> };

async function encadenar(token: string, body: Body) {
  const p = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/regintel-normativo`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-regintel-token": token }, body: JSON.stringify(body),
  }).then((r) => r.body?.cancel()).catch((e) => console.error("[regintel-normativo] encadenar:", e));
  // @ts-ignore EdgeRuntime existe en el runtime de Supabase
  EdgeRuntime.waitUntil(p);
}

async function leerFuente(sb: SupabaseClient, f: Fuente, corrida: string, ahora: string, html?: string): Promise<Resultado> {
  if (f.tipo === "por_fecha") return await leerDof(sb, f, corrida, ahora);
  if (f.tipo === "inventario") return await leerInventario(sb, f, corrida, ahora, html);
  return await leerNoticias(sb, f, corrida, ahora, html);
}

async function anotar(sb: SupabaseClient, corrida: string, f: Fuente, r: Resultado) {
  const { data } = await sb.from("regintel_norm_corridas").select("resumen").eq("id", corrida).single();
  const resumen = (data?.resumen ?? {}) as { fuentes?: Record<string, unknown> };
  resumen.fuentes = { ...(resumen.fuentes ?? {}), [f.clave]: { ...r, organismo: f.organismo, nombre: f.nombre } };
  await sb.from("regintel_norm_corridas").update({ resumen }).eq("id", corrida);
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: token, error: te } = await sb.rpc("regintel_scan_token");
  if (te || !token || req.headers.get("x-regintel-token") !== token) return json({ error: "no autorizado" }, 401);

  let b: Body = {};
  try { b = await req.json(); } catch { /* vacío = corrida de cron */ }
  const ahora = new Date().toISOString();
  const saltos = b.saltos ?? 0;
  const enviarCorreos = !b.noCorreo && b.disparo !== "prueba";

  try {
    // Clasificar un texto sin escribir nada (pruebas del clasificador).
    if (b.fase === "clasificar_prueba") {
      const p = b.prueba as { organismo: L.Organismo; pais?: string; dependencia: string | null; titulo: string; fecha: string | null; texto: string | null };
      const c = await llamarClaude(L.promptClasificador({ ...p, pais: p.pais ?? "MX", texto: p.texto ? L.recorteParaLlm(p.texto) : null }));
      return json({ ok: true, clasificacion: c });
    }

    const { data: lista } = await sb.from("regintel_norm_fuentes").select("*").eq("client_id", CLIENT_ID).eq("activo", true);
    const fuentes = ORDEN.map((k) => (lista ?? []).find((f) => f.clave === k)).filter(Boolean) as Fuente[];

    // Página guardada a mano de una fuente bloqueada.
    if (b.fase === "subir") {
      const f = fuentes.find((x) => x.clave === b.clave);
      if (!f || f.tipo === "por_fecha" || !b.html) return json({ error: "fuente o página inválida" }, 400);
      const { data: c } = await sb.from("regintel_norm_corridas").insert({ client_id: CLIENT_ID, disparo: "manual" }).select("id").single();
      const r = await leerFuente(sb, f, c!.id, ahora, b.html);
      await anotar(sb, c!.id, f, r);
      await encadenar(token, { fase: "clasificar", corrida: c!.id, disparo: "manual", noCorreo: b.noCorreo });
      return json({ ok: r.ok, resultado: r });
    }

    if (!b.fase || b.fase === "inicio") {
      const { data: c, error } = await sb.from("regintel_norm_corridas").insert({ client_id: CLIENT_ID, disparo: b.disparo ?? "cron", resumen: {} }).select("id").single();
      if (error) throw new Error(error.message);
      await encadenar(token, { fase: "leer", corrida: c!.id, i: 0, disparo: b.disparo, noCorreo: b.noCorreo });
      return json({ ok: true, corrida: c!.id });
    }

    const corrida = b.corrida!;
    if (b.fase === "leer") {
      const i = b.i ?? 0;
      const f = fuentes[i];
      if (f) {
        let r: Resultado;
        try { r = await leerFuente(sb, f, corrida, ahora); }
        catch (e) { r = { ok: false, error: String(e).slice(0, 300), candidatos: 0, descartados: 0 }; await guardarSalud(sb, f, false, ahora, r.error); }
        await anotar(sb, corrida, f, r);
        await encadenar(token, { ...b, fase: "leer", i: i + 1, saltos: saltos + 1 });
        return json({ ok: true, fuente: f.clave, resultado: r });
      }
      await encadenar(token, { ...b, fase: "clasificar", saltos: saltos + 1 });
      return json({ ok: true, fase: "clasificar" });
    }

    if (b.fase === "clasificar") {
      const n = await clasificarLote(sb, ahora);
      if (n > 0 && saltos < 120) {
        await encadenar(token, { ...b, fase: "clasificar", saltos: saltos + 1 });
        return json({ ok: true, clasificados: n });
      }
      const fin = await cerrar(sb, corrida, ahora, enviarCorreos);
      return json({ ok: true, terminado: true, ...fin });
    }

    return json({ error: "fase desconocida" }, 400);
  } catch (e) {
    console.error("[regintel-normativo]", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
