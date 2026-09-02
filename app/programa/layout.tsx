import type { Metadata, Viewport } from "next";

// La app de la persona inscrita al programa. La ve el público DE MARIO, así que
// va con su identidad (Fraunces / azul #3E86CF), no con la de FishFlow.
// Ver material-clientes/MarioCitalan/brand/BRAND.md.
// PWA: instalar desde Safari → Compartir → "Agregar a pantalla de inicio".
// ⚠️ Ícono e íconos PROPIOS. Ya pasó dos veces que una app nueva herede el de
// otra por reusar el manifest: cada una con el suyo.
export const metadata: Metadata = {
  title: "Mi programa",
  description: "Tu proceso, paso a paso",
  manifest: "/programa.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Mi programa",
  },
  icons: {
    apple: "/icons/icon-programa-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // evita el zoom accidental al enfocar inputs en iOS
  themeColor: "#0F1A24",
};

export default function ProgramaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
