/**
 * The caching decision, and nothing else.
 *
 * PURE and DOM-FREE by contract: no `self`, no `caches`, no `fetch`, no
 * `process`, no imports. service-worker.ts is untestable by construction —
 * jsdom has no ServiceWorkerGlobalScope and no Cache API — so everything
 * decidable without a browser lives here instead, exactly as qpdf-protocol.ts
 * pulls argv building and exit classification out of qpdf.worker.ts.
 *
 * WHY THIS IS THE MOST DANGEROUS MODULE IN THE REPO
 *
 * A service worker persists on a device and can pin a dead build there
 * permanently. The mechanism is measured, not imagined: the live index.html
 * references 13 top-level assets and 4 of them no longer exist in the pending
 * build; the deploy (peaceiris/actions-gh-pages) REPLACES the published tree
 * rather than merging into it, so those hashes vanish; and a missing chunk on
 * GitHub Pages answers `status=404, type=text/html, size=39976` — a 40 KB HTML
 * error page served where JavaScript was expected. Serve HTML cache-first once
 * and a returning visitor gets a shell whose scripts are gone, with no request
 * left that could heal it.
 *
 * So the default here is `"network-first"`, and it is the default on purpose:
 * a wrong guess must cost one request, never a brick.
 */

/** Pages, RSC payloads, un-hashed origin-root assets, hashed chunks. */
export const SHELL_CACHE = "transmute-shell-v1";
/**
 * Engine binaries. A SEPARATE cache from the shell for two reasons: the page's
 * offline opt-in has to be able to name, size and delete exactly the 32 MB it
 * added, and the worker must be structurally unable to write here (only the
 * page does — see the `"engine"` strategy).
 */
export const ENGINE_CACHE = "transmute-engines-v1";

/** Every cache this site may own. `activate` deletes anything else. */
export const OWNED_CACHES: readonly string[] = [SHELL_CACHE, ENGINE_CACHE];

export type Strategy =
  /** HTML + .txt: try the network, fall back to cache ONLY on a real failure. */
  | "network-first"
  /** Content-hashed immutable assets. */
  | "cache-first"
  /** Engine binaries: served from cache IF already there, else straight to network, never added. */
  | "engine"
  /** Never touched (GA4, the share-target POST). */
  | "network-only";

/**
 * The three fields of a `Request` this decision reads. A real `Request`
 * satisfies it structurally, so the worker passes the request itself and the
 * tests pass plain objects.
 */
export interface RequestFacts {
  mode: string; // request.mode — "navigate" for a top-level navigation
  destination: string; // request.destination — "document" | "script" | "font" | …
  method: string; // request.method
}

/**
 * Engine binaries at the ORIGIN ROOT, spelled exactly as their loaders ask for
 * them: ffmpeg-loader.ts:356-357, qpdf.worker.ts:100-102 (`/qpdf.js`, whose
 * Emscripten glue then resolves `/qpdf.wasm` beside itself),
 * png-optimise.ts:271, and the two CDN-avoiding paths gitignore records for
 * zxing-wasm and libarchive-wasm.
 *
 * There is no basePath: `next.config.ts` sets none and the site deploys to the
 * apex domain. The loaders still prefix `process.env.__NEXT_ROUTER_BASEPATH`,
 * which is `""`, so they ask for these exact strings — but this module must not
 * read that variable itself: it is bundled into a service worker where
 * `process` does not exist unless the build happens to `define` it, and a
 * ReferenceError at worker start-up is a feature that silently never installs.
 * If a basePath is ever reintroduced, these prefixes move and so does the
 * worker's own scope; the unit test pins the list so that cannot happen quietly.
 */
export const ENGINE_FILES: readonly string[] = [
  "/ffmpeg-core.js",
  "/ffmpeg-core.wasm",
  "/qpdf.js",
  "/qpdf.wasm",
  "/zxing_reader.wasm",
  "/libarchive.wasm",
  "/squoosh_oxipng_bg.wasm",
];

