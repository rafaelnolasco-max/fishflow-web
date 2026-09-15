// FishFlow / Trufa — leer el carnet de papel
// ─────────────────────────────────────────────────────────────────────────────
// Es la pieza de onboarding. Casi ningún suscriptor llega con un cachorro:
// llega con una libreta de cinco años, etiquetas pegadas y letra de tres
// veterinarios distintos. Si tiene que capturar eso a mano, abandona en la
// segunda vacuna.
//
// Lo que sale de aquí es un BORRADOR. Nunca se escribe solo en el carnet: la
// letra manuscrita sobre una etiqueta arrugada se lee mal, y un lote o una
// fecha inventados contaminan el historial médico del animal para siempre. Por
// eso cada registro trae `confianza`, y la pantalla de revisión obliga a que
// una persona confirme antes de guardar.

export const IMPORTAR_MODEL = "claude-sonnet-4-6";

export type Confianza = "alta" | "media" | "baja";

export interface DatosMascota {
  name: string | null;
  species: string | null;
  breed: string | null;
  sex: string | null;
  birth_date: string | null;
  color: string | null;
  microchip: string | null;
}
export interface VacunaLeida {
  applied_on: string; vaccine: string; brand: string | null;
  lot: string | null; next_due_on: string | null; confianza: Confianza;
}
export interface DesparasitacionLeida {
  applied_on: string; kind: string; product: string;
  weight_kg: number | null; next_due_on: string | null; confianza: Confianza;
}
export interface TratamientoLeido {
  applied_on: string; product: string; dose: string | null;
  lot: string | null; weight_kg: number | null; next_due_on: string | null; confianza: Confianza;
}
export interface PesoLeido { measured_on: string; weight_kg: number; confianza: Confianza }
export interface PadecimientoLeido { name: string; diagnosed_on: string | null; notes: string | null }

export interface CarnetLeido {
  mascota: DatosMascota;
  vacunas: VacunaLeida[];
  desparasitaciones: DesparasitacionLeida[];
  tratamientos: TratamientoLeido[];
  pesos: PesoLeido[];
  padecimientos: PadecimientoLeido[];
  /** Lo que se vio pero no se pudo leer. Va a la pantalla para que el dueño lo teclee. */
  ilegibles: string[];
}

export const IMPORTAR_SYSTEM_PROMPT =
  "Transcribes carnets de vacunación de mascotas fotografiados por sus dueños. " +
  "Son libretas de papel: hay etiquetas de frasco pegadas, letra manuscrita de varios " +
  "veterinarios, fotos torcidas y con reflejos. Transcribes lo que ves; no completas, " +
  "no corriges y no deduces lo que falta. Respondes ÚNICAMENTE con JSON válido, sin markdown.";

