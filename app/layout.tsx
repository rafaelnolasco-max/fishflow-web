import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import MetaPixel from "@/components/MetaPixel";
import MetaCtaTracker from "@/components/MetaCtaTracker";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-outfit",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://fishflow.mx"),
  title: {
    default: "FishFlow — Automatización inteligente para tu negocio local",
    template: "%s — FishFlow",
  },
  description:
    "FishFlow le da a tu micro PyME el poder digital de las grandes: agenda y citas automáticas, cobros en línea, facturación y reportes en tiempo real. Cotización a la medida tras un diagnóstico sin costo.",
  keywords: [
    "automatización para PyMES",
    "software para negocios locales México",
    "sistema de citas en línea",
    "automatización con IA",
    "agenda online para negocios",
    "cobros y facturación en línea",
    "FishFlow",
  ],
  authors: [{ name: "FishFlow" }],
  creator: "FishFlow",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "FishFlow — Automatización inteligente para tu negocio local",
    description:
      "Agenda y citas automáticas, cobros en línea, facturación y reportes en tiempo real para tu micro PyME en México.",
    url: "https://fishflow.mx",
    siteName: "FishFlow",
    locale: "es_MX",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "FishFlow — Automatización inteligente para tu negocio local",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "FishFlow — Automatización inteligente para tu negocio local",
    description:
      "Agenda y citas automáticas, cobros en línea, facturación y reportes en tiempo real para tu micro PyME en México.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  name: "FishFlow",
  description:
    "Automatización e inteligencia artificial para micro PyMES en México: agenda y citas automáticas, cobros en línea, facturación y reportes en tiempo real.",
  url: "https://fishflow.mx",
  logo: "https://fishflow.mx/logo-horizontal.svg",
  image: "https://fishflow.mx/og-image.png",
  email: "raf@fishflow.mx",
  areaServed: {
    "@type": "Country",
    name: "México",
  },
  address: {
    "@type": "PostalAddress",
    addressLocality: "Ciudad de México",
    addressCountry: "MX",
  },
  knowsAbout: [
    "Automatización de procesos",
    "Inteligencia artificial",
    "Sistemas de citas",
    "Cobros en línea",
    "Facturación electrónica",
  ],
  slogan: "Automatización inteligente para tu negocio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={outfit.variable}>
      <body>
        <MetaPixel />
        <MetaCtaTracker />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
