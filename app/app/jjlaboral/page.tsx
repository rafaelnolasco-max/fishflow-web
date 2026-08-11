"use client";

/**
 * Tablero de JJ Laboral Asociados (vertical legal_laboral).
 *
 * Un solo módulo por ahora: Contenido. Genera publicaciones con la voz del
 * despacho y exporta CSV para Canva Bulk Create, igual que CANE y Tinto Sentido.
 * Sin tablas propias: todo vive en content_posts / content_settings filtrado
 * por client_id.
 *
 * Sin TabBar a propósito — con una sola pestaña estorba. Cuando entre Reseñas
 * (o el programador de Blotato) se agrega igual que en /app/tintosentido.
 */

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { DashboardHeader } from "@/components/dashboard";
import ContentTab from "./ContentTab";
import { BRAND, T } from "./theme";

export default function JJLaboralPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/login?next=/app/jjlaboral");
      else setChecking(false);
    });
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login?next=/app/jjlaboral");
  }

  return (
    <div style={{ minHeight: "100vh", background: BRAND.bg, fontFamily: "Inter, system-ui, sans-serif" }}>
      <DashboardHeader
        theme={T}
        sticky
        onLogout={logout}
        iconShape="square"
        icon={<span style={{ color: BRAND.gold, fontWeight: 800, fontSize: 14 }}>JJ</span>}
        title="JJ Laboral Asociados"
        subtitle="Contenido para redes · @jjlaboral"
        right={
          // Regreso al otro panel de la misma cuenta. Ver el header de
          // /app/belange, que trae el salto en sentido contrario.
          <a href="/app/belange"
            style={{
              display: "flex", alignItems: "center", gap: 6, textDecoration: "none",
              border: `1px solid ${BRAND.border}`, borderRadius: 8, padding: "6px 12px",
              fontSize: 12, fontWeight: 600, color: BRAND.muted, whiteSpace: "nowrap",
            }}>
            💈 Belange
          </a>
        }
      />

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px clamp(14px, 3vw, 28px) 60px" }}>
        {checking ? (
          <div style={{ padding: 60, textAlign: "center", color: BRAND.muted, fontSize: 14 }}>
            Cargando…
          </div>
        ) : (
          <ContentTab />
        )}
      </main>
    </div>
  );
}
