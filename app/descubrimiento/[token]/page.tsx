// app/descubrimiento/[token]/page.tsx
// Módulo Descubrimiento — la pantalla que ve el prospecto.
// Sin login: el token de la liga es la credencial. noindex, porque aquí se
// contesta información del negocio de alguien más.

import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { discoveryAdmin, loadInviteByToken } from "@/lib/discovery";
import Cuestionario from "./Cuestionario";
import Aviso from "./Aviso";

export const dynamic = "force-dynamic";

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--ff-mono",
});

export const metadata: Metadata = {
  title: "FishFlow — Sesión de descubrimiento",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = discoveryAdmin();
  const found = await loadInviteByToken(supabase, token);

  if (!found.ok) {
    return (
      <div className={mono.variable}>
        <Aviso
          titulo={found.reason === "expired" ? "Esta liga ya venció" : "Liga no válida"}
          texto={
            found.reason === "expired"
              ? "Por seguridad las ligas caducan. Escríbenos y te mandamos una nueva en un minuto."
              : "Revisa que la liga esté completa. Si la copiaste de un mensaje, puede haberse cortado."
          }
        />
      </div>
    );
  }

  const { invite, template } = found;

  // Primera apertura: se sella para saber si lo abrió y no lo contestó.
  if (!invite.opened_at) {
    await supabase
      .from("discovery_invites")
      .update({ opened_at: new Date().toISOString(), status: "opened" })
      .eq("id", invite.id);
  }

  if (invite.status === "submitted") {
    return (
      <div className={mono.variable}>
        <Aviso
          titulo="Ya lo tenemos"
          texto={`Gracias, ${invite.prospect_name.split(" ")[0]}. Recibimos tus respuestas y las vamos a revisar antes de la sesión. Si te falta algo por agregar, escríbenos y reabrimos la liga.`}
        />
      </div>
    );
  }

  return (
    <div className={mono.variable}>
      <Cuestionario
        token={token}
        prospecto={invite.prospect_name}
        organizacion={invite.prospect_org}
        intro={template.intro}
        nombreCuestionario={template.name}
        bloques={template.blocks}
        respuestasIniciales={invite.answers ?? {}}
      />
    </div>
  );
}
