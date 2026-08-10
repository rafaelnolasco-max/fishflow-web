"use client";

/**
 * Tablero de Marissa — Tinto Sentido (vertical experiencias).
 *
 * Dos módulos, ambos compartidos y multi-tenant: Contenido (genera publicaciones
 * con la voz de la marca y exporta CSV para Canva Bulk Create — Marissa tiene
 * Canva Pro) y Reseñas (cola de WhatsApp con smart replies).
 *
 * Sin tablas propias: todo vive en content_posts / content_settings y
 * review_requests / review_settings filtrado por client_id.
 */

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { DashboardHeader, TabBar } from "@/components/dashboard";
import ContentTab from "./ContentTab";
import ReviewsTab from "./ReviewsTab";
import { BRAND, T } from "./theme";

type Tab = "contenido" | "resenas";

export default function TintoSentidoPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("contenido");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/login?next=/app/tintosentido");
    });
  }, [router]);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/login?next=/app/tintosentido");
  }

  return (
    <div style={{ minHeight: "100vh", background: BRAND.bg, fontFamily: "Inter, system-ui, sans-serif" }}>
      <DashboardHeader
        theme={T}
        sticky
        onLogout={logout}
        iconShape="circle"
        icon={<span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>TS</span>}
        title="Tinto Sentido"
        subtitle="Contenido y reseñas · @tintosentidoexp"
      />

      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px clamp(14px, 3vw, 28px) 60px" }}>
        <TabBar
          theme={T}
          tabs={[
            { id: "contenido" as const, label: "Contenido", icon: "✨" },
            { id: "resenas"   as const, label: "Reseñas",   icon: "⭐" },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === "contenido" && <ContentTab />}
        {tab === "resenas" && <ReviewsTab />}
      </main>
    </div>
  );
}
