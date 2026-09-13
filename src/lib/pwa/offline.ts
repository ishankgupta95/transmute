/**
 * The offline opt-in, from the page's side.
 *
 * sw-policy.ts decides how the worker ANSWERS a request for an engine; this
 * module is the only thing in the codebase that ever PUTS one in a cache. The
 * split is deliberate and it is the whole safety argument: service-worker.ts
 * contains no `cache.put` on the engine path at all, so 32 MB cannot enter
 * storage as a side effect of using a tool. It enters because someone read a
 * size and pressed a button.
 *
 * TWO RULES HOLD THIS FILE UP.
 *
 * 1. NOTHING IS REMEMBERED. `cachedBundleIds()` re-reads the Cache API every
 *    time it is called, and no boolean derived from it is ever stored. Storage
 *    eviction is per-origin and TOTAL — the spec's words are "all of its data,
 *    not parts of it, is deleted at the same time" — and it fires no event. A
 *    `localStorage` flag saying "FFmpeg is available offline" is therefore a
 *    claim that can become false while the tab is open, with nothing to
 *    correct it. This is the same rule the rest of the site follows when it
 *    derives copy from the run (`RemuxResult.streamCopied`,
 *    `NormalizeAudioResult.twoPass`) rather than asserting it.
 *
 * 2. A BUNDLE IS ALL OR NOTHING, on the way in and on the way out. A bundle is
 *    "present" only when EVERY one of its URLs is present, and `addBundle`
 *    deletes everything it wrote if any part fails. A half-cached FFmpeg that
 *    reads as available is worse than no cache at all: the tool would claim to
 *    work offline and then fail at the one moment there is no network to fix
 *    it with.
 */

import { ENGINE_CACHE, OWNED_CACHES, isEngineUrl } from "./sw-policy";

export interface EngineBundle {
  id:
    | "ffmpeg"
    | "lamejs"
    | "heic"
    | "qpdf"
    | "zxing"
    | "libarchive"
    | "oxipng"
    | "tesseract"
    | "print-fonts";
  label: string;
  /** What it is FOR, in one honest clause. */
  handles: string;
  /** Exact bytes on disk — measured, never estimated. */
  bytes: number;
  /** Origin-root paths, exactly as the loaders request them. */
  urls: readonly string[];
  /** How many REGISTERED TOOLS need it — a count, never a fraction of a number that moves. */
  toolCount: number;
}

/**
 * THE BYTE COUNTS ARE MEASUREMENTS, and `offline.test.ts` is what keeps them
 * measurements: it parses the `copy:wasm` command out of package.json — which
 * is the definition of what this origin serves at its root — derives the URL
 * set and `statSync`es every source artifact. Bump a dependency and these
 * numbers go red until someone re-measures, exactly as engine-disclosure.test.ts
 * holds the homepage's DOWNLOAD column to the same artifacts.
 *
 * They are the counts of the files THIS ORIGIN SERVES, uncompressed, which is
 * also what the reader sees in the Network tab and what `navigator.storage`
 * will report afterwards.
 *
 * `toolCount` is the number of registered tools whose code path can
 * reach that engine, and the two figures that look surprising are the two
 * corrections that mattered when this was derived. libheif reads 5 rather
 * than 63 because `toDecodableSource` tests the extension and MIME type
 * before it calls `decodeHeic()` — the 63 tools that go through
 * `toDecodableSource` never touch it unless the file really is a HEIC. oxipng
 * reads 1 rather than 61 because `optimisePng` has exactly one caller,
 * CompressPngUI.tsx:212, even though the worker hosting it serves 61 tools.
 * A count of "every tool that imports the module" would have been wrong by an
 * order of magnitude in both cases.
 */
