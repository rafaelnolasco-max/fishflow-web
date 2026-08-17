"use client";

/**
 * Wrapper CANE de la ventana "Programar".
 * La lógica vive en components/schedule/ScheduleTab.tsx (multi-tenant).
 *
 * Karlita hace sus imágenes y sus textos por su cuenta y hasta hoy nos los
 * mandaba por WhatsApp para que los subiéramos a mano. Esta ventana le quita ese
 * paso: publica ella, directo, en el día y la hora que escoja.
 *
 * No sustituye a la pestaña de Contenido — esa sigue ahí para quien quiera que
 * la IA le escriba.
 *
 * Los destinos y su cadencia NO están aquí: viven en
 * content_settings.blotato_accounts, para poder cambiarlos con un UPDATE.
 */

import React from "react";
import { CANE_CLIENT_ID } from "@/lib/supabase";
import SharedScheduleTab from "@/components/schedule/ScheduleTab";
import type { DashTheme } from "@/components/dashboard";

// Paleta CANE (misma que page.tsx)
const T: DashTheme = {
  accent: "#2A9D8F", accentDark: "#2A9D8F", accentSoft: "#E0F4F2",
  bg: "#F7F9FC", surface: "#FFFFFF", text: "#1A1A2E",
  muted: "#6B7280", border: "#E5E7EB", danger: "#EF4444", disabled: "#9CA3AF",
  panel: "#F9FAFB",
};

export default function ScheduleTab() {
  return (
    <SharedScheduleTab
      clientId={CANE_CLIENT_ID}
      theme={T}
      // Sus carruseles son divulgativos; es el formato que mejor le calza al
      // botón opcional de "Sugerir texto".
      suggestFormat="psicoeducacion"
    />
  );
}