export function buildImportarPrompt(hoy: string): string {
  return `Estas fotos son de uno o más carnets de vacunación de la MISMA mascota. Pueden estar desordenadas y repetirse páginas.

Devuelve un JSON con EXACTAMENTE esta forma:

{
  "mascota": {
    "name": "string|null", "species": "perro|gato|otro|null", "breed": "string|null",
    "sex": "macho|hembra|null", "birth_date": "YYYY-MM-DD|null",
    "color": "string|null", "microchip": "string|null"
  },
  "vacunas": [{
    "applied_on": "YYYY-MM-DD", "vaccine": "string", "brand": "string|null",
    "lot": "string|null", "next_due_on": "YYYY-MM-DD|null", "confianza": "alta|media|baja"
  }],
  "desparasitaciones": [{
    "applied_on": "YYYY-MM-DD", "kind": "interna|externa", "product": "string",
    "weight_kg": number|null, "next_due_on": "YYYY-MM-DD|null", "confianza": "alta|media|baja"
  }],
  "tratamientos": [{
    "applied_on": "YYYY-MM-DD", "product": "string", "dose": "string|null",
    "lot": "string|null", "weight_kg": number|null, "next_due_on": "YYYY-MM-DD|null",
    "confianza": "alta|media|baja"
  }],
  "pesos": [{ "measured_on": "YYYY-MM-DD", "weight_kg": number, "confianza": "alta|media|baja" }],
  "padecimientos": [{ "name": "string", "diagnosed_on": "YYYY-MM-DD|null", "notes": "string|null" }],
  "ilegibles": ["string"]
}

Reglas, en orden de importancia:

1. NO INVENTES NADA. Si una fecha, un lote o un producto no se leen con seguridad, tienes dos salidas: poner null en ese campo, o —si lo que no se lee es la fecha de aplicación— omitir el registro completo y describirlo en "ilegibles" (por ejemplo: "Una etiqueta de vacuna en la página 3, sin fecha legible"). Un dato inventado se queda en el historial médico del animal para siempre.

2. "confianza" es tu lectura real, no una cortesía. Usa "alta" solo para texto impreso nítido o manuscrito claro; "media" cuando reconstruiste algo por contexto; "baja" cuando dudaste entre dos opciones.

3. FECHAS. En México se escriben "20-Feb-24", "07.09.24", "8 JULIO 2026". Normalízalas a YYYY-MM-DD. Con año de dos dígitos, resuelve por contexto del resto del carnet. Nunca inventes una fecha futura como si fuera aplicación: la fecha anotada en la columna "próxima" va en next_due_on, no en applied_on. Hoy es ${hoy}: una fecha de aplicación posterior a hoy casi siempre es una mala lectura.

4. VACUNAS: usa el nombre de la LÍNEA, no el de la marca. "Quíntuple", "Rabia", "Bordetella", "Giardia", "Leptospira". La marca ("Nobivac DHPPi", "Vanguard Plus 5/CV-L", "Defensor", "Bronchicine CAe") va en "brand". Así, el refuerzo del año que entra sustituye al del año pasado en vez de contarse aparte.

5. TRATAMIENTOS son los productos que no son vacuna ni desparasitante: inmunoterapia, antibióticos, antiinflamatorios. Cytopoint, Apoquel y similares van aquí, con su dosis en mg en "dose".

6. DESPARASITACIÓN: "interna" es la de pastilla o jarabe (Endal, Vermiplex, Endogard, Drontal); "externa" es pulgas y garrapatas (Bravecto, NexGard, Frontline).

7. PESOS: cada kg anotado junto a una fecha es una medición. Van en "pesos" ADEMÁS de quedarse en el registro donde aparecen.

8. PADECIMIENTOS: solo si el carnet lo dice explícitamente. Un producto no es un diagnóstico: no concluyas "dermatitis" porque viste Cytopoint. Si el carnet escribe el padecimiento (a veces la etiqueta lo trae impreso), regístralo.

Responde ÚNICAMENTE con JSON válido.`;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function parseCarnet(raw: string, hoy: string): CarnetLeido | null {
  try {
    const clean = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
    const p = JSON.parse(clean) as Record<string, unknown>;

    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null;
    const fecha = (v: unknown): string | null => {
      const s = str(v);
      return s && ISO.test(s) ? s : null;
    };
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const conf = (v: unknown): Confianza =>
      v === "alta" || v === "media" || v === "baja" ? v : "baja";
    const arr = (v: unknown): Record<string, unknown>[] =>
      Array.isArray(v) ? (v as Record<string, unknown>[]).filter(x => x && typeof x === "object") : [];

    const m = (p.mascota ?? {}) as Record<string, unknown>;
    const ilegibles = Array.isArray(p.ilegibles)
      ? (p.ilegibles as unknown[]).map(str).filter((x): x is string => !!x) : [];

    // Una aplicación en el futuro es una mala lectura, no un registro. Se
    // descarta y se le avisa al dueño en vez de meterla al historial.
    const futuras: string[] = [];
    const pasada = (f: string | null, etiqueta: string): boolean => {
      if (!f) return false;
      if (f > hoy) { futuras.push(`${etiqueta} con fecha ${f}, posterior a hoy — revísala`); return false; }
      return true;
    };

    const vacunas = arr(p.vacunas).map(v => ({
      applied_on: fecha(v.applied_on), vaccine: str(v.vaccine), brand: str(v.brand),
      lot: str(v.lot), next_due_on: fecha(v.next_due_on), confianza: conf(v.confianza),
    })).filter(v => v.applied_on && v.vaccine && pasada(v.applied_on, `Vacuna ${v.vaccine}`)) as VacunaLeida[];

    const desparasitaciones = arr(p.desparasitaciones).map(d => ({
      applied_on: fecha(d.applied_on),
      kind: str(d.kind) === "externa" ? "externa" : "interna",
      product: str(d.product), weight_kg: num(d.weight_kg),
      next_due_on: fecha(d.next_due_on), confianza: conf(d.confianza),
    })).filter(d => d.applied_on && d.product && pasada(d.applied_on, `Desparasitación ${d.product}`)) as DesparasitacionLeida[];

    const tratamientos = arr(p.tratamientos).map(t => ({
      applied_on: fecha(t.applied_on), product: str(t.product), dose: str(t.dose),
      lot: str(t.lot), weight_kg: num(t.weight_kg), next_due_on: fecha(t.next_due_on),
      confianza: conf(t.confianza),
    })).filter(t => t.applied_on && t.product && pasada(t.applied_on, `${t.product}`)) as TratamientoLeido[];

    const pesos = arr(p.pesos).map(w => ({
      measured_on: fecha(w.measured_on), weight_kg: num(w.weight_kg), confianza: conf(w.confianza),
    })).filter(w => w.measured_on && w.weight_kg && w.weight_kg > 0 && w.weight_kg < 120) as PesoLeido[];

    const padecimientos = arr(p.padecimientos).map(c => ({
      name: str(c.name), diagnosed_on: fecha(c.diagnosed_on), notes: str(c.notes),
    })).filter(c => c.name) as PadecimientoLeido[];

    return {
      mascota: {
        name: str(m.name), species: str(m.species), breed: str(m.breed),
        sex: str(m.sex), birth_date: fecha(m.birth_date),
        color: str(m.color), microchip: str(m.microchip),
      },
      vacunas, desparasitaciones, tratamientos, pesos, padecimientos,
      ilegibles: [...ilegibles, ...futuras],
    };
  } catch {
    return null;
  }
}

/** Cuántos registros trae el borrador — para el resumen de la pantalla. */
export function contar(c: CarnetLeido): number {
  return c.vacunas.length + c.desparasitaciones.length + c.tratamientos.length
    + c.pesos.length + c.padecimientos.length;
}