export const ENGINE_BUNDLES: readonly EngineBundle[] = [
  {
    id: "ffmpeg",
    label: "FFmpeg WASM",
    handles:
      "Video container swaps, muting, rotating, trimming, splitting and joining; audio formats, loudness and silence filters; and the one H.264 re-encode offered when a stream copy would not play.",
    bytes: 32_344_478,
    // The glue and the binary are one download or neither: ffmpeg-loader.ts
    // :356-357 fetches both through toBlobURL in the same load() call.
    urls: ["/ffmpeg-core.js", "/ffmpeg-core.wasm"],
    toolCount: 32,
  },
  {
    id: "heic",
    label: "libheif",
    handles: "Decoding iPhone HEIC photos, which Canvas cannot open on its own.",
    bytes: 1_513_632,
    // The glue and the binary are one download or neither: image-convert.ts's
    // loadLibheif() hands the .wasm to the factory itself rather than letting
    // Emscripten resolve it, so a missing binary is a failed load, not a
    // silently degraded one.
    urls: ["/vendor/libheif.js", "/vendor/libheif.wasm"],
    // 6 since remove-metadata landed: its image arm accepts .heic/.heif and
    // reaches loadLibheif through toDecodableBlob (exif-viewer.ts:81 ->
    // image-convert.ts's decodeHeic), exactly like the five before it. The six
    // new PDF tools beside it need no origin-root binary at all.
    toolCount: 6,
  },
  {
    id: "qpdf",
    label: "qpdf",
    handles: "PDF passwords and permissions — protect, unlock, restrict, and repair a damaged file.",
    bytes: 2_403_819,
    // Same pairing as FFmpeg: /qpdf.js is the Emscripten glue, and it resolves
    // /qpdf.wasm beside itself. You never get one without the other.
    urls: ["/qpdf.js", "/qpdf.wasm"],
    toolCount: 4,
  },
  {
    id: "lamejs",
    label: "lamejs",
    handles: "MP3 encoding — the one codec browsers will decode but not write.",
    bytes: 259_508,
    urls: ["/vendor/lamejs.js"],
    toolCount: 17,
  },
  {
    id: "zxing",
    label: "zxing-wasm",
    handles: "Reading QR codes and barcodes out of a dropped image.",
    bytes: 1_093_289,
    urls: ["/zxing_reader.wasm"],
    toolCount: 1,
  },
  {
    id: "libarchive",
    label: "libarchive",
    handles:
      "Opening TAR, 7z, RAR, CAB, ISO and CPIO — listing what is inside and extracting it.",
    bytes: 613_235,
    urls: ["/libarchive.wasm"],
    toolCount: 1,
  },
  {
    id: "oxipng",
    label: "oxipng",
    handles: "Real PNG re-compression — the one image job a canvas re-encode cannot do at all.",
    bytes: 164_172,
    urls: ["/squoosh_oxipng_bg.wasm"],
    toolCount: 1,
  },
  {
    id: "tesseract",
    label: "Tesseract OCR",
    handles: "Reading printed text out of a photo, screenshot or scan.",
    bytes: 5_088_998,
    /*
      FIVE files, and they must be stored together or the tool half-works in a
      way that is worse than not working: the core glue resolves its own .wasm
      against worker.min.js's URL, so a cache holding four of these answers the
      page and then 404s the binary from inside the worker.
      `addBundle` is all-or-nothing for exactly this reason.
    */
    urls: [
      "/tesseract/tesseract.esm.min.js",
      "/tesseract/worker.min.js",
      "/tesseract/tesseract-core-simd-lstm.js",
      "/tesseract/tesseract-core-simd-lstm.wasm",
      "/tesseract/eng.traineddata.gz",
    ],
    /*
      TWO, and derived the way this file's own note demands — by counting
      reachable CALL SITES, not importers. `recognizeImage` has one
      (ImageToTextUI) and `openOcrSession` has one (ocr-pdf.ts, itself reached
      only from OcrPdfUI). Counting importers is what made the HEIC decoder read 63
      instead of 5.
    */
    toolCount: 2,
  },
  {
    id: "print-fonts",
    label: "Print typefaces",
    handles:
      "The five variable faces Markdown to PDF embeds in the document it prints — Newsreader, Outfit, Syne and JetBrains Mono.",
    bytes: 229_908,
    // markdown-pdf-print-css.ts:25-53 writes these five @font-face URLs into
    // the print stylesheet. A missing face does not fail the run — it silently
    // prints in a fallback, which is why they are here rather than trusted to
    // the shell cache.
    urls: [
      "/fonts/print/newsreader-latin-wght-normal.woff2",
      "/fonts/print/newsreader-latin-wght-italic.woff2",
      "/fonts/print/outfit-latin-wght-normal.woff2",
      "/fonts/print/syne-latin-wght-normal.woff2",
      "/fonts/print/jetbrains-mono-latin-wght-normal.woff2",
    ],
    toolCount: 1,
  },
];

