import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Bundle the pool workers into `public/workers/` as self-contained module
 * scripts — the same self-hosting treatment the ffmpeg WASM core and the
 * vendored LGPL libraries in `public/vendor/` get via `copy:wasm` (which
 * invokes this script; outputs are gitignored) — and bundle the service
 * worker to `public/sw.js` at the ORIGIN ROOT (see `buildServiceWorker`).
 *
 * "Self-contained" has two deliberate exceptions, both of which load a
 * third-party library over the network instead of having it bundled in, and
 * both of which build the specifier through a function call so esbuild cannot
 * fold it to a literal and re-inline the file:
 *   - audio-encode.worker.ts pulls libmp3lame from `/vendor/libmp3lame.js`
 *     (which resolves `/vendor/libmp3lame.wasm` relative to itself), because an
 *     LGPL library has to stay replaceable. It was lamejs, the pure-JS port of
 *     the same library, until 2026-11-11. See `vendorUrl` in
 *     src/lib/tools/audio-pcm.ts before touching that code.
 *   - qpdf.worker.ts pulls `/qpdf.js` from the origin root. Not a licensing
 *     matter (qpdf is Apache-2.0) but a mechanical one: the Emscripten glue
 *     locates its 2.3 MB binary as `new URL("qpdf.wasm", import.meta.url)`, so
 *     inlining the glue here would send that request to /workers/qpdf.wasm and
 *     404. See `engineUrl` in src/lib/workers/qpdf.worker.ts.
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

/** The seven pool-worker entry points, in the order they were added. */
export const WORKER_ENTRY_POINTS = [
  "src/lib/workers/image.worker.ts",
  "src/lib/workers/audio-encode.worker.ts",
  "src/lib/workers/pdf.worker.ts",
  "src/lib/workers/pdf-image.worker.ts",
  "src/lib/workers/qpdf.worker.ts",
  "src/lib/workers/regex.worker.ts",
  "src/lib/workers/hash.worker.ts",
].map((p) => path.join(root, p));

/** Gitignored; written by this script and by nothing else in `copy:wasm`. */
export const WORKERS_OUTDIR = path.join(root, "public/workers");

/** Written by P2. Guarded on existence — see `buildServiceWorker`. */
export const SERVICE_WORKER_ENTRY = path.join(root, "src/lib/pwa/service-worker.ts");

/** Origin root, NOT public/workers — see `buildServiceWorker`. */
export const SERVICE_WORKER_OUTFILE = path.join(root, "public/sw.js");

/** Shared by both bundles so the service worker resolves `@/…` the same way. */
const shared = {
  bundle: true,
  sourcemap: false,
  platform: "browser",
  target: ["es2022"],
  absWorkingDir: root,
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
};

/**
 * Delete the previous build's output before bundling again.
 *
 * WHY THIS EXISTS — do not remove it as redundant: the pool workers are built
 * with `splitting: true`, and esbuild names every shared chunk after a hash of
 * its CONTENTS (`chunk-*.js`, `pdf-engine-core-*.js`, `pdf-image-core-*.js`).
 * Change one line of pdf-engine-core.ts and the next build writes a NEW file
 * beside the old one instead of replacing it. Nothing ever removed the old
 * one, and because `output: "export"` copies all of `public/` verbatim, every
 * dead chunk shipped. Measured 2026-09-10 before this clean landed:
 * public/workers held 29 files / 5,815,816 bytes, of which the transitive
 * closure of the seven entry points reached only 12 files / 527,343 bytes —
 * **17 orphaned chunks, 5,288,473 bytes, in every deploy**, 91% of the
 * directory. A clean build of those same seven entry points emits exactly the
 * 12 live files, byte-identical.
 *
 * Scoped deliberately: this removes the top-level `.js` (and `.js.map`) files
 * of `outdir` and nothing else. It is NOT an `rm -rf` of the directory, and it
 * never walks into a subdirectory, so a mis-pointed `outdir` cannot take a
 * tree with it. It also cannot reach `public/sw.js`, which lives one level up
 * at the origin root. Everything else `copy:wasm` stages was checked at the
 * same time and needs no clean: `public/{ffmpeg-core.js,ffmpeg-core.wasm,
 * qpdf.js,qpdf.wasm,zxing_reader.wasm,libarchive.wasm,squoosh_oxipng_bg.wasm}`,
 * `public/vendor/*` and `public/fonts/print/*` are all `cp`ed under fixed
 * names, so each build overwrites in place and nothing can accumulate — and
 * `public/` root also holds tracked files (CNAME, robots.txt, the icons,
 * og-image.png), which is the other reason the clean stays inside `outdir`.
 *
 * @returns {Promise<{ removed: string[], bytes: number }>}
 */
