import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  // Incluir el binario de ffmpeg-static en el bundle serverless de estas rutas.
  // Sin esto, Vercel no lo empaqueta (es un binario, no un import) y el spawn
  // falla con ENOENT. Ver lib/whisper-chunked.ts (transcripción de sesiones largas).
  outputFileTracingIncludes: {
    // Comodín: empata la ruta con o sin diagonal final (trailingSlash: true).
    "/api/therapyos/**": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  // Venta de boletos: megaclase.fishflow.mx sirve la página del evento; /api
  // y el resto de rutas pasan igual (mismo proyecto de Vercel).
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          has: [{ type: "host", value: "megaclase.fishflow.mx" }],
          destination: "/eventos/megaclase/index.html",
        },
        { source: "/eventos/:slug/", destination: "/eventos/:slug/index.html" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  images: {
    // Allow SVG logos from /public to render without optimization restrictions
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
