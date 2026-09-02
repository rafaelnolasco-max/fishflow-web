// FishFlow — Backfill: leads (Criterio) → assessments
// ─────────────────────────────────────────────────────────────────────────────
// Fase 0 del Motor de Programas. Convierte las evaluaciones de Arquitectura
// Mental y del Criterio que ya están capturadas en `leads` (las manda
// /api/demo/mario-criterio desde mariocitalan.net) en filas de `assessments`
// con milestone='inicio'. Esa es la línea base del programa.
//
// ⚠️ SOLO los leads que traen `_puntaje_total`. Al 1-sep-2026 son 19 de 41:
// los otros 22 abandonaron a media evaluación y NO tienen paso 1 completado.
//
// ⚠️ Esto NO da de alta pacientes. Nadie pasa a `patients` sin invitación
// aceptada — ver la sección 6 de docs/plan-tecnico-programa-reconstruccion.md.
// Los leads no se tocan: solo se leen.
//
// Uso:
//   npx tsx scripts/backfill-assessments-criterio.ts --dry-run
//   npx tsx scripts/backfill-assessments-criterio.ts
//   npx tsx scripts/backfill-assessments-criterio.ts --revertir
//
// Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

// ── Configuración de la corrida ──────────────────────────────────────────────
// Cliente "Mario Citalán — Arquitectura del Criterio" (panel /app/mariocitalan).
const CLIENT_ID = "ea5266d5-cabb-44e2-a96a-0a0f40da07e7";

const SOURCE_LEADS = "criterio";
const INSTRUMENT = "criterio_v1";

// Marca de origen: hace el backfill reversible sin tocar nada más.
const SOURCE_MARK = "backfill_leads_criterio";

// 30 reactivos × escala 1-5.
const MAX_SCORE = 150;
const MIN_SCORE = 30;

// Perfiles por rango, copiados tal cual de cuestionario.html. Si allá cambian,
// aquí también: el script compara su resultado contra `leads.profile` y avisa.
const PROFILES: { nombre: string; min: number; max: number }[] = [
  { nombre: "Arquitectura Emergente", min: 30, max: 69 },
  { nombre: "Arquitectura en Desarrollo", min: 70, max: 89 },
  { nombre: "Arquitectura en Consolidación", min: 90, max: 109 },
  { nombre: "Arquitectura Funcional", min: 110, max: 129 },
  { nombre: "Arquitectura de Alto Desempeño", min: 130, max: 150 },
];

// Prefijo de las llaves de subtotal por dimensión dentro de leads.answers.
const DIM_PREFIX = "_dim · ";
const KEY_TOTAL = "_puntaje_total";

// ── Flags ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const REVERTIR = args.includes("--revertir");

// ── .env.local ───────────────────────────────────────────────────────────────
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

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ── Parseo ───────────────────────────────────────────────────────────────────
type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  profile: string | null;
  created_at: string;
  answers: Record<string, unknown> | null;
};

type DimScore = { score: number; max: number };

/** "18 / 25" → { score: 18, max: 25 }. Devuelve null si no cuadra. */
function parseDim(valor: unknown): DimScore | null {
  if (typeof valor === "number") return { score: valor, max: 25 };
  if (typeof valor !== "string") return null;
  const m = valor.match(/(-?\d+)\s*\/\s*(\d+)/);
  if (m) return { score: Number(m[1]), max: Number(m[2]) };
  const solo = valor.match(/-?\d+/);
  return solo ? { score: Number(solo[0]), max: 25 } : null;
}

function parseTotal(valor: unknown): number | null {
  if (typeof valor === "number") return valor;
  if (typeof valor !== "string") return null;
  const m = valor.match(/-?\d+/);
  return m ? Number(m[0]) : null;
}

function perfilPara(score: number): string | null {
  const p = PROFILES.find((x) => score >= x.min && score <= x.max);
  return p ? p.nombre : null;
}

