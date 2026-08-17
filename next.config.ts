import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js spawns a Node worker from its own package path. Bundling it
  // rewrites that path to /ROOT/... and the worker fails to load, so keep it
  // external and let it resolve from node_modules at runtime.
  serverExternalPackages: ['tesseract.js'],
};

export default nextConfig;
