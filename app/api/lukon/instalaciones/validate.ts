// Validación de los campos editables de una orden de instalación.
import { INSTALLERS } from "@/lib/installations";

const txt = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) || null : v == null ? null : undefined);

const FIELDS: Record<string, number> = {
  customer_name: 120, customer_email: 160, customer_phone: 30, vehicle_brand: 60, vehicle_model: 80,
  vehicle_plate: 20, vehicle_color: 40, address: 300, notes: 1000,
  device_imei: 30, sim_iccid: 30, dashcam_serial: 60, hidden_location: 500, tech_notes: 1000,
};

export function cleanOrder(b: Record<string, unknown>, creating: boolean): { row: Record<string, unknown> } | { error: string } {
  const row: Record<string, unknown> = {};
  for (const [k, max] of Object.entries(FIELDS)) {
    if (!(k in b)) continue;
    const v = txt(b[k], max);
    if (v === undefined) return { error: `Campo inválido: ${k}` };
    row[k] = k === "vehicle_plate" && v ? v.toUpperCase() : v;
  }
  if ("customer_email" in row && row.customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(row.customer_email)))
    return { error: "Correo del cliente inválido" };
  if ("vehicle_year" in b) {
    const y = b.vehicle_year === "" || b.vehicle_year == null ? null : Number(b.vehicle_year);
    if (y !== null && (!Number.isInteger(y) || y < 1950 || y > 2100)) return { error: "Año del vehículo inválido" };
    row.vehicle_year = y;
  }
  if ("installer_no" in b) {
    const n = b.installer_no === "" || b.installer_no == null ? null : Number(b.installer_no);
    if (n !== null && !(INSTALLERS as readonly number[]).includes(n)) return { error: "Instalador inválido" };
    row.installer_no = n;
  }
  if ("service" in b) {
    if (!["gps", "dashcam", "gps_dashcam"].includes(String(b.service))) return { error: "Servicio inválido" };
    row.service = b.service;
  }
  if ("scheduled_at" in b) {
    const s = b.scheduled_at ? new Date(String(b.scheduled_at)) : null;
    if (s && isNaN(s.getTime())) return { error: "Fecha inválida" };
    row.scheduled_at = s ? s.toISOString() : null;
  }
  if (creating && !row.customer_name) return { error: "Falta el nombre del cliente" };
  return { row };
}