/**
 * THE SHAPE OF THE CHOICE, and the reason this page leads with it rather than
 * with a list of toggles.
 *
 * 142 of the 190 registered tools reach no origin-root engine binary at all —
 * they are Canvas, Web Audio, WebCodecs, pdf-lib and ordinary bundled
 * JavaScript, and the app shell alone is enough for every one of them. Of the
 * 48 that do need something, 16 are covered by everything-except-FFmpeg
 * together, and the remaining 32 need the 32 MB core.
 *
 * A visitor deciding what to store is entitled to see that shape before they
 * see a download button. `offline.test.ts` pins 133 + 46 to the registry's own
 * length, so a new tool cannot quietly make this paragraph wrong.
 */
export const TOOLS_WITHOUT_ENGINES = 142;
export const TOOLS_WITH_ENGINES = 48;
export const TOOLS_NEEDING_FFMPEG = 32;
export const TOOLS_NEEDING_ONLY_SMALL_ENGINES = 16;

/**
 * THE TWO SHARES THE PAGE LEADS WITH — COMPUTED, NEVER WRITTEN DOWN.
 *
 * ⚠ These replace a sentence that was FALSE the day it was committed, and
 * that nothing in the suite could have contradicted. It read "a twentieth of
 * the bytes for a third of the tools". The tool half was right; the byte half
 * was out by a factor of ~3.8 AS AT 2026-09-10, when the eight bundles then
 * present summed to 6,125,478 B against FFmpeg's 32,344,478 — about a fifth,
 * where a twentieth would have needed the small set under 1,617,224 B. It had
 * never been that small in any committed revision (`git show 4549b77
 * --name-status` adds the file already carrying all eight); the figure was
 * most likely taken from lamejs + heic2any (the HEIC decoder of the day)
 * alone, 1,621,055 B, which really
 * is FFmpeg/19.95.
 *
 * ⚠⚠ EVERY FIGURE IN THE PARAGRAPH ABOVE IS HISTORICAL AND DATED FOR A
 * REASON — it went stale within two days. Adding the 5,088,998 B Tesseract
 * bundle moved the real ratio from a fifth to about a third, so a reader who
 * took "a fifth" as current would be repeating the very mistake this note
 * exists to describe. DO NOT state the live ratio here. It is
 * `SMALL_BYTE_SHARE_PCT` below, and that is the only place it is allowed to
 * exist.
 *
 * The lesson is not "that fraction was wrong". It is that AN ENGLISH FRACTION
 * CANNOT BE CONTRADICTED BY ARITHMETIC, so no test can hold it to anything —
 * the one that carried its name asserted a different number entirely (see
 * `offline.test.ts`). These are percentages divided out of ENGINE_BUNDLES, so
 * a ninth engine moves the sentence without anyone editing prose.
 */
export const SMALL_BUNDLES = ENGINE_BUNDLES.filter((b) => b.id !== "ffmpeg");
export const SMALL_ENGINE_BYTES = totalBundleBytes(SMALL_BUNDLES);
export const SMALL_BYTE_SHARE_PCT = Math.round((SMALL_ENGINE_BYTES / totalBundleBytes()) * 100);
export const SMALL_TOOL_SHARE_PCT = Math.round(
  (TOOLS_NEEDING_ONLY_SMALL_ENGINES / TOOLS_WITH_ENGINES) * 100,
);

