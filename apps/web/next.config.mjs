/** @type {import('next').NextConfig} */
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:4000";
const mocking = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@honeytree/ui-tokens"],
  // Keep the API same-origin so the httpOnly session cookie "just works" in dev.
  // In production Caddy routes /api to the API service, so this is a no-op there.
  async rewrites() {
    if (mocking) return [];
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  images: { unoptimized: true },
};

export default nextConfig;
