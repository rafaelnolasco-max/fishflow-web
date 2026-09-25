// Supabase Edge Function — regintel-scan
// Radar COFEPRIS de /app/regintel (inteligencia regulatoria).
//
// Lo dispara pg_cron una vez al día (job `regintel-scan-diario`). Cada corrida:
//   Fase "revisar":  GET a cada URL conocida de COFEPRIS con cabeceras de
//                    navegador (sin User-Agent gob.mx responde 403; a HEAD
//                    responde 404, por eso siempre GET completo). Si el SHA-256
//                    cambió, archiva el PDF en Storage y marca la fuente como
//                    `pendiente`. Si la URL da 404, la marca `url_rota`
//                    (COFEPRIS reemplazó el archivo con otro attachment ID y el
//                    índice está detrás de un anti-bot: la URL nueva la pega
//                    una persona).
//   Fase "procesar": parsea UNA fuente pendiente por invocación (límite de CPU
//                    de Edge Functions) y se vuelve a llamar a sí misma si
//                    quedan más. Upsert de registros, cruce con la watchlist y
//                    control de conteo: si lo leído no cuadra con lo que declara
//                    el pie del PDF, el corte NO se publica.
//   Al final:        correo a Rafa solo si pasó algo (corte nuevo, hallazgos,
//                    URL rota, no cuadra, fuente que acaba de pasar 45 días).
//
// Autenticación: verify_jwt = false + cabecera `x-regintel-token`, que se
// compara contra el secreto del Vault leído con la RPC `regintel_scan_token()`
// (solo service_role puede ejecutarla).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getDocumentProxy } from "npm:unpdf@1.6.2";
import { parsePdf, type Tipo } from "./parser.ts";

const CLIENT_ID = "c2b2a692-7f39-42a1-841a-5ae31e21e851";
const BUCKET = "regintel-docs";
const AVISO_RAFA = "raf@fishflow.mx"; // siempre en copia
// Destinatarios del cliente: tabla regintel_avisos (se cambian sin redeploy).
const FROM = "FishFlow · Radar COFEPRIS <noreply@fishflow.mx>";
const PANEL_URL = "https://fishflow.mx/app/regintel";
const DIAS_ESTANCADA = 45;
const PROPIOS_RE = /\b(pfizer|hospira|wyeth|upjohn|pharmacia)\b/i;

const HEADERS_NAVEGADOR = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "application/pdf,text/html;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9",
};

const TIPO_POR_CANAL: Record<string, Tipo> = {
  alopaticos: "autorizado",
  revocados: "revocado",
  cancelados: "cancelado",
};

interface Reporte {
  inicio: string;
  revisadas: number;
  sinCambio: string[];
  cortesNuevos: { nombre: string; lastModified: string | null }[];
  urlRotas: { nombre: string; url: string; status: number }[];
  errores: string[];
  procesadas: {
    nombre: string; leidos: number; declarados: number | null; incremento: boolean;
    cuadra: boolean | null; publicado: boolean; fechaCorte: string | null;
    registrosNuevos: number; hallazgosNuevos: { folio: string; marca: string | null; molecula: string; titular: string | null; tipo: Tipo; propio: boolean }[];
  }[];
  estancadas: { nombre: string; dias: number }[];
}

