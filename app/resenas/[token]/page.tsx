// app/resenas/[token]/page.tsx
// Página pública de la vendedora — sin login, el token es la credencial.
// noindex: la lista trae nombres y teléfonos de clientes reales.

import type { Metadata } from "next";
import VendorReviews from "./VendorReviews";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reseñas de Google · Enlace Integral",
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VendorReviews token={token} />;
}
