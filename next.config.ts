import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  pageExtensions: ["ts", "tsx"],
  images: {
    unoptimized: true, // Required for static export
  },
  trailingSlash: false,
  /*
    `libarchive-wasm`'s Emscripten glue reaches for three Node built-ins inside
    `if (ENVIRONMENT_IS_NODE) { … }` — a branch a browser never takes. But a
    bundler resolves `require()` statically, so the specifiers have to exist.

    ONLY `fs` FAILED TO RESOLVE. That is the one error this ever produced
    (`Module not found: Can't resolve 'fs'`, taking down every page compiled in
    the same pass rather than just /extract-archive), and it is not an accident:
    Next ships browser polyfills for the other two and none for `fs`. Both
    `next/dist/compiled/crypto-browserify` and `next/dist/compiled/
    path-browserify` are in the Turbopack binary's fallback map, with no `fs`
    entry beside them. So `path` and `crypto` were already resolving, and the
    other two rows below are not about resolution at all.

    They are about SIZE. Left alone, that dead `ENVIRONMENT_IS_NODE` branch
    drags 364 KB of crypto-browserify into the /extract-archive chunk for code
    that cannot run — the polyfill is real, working, and pure overhead here.
    Stubbing it is the point; `path-browserify` is only 16 KB but goes the same
    way for consistency, and neither can be dropped without trading a stub for
    either a red build or that download.

    The cost of keeping them is that these aliases are GLOBAL under the browser
    condition. A future dependency that genuinely wants `path` in the browser
    would get `{}` here instead of the shim Next would have handed it — quietly,
    if it reaches for it CJS-style (`require("path").join`), though a named ESM
    import stays loud because the stub exports no such name. That risk is what
    `src/__tests__/unit/lib/next-config-browser-stubs.test.ts` exists to hold
    down: it pins this map to the specifiers libarchive's glue actually
    requires, checks each of those requires is still inside the dead branch, and
    fails if anything shipped in src/ imports one of them for real.

    The `browser` condition means the server build still gets the real modules.
    See src/lib/empty-module.js for the rest; the same file stubbed `module` and
    `node:fs` for mupdf's glue until mupdf was removed.
  */
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/empty-module.js" },
      path: { browser: "./src/lib/empty-module.js" },
      crypto: { browser: "./src/lib/empty-module.js" },
    },
  },
};

export default nextConfig;
