/**
 * The PWA e2e harness' web server: `out/` served the way GitHub Pages serves it.
 *
 * WHY THIS EXISTS AT ALL. The other two Playwright projects run against
 * `next dev`, and the service worker deliberately does not register there
 * (ServiceWorkerRegistration.tsx gates on `process.env.NODE_ENV`, which the
 * compiler INLINES, so in a dev build the registration folds away entirely).
 * A spec pointed at the dev server would therefore assert nothing about this
 * feature — and the failure the whole design exists to prevent, a cached shell
 * outliving the hashed chunks it names, cannot even be staged there. So this
 * project runs against the BUILT export, statically, over `http://localhost`,
 * which is a secure context and is what makes `navigator.serviceWorker` and
 * the Cache API available.
 *
 * NODE'S OWN `http` AND NOTHING ELSE. No new dependency: a static file server
 * with the four behaviours below is 100 lines, and adding a package to the
 * tree of a site whose pitch is that it ships no third-party code to your
 * browser would be a poor trade.
 *
 * Run directly (`node src/__tests__/e2e/pwa/static-server.mjs`) it serves the
 * repo's `out/`; imported, `resolveFile` and `createStaticServer` take any
 * root, which is what makes the path resolution below testable against a
 * fixture tree rather than only against a 165 MB export.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** `<repo>/src/__tests__/e2e/pwa/` → `<repo>`. */
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");
const OUT_DIR = join(REPO_ROOT, "out");

/**
 * The port, as argv, defaulting to the one playwright.config.ts passes.
 *
 * It is NOT exported for the config to import. Playwright transpiles its TS
 * config through a CJS hook, and a `.mjs` import from there dies with
 * `ReferenceError: exports is not defined in ES module scope` — the hook
 * rewrites this file to CJS and Node then loads it as ESM. Measured, not
 * guessed: that is verbatim what `TRANSMUTE_PWA_E2E=1 playwright test --list`
 * printed when the config imported this module. So the config owns the number
 * and hands it over on the command line; the default here only matters when
 * someone runs the server by hand.
 */
const DEFAULT_PORT = 4319;

/**
 * Content types. Two of these are load-bearing rather than cosmetic:
 *
 * - `.wasm` MUST be `application/wasm`. `WebAssembly.instantiateStreaming`
 *   rejects any other type outright, and `addBundle` rebuilds its cached
 *   Response from the original headers precisely so the type survives storage
 *   (offline.ts). Serving `application/octet-stream` here would make the
 *   opt-in look like it worked and the engine fail to instantiate later.
 * - `.js` MUST be a JavaScript type or the browser refuses to register
 *   `/sw.js` as a worker script at all.
 */
const CONTENT_TYPES = new Map(
  Object.entries({
    ".html": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".xml": "application/xml; charset=utf-8",
    ".wasm": "application/wasm",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    /*
      The OCR language model. It is served PRE-COMPRESSED and inflated by the
      engine itself (zlibjs, inside worker.min.js), so what matters is the
      absence of `Content-Encoding: gzip` rather than this type: with that
      header the browser would inflate it too, and the engine would then be
      handed already-inflated bytes it cannot read. `application/gzip` with no
      Content-Encoding is the shape tesseract.js's own CDN serves and the shape
      this map mirrors.
    */
    ".gz": "application/gzip",
    ".map": "application/json; charset=utf-8",
  }),
);

function contentTypeFor(path) {
  return CONTENT_TYPES.get(extname(path).toLowerCase()) ?? "application/octet-stream";
}

/**
 * Map a request path onto a file in `root`.
 *
 * ⚠ THE ONE AMBIGUITY, AND THE ASSUMPTION MADE ABOUT IT.
 *
 * `trailingSlash: false` (next.config.ts:10) makes the export emit BOTH
 * `out/merge-pdf.html` and a directory `out/merge-pdf/`, while the browser
 * asks for `/merge-pdf`. Which of the two GitHub Pages consults first is not
 * something this repo can measure from here, so the order below is an
 * explicit ASSUMPTION, written down rather than left implicit:
 *
 *     exact file  →  `<path>.html`  →  `<path>/index.html`  →  404.html
 *
 * The `.html` sibling is tried BEFORE the directory index because that is the
 * file Next generated for that URL, and serving a directory listing or a
 * nested index in its place would answer a navigation with the wrong document.
 *
 * MEASURED, so the specs do not rest on the ambiguity either way: in this
 * export the two candidates never both exist. Every route directory holds only
 * `__next.*.txt` RSC payloads and no `index.html` at all — `out/privacy/`
 * contains exactly `__next._tree.txt`, `__next._head.txt`, `__next._full.txt`,
 * `__next._index.txt`, `__next.privacy.__PAGE__.txt`, `__next.privacy.txt`.
 * (This corrects the contract's "EMPTY out/merge-pdf/": the directory is not
 * empty, it just contains nothing a navigation resolves to.) So step 3 is
 * unreachable for a tool page, and swapping steps 2 and 3 would not change a
 * single byte this harness serves. The specs additionally avoid depending on
 * it: the only offline navigation they make to an unvisited route is served by
 * the service worker with the network switched off, so this function is never
 * consulted for it.
 *
 * Returns `{ path, status }`, or `null` when nothing at all can be served
 * (no `404.html` in the root).
 */
