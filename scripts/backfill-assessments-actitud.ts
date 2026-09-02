// FishFlow — Backfill: leads (Actitud) → assessments
// ─────────────────────────────────────────────────────────────────────────────
// Hermano de backfill-assessments-criterio.ts, para el otro instrumento de
// Mario: la Evaluación de Actitud (actitud.html en mariocitalan.net).
//
// Los dos instrumentos NO se parsean igual:
//
//                        Criterio            Actitud
//   Reactivos            30, escala 1-5      15, opción múltiple ponderada 0-4
//   Puntaje              30-150              0-60
//   Subtotales           `_dim · <nombre>`   `_cat · <categoría>`
//   Formato del subtotal "18 / 25" (texto)   12 (número)
//   `_puntaje_total`     sí                  NO
//
// Actitud nunca mandó el puntaje total, pero **se reconstruye exacto**: son
// cinco categorías de tres reactivos y cada opción vale 0-4, así que la suma de
// los cinco `_cat` ES el puntaje sobre 60. Verificado contra los 47 registros:
// el perfil que cae de esa suma coincide con `leads.profile` en los 47.
//
// Igual que en Criterio, hay dos clases de registro y la diferencia NO es
// abandono: antes del 30-jul-2026 el cuestionario solo mandaba perfil y ruta.
// Esas entran con `total_score` en null y `dimensions` vacío.
//
// ⚠️ Esto NO da de alta pacientes.
//
// Uso:
//   npx tsx scripts/backfill-assessments-actitud.ts --dry-run
//   npx tsx scripts/backfill-assessments-actitud.ts
//   npx tsx scripts/backfill-assessments-actitud.ts --revertir

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const CLIENT_ID = "ea5266d5-cabb-44e2-a96a-0a0f40da07e7";

const SOURCE_LEADS = "actitud";
const INSTRUMENT = "actitud_v1";

const SOURCE_MARK = "backfill_leads_actitud";
const SOURCE_MARK_SIN_DETALLE = "backfill_leads_actitud_sin_detalle";

// 15 reactivos, cada opción vale 0-4.
const MAX_SCORE = 60;
const MIN_SCORE = 0;
// 5 categorías × 3 reactivos × 4 puntos.
const MAX_POR_CATEGORIA = 12;
const N_CATEGORIAS = 5;

// Perfiles por rango, copiados tal cual de actitud.html. Ojo: son OTROS, no los
// de Criterio — un "Funcional" de Actitud no es un "Funcional" de Criterio.
const PROFILES: { nombre: string; min: number; max: number }[] = [
  { nombre: "Arquitectura de Actitud en Reconstrucción", min: 0,  max: 19 },
  { nombre: "Arquitectura de Actitud Vulnerable",        min: 20, max: 34 },
  { nombre: "Arquitectura de Actitud Funcional",         min: 35, max: 49 },
  { nombre: "Arquitectura de Actitud Sólida",            min: 50, max: 60 },
];

const CAT_PREFIX = "_cat · ";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const REVERTIR = args.includes("--revertir");

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(__dirname, "..");

function cargarEnvLocal(): void {
  let crudo: string;
  try {
    crudo = readFileSync(resolve(RAIZ, ".env.local"), "utf8");
  } catch {
    console.error("No encontré .env.local en", RAIZ);
    process.exit(1);
  }
  for (const linea of crudo.split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const i = limpia.indexOf("=");
    if (i === -1) continue;
    const clave = limpia.slice(0, i).trim();
    let valor = limpia.slice(i + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (!process.env[clave]) process.env[clave] = valor;
  }
}

cargarEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  profile: string | null;
  created_at: string;
  answers: Record<string, unknown> | null;
};

type DimScore = { score: number; max: number };

/** En Actitud el subtotal viaja como número puro, no como "9 / 12". */
function parseCat(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string") {
    const m = valor.match(/-?\d+/);
    if (m) return Number(m[0]);
  }
  return null;
}

function perfilPara(score: number): string | null {
  const p = PROFILES.find((x) => score >= x.min && score <= x.max);
  return p ? p.nombre : null;
}

/** Suma de las cinco categorías. Devuelve null si no vienen las cinco. */
function reconstruirPuntaje(answers: Record<string, unknown>): {
  total: number;
  dimensions: Record<string, DimScore>;
} | null {
  const dimensions: Record<string, DimScore> = {};
  let total = 0;
  for (const [k, v] of Object.entries(answers)) {
    if (!k.startsWith(CAT_PREFIX)) continue;
    const n = parseCat(v);
    if (n == null) return null;
    dimensions[k.slice(CAT_PREFIX.length)] = { score: n, max: MAX_POR_CATEGORIA };
    total += n;
  }
  if (Object.keys(dimensions).length !== N_CATEGORIAS) return null;
  return { total, dimensions };
}

