import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the docker compose `app` service (§1.1.1, Dockerfile).
  output: "standalone",
  // Pin the workspace root so a stray lockfile in a parent folder isn't picked up.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
