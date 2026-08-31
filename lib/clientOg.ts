import type { Metadata } from "next";

/**
 * Metadata de Open Graph por cliente para /app/[slug].
 * Sin esto, WhatsApp/redes muestran el logo de FishFlow al compartir
 * el link del panel de cualquier cliente (hereda el openGraph del
 * layout raíz). Cada carpeta app/app/<slug>/layout.tsx llama a esto
 * con el nombre del cliente — la imagen vive en public/clients/<slug>/og-image.png.
 */
export function clientMetadata(nombre: string, slug: string): Metadata {
  const url = `https://fishflow.mx/app/${slug}`;
  const imagen = `/clients/${slug}/og-image.png`;

  return {
    title: nombre,
    openGraph: {
      title: nombre,
      url,
      siteName: nombre,
      images: [{ url: imagen, width: 1200, height: 630, alt: nombre }],
    },
    twitter: {
      card: "summary_large_image",
      title: nombre,
      images: [imagen],
    },
  };
}

/**
 * Nombre público por cliente — fuente compartida para el og:image de
 * /app/[slug] (los layout.tsx) y el de /login (cuando el visitante no
 * tiene sesión y ?next= apunta a un cliente). Si agregas un cliente nuevo
 * en app/app/<slug>/layout.tsx, agrégalo aquí también.
 */
export const CLIENT_NAMES: Record<string, string> = {
  belange: "Belange Estética",
  tba: "TBA Telecom",
  autolavado: "Autolavado — Carlos Alonso",
  sparc: "Sparc",
  cane: "CANE Neurofeedback",
  sieckvet: "SieckVet",
  hireflow: "HireFlow",
  enlace: "Enlace Integral Seguros",
  bwing: "B-Wing Karaoke Bar",
  rmz: "RMZ Cocinas y Closets",
  mariocitalan: "Mario Citalán — Arquitectura del Criterio",
  regintel: "Inteligencia Regulatoria",
  jjlaboral: "JJ Laboral Asociados",
  lukon: "Lukon Telemática",
  cafemoran: "Café Moran's",
  therapyos: "TherapyOS — Mario Citalán",
  tintosentido: "Tinto Sentido",
};