const nuevoReporte = (): Reporte => ({
  inicio: new Date().toISOString(), revisadas: 0, sinCambio: [], cortesNuevos: [], urlRotas: [],
  errores: [], procesadas: [], estancadas: [],
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

async function sha256Hex(buf: Uint8Array<ArrayBuffer>): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const diasDesde = (iso: string | null) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;

// ─── Fase 1: revisar URLs ──────────────────────────────────────────────────────
async function revisar(sb: SupabaseClient, rep: Reporte) {
  const { data: fuentes, error } = await sb
    .from("regintel_sources")
    .select("id,canal,anio,nombre,url,sha256,last_modified,estado_proceso")
    .eq("client_id", CLIENT_ID)
    .eq("origen", "automatico");
  if (error) throw new Error("leer fuentes: " + error.message);

  for (const f of fuentes ?? []) {
    rep.revisadas++;
    const ahora = new Date().toISOString();
    let resp: Response;
    try {
      resp = await fetch(f.url, { headers: HEADERS_NAVEGADOR, signal: AbortSignal.timeout(45_000) });
    } catch (e) {
      rep.errores.push(`${f.nombre}: no respondió (${String(e).slice(0, 120)})`);
      continue;
    }
    if (resp.status === 404 || resp.status === 410) {
      await resp.body?.cancel();
      if (f.estado_proceso !== "url_rota") {
        rep.urlRotas.push({ nombre: f.nombre, url: f.url, status: resp.status });
      }
      await sb.from("regintel_sources").update({
        estado_proceso: "url_rota",
        revisado_en: ahora,
        nota: `COFEPRIS reemplazó el archivo: la URL responde ${resp.status}. Hay que pegar la URL nueva del índice.`,
      }).eq("id", f.id);
      continue;
    }
    if (!resp.ok) {
      await resp.body?.cancel();
      rep.errores.push(`${f.nombre}: HTTP ${resp.status}`);
      continue;
    }
    const buf = new Uint8Array(await resp.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    const cabecera = new TextDecoder().decode(buf.slice(0, 5));
    if (cabecera !== "%PDF-") {
      rep.errores.push(`${f.nombre}: la respuesta no es un PDF (posible desafío anti-bot)`);
      continue;
    }
    const sha = await sha256Hex(buf);
    const lm = resp.headers.get("last-modified");
    const lastModified = lm ? new Date(lm).toISOString() : null;

    if (sha === f.sha256) {
      rep.sinCambio.push(f.nombre);
      const upd: Record<string, unknown> = { revisado_en: ahora };
      if (f.estado_proceso === "url_rota") upd.estado_proceso = "procesado";
      await sb.from("regintel_sources").update(upd).eq("id", f.id);
    } else {
      const path = `${CLIENT_ID}/cofepris/${f.canal}/${f.anio ?? "sin-anio"}/${sha.slice(0, 16)}.pdf`;
      const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: "application/pdf", upsert: true });
      if (up.error) { rep.errores.push(`${f.nombre}: no se pudo archivar (${up.error.message})`); continue; }
      const { error: e2 } = await sb.from("regintel_sources").update({
        sha256: sha,
        etag: resp.headers.get("etag"),
        last_modified: lastModified,
        bytes: buf.byteLength,
        storage_path: path,
        estado_proceso: "pendiente",
        detectado_en: ahora,
        revisado_en: ahora,
        nota: null,
      }).eq("id", f.id);
      if (e2) { rep.errores.push(`${f.nombre}: ${e2.message}`); continue; }
      // La primera vez que se guarda el hash no es "corte nuevo", es línea base.
      if (f.sha256) rep.cortesNuevos.push({ nombre: f.nombre, lastModified });
    }

    // Fuente que acaba de cruzar el umbral: avisar una sola vez.
    const d = diasDesde(lastModified ?? f.last_modified);
    if (d !== null && d === DIAS_ESTANCADA + 1) rep.estancadas.push({ nombre: f.nombre, dias: d });
  }
}

// ─── Fase 2: procesar una fuente pendiente ─────────────────────────────────────
async function procesarUna(sb: SupabaseClient, rep: Reporte): Promise<boolean> {
  // Una fuente que se quedó en `procesando` más de 15 min murió por límite de CPU.
  await sb.from("regintel_sources")
    .update({ estado_proceso: "error", nota: "El procesamiento se interrumpió (límite de la función). Revisar." })
    .eq("client_id", CLIENT_ID).eq("estado_proceso", "procesando")
    .lt("revisado_en", new Date(Date.now() - 15 * 60_000).toISOString());

  const { data: pend } = await sb
    .from("regintel_sources")
    .select("id,canal,anio,nombre,storage_path,registros_parseados,origen")
    .eq("client_id", CLIENT_ID).eq("estado_proceso", "pendiente")
    .order("detectado_en", { ascending: true }).limit(1);
  const f = pend?.[0];
  if (!f) return false;

  const tipo = TIPO_POR_CANAL[f.canal];
  if (!tipo || !f.storage_path || !/\.pdf$/i.test(f.storage_path)) {
    await sb.from("regintel_sources").update({
      estado_proceso: "archivado",
      nota: "Archivado. Este canal o formato no tiene lector automático; queda como documento de consulta.",
    }).eq("id", f.id);
    return true;
  }

  await sb.from("regintel_sources").update({ estado_proceso: "procesando", revisado_en: new Date().toISOString() }).eq("id", f.id);

  try {
    const dl = await sb.storage.from(BUCKET).download(f.storage_path);
    if (dl.error || !dl.data) throw new Error("descargar de Storage: " + (dl.error?.message ?? "vacío"));
    const pdf = await getDocumentProxy(new Uint8Array(await dl.data.arrayBuffer()));
    const r = await parsePdf(pdf, tipo);

    const leidos = r.registros.length;
    const previos = f.registros_parseados as number | null;
    let cuadra: boolean | null = null;
    if (r.declarados !== null) {
      if (!r.declaradoEsIncremento) cuadra = leidos === r.declarados;
      else if (previos !== null && previos !== leidos) cuadra = leidos - previos === r.declarados;
      // incremento sin corte previo comparable: no se puede verificar → null
    } else if (leidos === 0) cuadra = false;

    const publicar = cuadra !== false && leidos > 0;
    const fechaCorte = r.fechaActualizacion;
    const item: Reporte["procesadas"][number] = {
      nombre: f.nombre, leidos, declarados: r.declarados, incremento: r.declaradoEsIncremento,
      cuadra, publicado: publicar, fechaCorte, registrosNuevos: 0, hallazgosNuevos: [],
    };

    if (publicar) {
      // Registros que ya existían (para contar los nuevos).
      const folios = r.registros.map((x) => x.folio);
      const existentes = new Set<string>();
      for (let i = 0; i < folios.length; i += 300) {
        const { data } = await sb.from("regintel_registros").select("folio")
          .eq("client_id", CLIENT_ID).eq("tipo", tipo).in("folio", folios.slice(i, i + 300));
        for (const d of data ?? []) existentes.add(d.folio);
      }
      item.registrosNuevos = folios.filter((x) => !existentes.has(x)).length;

      const filas = r.registros.map((x) => ({ ...x, client_id: CLIENT_ID, tipo, source_id: f.id }));
      const guardados: { id: string; folio: string; titular: string | null; denominacion_distintiva: string | null; denominacion_generica: string | null }[] = [];
      for (let i = 0; i < filas.length; i += 300) {
        const { data, error } = await sb.from("regintel_registros")
          .upsert(filas.slice(i, i + 300), { onConflict: "client_id,folio,tipo" })
          .select("id,folio,titular,denominacion_distintiva,denominacion_generica");
        if (error) throw new Error("guardar registros: " + error.message);
        guardados.push(...(data ?? []));
      }

      // Cruce con la watchlist.
      const { data: wl } = await sb.from("regintel_watchlist")
        .select("id,molecula,sinonimos").eq("client_id", CLIENT_ID).eq("activo", true);
      const patrones = (wl ?? []).map((w) => ({
        w,
        re: new RegExp(
          `(^|[^a-z0-9])(${[w.molecula, ...(w.sinonimos ?? [])].map((t: string) => escapeRe(norm(t))).join("|")})([^a-z0-9]|$)`,
        ),
      }));
      const candidatos: Record<string, unknown>[] = [];
      for (const g of guardados) {
        const gen = norm(g.denominacion_generica ?? "");
        if (!gen) continue;
        for (const { w, re } of patrones) {
          if (!re.test(gen)) continue;
          const propio = PROPIOS_RE.test(g.titular ?? "");
          candidatos.push({
            client_id: CLIENT_ID, registro_id: g.id, watchlist_id: w.id, molecula_match: w.molecula,
            estado: "pendiente",
            clasificacion: propio ? "producto_propio" : null,
            nota: `Detectado por el radar${fechaCorte ? ` en el corte COFEPRIS del ${fechaCorte}` : ""}.`,
          });
        }
      }
      for (let i = 0; i < candidatos.length; i += 300) {
        const { data, error } = await sb.from("regintel_hallazgos")
          .upsert(candidatos.slice(i, i + 300), { onConflict: "client_id,registro_id,molecula_match", ignoreDuplicates: true })
          .select("registro_id,molecula_match,clasificacion");
        if (error) throw new Error("guardar hallazgos: " + error.message);
        for (const h of data ?? []) {
          const g = guardados.find((x) => x.id === h.registro_id);
          item.hallazgosNuevos.push({
            folio: g?.folio ?? "", marca: g?.denominacion_distintiva ?? null, molecula: h.molecula_match,
            titular: g?.titular ?? null, tipo, propio: h.clasificacion === "producto_propio",
          });
        }
      }
    }

    const notaPartes = [
      fechaCorte ? `Corte COFEPRIS del ${fechaCorte}.` : null,
      !publicar ? "No se publicó: lo leído no cuadra con lo que declara el PDF." : null,
      r.avisos.length ? `Avisos del lector: ${r.avisos.slice(0, 3).join("; ")}` : null,
    ].filter(Boolean);
    await sb.from("regintel_sources").update({
      registros_parseados: leidos,
      registros_declarados: r.declarados,
      declarado_es_incremento: r.declaradoEsIncremento,
      cuadra,
      estado_proceso: publicar ? "procesado" : "no_cuadra",
      revisado_en: new Date().toISOString(),
      nota: notaPartes.join(" ") || null,
    }).eq("id", f.id);

    rep.procesadas.push(item);
  } catch (e) {
    rep.errores.push(`${f.nombre}: ${String(e).slice(0, 200)}`);
    await sb.from("regintel_sources").update({
      estado_proceso: "error", nota: `Error al procesar: ${String(e).slice(0, 300)}`,
    }).eq("id", f.id);
  }
  return true;
}

// ─── Correo ────────────────────────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function hayNovedad(r: Reporte) {
  return r.cortesNuevos.length || r.urlRotas.length || r.errores.length || r.estancadas.length ||
    r.procesadas.some((p) => p.hallazgosNuevos.length || !p.publicado || p.registrosNuevos);
}