/**
 * Engine directories. `/vendor/` is lamejs + libheif (audio-pcm.ts:62,
 * image-convert.ts:169); `/fonts/print/` is the five woff2 faces the Markdown
 * to PDF tool embeds (markdown-pdf-print-css.ts:25-53); `/tesseract/` is the
 * OCR engine, its language model and the worker script that loads them
 * (ocr.ts:52) — one directory because the core locates its .wasm relative to
 * the worker's URL, so they cannot be split.
 */
export const ENGINE_DIRS: readonly string[] = ["/vendor/", "/fonts/print/", "/tesseract/"];

/**
 * Is this one of the self-hosted engine binaries?
 *
 * Matched on the PATH ONLY, deliberately: every engine loader appends a
 * `?retry=N` cache-buster on a second attempt, because a module that fails to
 * fetch is remembered as failed in the realm's module map and a same-URL retry
 * never touches the network (measured in Chromium and WebKit —
 * audio-pcm.ts:52-57). `/qpdf.js?retry=1` is the same engine as `/qpdf.js`, so
 * it must classify the same way, and the worker's cache lookup pairs this with
 * `ignoreSearch: true`.
 */
export function isEngineUrl(url: URL, origin: string): boolean {
  if (url.origin !== origin) return false;
  if (ENGINE_FILES.includes(url.pathname)) return true;
  return ENGINE_DIRS.some((dir) => url.pathname.startsWith(dir));
}

/**
 * Which strategy the worker applies to one request.
 *
 * Order is load-bearing: the engine test sits ABOVE `/_next/static/` and above
 * the default, because both of those populate a cache and `/ffmpeg-core.wasm`
 * is a 32,232,419-byte file that may only enter storage through an explicit,
 * sized, user-initiated opt-in.
 */
export function strategyFor(url: URL, facts: RequestFacts, origin: string): Strategy {
  // Not http(s), or not ours. GA4 is the only cross-origin request the site
  // makes and caching an analytics beacon would be both useless and creepy.
  //
  // The protocol half is not paranoia: `new URL("blob:https://transmute.tools/x")`
  // reports `origin` "https://transmute.tools" and `pathname`
  // "https://transmute.tools/x" (measured with the same URL parser the browser
  // uses), so an origin-only check would call a blob: URL same-origin and hand
  // it to a caching branch — and `cache.put` rejects on a non-http(s) scheme.
  // FFmpeg hands its worker blob: URLs for the core (ffmpeg-loader.ts:356-357).
  if (url.protocol !== "https:" && url.protocol !== "http:") return "network-only";
  if (url.origin !== origin) return "network-only";

  // The share-target POST, and anything else non-GET. The Cache API stores GET
  // responses only; a POST here would be a crash, not a cache.
  if (facts.method !== "GET") return "network-only";

  // THE ANTI-BRICK GATE. Navigations and the `.txt` RSC payloads client
  // navigation fetches (`e.pathname += ".txt"`, verbatim from the shipped
  // bundle) are the two asset classes whose filenames are NOT content-hashed
  // while their BODIES name hashed chunks — 190 such .txt files in the export.
  // A stale one points at chunks the next deploy deletes. Network-first means
  // the network always wins when it answers at all, so a stale copy can only
  // ever surface when the device is genuinely offline, and heals itself on the
  // next successful request. `destination` is checked as well as `mode` so the
  // gate does not rest on a single field being populated.
  if (facts.mode === "navigate" || facts.destination === "document") return "network-first";
  if (url.pathname.endsWith(".txt")) return "network-first";

  // Engines: cache hit if the user opted in, otherwise straight to the network
  // WITHOUT being added. The worker never writes this cache.
  if (isEngineUrl(url, origin)) return "engine";

  // The only class whose filenames are content-hashed (`out/_next/static/**`),
  // which makes them immutable by construction: a changed file is a changed
  // URL, so a cached hit can never be stale and a deploy can never invalidate
  // one out from under us.
  if (url.pathname.startsWith("/_next/static/")) return "cache-first";

  // Everything else — /workers/*.js, /manifest.webmanifest, the icons, and
  // anything added after this file was written. Un-hashed names
  // whose contents change per deploy, so they get the safe strategy: still
  // available offline once seen, never allowed to outvote the network.
  return "network-first";
}
