"use client";

/**
 * Pestaña "Publicaciones" del /admin de FishFlow.
 *
 * Es el mismo módulo que usa Karlita en CANE —components/schedule/ScheduleTab—
 * apuntado a las cuentas de FishFlow: Instagram @fishflow.mx y la página de
 * Facebook FishFlow. Aquí Rafa sube el arte, escribe el pie y lo programa, en
 * vez de entrar a Blotato a hacerlo a mano.
 *
 * Lo único propio de esta pantalla es el tema: el resto del /admin vive sobre
 * fondo #0A1820 y el módulo nació con paletas claras de cliente. Los tokens
 * oscuros (inputBg, warnBg, chipBg…) son opcionales en DashTheme, así que
 * ningún tablero de cliente se entera de que existen.
 *
 * Los destinos y su cadencia NO están aquí: viven en
 * content_settings.blotato_accounts del cliente FishFlow, para poder cambiarlos
 * con un UPDATE y sin deploy.
 */

import React from "react";
import { FISHFLOW_CLIENT_ID } from "@/lib/supabase";
import SharedScheduleTab from "@/components/schedule/ScheduleTab";
import type { DashTheme } from "@/components/dashboard";

/** Paleta oscura del /admin (los mismos valores del bloque CSS de page.tsx). */
const T: DashTheme = {
  accent:      "#1FA9D6",
  // accentDark es a la vez color de texto (tab activo, chips) y fondo del toast.
  // Se deja en el mismo azul del CSS del /admin: así el toast queda como los
  // botones primarios (azul con texto blanco) y no como un parche celeste.
  accentDark:  "#1FA9D6",
  accentSoft:  "rgba(31,169,214,.14)",
  bg:          "#0A1820",
  surface:     "#0C2232",
  panel:       "#11313f",
  text:        "#e8f4f8",
  muted:       "#5a8a9e",
  border:      "rgba(255,255,255,0.08)",
  danger:      "#ef4444",
  disabled:    "#345a69",
  inputBg:     "#11313f",
  warnBg:      "rgba(234,179,8,.10)",
  warnBorder:  "rgba(234,179,8,.35)",
  warnText:    "#fbbf24",
  dangerBg:    "rgba(239,68,68,.10)",
  chipBg:      "#11313f",
  infoBg:      "rgba(242,107,23,.15)",
  infoText:    "#F26B17",
};

export default function PublicacionesTab() {
  return (
    <div style={{ padding: "20px 24px 48px", background: T.bg, minHeight: "calc(100vh - 200px)" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        {/* Encabezado: el módulo no dice a qué cuentas publica y aquí importa,
            porque el resto del /admin es de venta y no de redes. */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>
            🗓️ Publicaciones de FishFlow
          </div>
          <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3 }}>
            Instagram @fishflow.mx y la página de Facebook · lunes, miércoles y viernes a las 12:00
          </div>
        </div>

        <SharedScheduleTab
          clientId={FISHFLOW_CLIENT_ID}
          theme={T}
          // El formato con el que redacta "Sugerir texto": la voz de FishFlow
          // vive en content_settings.voice_profile y la estructura en el
          // formato `automatizacion_pyme` de /api/content/draft.
          suggestFormat="automatizacion_pyme"
        />
      </div>
    </div>
  );
}
