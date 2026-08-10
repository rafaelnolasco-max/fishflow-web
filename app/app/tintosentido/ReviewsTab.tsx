"use client";

/**
 * Wrapper Tinto Sentido del módulo de Reseñas compartido.
 * La lógica vive en components/reviews/ReviewsTab.tsx (multi-tenant).
 *
 * smartReplies activo: los mensajes 2 y 3 los redacta la IA con la respuesta real
 * del invitado, usando review_settings.ai_persona (voz de Marissa por WhatsApp).
 */

import React from "react";
import { TINTOSENTIDO_CLIENT_ID } from "@/lib/supabase";
import SharedReviewsTab, { normalizePhone } from "@/components/reviews/ReviewsTab";
import { T } from "./theme";

export { normalizePhone };
export type { ReviewSettings, ReviewRequest } from "@/components/reviews/ReviewsTab";

export default function ReviewsTab() {
  return (
    <SharedReviewsTab
      clientId={TINTOSENTIDO_CLIENT_ID}
      theme={T}
      personLabel="invitado"
      personLabelPlural="invitados"
      emptyHint="Sube la lista de quienes asistieron a la última experiencia y manda la cola desde tu celular."
      smartReplies
    />
  );
}