export async function cleanWorkersOutdir(outdir = WORKERS_OUTDIR) {
  let entries;
  try {
    entries = await fs.readdir(outdir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return { removed: [], bytes: 0 };
    throw err;
  }

  const removed = [];
  let bytes = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Only what this script can emit. Anything else was put here by something
    // that is not this script, so it is not ours to delete — say so instead.
    if (!entry.name.endsWith(".js") && !entry.name.endsWith(".js.map")) {
      console.warn(`[build-workers] leaving ${entry.name}: not a file this script emits`);
      continue;
    }
    const file = path.join(outdir, entry.name);
    bytes += (await fs.stat(file)).size;
    await fs.rm(file);
    removed.push(entry.name);
  }
  return { removed, bytes };
}

/** Clean, then bundle the seven pool workers as ES modules. */
export async function buildPoolWorkers({
  entryPoints = WORKER_ENTRY_POINTS,
  outdir = WORKERS_OUTDIR,
} = {}) {
  const { removed, bytes } = await cleanWorkersOutdir(outdir);
  if (removed.length > 0) {
    console.log(
      `[build-workers] cleaned ${removed.length} file(s), ${bytes.toLocaleString()} bytes ` +
        `from ${path.relative(root, outdir) || outdir}`,
    );
  }

  await build({
    ...shared,
    entryPoints,
    outdir,
    // Every consumer constructs these with `{ type: "module" }` — e.g.
    // src/lib/workers/hash-client.ts:17 — so ESM output is required, and
    // pdf.worker's dynamic import of pdf-engine-core needs code splitting.
    // Module workers resolve the emitted sibling chunks relative to their URL.
    format: "esm",
    splitting: true,
    minify: true,
    logLevel: "info",
  });
}

/**
 * Bundle the service worker to `public/sw.js`.
 *
 * The outfile is the ORIGIN ROOT, not `public/workers/`, and that is not a
 * preference: a service worker's default scope is its own directory, so one
 * served from `/workers/sw.js` could only control `/workers/*`. Widening it
 * needs a `Service-Worker-Allowed` response header, and GitHub Pages sends no
 * custom headers (the same constraint that rules out `headers()` under
 * `output: "export"`). Shipping it at `/sw.js` is the only way it can claim
 * scope `/`. That is why this is a second esbuild call rather than an eighth
 * entry point: one call has one `outdir`, and moving the pool workers to the
 * origin root would break the `/workers/…` URLs their clients hardcode.
 *
 * Two deliberate differences from the pool workers:
 *   - `format: "iife"`, because `navigator.serviceWorker.register()` defaults
 *     to `{ type: "classic" }`. An IIFE runs under that default, so
 *     registration never depends on module-service-worker support.
 *   - `minify: false`. This app is closed-source (licensing-posture.md:61), so
 *     the shipped `/sw.js` is the only copy anyone auditing the "nothing
 *     happens behind your back" claim on /privacy can read. It is a few KB;
 *     legibility is worth more than the bytes here.
 *
 * Guarded on the entry existing so `npm run dev` / `npm run build` still work
 * while src/lib/pwa/service-worker.ts is unwritten. When it is missing but a
 * `public/sw.js` from an earlier build is still sitting there, we warn rather
 * than delete: a stale worker at the origin root is exactly the pin-a-dead-
 * build hazard, but a file this script did not just emit is not ours to
 * remove — surface it and let a human decide.
 *
 * @returns {Promise<"built" | "skipped">}
 */
export async function buildServiceWorker({
  entry = SERVICE_WORKER_ENTRY,
  outfile = SERVICE_WORKER_OUTFILE,
} = {}) {
  const present = await fs
    .access(entry)
    .then(() => true)
    .catch(() => false);

  if (!present) {
    const stale = await fs
      .access(outfile)
      .then(() => true)
      .catch(() => false);
    console.warn(
      `[build-workers] skipping service worker: ${path.relative(root, entry)} does not exist` +
        (stale ? ` — but ${path.relative(root, outfile)} still exists and will ship as-is` : ""),
    );
    return "skipped";
  }

  await build({
    ...shared,
    entryPoints: [entry],
    outfile,
    format: "iife",
    minify: false,
    logLevel: "info",
  });
  return "built";
}

// Only run when invoked as a script (`node scripts/build-workers.mjs`); the
// unit test imports the functions above and drives them against a temp dir.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildPoolWorkers();
  await buildServiceWorker();
}
