import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  output: "export",
  pageExtensions: ["ts", "tsx", "md", "mdx"],
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

const withMDX = createMDX({});

export default withMDX(nextConfig);
