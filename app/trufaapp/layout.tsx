import type { Metadata, Viewport } from "next";

// PWA: instalar desde Safari → Compartir → "Agregar a pantalla de inicio"
export const metadata: Metadata = {
  title: "Trufa — el carnet de tu mascota",
  description: "Vacunas, tratamientos, peso y consultas de tu mascota en un solo lugar.",
  manifest: "/trufa.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Trufa",
  },
  icons: {
    apple: "/icons/icon-trufa-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // evita zoom accidental al enfocar inputs en iOS
  themeColor: "#1F1714",
};

export default function TrufaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