// ── Revertir ─────────────────────────────────────────────────────────────────
async function revertir(): Promise<void> {
  const { data, error } = await db
    .from("assessments")
    .delete()
    .eq("client_id", CLIENT_ID)
    .eq("instrument", INSTRUMENT)
    .eq("source", SOURCE_MARK)
    .select("id");

  if (error) {
    console.error("Error al revertir:", error.message);
    process.exit(1);
  }
  console.log(`Revertido: ${data?.length ?? 0} evaluaciones borradas.`);
}

// ── Backfill ─────────────────────────────────────────────────────────────────
async function backfill(): Promise<void> {
  const { data: leads, error } = await db
    .from("leads")
    .select("id, name, email, profile, created_at, answers")
    .eq("client_id", CLIENT_ID)
    .eq("source", SOURCE_LEADS)
    .not("answers", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error al leer leads:", error.message);
    process.exit(1);
  }

  const todos = (leads ?? []) as Lead[];

  // Solo los que traen puntaje. Los demás abandonaron a media evaluación.
  const completos = todos.filter(
    (l) => l.answers != null && parseTotal(l.answers[KEY_TOTAL]) != null,
  );
  const incompletos = todos.length - completos.length;

  // Idempotencia: qué leads ya tienen su evaluación.
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
  let fueraDeRango = 0;
  let saltados = 0;

  for (const lead of completos) {
    if (existentes.has(lead.id)) {
      saltados++;
      continue;
    }
    const answers = lead.answers as Record<string, unknown>;
    const total = parseTotal(answers[KEY_TOTAL]);
    if (total == null) continue;

    if (total < MIN_SCORE || total > MAX_SCORE) {
      fueraDeRango++;
      console.warn(`  ⚠️  ${lead.email ?? lead.id}: puntaje ${total} fuera de ${MIN_SCORE}-${MAX_SCORE}`);
    }

    const dimensions: Record<string, DimScore> = {};
    for (const [k, v] of Object.entries(answers)) {
      if (!k.startsWith(DIM_PREFIX)) continue;
      const d = parseDim(v);
      if (d) dimensions[k.slice(DIM_PREFIX.length)] = d;
    }

    const calculado = perfilPara(total);
    if (lead.profile && calculado && lead.profile !== calculado) {
      desacuerdos.push(
        `  ⚠️  ${lead.email ?? lead.id}: lead.profile="${lead.profile}" vs calculado="${calculado}" (${total})`,
      );
    }

    filas.push({
      client_id: CLIENT_ID,
      lead_id: lead.id,
      instrument: INSTRUMENT,
      milestone: "inicio",
      taken_at: lead.created_at,
      total_score: total,
      max_score: MAX_SCORE,
      profile: lead.profile ?? calculado,
      dimensions,
      answers,
      source: SOURCE_MARK,
    });
  }

  console.log("");
  console.log(`Leads de "${SOURCE_LEADS}" con answers : ${todos.length}`);
  console.log(`  con puntaje completo               : ${completos.length}`);
  console.log(`  incompletos (se quedan como lead)  : ${incompletos}`);
  console.log(`  ya tenían su evaluación            : ${saltados}`);
  console.log(`  por insertar                       : ${filas.length}`);
  if (fueraDeRango) console.log(`  puntajes fuera de rango            : ${fueraDeRango}`);
  console.log("");

  if (desacuerdos.length) {
    console.log(`Perfil guardado vs. calculado — ${desacuerdos.length} desacuerdos:`);
    desacuerdos.forEach((d) => console.log(d));
    console.log("");
  } else {
    console.log("Perfil guardado y calculado coinciden en el 100% de los casos.");
    console.log("");
  }

  const conDims = filas.filter((f) => Object.keys(f.dimensions as object).length === 6).length;
  console.log(`Filas con las 6 dimensiones parseadas: ${conDims} de ${filas.length}`);
  console.log("");

  if (DRY_RUN) {
    console.log("--dry-run: no se escribió nada.");
    return;
  }
  if (!filas.length) {
    console.log("Nada que insertar.");
    return;
  }

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

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("");
  console.log("FishFlow — backfill de evaluaciones de Criterio → assessments");
  console.log(`Modo: ${REVERTIR ? "REVERTIR" : DRY_RUN ? "dry-run" : "escritura"}`);
  if (REVERTIR) {
    await revertir();
  } else {
    await backfill();
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
