import type { DashTheme } from "@/components/dashboard";

/**
 * Paleta JJ Laboral Asociados.
 * Azul marino y dorado, tomados de sus artes de Instagram: fondo marino con
 * balanza y tipografía dorada. El marino va de acento porque es el color que
 * carga botón con texto blanco; el dorado se reserva para el sello del header.
 */
export const BRAND = {
  navy:     "#1B3A63",
  navyDark: "#0E2340",
  navySoft: "#E8EEF6",
  gold:     "#C6A15B",
  bg:       "#F6F8FB",
  white:    "#FFFFFF",
  text:     "#16233A",
  muted:    "#63708A",
  border:   "#DEE5EF",
  red:      "#C0392B",
  gray:     "#9AA5B8",
} as const;

export const T: DashTheme = {
  accent:     BRAND.navy,
  accentDark: BRAND.navyDark,
  accentSoft: BRAND.navySoft,
  bg:         BRAND.bg,
  surface:    BRAND.white,
  text:       BRAND.text,
  muted:      BRAND.muted,
  border:     BRAND.border,
  danger:     BRAND.red,
  disabled:   BRAND.gray,
  panel:      "#FAFBFD",
};
