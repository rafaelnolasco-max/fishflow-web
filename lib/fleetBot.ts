// FishFlow — Telemática · bot de preguntas sobre una flotilla ("Pregúntale a tu flotilla").
// Módulo para TODAS las flotillas de LUKON: panel /app/lukon y vistas por NIP /flotilla/<slug>.
//
// La IA no ve datos crudos ni escribe SQL: solo puede llamar consultas fijas de
// lib/fleetData.ts, siempre amarradas al client_id de la flotilla que se está viendo
// (lo pone el servidor, nunca el modelo). Así cada quien solo pregunta por sus unidades
// y las cifras cuadran con el Reporte mensual.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  coverage, dailyStats, lastPositions, loadFleet, summarize, todayCdmx, vehName,
  type FleetContext, type FleetVehicle,
} from "@/lib/fleetData";

export const FLEET_BOT_MODEL = process.env.FLEET_BOT_MODEL || "claude-haiku-4-5-20251001";
const MAX_ROUNDS = 6;
const MAX_DAYS = 400;

export interface ChatMsg { role: "user" | "assistant"; content: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const days = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 864e5;

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s·_-]+/g, " ").trim();
}

/** "06", "selome 6", "X84-BCM", "la 22" → unidad. */
export function resolveUnit(fleet: FleetContext, q: string): FleetVehicle | null {
  const n = norm(q);
  if (!n) return null;
  const vs = fleet.vehicles;
  const exact = vs.find(v => [v.alias, v.plate, v.device_id].some(x => x && norm(x) === n));
  if (exact) return exact;
  const contains = vs.filter(v => [v.alias, v.plate].some(x => x && (norm(x).includes(n) || n.includes(norm(x)))));
  if (contains.length === 1) return contains[0];
  const num = n.match(/(\d{1,3})\s*$/)?.[1];
  if (num) {
    const hits = vs.filter(v => (v.alias ?? "").match(/(\d{1,3})\s*$/)?.[1]?.replace(/^0+/, "") === num.replace(/^0+/, ""));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

const tools: Anthropic.Tool[] = [
  {
    name: "resumen_flotilla",
    description: "Totales de la flotilla y de cada unidad en un periodo: km, días con uso, horas en movimiento, ralentí, km fuera de horario y de noche, excesos de velocidad, velocidad máxima, aceleraciones/frenadas bruscas, arrancones, jornada continua más larga, litros y costo estimado de combustible, batería. Úsalo para rankings, comparaciones entre unidades y entre periodos (llámalo una vez por periodo).",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha inicial YYYY-MM-DD (inclusive, hora CDMX)" },
        hasta: { type: "string", description: "Fecha final YYYY-MM-DD (inclusive)" },
        unidad: { type: "string", description: "Opcional: nombre, número o placa de una unidad para ver solo esa" },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "detalle_por_dia",
    description: "Día por día de UNA unidad: km, primera salida, último movimiento, horas en movimiento y ralentí, km fuera de horario y de noche, excesos, vel. máxima, eventos bruscos, batería en reposo. Máximo 93 días.",
    input_schema: {
      type: "object",
      properties: {
        unidad: { type: "string", description: "Nombre, número o placa de la unidad" },
        desde: { type: "string", description: "YYYY-MM-DD" },
        hasta: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["unidad", "desde", "hasta"],
    },
  },
  {
    name: "ultima_ubicacion",
    description: "Último reporte de cada unidad (o de una): hora, lugar, velocidad, motor encendido, batería y si lleva 24 h o más sin reportar.",
    input_schema: {
      type: "object",
      properties: { unidad: { type: "string", description: "Opcional: una unidad" } },
    },
  },
];

async function runTool(db: SupabaseClient, fleet: FleetContext, name: string, input: Record<string, string>) {
  const unitArg = input.unidad?.trim();
  const unit = unitArg ? resolveUnit(fleet, unitArg) : null;
  if (unitArg && !unit) {
    return { error: `No encontré la unidad "${unitArg}". Unidades válidas: ${fleet.vehicles.map(vehName).join(", ")}` };
  }
  if (name === "ultima_ubicacion") return { unidades: await lastPositions(db, fleet, unit?.id) };

  const { desde, hasta } = input;
  if (!DATE_RE.test(desde ?? "") || !DATE_RE.test(hasta ?? "") || desde > hasta) return { error: "Fechas inválidas: usa YYYY-MM-DD y desde ≤ hasta" };

  if (name === "resumen_flotilla") {
    if (days(desde, hasta) > MAX_DAYS) return { error: `Periodo máximo de ${MAX_DAYS} días` };
    const rows = await dailyStats(db, fleet.id, desde, hasta, unit?.id);
    const { units, total } = summarize(unit ? { ...fleet, vehicles: [unit] } : fleet, rows);
    return {
      periodo: { desde, hasta }, dias_con_datos: new Set(rows.map(r => r.day)).size,
      total: unit ? undefined : total,
      unidades: units.sort((a, b) => b.km - a.km).map(({ vehicle_id: _id, ...u }) => u), // eslint-disable-line @typescript-eslint/no-unused-vars
    };
  }

  if (name === "detalle_por_dia") {
    if (!unit) return { error: "Indica la unidad" };
    if (days(desde, hasta) > 93) return { error: "Máximo 93 días por consulta" };
    const rows = await dailyStats(db, fleet.id, desde, hasta, unit.id);
    return {
      unidad: vehName(unit),
      dias: rows.map(r => ({
        dia: r.day, km: Math.round(r.km * 10) / 10,
        primera_salida: r.first_move?.slice(0, 5) ?? null, ultimo_movimiento: r.last_move?.slice(0, 5) ?? null,
        horas_movimiento: Math.round(r.moving_min / 6) / 10, horas_ralenti: Math.round(r.idle_min / 6) / 10,
        km_fuera_horario: Math.round(r.km_after_hours * 10) / 10, km_noche: Math.round(r.km_night * 10) / 10,
        excesos: r.speeding, vel_max: r.vmax, acel_bruscas: r.harsh_accel, frenadas_bruscas: r.harsh_brake,
        bateria_reposo_v: r.batt_v_rest,
      })),
    };
  }
  return { error: "Herramienta desconocida" };
}

function systemPrompt(fleet: FleetContext, cov: { desde: string | null; hasta: string | null }) {
  const s = fleet.settings;
  const today = todayCdmx();
  const weekday = new Date().toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", weekday: "long" });
  return `Eres el asistente de la flotilla "${fleet.name}" en el panel de LUKON (GPS y telemática). Contestas preguntas del dueño o jefe de flotilla sobre sus unidades.

Hoy es ${weekday} ${today} (hora de Ciudad de México).
Datos disponibles: del ${cov.desde ?? "—"} al ${cov.hasta ?? "—"}. Antes de esa fecha no hay datos.
Configuración: horario laboral ${s.work_start_hour}:00–${s.work_end_hour}:00 entre semana${s.sat_end_hour ? `, sábado hasta ${s.sat_end_hour}:00` : ""}; fuera de eso cuenta como "fuera de horario". Exceso de velocidad = más de ${s.speeding_kmh} km/h. ${s.fuel_price_mxn ? `Precio de combustible: $${s.fuel_price_mxn}/L.` : "No hay precio de combustible capturado: solo puedes dar litros estimados, no pesos."} "De noche" = entre 22:00 y 5:00.
Unidades (${fleet.vehicles.length}): ${fleet.vehicles.map(v => `${vehName(v)}${v.vehicle_desc ? ` [${v.vehicle_desc}]` : ""}`).join("; ")}.

Reglas:
- Usa SIEMPRE las herramientas para cualquier cifra. Nunca inventes ni estimes números que no vengan de ellas. Si la pregunta no se puede contestar con estos datos (p. ej. quién manejaba, rutas a clientes, RPM), dilo en una línea y sugiere qué sí puedes responder.
- Interpreta fechas relativas desde hoy: "esta semana" = lunes a hoy; "la semana pasada" = lunes a domingo anteriores; "este mes" = día 1 a hoy; "octubre" = 1 al 31 de octubre del año en curso salvo que ya haya pasado más de un año.
- Responde en español, de tú, directo y breve (máximo ~120 palabras). Cifras con separador de miles (12,345 km) y redondeadas. Para rankings o comparaciones usa una lista corta con guiones (nunca tablas). Puedes usar **negritas** para resaltar la cifra clave.
- Menciona el periodo que usaste. Si un dato es estimado (litros, costo), dilo.
- Litros = km ÷ rendimiento de cada unidad. Los eventos bruscos por 100 km solo se califican con 200 km o más.
- No hables de herramientas, bases de datos ni de cómo funcionas por dentro. No menciones a FishFlow.`;
}

/** Corre la conversación con herramientas y regresa el texto final. */
export async function askFleetBot(db: SupabaseClient, clientId: string, messages: ChatMsg[]) {
  const fleet = await loadFleet(db, clientId);
  if (!fleet) throw new Error("Flotilla no encontrada");
  const cov = await coverage(db, clientId);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const convo: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role, content: m.content }));
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const resp = await anthropic.messages.create({
      model: FLEET_BOT_MODEL, max_tokens: 1000, system: systemPrompt(fleet, cov), tools, messages: convo,
    });
    const uses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (resp.stop_reason !== "tool_use" || !uses.length) {
      return resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("").trim()
        || "No encontré una respuesta. ¿Puedes reformular la pregunta?";
    }
    convo.push({ role: "assistant", content: resp.content });
    const results = await Promise.all(uses.map(async u => {
      let out: unknown;
      try { out = await runTool(db, fleet, u.name, u.input as Record<string, string>); }
      catch (e) { out = { error: (e as Error).message }; }
      return { type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(out) };
    }));
    convo.push({ role: "user", content: results });
  }
  return "La pregunta requirió demasiadas consultas. Prueba con algo más específico (una unidad o un periodo).";
}
