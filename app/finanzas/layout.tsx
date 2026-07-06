import type { Metadata, Viewport } from "next";

// PWA: instalar desde Safari → Compartir → "Agregar a pantalla de inicio"
export const metadata: Metadata = {
  title: "FishFlow Finanzas",
  description: "Tus gastos del mes, claros y bajo control",
  manifest: "/finanzas.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FishFlow Finanzas",
  },
  icons: {
    apple: "/icon-rafa-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // evita zoom accidental al enfocar inputs en iOS
  themeColor: "#0D1B2A",
};

export default function FinanzasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
