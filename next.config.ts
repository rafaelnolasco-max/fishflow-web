import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  // Incluir el binario de ffmpeg-static en el bundle serverless de estas rutas.
  // Sin esto, Vercel no lo empaqueta (es un binario, no un import) y el spawn
  // falla con ENOENT. Ver lib/whisper-chunked.ts (transcripción de sesiones largas).
  outputFileTracingIncludes: {
    "/api/therapyos/record-session": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/therapyos/reprocess-audio": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  images: {
    // Allow SVG logos from /public to render without optimization restrictions
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
