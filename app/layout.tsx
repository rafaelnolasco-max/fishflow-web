import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FishFlow — Automatización inteligente para tu negocio local",
  description:
    "FishFlow da a tu micro PyME el mismo poder digital que las grandes: WhatsApp automático, agenda online, contenido con IA y reportes en tiempo real.",
  openGraph: {
    title: "FishFlow",
    description: "Automatización inteligente para negocios locales en México.",
    url: "https://fishflow.mx",
    siteName: "FishFlow",
    locale: "es_MX",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={outfit.variable}>
      <body>{children}</body>
    </html>
  );
}
