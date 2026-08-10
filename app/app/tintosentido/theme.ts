import type { DashTheme } from "@/components/dashboard";

/**
 * Paleta Tinto Sentido.
 * El morado ciruela viene del logo y de los artes tipográficos del feed.
 * ⚠️ Aproximado a partir de captura de pantalla: confirmar contra el manual de
 * marca de Marissa cuando lo mande y ajustar aquí (un solo lugar).
 */
export const BRAND = {
  plum:      "#6B3E63",  // morado ciruela del logo
  plumDark:  "#4C2A47",
  plumSoft:  "#F4EBF2",
  wine:      "#8C2F39",  // acento vino para chips y alertas suaves
  bg:        "#FAF7F9",
  white:     "#FFFFFF",
  text:      "#241C22",
  muted:     "#6E6470",
  border:    "#E8DFE6",
  red:       "#C0392B",
  gray:      "#A79EA5",
} as const;

export const T: DashTheme = {
  accent:     BRAND.plum,
  accentDark: BRAND.plumDark,
  accentSoft: BRAND.plumSoft,
  bg:         BRAND.bg,
  surface:    BRAND.white,
  text:       BRAND.text,
  muted:      BRAND.muted,
  border:     BRAND.border,
  danger:     BRAND.red,
  disabled:   BRAND.gray,
  panel:      "#FDFBFC",
};
