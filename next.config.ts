import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js spawns a Node worker from its own package path. Bundling it
  // rewrites that path to /ROOT/... and the worker fails to load, so keep it
  // external and let it resolve from node_modules at runtime.
  serverExternalPackages: ['tesseract.js'],
  // serverExternalPackages alone wasn't enough in production: Vercel's automatic
  // file tracer (@vercel/nft) failed to detect tesseract.js's worker-script files
  // because they're required via a dynamic relative path at runtime, not a static
  // one it can analyze. Confirmed live: "Cannot find module '..'" thrown from
  // node_modules/tesseract.js/src/worker-script/node/index.js on every OCR call.
  // Force-include the whole package for the two routes that call performOCR().
  outputFileTracingIncludes: {
    '/api/admin/disc-guide-scan/upload': ['./node_modules/tesseract.js/**/*'],
    '/api/admin/disc-guide-scan/drive-import': ['./node_modules/tesseract.js/**/*'],
  },
};

export default nextConfig;
