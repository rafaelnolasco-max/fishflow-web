import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Allow SVG logos from /public to render without optimization restrictions
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