/**
 * ⚠ THE ONE CLAIM THAT CANNOT BE MADE EITHER WAY.
 *
 * `audio-decode.ts:411-419` reaches FFmpeg only AFTER the browser's own
 * `decodeAudioData` has REJECTED the file. So for these 12 audio tools the
 * 32 MB is not a property of the tool at all — it is decided per file, per
 * browser, at the moment one is dropped. Safari decodes formats Chromium
 * refuses and the reverse is also true, and an m4a that one engine opens is an
 * m4a the other hands to the fallback.
 *
 * A green "works offline" badge on those tools would be a guess, and a red one
 * would be a different guess. The UI gets a third value and says which twelve.
 */
export const TOOLS_WHERE_FFMPEG_IS_A_FALLBACK = 12;

/**
 * Is the Cache API usable here at all?
 *
 * `caches` is undefined outside a secure context, and jsdom does not implement
 * it, so every entry point below has to survive its absence rather than
 * assume a browser. The service worker is checked too: the Cache API on its
 * own is storage, not offline — nothing SERVES a stored engine unless a worker
 * is there to answer the request. Storing 32 MB that nothing can hand back
 * would be the most expensive no-op on the site.
 */
export function supportsOffline(): boolean {
  return (
    typeof caches !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
}

/**
 * `caches.match(url, { cacheName })` rather than `caches.open(...)` then
 * `cache.match(...)`, for one reason: `open` CREATES the cache if it is
 * missing. A read must not be able to bring the thing it is reading into
 * existence.
 *
 * The rejection path is not theoretical either. The current spec resolves with
 * `undefined` when no cache of that name exists, but older implementations
 * rejected with a NotFoundError, and a read that throws where it used to
 * return would surface here as a broken page rather than an empty cache.
 * Either way the answer is the same: not stored.
 */
async function isStored(url: string): Promise<boolean> {
  try {
    // `ignoreSearch` matches the worker's own lookup. Every engine loader
    // retries with `?retry=N` (audio-pcm.ts:52-57: a module that fails to
    // fetch is remembered as failed in the realm's module map, so a same-URL
    // retry never touches the network), and the worker pairs `isEngineUrl`'s
    // path-only match with `ignoreSearch: true`. Reading any other way would
    // let the page and the worker disagree about whether a copy exists.
    const hit = await caches.match(url, { cacheName: ENGINE_CACHE, ignoreSearch: true });
    return hit !== undefined;
  } catch {
    return false;
  }
}

/**
 * DERIVED every call from `caches.match()`. Never memoised, never stored.
 *
 * A bundle is reported only when EVERY url in it is present. That is not
 * belt-and-braces: `addBundle` is the only writer and it cleans up after
 * itself, so a partial bundle should be impossible — and the moment it turns
 * out not to be, this function must call it absent rather than let a tool
 * promise a fallback it cannot load.
 */
export async function cachedBundleIds(): Promise<Set<EngineBundle["id"]>> {
  const present = new Set<EngineBundle["id"]>();
  if (!supportsOffline()) return present;
  for (const bundle of ENGINE_BUNDLES) {
    const found = await Promise.all(bundle.urls.map(isStored));
    if (found.every(Boolean)) present.add(bundle.id);
  }
  return present;
}

function bundleById(id: EngineBundle["id"]): EngineBundle {
  const bundle = ENGINE_BUNDLES.find((b) => b.id === id);
  if (!bundle) throw new Error(`Unknown engine bundle: ${id}`);
  return bundle;
}

/** The shape `signal.throwIfAborted()` produces, spelled out for older engines. */
function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

/**
 * Fetch one URL and return its bytes, reporting progress as they arrive.
 *
 * The body is read through a reader rather than handed straight to
 * `cache.put`, because the whole point of the consent screen is that the user
 * can watch the 32 MB they agreed to arrive — and `cache.put` on a streaming
 * response reports nothing until it is finished.
 *
 * Progress is measured against the DECLARED bundle size rather than
 * `content-length`. That is not laziness: a `content-length` describes the
 * encoded body, while the reader yields decoded bytes, so on any
 * content-encoded response the two disagree and the bar overshoots. The
 * declared size is the uncompressed byte count of the file on disk, which is
 * exactly what the reader will hand back.
 */
async function fetchBytes(
  url: string,
  onChunk: (bytes: number) => void,
  signal?: AbortSignal,
): Promise<{ body: ArrayBuffer; headers: Headers }> {
  // `cache: "reload"` for the reason install uses it: GitHub Pages sends a flat
  // `cache-control: max-age=600` to everything, so an ordinary fetch could
  // copy a ten-minute-old response out of the HTTP cache and make it this
  // origin's first durable copy. The user asked for the engine this site
  // serves now, not the one it served before lunch.
  const response = await fetch(url, { cache: "reload", signal });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const body = response.body;
  if (!body) {
    // No `body` getter at all (an old engine, or a stubbed fetch). Nothing to
    // stream, so progress arrives in one jump.
    const whole = await response.arrayBuffer();
    onChunk(whole.byteLength);
    return { body: whole, headers: response.headers };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      onChunk(value.byteLength);
    }
  }
  // An explicit ArrayBuffer, not `new Uint8Array(total).buffer`: `BodyInit`
  // wants an `ArrayBufferView<ArrayBuffer>` and a bare Uint8Array is typed
  // over `ArrayBufferLike`, which includes SharedArrayBuffer and is refused.
  const buffer = new ArrayBuffer(total);
  const view = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: buffer, headers: response.headers };
}