function correoHtml(r: Reporte, completo: boolean) {
  const td = 'style="padding:7px 10px;border-bottom:1px solid #DCE5EC;font-size:13px;vertical-align:top"';
  const th = 'style="padding:7px 10px;border-bottom:2px solid #12395C;font-size:12px;text-align:left;color:#12395C"';
  const seccion = (titulo: string, cuerpo: string) =>
    `<h3 style="margin:22px 0 8px;font-size:15px;color:#12395C">${titulo}</h3>${cuerpo}`;
  let html = "";

  if (r.procesadas.length) {
    html += seccion("Cortes procesados", `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
      <tr><th ${th}>Fuente</th><th ${th}>Corte</th><th ${th}>Leídos</th><th ${th}>Declarados</th><th ${th}>Nuevos</th><th ${th}>Estado</th></tr>
      ${r.procesadas.map((p) => `<tr><td ${td}>${esc(p.nombre)}</td><td ${td}>${esc(p.fechaCorte ?? "—")}</td><td ${td}>${p.leidos}</td>
        <td ${td}>${p.declarados ?? "—"}${p.incremento ? " (incremento)" : ""}</td><td ${td}>${p.registrosNuevos}</td>
        <td ${td}>${p.publicado ? (p.cuadra === true ? "Cuadra · publicado" : "Publicado (sin conteo verificable)") : "<b style='color:#B3261E'>No cuadra · no publicado</b>"}</td></tr>`).join("")}
    </table>`);
  }
  const hall = r.procesadas.flatMap((p) => p.hallazgosNuevos);
  if (hall.length) {
    html += seccion(`Hallazgos nuevos en la bandeja (${hall.length})`, `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
      <tr><th ${th}>Folio</th><th ${th}>Marca</th><th ${th}>Molécula</th><th ${th}>Titular</th><th ${th}>Tipo</th></tr>
      ${hall.map((h) => `<tr><td ${td}>${esc(h.folio)}</td><td ${td}>${esc(h.marca ?? "—")}</td><td ${td}>${esc(h.molecula)}</td>
        <td ${td}>${esc(h.titular ?? "—")}${h.propio ? " <i>(propio)</i>" : ""}</td><td ${td}>${esc(h.tipo)}</td></tr>`).join("")}
    </table>`);
  }
  if (completo && r.urlRotas.length) {
    html += seccion("URLs rotas — hay que pegar la nueva", `<ol style="font-size:13px;padding-left:18px">${
      r.urlRotas.map((u) => `<li>${esc(u.nombre)} (HTTP ${u.status})<br><span style="color:#65798A;font-size:12px">${esc(u.url)}</span></li>`).join("")
    }</ol><p style="font-size:12.5px;color:#65798A">COFEPRIS reemplazó el archivo y cambió su ID. El índice está protegido contra bots: abrir <a href="https://www.gob.mx/cofepris/documentos/registros-sanitarios-medicamentos">el índice</a>, copiar la URL nueva y actualizarla en la fuente.</p>`);
  }
  if (r.estancadas.length) {
    html += seccion("Fuentes estancadas", `<ol style="font-size:13px;padding-left:18px">${
      r.estancadas.map((s) => `<li>${esc(s.nombre)}: ${s.dias} días sin actualizarse en COFEPRIS</li>`).join("")}</ol>`);
  }
  if (completo && r.errores.length) {
    html += seccion("Errores", `<ol style="font-size:13px;padding-left:18px">${r.errores.map((e) => `<li>${esc(e)}</li>`).join("")}</ol>`);
  }

  return `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#F4F7FA;font-family:Inter,system-ui,sans-serif;color:#152430">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 0"><tr><td align="center">
  <table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:6px;overflow:hidden;border:1px solid #DCE5EC">
  <tr><td style="background:#12395C;padding:18px 24px;color:#fff">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.75">Radar COFEPRIS · Inteligencia regulatoria</div>
    <div style="font-size:18px;font-weight:700;margin-top:4px">Resumen del scan del ${new Date(r.inicio).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "long", year: "numeric" })}</div>
  </td></tr>
  <tr><td style="padding:6px 24px 24px">
    <p style="font-size:13px;color:#65798A;margin:14px 0 0">${r.revisadas} fuentes revisadas · ${r.sinCambio.length} sin cambios · ${r.cortesNuevos.length} con corte nuevo.</p>
    ${html}
    <p style="margin:26px 0 0"><a href="${PANEL_URL}" style="background:#12395C;color:#fff;text-decoration:none;padding:11px 20px;border-radius:5px;font-size:13px;font-weight:600">Abrir la bandeja</a></p>
  </td></tr>
  <tr><td style="padding:14px 24px;border-top:1px solid #DCE5EC;font-size:11px;color:#65798A">Radar de inteligencia regulatoria operado por FishFlow. Información para uso interno del área. Los listados de COFEPRIS son informativos y llegan con rezago; lo más reciente sigue requiriendo la consulta con CAPTCHA.</td></tr>
  </table></td></tr></table></body></html>`;
}

