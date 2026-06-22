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
          "/app/",
          "/api/",
          "/login",
          "/pay/",
          "/receipt/",
          "/cita/",
          "/resumen/",
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
