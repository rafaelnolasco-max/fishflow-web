import type { MetadataRoute } from "next";

const BASE_URL = "https://fishflow.mx";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/demos/",
          "/app/",
          "/api/",
          "/login",
          "/pay/",
          "/receipt/",
          "/cita/",
          "/resumen/",
          "/resenas/",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
