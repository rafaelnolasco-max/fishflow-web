import type { Metadata, Viewport } from "next";

// PWA: instalar desde Safari → Compartir → "Agregar a pantalla de inicio"
export const metadata: Metadata = {
  title: "Therapy Flow",
  description: "Que tu terapia fluya",
  manifest: "/terapia.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Therapy Flow",
  },
  icons: {
    apple: "/icons/icon-therapyflow-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // evita zoom accidental al enfocar inputs en iOS
  themeColor: "#0D1B2A",
};

export default function TerapiaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
