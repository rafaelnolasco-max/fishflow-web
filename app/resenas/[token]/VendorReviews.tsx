"use client";

/**
 * Tablero de reseñas de una vendedora — acceso por token, sin login.
 * Monta el módulo compartido en modo vendedora; toda la data va por
 * /api/reviews/vendor/[token]. Ver components/reviews/ReviewsTab.tsx.
 */

import React from "react";
import SharedReviewsTab from "@/components/reviews/ReviewsTab";
import type { DashTheme } from "@/components/dashboard";

// Paleta Enlace Integral (misma que /app/enlace)
const T: DashTheme = {
  accent: "#65BC7B", accentDark: "#4B9A62", accentSoft: "#EAF7EE",
  bg: "#F4F7F5", surface: "#FFFFFF", text: "#212934",
  muted: "#5D7080", border: "#E2EAE5", danger: "#D64545", disabled: "#9CA3AF",
};

export default function VendorReviews({ token }: { token: string }) {
  return (
    <div style={{ background: T.bg, minHeight: "100vh" }}>
      <header style={{
        background: T.surface, borderBottom: `3px solid ${T.accent}`,
        padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/clients/enlace/logo.png" alt="Enlace Integral" style={{ height: 34, width: "auto" }} />
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>Reseñas de Google</div>
      </header>

      <main className="vr-main">
        <SharedReviewsTab
          vendorToken={token}
          theme={T}
          personLabel="cliente"
          personLabelPlural="clientes"
          smartReplies
        />

        <section style={{
          marginTop: 22, background: "#FFFBEB", border: "1px solid #FDE68A",
          borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "#92400E", lineHeight: 1.55,
        }}>
          <b>Guarda este enlace.</b> Es tu lista personal y la vas a usar varios días.
          En el celular ábrelo en tu navegador y usa <b>Compartir → Agregar a pantalla de inicio</b>
          {" "}(iPhone) o <b>menú ⋮ → Agregar a pantalla principal</b> (Android). Así lo tienes como una app.
          <div style={{ marginTop: 8 }}>
            Manda máximo <b>15 a 20 mensajes al día</b>. Si mandas muchos de golpe, WhatsApp puede limitar tu número.
          </div>
        </section>

        <footer style={{ textAlign: "center", padding: "22px 0 8px", fontSize: 11.5, color: T.muted }}>
          Enlace Integral Seguros · Uso interno
        </footer>
      </main>

      <style>{`
        .vr-main { max-width: 860px; margin: 0 auto; padding: 18px 16px 40px; }
        @media (max-width: 600px) { .vr-main { padding: 14px 12px 32px; } }
      `}</style>
    </div>
  );
}
