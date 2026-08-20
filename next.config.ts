import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js spawns a Node worker from its own package path. Bundling it
  // rewrites that path to /ROOT/... and the worker fails to load, so keep it
  // external and let it resolve from node_modules at runtime.
  serverExternalPackages: ['tesseract.js'],
  // serverExternalPackages alone wasn't enough in production: Vercel's automatic
  // file tracer (@vercel/nft) failed to detect tesseract.js's worker-script files
  // and several of its transitive dependencies, because they're required via
  // dynamic relative paths at runtime that static analysis can't follow.
  // Confirmed live, one missing module at a time: worker-script/node/index.js
  // itself, then bmp-js. Force-include tesseract.js and its full direct
  // dependency tree (per its package.json) up front instead of chasing each
  // missing module through repeated deploys.
  outputFileTracingIncludes: {
    '/api/admin/disc-guide-scan/upload': [
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/bmp-js/**/*',
      './node_modules/idb-keyval/**/*',
      './node_modules/is-url/**/*',
      './node_modules/node-fetch/**/*',
      './node_modules/regenerator-runtime/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/zlibjs/**/*',
    ],
    '/api/admin/disc-guide-scan/drive-import': [
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/bmp-js/**/*',
      './node_modules/idb-keyval/**/*',
      './node_modules/is-url/**/*',
      './node_modules/node-fetch/**/*',
      './node_modules/regenerator-runtime/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/zlibjs/**/*',
    ],
  },
};

export default nextConfig;
