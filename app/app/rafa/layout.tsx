import type { Metadata, Viewport } from "next";

// PWA: instalar desde Safari → Compartir → "Agregar a pantalla de inicio"
export const metadata: Metadata = {
  title: "Finanzas Rafa",
  description: "Gastos, cubetas y camino al retiro",
  manifest: "/rafa.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Finanzas Rafa",
  },
  icons: {
    apple: "/icon-rafa-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // evita zoom accidental al enfocar inputs en iOS
  themeColor: "#0E9F6E",
};

export default function RafaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
