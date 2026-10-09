// FishFlow — Telemática (módulo Recorridos, add-on de Lukon)
// ─────────────────────────────────────────────────────────────────────────────
// Parser del export "Sistema de Monitoreo Vehicular LUKON" (CSV o XLSX).
// Puro: corre en el navegador (la carga se parsea del lado del cliente para no
// toparse con el límite de 4.5 MB del body en Vercel) y en el servidor.
//
// Formato observado (oct-2026):
//   - XLSX: fila 1 = título "Sistema de Monitoreo Vehicular LUKON", fila 2 = encabezados.
//   - CSV:  fila 1 = encabezados.
//   - Columnas: Nombre · Latitud-Longitud · Fecha-Hora (YYYY-MM-DD_HH:MM:SS, hora CDMX)
//     · Estado · Tipo dato - evento · Vel (km/h) · Dir · Sen · Sat · Inputs · Odómetro
//     · Bat GPS · Bat Activo · Ign · Domicilio · Buf · Datos_extras (JSON, se ignora)
//   - Sat = -99 significa "sin dato". Un equipo sin cableado de ignición reporta Ign=0 siempre.

export interface TelematicaPoint {
  ts: string;               // ISO con zona -06:00
  lat: number;
  lon: number;
  speed_kmh: number | null;
  heading: number | null;
  event_code: number | null;
  ignition: boolean | null;
  odometer_m: number | null;
  sats: number | null;
  gsm_signal: number | null;
  batt_gps_pct: number | null;
  batt_vehicle_v: number | null;
  address: string | null;
}

/** Puntos de un equipo dentro de un archivo. */
export interface DeviceGroup {
  device_id: string;
  points: TelematicaPoint[];
  ts_min: string | null;
  ts_max: string | null;
}

export interface ParsedExport {
  groups: DeviceGroup[];    // uno por equipo: un archivo puede traer varias unidades
  total: number;            // puntos válidos en todo el archivo
  skipped: number;          // filas sin coordenadas, fecha o equipo válidos
  missing: string[];        // columnas esperadas que el archivo no trae (para avisar en pantalla)
  header: string[];         // encabezados tal como vienen, para diagnosticar formatos nuevos
}

// Mexico (CDMX) no tiene horario de verano desde 2022: UTC-6 fijo.
const TZ = "-06:00";

const HEADERS = {
  device: "Nombre",
  latlon: "Latitud-Longitud",
  fecha: "Fecha-Hora",
  evento: "Tipo dato - evento",
  vel: "Vel (km/h)",
  dir: "Dir",
  sen: "Sen",
  sat: "Sat",
  odo: "Odómetro",
  batGps: "Bat GPS",
  batVeh: "Bat Activo",
  ign: "Ign",
  domicilio: "Domicilio",
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/** "2026-10-09_08:59:29" → "2026-10-09T08:59:29-06:00" */
export function parseFecha(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[_ T](\d{2}:\d{2}:\d{2})$/.exec(String(v ?? "").trim());
  return m ? `${m[1]}T${m[2]}${TZ}` : null;
}

/**
 * Recibe las filas de la hoja (arreglo de arreglos, como `sheet_to_json(ws, {header:1})`)
 * y devuelve los puntos normalizados. Encuentra sola la fila de encabezados.
 */
export function parseLukonRows(rows: unknown[][]): ParsedExport {
  const hIdx = rows.findIndex(
    r => Array.isArray(r) && r.some(c => String(c).trim() === HEADERS.device) && r.some(c => String(c).trim() === HEADERS.fecha),
  );
  if (hIdx < 0) throw new Error('No encontré los encabezados "Nombre" y "Fecha-Hora": ¿es un export del Sistema de Monitoreo Vehicular?');

  // Comparación sin acentos ni mayúsculas: un CSV leído con otra codificación
  // convierte "Odómetro" en "OdÃ³metro" y no debe perder la columna.
  const norm = (s: string) => s.normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const header = rows[hIdx].map(c => norm(String(c)));
  const col = (name: string) => {
    const n = norm(name);
    const exact = header.indexOf(n);
    if (exact >= 0) return exact;
    // "Odómetro" mal decodificado → "odametro"/"odmetro": basta con prefijo y sufijo
    return header.findIndex(h => h.length >= 6 && h.startsWith(n.slice(0, 2)) && h.endsWith(n.slice(-5)));
  };
  const c = Object.fromEntries(Object.entries(HEADERS).map(([k, v]) => [k, col(v)])) as Record<keyof typeof HEADERS, number>;
  if (c.latlon < 0) throw new Error('Falta la columna "Latitud-Longitud".');

  const byDevice = new Map<string, TelematicaPoint[]>();
  let skipped = 0, total = 0;

  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.length === 0) continue;
    const ts = parseFecha(r[c.fecha]);
    const [latS, lonS] = String(r[c.latlon] ?? "").split(",");
    const lat = num(latS), lon = num(lonS);
    if (!ts || lat === null || lon === null || (lat === 0 && lon === 0)) { skipped++; continue; }

    const dev = String(r[c.device] ?? "").trim();
    if (!dev) { skipped++; continue; }
    let points = byDevice.get(dev);
    if (!points) { points = []; byDevice.set(dev, points); }

    const sats = c.sat >= 0 ? int(r[c.sat]) : null;
    const ign = c.ign >= 0 ? int(r[c.ign]) : null;
    points.push({
      ts, lat, lon,
      speed_kmh:     c.vel >= 0 ? int(r[c.vel]) : null,
      heading:       c.dir >= 0 ? int(r[c.dir]) : null,
      event_code:    c.evento >= 0 ? int(r[c.evento]) : null,
      ignition:      ign === null ? null : ign === 1,
      odometer_m:    c.odo >= 0 ? int(r[c.odo]) : null,
      sats:          sats !== null && sats >= 0 ? sats : null,
      gsm_signal:    c.sen >= 0 ? int(r[c.sen]) : null,
      batt_gps_pct:  c.batGps >= 0 ? int(r[c.batGps]) : null,
      batt_vehicle_v: c.batVeh >= 0 ? num(r[c.batVeh]) : null,
      address:       c.domicilio >= 0 ? (String(r[c.domicilio] ?? "").trim() || null) : null,
    });
  }

  const groups: DeviceGroup[] = [...byDevice.entries()].map(([device_id, points]) => {
    points.sort((a, b) => a.ts.localeCompare(b.ts));
    total += points.length;
    return { device_id, points, ts_min: points[0]?.ts ?? null, ts_max: points[points.length - 1]?.ts ?? null };
  }).sort((a, b) => a.device_id.localeCompare(b.device_id));

  const LABELS: Partial<Record<keyof typeof HEADERS, string>> = {
    vel: "velocidad", ign: "ignición", odo: "odómetro", evento: "tipo de evento",
    batVeh: "batería del vehículo", batGps: "batería del GPS", sat: "satélites", domicilio: "domicilio",
  };
  const missing = (Object.keys(LABELS) as (keyof typeof HEADERS)[]).filter(k => c[k] < 0).map(k => LABELS[k]!);
  return { groups, total, skipped, missing, header: rows[hIdx].map(x => String(x).trim()) };
}

/** Puntos por petición al API de importación (≈200 KB de JSON). */
export const IMPORT_CHUNK = 1000;
