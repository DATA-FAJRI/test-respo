import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright ne doit pas être empaqueté par le bundler serveur.
  serverExternalPackages: ["playwright-core"],
};

export default nextConfig;