async function enviarUno(key: string, to: string[], subject: string, html: string) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: FROM, to, reply_to: AVISO_RAFA, subject, html }),
  });
  if (!resp.ok) console.error("[regintel-scan] Resend:", await resp.text());
}

/** Novedades que le importan al cliente (no las operativas: URL rota, errores). */
function novedadCliente(r: Reporte) {
  return r.cortesNuevos.length || r.procesadas.some((p) => p.publicado && (p.hallazgosNuevos.length || p.registrosNuevos));
}

async function enviarCorreo(sb: SupabaseClient, r: Reporte, soloCliente = false) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { console.warn("[regintel-scan] sin RESEND_API_KEY"); return; }
  const hall = r.procesadas.reduce((n, p) => n + p.hallazgosNuevos.length, 0);
  const asunto = (completo: boolean) => {
    const partes = [
      r.cortesNuevos.length ? `${r.cortesNuevos.length} corte(s) nuevo(s)` : null,
      hall ? `${hall} hallazgo(s) nuevo(s)` : null,
      completo && r.urlRotas.length ? `${r.urlRotas.length} URL rota(s)` : null,
      completo && r.procesadas.some((p) => !p.publicado) ? "corte que no cuadra" : null,
      completo && r.errores.length ? `${r.errores.length} error(es)` : null,
    ].filter(Boolean);
    return `Radar COFEPRIS: ${partes.join(" · ") || "novedades"}`;
  };

  // Rafa: siempre la versión completa (incluye lo operativo).
  if (!soloCliente) await enviarUno(key, [AVISO_RAFA], asunto(true), correoHtml(r, true));

  // Cliente: solo si hay novedad de negocio, sin secciones operativas.
  if (!novedadCliente(r)) return;
  const { data: av } = await sb.from("regintel_avisos").select("email").eq("client_id", CLIENT_ID).eq("activo", true);
  const cliente = (av ?? []).map((a) => a.email as string).filter((e) => e && e !== AVISO_RAFA);
  if (cliente.length) await enviarUno(key, cliente, asunto(false), correoHtml(r, false));
}