async function revertir(): Promise<void> {
  const { data, error } = await db
    .from("assessments")
    .delete()
    .eq("client_id", CLIENT_ID)
    .eq("instrument", INSTRUMENT)
    .in("source", [SOURCE_MARK, SOURCE_MARK_SIN_DETALLE])
    .select("id");

  if (error) {
    console.error("Error al revertir:", error.message);
    process.exit(1);
  }
  console.log(`Revertido: ${data?.length ?? 0} evaluaciones borradas.`);
}

async function backfill(): Promise<void> {
  const { data: leads, error } = await db
    .from("leads")
    .select("id, name, email, profile, created_at, answers")
    .eq("client_id", CLIENT_ID)
    .eq("source", SOURCE_LEADS)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error al leer leads:", error.message);
    process.exit(1);
  }

  const todos = (leads ?? []) as Lead[];

  const { data: yaHay, error: errYa } = await db
    .from("assessments")
    .select("lead_id")
    .eq("client_id", CLIENT_ID)
    .eq("instrument", INSTRUMENT)
    .not("lead_id", "is", null);

  if (errYa) {
    console.error("Error al leer assessments existentes:", errYa.message);
    process.exit(1);
  }
  const existentes = new Set((yaHay ?? []).map((r) => r.lead_id as string));

  const filas: Record<string, unknown>[] = [];
  const desacuerdos: string[] = [];
  let conDetalle = 0;
  let soloPerfil = 0;
  let sinNada = 0;
  let saltados = 0;
  let fueraDeRango = 0;

  for (const lead of todos) {
    if (existentes.has(lead.id)) { saltados++; continue; }

    const parsed = lead.answers ? reconstruirPuntaje(lead.answers) : null;

    if (parsed) {
      conDetalle++;
      if (parsed.total < MIN_SCORE || parsed.total > MAX_SCORE) {
        fueraDeRango++;
        console.warn(`  ⚠️  ${lead.email ?? lead.id}: puntaje ${parsed.total} fuera de ${MIN_SCORE}-${MAX_SCORE}`);
      }
      const calculado = perfilPara(parsed.total);
      if (lead.profile && calculado && lead.profile !== calculado) {
        desacuerdos.push(
          `  ⚠️  ${lead.email ?? lead.id}: lead.profile="${lead.profile}" vs calculado="${calculado}" (${parsed.total})`,
        );
      }
      filas.push({
        client_id: CLIENT_ID,
        lead_id: lead.id,
        instrument: INSTRUMENT,
        milestone: "inicio",
        taken_at: lead.created_at,
        total_score: parsed.total,
        max_score: MAX_SCORE,
        profile: lead.profile ?? calculado,
        dimensions: parsed.dimensions,
        answers: lead.answers,
        source: SOURCE_MARK,
      });
      continue;
    }

    if (typeof lead.profile === "string" && lead.profile.trim() !== "") {
      soloPerfil++;
      filas.push({
        client_id: CLIENT_ID,
        lead_id: lead.id,
        instrument: INSTRUMENT,
        milestone: "inicio",
        taken_at: lead.created_at,
        total_score: null,
        max_score: MAX_SCORE,
        profile: lead.profile,
        dimensions: {},
        answers: {},
        source: SOURCE_MARK_SIN_DETALLE,
      });
      continue;
    }

    sinNada++;
  }

  console.log("");
  console.log(`Leads de "${SOURCE_LEADS}"               : ${todos.length}`);
  console.log(`  con desglose (5 categorías)        : ${conDetalle}`);
  console.log(`  solo perfil (antes del 30-jul)     : ${soloPerfil}`);
  console.log(`  sin perfil (se quedan como lead)   : ${sinNada}`);
  console.log(`  ya tenían su evaluación            : ${saltados}`);
  console.log(`  por insertar                       : ${filas.length}`);
  if (fueraDeRango) console.log(`  puntajes fuera de rango            : ${fueraDeRango}`);
  console.log("");

  if (desacuerdos.length) {
    console.log(`Perfil guardado vs. puntaje reconstruido — ${desacuerdos.length} desacuerdos:`);
    desacuerdos.forEach((d) => console.log(d));
    console.log("");
  } else {
    console.log("El puntaje reconstruido cae en el perfil guardado en el 100% de los casos.");
    console.log("");
  }

  if (DRY_RUN) { console.log("--dry-run: no se escribió nada."); return; }
  if (!filas.length) { console.log("Nada que insertar."); return; }

  const { data: insertadas, error: errIns } = await db
    .from("assessments")
    .insert(filas)
    .select("id");

  if (errIns) {
    console.error("Error al insertar:", errIns.message);
    process.exit(1);
  }
  console.log(`Insertadas ${insertadas?.length ?? 0} evaluaciones.`);
}

async function main(): Promise<void> {
  console.log("");
  console.log("FishFlow — backfill de evaluaciones de Actitud → assessments");
  console.log(`Modo: ${REVERTIR ? "REVERTIR" : DRY_RUN ? "dry-run" : "escritura"}`);
  if (REVERTIR) await revertir();
  else await backfill();
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
