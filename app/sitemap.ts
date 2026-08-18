import type { MetadataRoute } from "next";
import { CASOS_PUBLICOS } from "@/lib/casos";

const BASE_URL = "https://fishflow.mx";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: BASE_URL,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/casos`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    ...CASOS_PUBLICOS.map((c) => ({
      url: `${BASE_URL}/casos/${c.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    {
      url: `${BASE_URL}/aviso-de-privacidad`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
