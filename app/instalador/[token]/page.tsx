// /instalador/[token] — página del instalador de LUKON (liga privada por orden, sin cuenta).
// Solo esa orden: empezar, fotos, datos del equipo y terminar. Ver lib/installationsAuth.ts.
import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/telematicaAuth";
import { LUKON_ID } from "@/lib/installations";
import InstallerView from "./InstallerView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "Instalación · LUKON" },
  robots: { index: false, follow: false },
  icons: { icon: "/demos/lukon-sitio/img/favicon.svg", apple: "/demos/lukon-sitio/img/apple-touch-icon.png" },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Props = { params: Promise<{ token: string }> };

export default async function Page({ params }: Props) {
  const { token } = await params;
  let id: string | null = null;
  if (UUID_RE.test(token)) {
    const { data } = await supabaseAdmin().from("telematica_installations")
      .select("id, status").eq("installer_token", token).eq("client_id", LUKON_ID).maybeSingle();
    if (data && data.status !== "cancelada") id = data.id;
  }
  return <InstallerView id={id} token={token} />;
}
