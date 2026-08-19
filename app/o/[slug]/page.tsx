// app/o/[slug]/page.tsx
// Canal QR del Módulo Reputación — pantalla pública del comensal.
// Sin login: el slug del touchpoint es la credencial.
// noindex: son opiniones de clientes reales, no contenido para buscadores.

import type { Metadata } from "next";
import EncuestaQR from "./EncuestaQR";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "¿Cómo estuvo tu visita?",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <EncuestaQR slug={slug} />;
}
