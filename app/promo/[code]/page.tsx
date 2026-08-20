// app/promo/[code]/page.tsx
// El cupón, tal como lo ve el cliente final. Sin login: el código ES la
// credencial, igual que /o/[slug] y /receipt/[id].
//
// Por qué existe esta página y no mandamos una imagen por WhatsApp: wa.me no
// puede adjuntar archivos, solo texto. Un enlace, en cambio, WhatsApp lo pinta
// con su imagen de vista previa — la que genera opengraph-image.tsx. Así el
// mensaje llega viéndose como flyer sin depender de la API de Meta, y de paso
// queda registrado cuándo lo abrieron, que es la única señal de apertura que
// existe en el envío asistido.
//
// La página NO canjea. El canje lo hace el mostrador desde el tablero: si el
// cliente pudiera marcarlo desde su celular, el cupón se quemaría solo.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _admin;
}

type Cupon = {
  code: string;
  state: string;
  expires_at: string;
  offer_label: string;
  campaign_name: string;
  business: string;
  brand_color: string;
  logo_url: string | null;
  nombre: string | null;
};

export async function cuponPorCodigo(code: string): Promise<Cupon | null> {
  const limpio = code.trim().toUpperCase();
  if (!/^[2-9A-HJ-NP-Z]{5}$/.test(limpio)) return null;

  const { data, error } = await admin()
    .from("promo_codes")
    .select("id, code, state, expires_at, client_id, promo_campaigns(name, offer_label), contacts(name)")
    .eq("code", limpio)
    .maybeSingle();
  if (error || !data) return null;

  const fila = data as unknown as {
    id: string;
    code: string;
    state: string;
    expires_at: string;
    client_id: string;
    promo_campaigns: { name: string; offer_label: string } | null;
    contacts: { name: string | null } | null;
  };

  const { data: cfg } = await admin()
    .from("review_settings")
    .select("business_display_name, brand_color, logo_url")
    .eq("client_id", fila.client_id)
    .maybeSingle();

  const s = cfg as { business_display_name: string | null; brand_color: string | null; logo_url: string | null } | null;

  return {
    code: fila.code,
    state: fila.state,
    expires_at: fila.expires_at,
    offer_label: fila.promo_campaigns?.offer_label ?? "Promoción",
    campaign_name: fila.promo_campaigns?.name ?? "",
    business: s?.business_display_name ?? "El negocio",
    brand_color: s?.brand_color ?? "#C9741F",
    logo_url: s?.logo_url ?? null,
    nombre: fila.contacts?.name ?? null,
  };
}

/** Vigente = ni canjeado, ni cancelado, ni caduco. */
export function estaVigente(c: Cupon): boolean {
  return c.state !== "canjeado" && c.state !== "cancelado" && new Date(c.expires_at) > new Date();
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long", timeZone: "America/Mexico_City",
  });
}

export async function generateMetadata(
  { params }: { params: Promise<{ code: string }> },
): Promise<Metadata> {
  const { code } = await params;
  const cupon = await cuponPorCodigo(code);
  if (!cupon) return { title: "Cupón no válido" };
  return {
    title: `${cupon.offer_label} · ${cupon.business}`,
    description: `Enseña el código ${cupon.code} en el mostrador. Vence ${fechaLarga(cupon.expires_at)}.`,
    robots: { index: false, follow: false },
  };
}

export default async function CuponPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const cupon = await cuponPorCodigo(code);

  if (!cupon) {
    return (
      <Marco color="#64748B">
        <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Este cupón no existe</h1>
        <p style={{ opacity: 0.75, margin: 0 }}>
          Revisa el enlace del mensaje, o pregunta en el mostrador.
        </p>
      </Marco>
    );
  }

  // Primera apertura. Se hace sin await bloqueante del resultado porque si esto
  // falla, el cliente igual tiene que poder ver su cupón.
  void admin()
    .from("promo_codes")
    .update({ viewed_at: new Date().toISOString() })
    .eq("code", cupon.code)
    .is("viewed_at", null)
    .then(({ error }) => {
      if (error) console.error("[promo] marcar visto:", error);
    });

  const vigente = estaVigente(cupon);
  const canjeado = cupon.state === "canjeado";

  return (
    <Marco color={cupon.brand_color}>
      {cupon.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cupon.logo_url} alt={cupon.business} style={{ height: 44, marginBottom: 14 }} />
      )}
      <div style={{ fontSize: 12, letterSpacing: ".18em", textTransform: "uppercase", opacity: 0.7 }}>
        {cupon.business}
      </div>

      <h1 style={{ fontSize: 30, lineHeight: 1.15, margin: "10px 0 18px", fontWeight: 800 }}>
        {cupon.offer_label}
      </h1>

      {vigente ? (
        <>
          <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
            {cupon.nombre ? `${cupon.nombre.split(" ")[0]}, enseña este código:` : "Enseña este código:"}
          </div>
          <div
            style={{
              fontFamily: "ui-monospace, 'SFMono-Regular', Menlo, monospace",
              fontSize: 46, fontWeight: 800, letterSpacing: 8, padding: "18px 10px",
              background: "#fff", color: cupon.brand_color, borderRadius: 16, textAlign: "center",
              border: "2px dashed rgba(0,0,0,.12)",
            }}
          >
            {cupon.code}
          </div>
          <p style={{ fontSize: 14, marginTop: 16, marginBottom: 0, opacity: 0.85 }}>
            Vence el {fechaLarga(cupon.expires_at)}. Un solo uso.
          </p>
        </>
      ) : (
        <div
          style={{
            background: "rgba(255,255,255,.14)", borderRadius: 16, padding: "20px 18px",
            border: "1px solid rgba(255,255,255,.25)",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>
            {canjeado ? "Este cupón ya se usó" : "Este cupón ya venció"}
          </div>
          <p style={{ fontSize: 14, margin: 0, opacity: 0.85 }}>
            {canjeado
              ? "Gracias por venir. Te avisamos cuando salga la siguiente."
              : `Venció el ${fechaLarga(cupon.expires_at)}. Te avisamos de la próxima.`}
          </p>
        </div>
      )}

      <div style={{ marginTop: 26, fontSize: 11, opacity: 0.6 }}>
        {cupon.business} · Automatizado por FishFlow
      </div>
    </Marco>
  );
}

function Marco({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh", background: color, color: "#fff", display: "grid", placeItems: "center",
        padding: "28px 18px",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>{children}</div>
    </main>
  );
}