/**
 * Store one bundle. Rejects on any failure and leaves NO partial bundle
 * behind.
 *
 * The cleanup in the `catch` is the reason this function exists rather than a
 * three-line `cache.addAll`. `addAll` is atomic about its own writes, but it
 * gives no progress at all for a 32 MB download and it cannot be told to keep
 * the response's headers — and this cache is read back by
 * `WebAssembly.instantiateStreaming`, which refuses a response whose
 * content-type is not `application/wasm`. So the response is rebuilt from the
 * bytes with the ORIGINAL headers carried over.
 *
 * Already-stored bundles return immediately. Without that, re-pressing the
 * button on a bundle that is already present could fail halfway and delete a
 * copy that was complete before the call started.
 */
export async function addBundle(
  id: EngineBundle["id"],
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const bundle = bundleById(id);
  if (!supportsOffline()) {
    throw new Error("This browser cannot store an offline copy (no Cache API).");
  }
  if (signal?.aborted) throw abortError();

  const already = await cachedBundleIds();
  if (already.has(id)) {
    onProgress?.(1);
    return;
  }

  const cache = await caches.open(ENGINE_CACHE);
  let received = 0;
  const report = (delta: number) => {
    received += delta;
    // Clamped because the denominator is a measurement of the file and the
    // numerator is whatever the network actually handed over; a proxy that
    // pads or a re-measured artifact must not push the bar past its end.
    onProgress?.(Math.min(1, received / bundle.bytes));
  };

  try {
    for (const url of bundle.urls) {
      if (signal?.aborted) throw abortError();
      const { body, headers } = await fetchBytes(url, report, signal);
      await cache.put(url, new Response(body, { status: 200, headers }));
    }
    if (signal?.aborted) throw abortError();
  } catch (err) {
    // Everything this call wrote, gone — including on an abort, because a
    // cancelled download is not a smaller download. `removeBundle` is used
    // rather than a bare loop so there is one definition of "all of it".
    await removeBundle(id).catch(() => {});
    throw err;
  }
  onProgress?.(1);
}

/**
 * Remove one bundle. Complete, or it is not a removal.
 *
 * `ignoreSearch` for the same reason the reads use it: `?retry=N` variants are
 * the same engine, and a removal that left one behind would leave the bundle
 * reading as absent (`cachedBundleIds` needs every url) while still occupying
 * the bytes the user asked to reclaim.
 */
