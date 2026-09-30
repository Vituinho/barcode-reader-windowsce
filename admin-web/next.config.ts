import type { NextConfig } from "next";

// NEXT_PUBLIC_API_URL is baked into the browser bundle at build time, so it must be set for `next build`.
// Only NEXT_PUBLIC_* variables reach the browser; DATABASE_URL / SECRET_KEY belong to the API service only.
const apiUrl = process.env.NEXT_PUBLIC_API_URL;
if (process.argv.includes("build")) {
  if (!apiUrl || !/^https?:\/\/[^/]+/.test(apiUrl)) {
    throw new Error("NEXT_PUBLIC_API_URL must be set to the public API URL (e.g. https://api.example.up.railway.app)");
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server in .next/standalone (smaller runtime, started by scripts/start.mjs).
  output: "standalone",
};

export default nextConfig;
