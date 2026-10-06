import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:4000";
const mocking = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@honeytree/ui-tokens"],
  // Docker image: `NEXT_OUTPUT=standalone` emits a self-contained server (apps/web/Dockerfile).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone", outputFileTracingRoot: path.join(here, "../..") } : {}),
  // Keep the API same-origin so the httpOnly session cookie "just works" in dev.
  // In production Caddy routes /api to the API service before it reaches Next, so this is a no-op there.
  async rewrites() {
    if (mocking) return [];
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  // Media is served from a public media host (or data: URLs in mock mode); no image optimizer is needed.
  images: { unoptimized: true },
};

export default nextConfig;
