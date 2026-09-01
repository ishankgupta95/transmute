import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  output: "export",
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  images: {
    unoptimized: true, // Required for static export
  },
  trailingSlash: false,
};

/*
  GFM is not on by default. Three posts (heic-vs-jpg, modern-image-formats,
  video-to-gif-tradeoffs) write comparison tables in pipe syntax, and without
  this they rendered to readers as literal `| --- |` text inside a paragraph —
  while `blog/[slug]/page.tsx` carried a full set of `prose-table:*` styles that
  could never apply.

  Plugins are named as STRINGS, not imported: this project builds with
  Turbopack, and a plugin passed as a JS function cannot cross into Rust
  (see node_modules/next/dist/docs/01-app/02-guides/mdx.md, "Using Plugins with
  Turbopack").
*/
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
  },
});

export default withMDX(nextConfig);
