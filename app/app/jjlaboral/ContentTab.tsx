"use client";

/**
 * Wrapper JJ Laboral del módulo de Contenido compartido.
 * La lógica vive en components/content/ContentTab.tsx (multi-tenant).
 *
 * Los formatos NO son genéricos: salen del feed real de @jjlaboral y de su
 * página de Facebook (JJ Laboral Asociados), leídos el 2026-08-11. El despacho
 * publica infografías de derecho laboral dirigidas al trabajador, y cada
 * publicación repite la misma estructura: gancho con emoji → explicación →
 * lista con viñetas → "⚖️ Recuerda:" → bloque del despacho → contacto → firma.
 *
 * El orden refleja lo que más publica, no lo que más alcance tiene: la cuenta
 * es joven (11 seguidores en IG, 39 en FB) y todavía no hay señal de alcance
 * confiable. Cuando la haya, reordenar aquí igual que se hizo con Tinto Sentido.
 *
 * ⚠️ La voz vive en content_settings.voice_profile y los guardrails jurídicos en
 * content_settings.guardrails = 'legal'. Se ajustan con un UPDATE, sin deploy.
 */

import React from "react";
import { JJLABORAL_CLIENT_ID } from "@/lib/supabase";
import SharedContentTab, { type ContentFormat } from "@/components/content/ContentTab";
import { T } from "./theme";

const FORMATOS: ContentFormat[] = [
  {
    id: "derecho_explicado",
    label: "Tu derecho explicado",
    icon: "⚖️",
    hint: "El que más publicas: caja de ahorro, constancia laboral, prima de antigüedad. Afirma el derecho y explica cuándo aplica.",
  },
  {
    id: "mito_vs_realidad",
    label: "No te dejes engañar",
    icon: "🔴",
    hint: "Dos conceptos que el trabajador confunde y esa confusión le cuesta dinero. El arte va partido en dos columnas.",
  },
  {
    id: "que_hacer_si",
    label: "Qué hacer si…",
    icon: "📋",
    hint: "Para lo que ya le está pasando al lector: acta administrativa, visita del inspector, despido. Sale en pasos.",
  },
  {
    id: "alerta_patron",
    label: "Lo que tu patrón no puede hacer",
    icon: "⚠️",
    hint: "Prácticas que se normalizaron y no proceden. Firme, pero sobre la ley: sin denigrar a las empresas.",
  },
  {
    id: "fecha_clave",
    label: "Fecha clave del calendario",
    icon: "📅",
    hint: "Aguinaldo, PTU, vacaciones, salario mínimo. Pon los montos y las fechas en las notas: la IA no los inventa.",
  },
  {
    id: "pov_despacho",
    label: "Al frente de la cámara",
    icon: "🎬",
    hint: "Video corto de 30 a 45 segundos. El gancho es el rótulo sobre el video y el pie va breve.",
  },
];

export default function ContentTab() {
  return (
    <SharedContentTab
      clientId={JJLABORAL_CLIENT_ID}
      theme={T}
      formats={FORMATOS}
      network="Instagram, Facebook y TikTok"
      topicPlaceholder="Diferencia entre finiquito y liquidación"
      notesPlaceholder="Artículo de la LFT si lo quieres citar, montos, plazos, el ángulo que te interesa…"
    />
  );
}
