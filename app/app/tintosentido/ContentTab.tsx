"use client";

/**
 * Wrapper Tinto Sentido del módulo de Contenido compartido.
 * La lógica vive en components/content/ContentTab.tsx (multi-tenant).
 *
 * Los formatos NO son genéricos: salen del feed real de @tintosentidoexp y están
 * ordenados por el alcance que le han dado. Referencia (likes, ago 2026):
 *   Invitación a experiencia (ALMARAZ WHISKY EXPERIENCE) ...... 43
 *   Colaboración con marca aliada (#GinLab Doble Cara) ......... 28
 *   Así se vivió (reel taller de mixología) .................... 22
 *   Detrás de la barra ("Detrás de Tinto Sentido hay risas") ... 20
 *   Brindis del viernes (tipográfico) ..........................  2
 *
 * De ahí el orden y los hints: el generador empuja a Marissa hacia lo que ya le
 * funciona en lugar de tratar todos los formatos como equivalentes.
 */

import React from "react";
import { TINTOSENTIDO_CLIENT_ID } from "@/lib/supabase";
import SharedContentTab, { type ContentFormat } from "@/components/content/ContentTab";
import type { DashTheme } from "@/components/dashboard";
import { T } from "./theme";

const FORMATOS: ContentFormat[] = [
  {
    id: "invitacion_experiencia",
    label: "Invitación a experiencia",
    icon: "🎟️",
    hint: "Tu formato de mayor alcance. Pon fecha, hora, qué incluye y precios en las notas: la IA no inventa esos datos.",
  },
  {
    id: "colaboracion",
    label: "Colaboración con marca",
    icon: "🤝",
    hint: "El destilado invitado es el protagonista y tú lo pones en escena. El más corto y el segundo de mejor alcance.",
  },
  {
    id: "asi_se_vivio",
    label: "Así se vivió",
    icon: "📸",
    hint: "Recap con foto o video real de tus invitados. Agradece, cierra con «¿Vienes al siguiente?» y etiqueta a la marca aliada.",
  },
  {
    id: "detras_barra",
    label: "Detrás de la barra",
    icon: "💜",
    hint: "El proyecto y su gente, sin vender nada. Para las semanas en las que no hay evento próximo que anunciar.",
  },
  {
    id: "viernes_brindis",
    label: "Brindis del viernes",
    icon: "🥂",
    hint: "Frase tipográfica que cierra con pregunta de opciones. Rinde poco alcance: úsalo para mantener presencia, no para vender.",
  },
];

const theme: DashTheme = T;

export default function ContentTab() {
  return (
    <SharedContentTab
      clientId={TINTOSENTIDO_CLIENT_ID}
      theme={theme}
      formats={FORMATOS}
      network="Instagram, Facebook y TikTok"
    />
  );
}
