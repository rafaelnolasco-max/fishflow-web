"use client";

/**
 * Wrapper CANE del módulo de Reseñas compartido.
 * La lógica vive en components/reviews/ReviewsTab.tsx (multi-tenant).
 */

import React from "react";
import { CANE_CLIENT_ID } from "@/lib/supabase";
import SharedReviewsTab, { normalizePhone } from "@/components/reviews/ReviewsTab";
import type { DashTheme } from "@/components/dashboard";

export { normalizePhone };
export type { ReviewSettings, ReviewRequest } from "@/components/reviews/ReviewsTab";

// Paleta CANE (misma que page.tsx)
const T: DashTheme = {
  accent: "#2A9D8F", accentDark: "#2A9D8F", accentSoft: "#E0F4F2",
  bg: "#F7F9FC", surface: "#FFFFFF", text: "#1A1A2E",
  muted: "#6B7280", border: "#E5E7EB", danger: "#EF4444", disabled: "#9CA3AF",
};

export default function ReviewsTab() {
  return (
    <SharedReviewsTab
      clientId={CANE_CLIENT_ID}
      theme={T}
      personLabel="paciente"
      personLabelPlural="pacientes"
      emptyHint="o usa ⭐ desde una cita"
      smartReplies
    />
  );
}
