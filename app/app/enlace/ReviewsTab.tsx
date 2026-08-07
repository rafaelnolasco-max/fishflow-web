"use client";

/**
 * Wrapper Enlace del módulo de Reseñas compartido.
 * La lógica vive en components/reviews/ReviewsTab.tsx (multi-tenant).
 * smartReplies activo: los mensajes 2 y 3 los redacta la IA con la
 * respuesta del cliente (mismo patrón que CANE).
 */

import React from "react";
import { ENLACE_CLIENT_ID } from "@/lib/supabase";
import SharedReviewsTab, { normalizePhone } from "@/components/reviews/ReviewsTab";
import type { DashTheme } from "@/components/dashboard";

export { normalizePhone };
export type { ReviewSettings, ReviewRequest, ReviewVendor } from "@/components/reviews/ReviewsTab";

// Paleta Enlace Integral (misma que page.tsx)
const T: DashTheme = {
  accent: "#65BC7B", accentDark: "#4B9A62", accentSoft: "#EAF7EE",
  bg: "#F4F7F5", surface: "#FFFFFF", text: "#212934",
  muted: "#5D7080", border: "#E2EAE5", danger: "#D64545", disabled: "#9CA3AF",
};

export default function ReviewsTab() {
  return (
    <SharedReviewsTab
      clientId={ENLACE_CLIENT_ID}
      theme={T}
      personLabel="cliente"
      personLabelPlural="clientes"
      smartReplies
      showVendors
    />
  );
}
