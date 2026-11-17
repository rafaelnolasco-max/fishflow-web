// /flotilla/<slug> — reporte de flotilla de un cliente de LUKON, solo lectura, con NIP.
// Acceso temporal mientras el cliente no tiene usuario y contraseña (ver lib/pinAccess.ts).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { pinSessions } from "@/lib/pinAccess";
import FlotillaView from "./FlotillaView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "Reporte de flotilla · LUKON" },
  robots: { index: false, follow: false },
  icons: { icon: "/demos/lukon-sitio/img/favicon.svg", apple: "/demos/lukon-sitio/img/apple-touch-icon.png" },
};

type Props = { params: Promise<{ slug: string }> };

export default async function Page({ params }: Props) {
  const slug = (await params).slug.toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) notFound();

  const db = supabaseAdmin();
  const { data: access } = await db.from("telematica_pin_access")
    .select("client_id, expires_at").eq("slug", slug).maybeSingle();
  if (!access) notFound();
  const { data: fleet } = await db.from("clients").select("name").eq("id", access.client_id).maybeSingle();

  const expired = new Date(access.expires_at).getTime() <= Date.now();
  const authed = !expired && (await pinSessions(slug)).length > 0;
  return <FlotillaView slug={slug} fleetName={fleet?.name ?? "Flotilla"} authed={authed} expired={expired} />;
}
