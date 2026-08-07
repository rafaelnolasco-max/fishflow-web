"use client";

/**
 * Wrapper CANE del módulo de Contenido compartido.
 * La lógica vive en components/content/ContentTab.tsx (multi-tenant).
 *
 * Los formatos son los que Karlita ya usa en @cane_mexico. No son genéricos:
 * salen de su propio feed, por eso el generador suena a ella y no a IA.
 */

import React from "react";
import { CANE_CLIENT_ID } from "@/lib/supabase";
import SharedContentTab, { type ContentFormat } from "@/components/content/ContentTab";
import type { DashTheme } from "@/components/dashboard";

// Paleta CANE (misma que page.tsx)
const T: DashTheme = {
  accent: "#2A9D8F", accentDark: "#2A9D8F", accentSoft: "#E0F4F2",
  bg: "#F7F9FC", surface: "#FFFFFF", text: "#1A1A2E",
  muted: "#6B7280", border: "#E5E7EB", danger: "#EF4444", disabled: "#9CA3AF",
  panel: "#F9FAFB",
};

const FORMATOS: ContentFormat[] = [
  {
    id: "pregunta_consulta",
    label: "Pregunta de consulta",
    icon: "💬",
    hint: "Abre con una pregunta real de paciente y explica el mecanismo detrás. Es el formato que más alcance te ha dado.",
  },
  {
    id: "reflexion",
    label: "Reflexión",
    icon: "✨",
    hint: "Una o dos frases que le dan la vuelta a una creencia común. Para arte tipográfico.",
  },
  {
    id: "psicoeducacion",
    label: "Psicoeducación",
    icon: "🧠",
    hint: "Carrusel divulgativo: señales, mitos, qué sí y qué no.",
  },
  {
    id: "pov",
    label: "POV de consulta",
    icon: "🎬",
    hint: "Video corto con humor cálido sobre la vida real de la consulta.",
  },
  {
    id: "personal",
    label: "Personal",
    icon: "🎧",
    hint: "Tú fuera del rol clínico: lo que escuchas, tu consultorio, tu rutina.",
  },
];

export default function ContentTab() {
  return (
    <SharedContentTab
      clientId={CANE_CLIENT_ID}
      theme={T}
      formats={FORMATOS}
      network="Instagram y Facebook"
    />
  );
}