export function resolveFile(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    // A malformed percent-escape. Not a path, so not a file.
    return null;
  }

  // `join` normalises `..` away; the containment check below is what actually
  // enforces the root, because `join(root, "../../etc/passwd")` normalises to
  // a real path outside it.
  const candidate = join(root, decoded);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return null;

  const isFile = (p) => existsSync(p) && statSync(p).isFile();

  // 1. The file as asked for. Covers /_next/static/**, /sw.js, /offline.html,
  //    /manifest.webmanifest, every engine binary, and the .txt payloads.
  if (!decoded.endsWith("/") && isFile(candidate)) return { path: candidate, status: 200 };

  // 2. The generated sibling — `/privacy` → `out/privacy.html`. This is the
  //    step every tool-page navigation takes.
  if (!decoded.endsWith("/") && isFile(`${candidate}.html`)) {
    return { path: `${candidate}.html`, status: 200 };
  }

  // 3. A directory index — `/` → `out/index.html`.
  const index = join(candidate, "index.html");
  if (isFile(index)) return { path: index, status: 200 };

  // 4. GitHub Pages answers an unknown path with the repo's own 404.html and
  //    a 404 status. Reproduced because the worker's `isStorable` turns on
  //    exactly this: a missing chunk answers 404 with an HTML body, and
  //    storing that under a hashed .js key is the brick the design prevents.
  const notFound = join(root, "404.html");
  if (isFile(notFound)) return { path: notFound, status: 404 };
  return null;
}

export function createStaticServer(root) {
  return createServer((req, res) => {
    const urlPath = new URL(req.url ?? "/", "http://localhost").pathname;
    const found = resolveFile(root, urlPath);

    if (!found) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found\n");
      return;
    }

    const headers = {
      "content-type": contentTypeFor(found.path),
      "content-length": statSync(found.path).size,
      /*
        GitHub Pages sends a flat `cache-control: max-age=600` to everything it
        serves, including `/ffmpeg-core.wasm` (measured with `curl -I` against
        the live site). Reproduced here because two pieces of shipped code are
        written against it: the worker's install and `addBundle` both pass
        `cache: "reload"` so that the first durable copy this origin ever holds
        cannot be a ten-minute-old response lifted out of the HTTP cache. A
        harness that sent `no-store` would make those two arguments untestable
        by removing the thing they defend against.
      */
      "cache-control": "max-age=600",
    };

    if (req.method === "HEAD") {
      res.writeHead(found.status, headers);
      res.end();
      return;
    }

    res.writeHead(found.status, headers);
    createReadStream(found.path).pipe(res);
  });
}

/**
 * The preflight. `out/` is NOT built here: `next build` shares `.next` with a
 * running `next dev`, and a test harness that rebuilds the thing under test is
 * a harness that can hide a broken build script. So this checks and refuses.
 *
 * It checks four specific files rather than just the directory, because the
 * expensive failure is not a missing `out/` — it is a STALE one. An export
 * from before this feature landed has an `index.html` and no `sw.js`, and
 * every spec in this project would then fail on a timeout waiting for a worker
 * that was never shipped, which reads as a broken feature rather than a
 * missing build.
 */
const REQUIRED = ["index.html", "sw.js", "offline.html", "manifest.webmanifest"];

export function missingFromExport(root) {
  if (!existsSync(root)) return REQUIRED;
  return REQUIRED.filter((name) => !existsSync(join(root, name)));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const missing = missingFromExport(OUT_DIR);
  if (missing.length > 0) {
    process.stderr.write(
      `\nThe PWA e2e project serves the BUILT export and it is not there.\n` +
        `  Looked in: ${OUT_DIR}\n` +
        `  Missing:   ${missing.join(", ")}\n\n` +
        `Run \`npm run build\` first, then \`npm run test:e2e:pwa\`.\n` +
        `(This harness will not build for you: \`next build\` shares .next with a\n` +
        ` running \`next dev\`, and a harness that rebuilds its own subject can hide\n` +
        ` a broken build script.)\n\n`,
    );
    process.exit(1);
  }

  const port = Number(process.argv[2]) || DEFAULT_PORT;
  createStaticServer(OUT_DIR).listen(port, () => {
    process.stdout.write(`Serving ${OUT_DIR} on http://localhost:${port}\n`);
  });
}
