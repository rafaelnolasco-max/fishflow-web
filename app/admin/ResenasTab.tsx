"use client";

/**
 * Pestaña "Reseñas" del /admin — el Módulo de Reputación apuntado a FishFlow
 * misma, sobre la línea WhatsApp de la Cloud API (+52 56 1059 7851).
 *
 *  - El mensaje 1 sale como plantilla aprobada `opinion_fishflow`.
 *  - Cuando el cliente contesta, lib/whatsappBot redacta con IA el mensaje 2
 *    (y luego el 3 con el link rastreado /r/<id>/) y lo manda solo.
 *  - Los botones del tablero siguen sirviendo para mandar a mano (misma API).
 *
 * Configuración (link de Google, plantillas base, voz de Rafa) en
 * review_settings del cliente FishFlow. Ritmo sano: 3 a 5 solicitudes por
 * semana, nunca todas el mismo día, y jamás ofrecer nada a cambio.
 */

import React from "react";
import SharedReviewsTab from "@/components/reviews/ReviewsTab";
import { ADMIN_THEME as T } from "./PublicacionesTab";

const FISHFLOW_CLIENT_ID = "b0d1a4f6-3c58-4a7e-9d21-7fe6c0a13b42";

export default function ResenasTab() {
  return (
    <div style={{ padding: "20px 24px 48px", background: T.bg, minHeight: "calc(100vh - 200px)" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>⭐ Reseñas de FishFlow en Google</div>
          <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>
            Salen por WhatsApp (56 1059 7851) y la IA contesta sola cuando el cliente responde · 3 a 5 por semana, nunca todas el mismo día
          </div>
        </div>
        <SharedReviewsTab
          clientId={FISHFLOW_CLIENT_ID}
          theme={T}
          personLabel="cliente"
          personLabelPlural="clientes"
          smartReplies
          waApi
        />
      </div>
    </div>
  );
}
