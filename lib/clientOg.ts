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
