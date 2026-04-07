import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true, // Required for static export
  },
  trailingSlash: false,
  turbopack: {
    resolveAlias: {
      // mupdf WASM conditionally imports Node.js-only modules; stub them for browser
      module: { browser: "./src/lib/empty-module.js" },
      "node:fs": { browser: "./src/lib/empty-module.js" },
    },
  },
};
export default nextConfig;
