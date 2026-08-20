"use client";

// app/app/cafemoran/page.tsx
// Tablero de Café Moran's. Dos módulos: Reputación (canal QR) y Promociones.
//
// Acceso: el dueño (alta en user_client_access) y Rafa como admin. La RLS de
// review_responses y de promo_* cuelga de user_has_access_to_client, así que
// quien no esté dado de alta simplemente no ve filas — no hay que filtrar nada
// a mano aquí.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, CAFEMORAN_CLIENT_ID } from "@/lib/supabase";
import { DashboardHeader, TabBar, type DashTheme } from "@/components/dashboard";
import ReviewsTab from "@/components/reviews/ReviewsTab";
import PromosTab from "@/components/promos/PromosTab";

// Paleta de café. Provisional hasta tener la marca real de Moran's; el color de
// la encuesta pública ya sale de review_settings.brand_color.
const T: DashTheme = {
  accent: "#C9741F",
  accentDark: "#8A4E13",
  accentSoft: "#FBEEE0",
  bg: "#FAF7F2",
  surface: "#FFFFFF",
  text: "#2E1F17",
  muted: "#7C6A5E",
  border: "#E7DDD1",
  danger: "#DC2626",
  disabled: "#CBD5E1",
  panel: "#F6EFE5",
};

type Tab = "resenas" | "promos";

export default function CafeMoranPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<"cargando" | "listo" | "sin-acceso">("cargando");
  const [tab, setTab] = useState<Tab>("resenas");

  const verificar = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login?next=/app/cafemoran");
      return;
    }
    // Fail closed: si la consulta falla, se trata como sin acceso.
    const { data, error } = await supabase
      .from("user_client_access")
      .select("client_id")
      .eq("user_id", user.id)
      .eq("client_id", CAFEMORAN_CLIENT_ID)
      .maybeSingle();
    setEstado(!error && data ? "listo" : "sin-acceso");
  }, [router]);

  useEffect(() => {
    void verificar();
  }, [verificar]);

  async function salir() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (estado === "cargando") {
    return (
      <main style={{ ...pagina, display: "grid", placeItems: "center" }}>
        <p style={{ color: T.muted, fontSize: 14 }}>Cargando…</p>
      </main>
    );
  }

  if (estado === "sin-acceso") {
    return (
      <main style={{ ...pagina, display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 380 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: T.text, margin: "0 0 6px" }}>
            Sin acceso a este tablero
          </h1>
          <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.6, margin: "0 0 18px" }}>
            Tu cuenta no está dada de alta en Café Moran&apos;s. Si crees que es un error,
            escríbele a FishFlow.
          </p>
          <button onClick={() => void salir()} style={botonSalir}>
            Cambiar de cuenta
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={pagina}>
      <DashboardHeader
        icon="☕"
        title="Café Moran's"
        subtitle="Opiniones y promociones · Militar Marte"
        theme={T}
        onLogout={() => void salir()}
        iconBg={T.accentSoft}
        sticky
      />
      <div style={contenido}>
        <TabBar<Tab>
          theme={T}
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "resenas", label: "Opiniones", icon: "⭐" },
            { id: "promos", label: "Promociones", icon: "🎟️" },
          ]}
        />
        {/* Las dos pestañas se montan y desmontan: cada una hace sus propias
            consultas al entrar, y así el tablero no arrastra datos viejos. */}
        {tab === "resenas" ? (
          <ReviewsTab
            clientId={CAFEMORAN_CLIENT_ID}
            theme={T}
            personLabel="cliente"
            personLabelPlural="clientes"
            showTouchpoints
            emptyHint="Los contactos entran solos cuando alguien escanea el QR y deja su WhatsApp."
          />
        ) : (
          <PromosTab clientId={CAFEMORAN_CLIENT_ID} theme={T} businessName="Café Moran's" />
        )}
      </div>
    </main>
  );
}

const pagina: React.CSSProperties = {
  minHeight: "100vh",
  background: T.bg,
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  color: T.text,
};

const contenido: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "22px clamp(14px, 3vw, 28px) 60px",
};

const botonSalir: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 9,
  border: `1px solid ${T.border}`,
  background: "#fff",
  color: T.text,
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};