export async function removeBundle(id: EngineBundle["id"]): Promise<void> {
  const bundle = bundleById(id);
  if (typeof caches === "undefined") return;
  // `caches.has` first so removing something that was never there does not
  // create an empty cache as a side effect.
  if (!(await caches.has(ENGINE_CACHE))) return;
  const cache = await caches.open(ENGINE_CACHE);
  for (const url of bundle.urls) {
    await cache.delete(url, { ignoreSearch: true });
  }
}

/**
 * Everything this site put in the Cache API, gone. The escape hatch.
 *
 * Both caches, not just the engines: the shell cache is the copy of the site's
 * own HTML, scripts and styles, and someone asking for it all to go does not
 * mean "except the part I did not choose". `OWNED_CACHES` is imported rather
 * than re-listed so this cannot drift from what the worker's `activate`
 * considers ours.
 *
 * WHAT IT DOES NOT DO, stated because the button's label has to be true. It
 * does not unregister the service worker: on the next visit the worker
 * re-precaches `/` and `/offline.html`, which is two documents and no engine.
 * And it does not touch `transmute-recent-outputs`, the localStorage key that
 * remembers the names of your last 8 downloads — that is a different thing in
 * a different store, and the page says so beside the button rather than
 * quietly widening what "clear" means.
 */
export async function clearAllOffline(): Promise<void> {
  if (typeof caches === "undefined") return;
  for (const name of OWNED_CACHES) {
    await caches.delete(name);
  }
}

/**
 * What the browser says about this origin's storage, or null where the API is
 * absent (Safari implemented `estimate` late, and it is missing entirely in
 * insecure contexts).
 *
 * Both numbers are the browser's, not ours. `usage` includes the shell cache
 * and anything else this origin holds, and browsers deliberately pad and round
 * it to frustrate cross-site fingerprinting, so it will not equal the sum of
 * the bundle sizes above and the page must not present it as if it should.
 */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== "number" || typeof quota !== "number") return null;
    return { usage, quota };
  } catch {
    return null;
  }
}

/**
 * The site's own size ruler: binary prefixes, printed with the decimal
 * prefix's spelling.
 *
 * It is not a free choice — it is the ruler the homepage DOWNLOAD column
 * already uses, measured off the rows that were there before this file
 * existed: lamejs is 259,508 bytes and reads "253 KB" (253.4 KiB; decimal
 * would be 260 — and "254" is what this comment said until 2026-09-12, which
 * is the arithmetic slip engine-disclosure.test.ts:73 already records fixing
 * on the homepage), and the HEIC decoder — heic2any's 1,361,547 B then, libheif's
 * 1,513,632 B since 2026-09-12 — reads "1.3 MB" and "1.4 MB" respectively,
 * where a decimal ruler would have printed 1.4 and 1.5 for the same two files.
 * Printing the same artifacts on a decimal ruler here would make two pages of
 * this site disagree about the size of one file.
 *
 * Under a mebibyte the figure is whole kibibytes, which is what
 * engine-disclosure.test.ts derives libarchive's "599 KB" with; above it, one
 * decimal place.
 */
export function formatEngineBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Every engine bundle's bytes added up — the "store everything" figure. */
export function totalBundleBytes(bundles: readonly EngineBundle[] = ENGINE_BUNDLES): number {
  return bundles.reduce((sum, b) => sum + b.bytes, 0);
}

/**
 * Exported for the test that pins this module to sw-policy.ts.
 *
 * The worker's view is authoritative about what it will SERVE: an engine this
 * module stored at a URL `isEngineUrl` does not recognise would sit in the
 * cache forever and never be handed to anyone, because `strategyFor` would
 * route that request to `network-first` and look in the wrong cache. The two
 * lists have to be the same list, and the test proves it rather than a comment
 * asking for it.
 */
export function everyBundleUrlIsAnEngineUrl(origin: string): boolean {
  return ENGINE_BUNDLES.every((bundle) =>
    bundle.urls.every((url) => isEngineUrl(new URL(url, origin), origin)),
  );
}
