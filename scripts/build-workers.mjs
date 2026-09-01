import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Bundle the pool workers into `public/workers/` as self-contained module
 * scripts — the same self-hosting treatment the ffmpeg WASM core and the
 * vendored LGPL libraries in `public/vendor/` get via `copy:wasm` (which
 * invokes this script; outputs are gitignored).
 *
 * "Self-contained" has one deliberate exception: audio-encode.worker.ts pulls
 * lamejs from `/vendor/lamejs.js` at runtime rather than having it bundled in,
 * because an LGPL library has to stay replaceable. The specifier is built by a
 * function call so esbuild cannot fold it to a literal and re-inline the
 * library; see the comment on `vendorUrl` in src/lib/tools/audio-pcm.ts before
 * touching that code.
 *
 * Why not let Next bundle them: Turbopack's `next build` does NOT compile
 * `new Worker(new URL("./x.worker.ts", import.meta.url))` into a worker
 * chunk — it emits the raw TypeScript source as a static asset and hands
 * `new Worker` that URL, so every worker-backed tool breaks in production.
 * (`next dev` hides this behind a dev-only worker loader that compiles on
 * demand — verified 2026-08-10 by inspecting `out/_next/static/chunks/*`.)
 * Pre-bundling with esbuild gives dev and prod byte-identical workers.
 *
 * NOTE: `next dev` does not watch these — after editing worker code (or
 * anything it imports: lib/tools/audio-pcm.ts, pdf-engine-core.ts, pool.ts),
 * re-run `npm run copy:wasm` or restart the dev server.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [
    "src/lib/workers/image.worker.ts",
    "src/lib/workers/audio-encode.worker.ts",
    "src/lib/workers/pdf.worker.ts",
    "src/lib/workers/regex.worker.ts",
    "src/lib/workers/hash.worker.ts",
  ],
  outdir: "public/workers",
  bundle: true,
  format: "esm",
  // pdf.worker's dynamic import of pdf-engine-core needs code splitting;
  // module workers resolve the emitted sibling chunks relative to their URL.
  splitting: true,
  minify: true,
  sourcemap: false,
  platform: "browser",
  target: ["es2022"],
  alias: {
    // The only alias left. `module` and `node:fs` used to be stubbed out here
    // (and in next.config.ts) because mupdf's glue conditionally imports them
    // when it thinks it is running under Node; nothing else in the dependency
    // set reaches for either, so both stubs left with mupdf.
    "@": path.join(root, "src"),
  },
  define: {
    "process.env.__NEXT_ROUTER_BASEPATH": JSON.stringify(""),
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  logLevel: "info",
});