// ─── Serve ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: token, error: te } = await sb.rpc("regintel_scan_token");
  if (te || !token || req.headers.get("x-regintel-token") !== token) return json({ error: "no autorizado" }, 401);

  let body: { fase?: string; reporte?: Reporte; noCorreo?: boolean; soloCliente?: boolean; saltos?: number } = {};
  try { body = await req.json(); } catch { /* cuerpo vacío = corrida completa */ }

  const rep = body.reporte ?? nuevoReporte();
  const saltos = body.saltos ?? 0;

  try {
    if (body.fase !== "procesar") await revisar(sb, rep);
    const proceso = await procesarUna(sb, rep);

    if (proceso && saltos < 40) {
      // Quedan (o pueden quedar) pendientes: siguiente invocación, con el reporte acumulado.
      const siguiente = fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/regintel-scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-regintel-token": token },
        body: JSON.stringify({ fase: "procesar", reporte: rep, noCorreo: body.noCorreo, saltos: saltos + 1 }),
      }).then((r) => r.body?.cancel()).catch((e) => console.error("[regintel-scan] encadenar:", e));
      // @ts-ignore EdgeRuntime existe en el runtime de Supabase
      EdgeRuntime.waitUntil(siguiente);
      return json({ ok: true, fase: "procesar", siguiente: true, procesadas: rep.procesadas.length });
    }

    if (!body.noCorreo && hayNovedad(rep)) await enviarCorreo(sb, rep, body.soloCliente);
    return json({ ok: true, terminado: true, reporte: rep });
  } catch (e) {
    console.error("[regintel-scan]", e);
    rep.errores.push(String(e).slice(0, 300));
    if (!body.noCorreo) await enviarCorreo(sb, rep);
    return json({ ok: false, error: String(e) }, 500);
  }
});
