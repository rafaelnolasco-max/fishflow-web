// FishFlow — Módulo Campañas por correo
// ─────────────────────────────────────────────────────────────────────────────
// Correos uno a uno, ya armados por destinatario (subject/html en la base),
// que salen en tandas diarias desde el dominio del cliente. El botón de
// WhatsApp pasa por /c/<id> para saber quién lo picó; /c/<id>/baja da de baja
// en un clic. El seguimiento (etapa, nota, monto) lo mueve el equipo del
// cliente en su panel.
//
// Tablas: campaigns y campaign_recipients (migración 20261022150000).

export const SITE = "https://www.fishflow.mx";

export type Stage =
  | "pendiente" | "enviado" | "interesado" | "respondio" | "llamada"
  | "aporto" | "lo_pensara" | "no_interesa" | "baja" | "error";

export const STAGE_LABEL: Record<Stage, string> = {
  pendiente: "Por enviar",
  enviado: "Enviado",
  interesado: "Picó WhatsApp",
  respondio: "Respondió",
  llamada: "Llamada agendada",
  aporto: "Aportó",
  lo_pensara: "Lo pensará",
  no_interesa: "No le interesa",
  baja: "Baja",
  error: "No se pudo enviar",
};

/** Etapas que el equipo del cliente puede elegir a mano. */
export const STAGES_MANUALES: Stage[] = [
  "enviado", "interesado", "respondio", "llamada", "aporto", "lo_pensara", "no_interesa", "baja",
];

export const waLink = (id: string) => `${SITE}/c/${id}/`;
export const bajaLink = (id: string) => `${SITE}/c/${id}/baja/`;

/** Llena los marcadores del HTML guardado con las ligas rastreadas del destinatario. */
export function renderRecipientHtml(html: string, id: string): string {
  return html.replaceAll("{{wa_url}}", waLink(id)).replaceAll("{{baja_url}}", bajaLink(id));
}
