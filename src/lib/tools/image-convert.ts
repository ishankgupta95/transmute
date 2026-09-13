import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { canvasToBlob, fillBackground, loadImage, mimeSupportsAlpha } from "./canvas-utils";
import { fileFirstFrameWarning, heicImageWarning, tiffPageWarning } from "./image-frames";

/**
 * BMP is deliberately absent as a *target*: `canvas.toBlob` is only required to
 * support PNG and silently falls back to it for any type the browser can't
 * encode, so asking for `image/bmp` produced PNG bytes wearing a `.bmp` name.
 * It remains a perfectly good *source* format — the browser decodes it fine.
 */
export interface ImageConvertOptions {
  targetFormat: "jpeg" | "png" | "webp";
  quality: number; // 0–1
  width?: number;
  height?: number;
}

/**
 * Convert an image file to the target format using Canvas API.
 * Handles HEIC (via libheif-js), TIFF (via utif2), SVG, and all
 * browser-native formats.
 */
export async function convertImage(
  file: File,
  options: ImageConvertOptions,
): Promise<ProcessedResult> {
  const { targetFormat, quality, width, height } = options;
  const mimeType = `image/${targetFormat}`;

  // Get a decodable blob — special handling for HEIC and TIFF. Warnings ride
  // along: a multi-page TIFF or animated GIF/WebP loses everything past its
  // first raster here, and the result must say so.
  const { blob: decodableBlob, warnings } = await toDecodableSource(file);

  // Load into an HTMLImageElement
  const img = await loadImage(decodableBlob);

  // Determine output dimensions. An SVG without width/height attributes has
  // no intrinsic size — Firefox reports naturalWidth 0 and Chromium invents
  // the CSS replaced-element default (300×150), so the old code produced a
  // 0×0 or 300×150 PNG regardless of the drawing. When the document itself
  // declares no size, its viewBox (scaled to a usable raster) wins over
  // whatever the UA made up.
  let intrinsicWidth = img.naturalWidth;
  let intrinsicHeight = img.naturalHeight;
  if (isSvgSource(file)) {
    const fallback = svgFallbackSize(await file.text());
    if (fallback && (!fallback.explicit || intrinsicWidth === 0 || intrinsicHeight === 0)) {
      intrinsicWidth = fallback.width;
      intrinsicHeight = fallback.height;
    }
  }
  if (intrinsicWidth === 0 || intrinsicHeight === 0) {
    throw new Error("Could not determine the image's dimensions");
  }

  const outWidth = width ?? intrinsicWidth;
  const outHeight = height ?? intrinsicHeight;

  // Draw to canvas and export
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  // JPEG/BMP have no alpha channel: paint white first so transparent regions
  // flatten to white instead of black.
  if (!mimeSupportsAlpha(mimeType)) fillBackground(ctx, outWidth, outHeight);
  ctx.drawImage(img, 0, 0, outWidth, outHeight);

  const blob = await canvasToBlob(canvas, mimeType, quality);
  // The trap this file's own header records, applied to this file's own
  // encode: `toBlob` silently serialises PNG for a type the browser cannot
  // write, and the Blob's type is the encoder saying which it produced. WebKit
  // is the live case for WebP, so svg-to-webp handed back 42 KB of PNG named
  // `.webp` — the same lie the `.bmp` target was removed for. The message is
  // the one image-edit.ts:112 and image.worker.ts's edit op already ship.
  if (blob.type && blob.type !== mimeType) {
    throw new Error(`This browser cannot write ${targetFormat.toUpperCase()} images.`);
  }
  const ext = targetFormat === "jpeg" ? "jpg" : targetFormat;
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}.${ext}`,
    originalSize: file.size,
    newSize: blob.size,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function isSvgSource(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "svg" || file.type === "image/svg+xml";
}

/**
 * Raster size for an SVG. `explicit: true` means the document declares its
 * own width/height (returned as-is — the browser's naturalWidth agrees, and
 * an author-chosen 240px SVG must not be inflated). `explicit: false` means
 * the size came from the viewBox, scaled so the longest edge is 1024 px —
 * a viewBox of 24×24 units would otherwise rasterise into an unusable
 * thumbnail. Exported for unit tests.
 */
export function svgFallbackSize(
  svgText: string,
): { width: number; height: number; explicit: boolean } | null {
  const attr = (name: string): number | null => {
    const m = svgText.match(new RegExp(`<svg[^>]*\\s${name}="([0-9.]+)(?:px)?"`, "i"));
    return m ? Number(m[1]) : null;
  };
  const w = attr("width");
  const h = attr("height");
  if (w && h && Number.isFinite(w) && Number.isFinite(h)) {
    return { width: Math.round(w), height: Math.round(h), explicit: true };
  }
  const vb = svgText.match(
    /<svg[^>]*\sviewBox="[\s]*([-0-9.]+)[ ,]+([-0-9.]+)[ ,]+([0-9.]+)[ ,]+([0-9.]+)/i,
  );
  if (!vb) return null;
  const vw = Number(vb[3]);
  const vh = Number(vb[4]);
  if (!vw || !vh || !Number.isFinite(vw) || !Number.isFinite(vh)) return null;
  const scale = Math.max(1, 1024 / Math.max(vw, vh));
  return { width: Math.round(vw * scale), height: Math.round(vh * scale), explicit: false };
}

/** A pre-decoded source plus any notices generated while producing it. */
export interface DecodableSource {
  blob: Blob;
  /** User-facing notices (multi-page TIFF, animated GIF/WebP flattened). */
  warnings: string[];
}

/**
 * The slice of libheif-js's high-level binding this file drives. Declared by
 * hand because the library is reached through a runtime-computed URL and has
 * no static type here — TypeScript cannot know which file will answer it.
 *
 * `display` is callback-shaped rather than promise-shaped, and it hands back
 * null on a decode failure instead of throwing.
 */
interface HeifImage {
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  display(into: ImageData, done: (out: ImageData | null) => void): void;
  free(): void;
}
interface HeifDecoderInstance {
  /**
   * The wasm pointer to this decoder's `heif_context`. Public in the shipped
   * binding (`Wr = function(){ this.decoder = null }`) and the only handle on
   * the allocation — see the leak note on `decodeHeic`.
   */
  decoder: number | null;
  decode(bytes: Uint8Array): HeifImage[];
}
interface HeifDecoderCtor {
  new (): HeifDecoderInstance;
}
interface LibheifModule {
  HeifDecoder: HeifDecoderCtor;
  heif_context_free(context: number | null): void;
}
/** Emscripten module factory. Resolves once the wasm is instantiated. */
type LibheifFactory = (options: { wasmBinary: ArrayBuffer }) => Promise<LibheifModule>;

/**
 * Same-origin URL of a vendored third-party library, prefixed the way every
 * other self-hosted asset in this app is (see workers/image-client.ts).
 *
 * THIS FUNCTION IS LOAD-BEARING — see the twin in lib/tools/audio-pcm.ts.
 * Folding it into a plain template literal at the call site would give the
 * bundler a resolvable string constant and it would inline the library again,
 * which is precisely what must not happen.
 */
function vendorUrl(name: string, attempt = 0): string {
  const base = `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/vendor/${name}`;
  // A failed fetch is remembered — per specifier by the module map for the
  // `import()` twin in audio-pcm.ts, and by the HTTP cache for the script tag
  // and `fetch` here — so a retry of the identical URL can resolve to the
  // failure without a request. The query string makes the retry a new URL.
  return attempt === 0 ? base : `${base}?retry=${attempt}`;
}


/** Memoised so a batch of HEICs shares one fetch of the 1.4 MB decoder. */
let libheifModule: Promise<LibheifModule> | null = null;
/** How many times loading has been attempted; see vendorUrl's `attempt`. */
let libheifAttempts = 0;

/**
 * Fetch libheif-js from `/vendor/` instead of bundling it.
 *
 * WHY VENDORED: libheif and libde265 are LGPL. An LGPL library stays under its
 * own terms only while it remains replaceable — someone must be able to drop
 * in their own build of the decoder and have this app use it. Minified into a
 * Next client chunk it is not replaceable, so `npm run copy:wasm` copies
 * upstream's `libheif-wasm/libheif.js` and `libheif-wasm/libheif.wasm`
 * byte-for-byte into `public/vendor/` and this loads them at first HEIC.
 *
 * WHY TWO FILES AND NOT THE ONE-FILE BUNDLE: libheif-js also publishes
 * `libheif-bundle.mjs`, which is this same wasm base64'd inside the glue.
 * Measured 2026-09-12: 1,989,119 B raw / 696,990 B gzipped against
 * 1,513,632 B / 497,826 B for the pair — the convenience of one file costs
 * 199,164 bytes on the wire, all of it base64 padding, for no capability. The
 * two files are siblings in `/vendor/` and both are replaceable, which is what
 * the licence needs.
 *
 * WHY A SCRIPT TAG AND NOT `import()`: this is the one place the twin in
 * lib/tools/audio-pcm.ts could not be copied. heic2any's UMD had an explicit
 * global branch (`global.heic2any = factory()`), so importing it for its side
 * effect and reading the global worked. libheif-js's UMD tail does only
 * `module.exports` / AMD `define` over a top-level `var libheif`, which in an
 * ES module is module-scoped and unreachable: measured, `import()` yields an
 * empty namespace AND leaves `globalThis.libheif` undefined. A classic script
 * gets the sloppy-mode global, and — like the computed specifier it replaces —
 * a runtime-built `src` is something no bundler can inline.
 *
 * WHY WE HAND IT THE WASM — and the reason is not the one you would guess.
 * It is not about URL resolution: this build has ASYNC WASM COMPILATION OFF, so
 * left alone the glue tries to read its binary SYNCHRONOUSLY, which no browser
 * permits. Measured: it never issues a request for `libheif.wasm` at all, it
 * aborts with "sync fetching of the wasm failed: you can preload it to
 * Module['wasmBinary'] manually". Supplying `wasmBinary` is therefore
 * REQUIRED, not an optimisation — it is what the package's own Node entrypoint
 * does too. The happy side effect is that the URL is ours, so the tesseract
 * sibling-resolution trap has nothing to bite.
 *
 * This is main-thread-only code: image-convert.ts is reachable from the UI and
 * from workers/image-client.ts's main-thread `prepareSource`, but from no
 * worker entrypoint (image.worker.ts imports it with `import type` only, which
 * esbuild erases). Keep it that way — dragging it into the worker graph would
 * put a 1.4 MB decoder into a worker bundle that today has none of it, and
 * `document.createElement` would not be there to load it.
 */
async function loadLibheif(): Promise<LibheifModule> {
  if (!libheifModule) {
    const attempt = libheifAttempts++;
    libheifModule = (async () => {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = vendorUrl("libheif.js", attempt);
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Could not load the HEIC decoder"));
        document.head.appendChild(script);
      });
      const factory = (globalThis as { libheif?: LibheifFactory }).libheif;
      if (typeof factory !== "function") throw new Error("Could not load the HEIC decoder");
      const response = await fetch(vendorUrl("libheif.wasm", attempt));
      if (!response.ok) throw new Error("Could not load the HEIC decoder");
      return await factory({ wasmBinary: await response.arrayBuffer() });
    })().catch((err) => {
      // Clearing the memo is only half of it — the retry also has to ask for a
      // URL the HTTP cache has not already condemned, which is what the
      // attempt counter in vendorUrl buys. Without both, one flaky request for
      // these 1.4 MB breaks every later HEIC in the tab, including the retry
      // the user reaches for by re-dropping the photo.
      libheifModule = null;
      throw err;
    });
  }
  return await libheifModule;
}

/**
 * Decode a HEIC/HEIF to PNG bytes the rest of the pipeline can `<img>`-decode,
 * plus a warning when the container held more than one picture.
 *
 * WHICH image survives: the one the file marks primary, not index 0. The
 * container's `pitm` box names the main picture and nothing requires it to be
 * first — the decoder we used until 2026-09-12 always took `[0]`, which is why
 * the shipped copy's promise of "the primary image" was not reliably true.
 *
 * Every handle is freed, including the ones we discard: they are wasm heap
 * allocations, and a batch of bursts would otherwise grow the heap until it
 * aborted. (Same lesson as the TIFF per-page retention fixed in Wave 1.)
 */
async function decodeHeic(file: File): Promise<DecodableSource> {
  const libheif = await loadLibheif();
  const decoder = new libheif.HeifDecoder();
  let images: HeifImage[] = [];
  try {
    images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
    if (images.length === 0) throw new Error("This file has no image inside it");

    const main = images.find((image) => image.is_primary()) ?? images[0];
    const w = main.get_width();
    const h = main.get_height();

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");

    const imageData = ctx.createImageData(w, h);
    const decoded = await new Promise<ImageData | null>((resolve) => {
      main.display(imageData, resolve);
    });
    if (!decoded) throw new Error("Could not decode this HEIC image");
    ctx.putImageData(decoded, 0, 0);

    const warning = heicImageWarning(images.length);
    return {
      // PNG, always: HEIC carries alpha in its own auxiliary item and a JPEG
      // hand-off here would flatten it to black, which is the exact defect the
      // decoder swap fixed.
      blob: await canvasToBlob(canvas, "image/png", 1),
      warnings: warning ? [warning] : [],
    };
  } finally {
    for (const image of images) image.free();
    // ⚠ FREEING THE CONTEXT IS NOT OPTIONAL, AND THE LIBRARY WILL NOT DO IT.
    // `HeifDecoder.decode()` frees the previous context only when it is called
    // AGAIN ON THE SAME INSTANCE — and a fresh instance per file (which is what
    // safety requires here, see below) is dropped before that ever happens, so
    // `heif_context_read_from_memory`'s copy of the whole file stays in the
    // wasm heap for the life of the tab.
    //
    // Measured 2026-09-12, 400 decodes of an 82,878-byte photo: the heap grows
    // 16.3 MB -> 48.6 MB without this line and stays flat at 16.3 MB with it.
    // ~81 KB retained per photo, i.e. roughly the file. A batch of 3 MB iPhone
    // photos would walk a browser into the same out-of-memory abort this swap
    // was partly made to escape.
    //
    // WHY NOT SHARE ONE DECODER INSTANCE, which would also free the previous
    // context: the image handles are used AFTER an `await` (display() is
    // callback-shaped), so two conversions running at once — which a batch
    // does — would let the second decode free the first's context out from
    // under live handles. A fresh decoder plus an explicit free is the version
    // that is both leak-free and safe.
    libheif.heif_context_free(decoder.decoder);
    decoder.decoder = null;
  }
}

/**
 * Return a blob the browser's <img> can decode, plus warnings about what the
 * pre-decode dropped. HEIC/HEIF and TIFF are pre-decoded to PNG; SVG is
 * re-wrapped with the right MIME; everything else is returned as-is (with an
 * animated GIF/WebP sniff — the eventual <img>/createImageBitmap decode keeps
 * only frame 0 and says nothing).
 */
export async function toDecodableSource(file: File): Promise<DecodableSource> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  // HEIC / HEIF
  if (ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif") {
    return await decodeHeic(file);
  }

  // TIFF
  if (ext === "tiff" || ext === "tif" || file.type === "image/tiff") {
    return await decodeTiff(file);
  }

  // SVG — wrap in blob with correct MIME so <img> can decode it
  if (ext === "svg" || file.type === "image/svg+xml") {
    return {
      blob: new Blob([await file.arrayBuffer()], { type: "image/svg+xml" }),
      warnings: [],
    };
  }

  // Everything else (JPEG, PNG, WebP, BMP, AVIF, GIF) — browser decodes natively
  const warning = await fileFirstFrameWarning(file);
  return { blob: file, warnings: warning ? [warning] : [] };
}

/** Back-compat wrapper for callers that only need the pixels (exif-viewer). */
export async function toDecodableBlob(file: File): Promise<Blob> {
  return (await toDecodableSource(file)).blob;
}

/**
 * An opened TIFF: page count up front, pixels decoded per page on demand.
 * Pages are decoded lazily and one at a time on purpose — scan/fax TIFFs run
 * to hundreds of pages, and eagerly decoding them all to RGBA would OOM a
 * mobile tab. Wave 1's tiff-to-pdf calls `page(i)` for every page; the
 * converters below only ever ask for page 0.
 */
export interface TiffDocument {
  pageCount: number;
  page(index: number): { rgba: Uint8Array; width: number; height: number };
}

export async function openTiff(arrayBuffer: ArrayBuffer): Promise<TiffDocument> {
  const UTIF = await import("utif2");
  const ifds = UTIF.decode(arrayBuffer);
  if (ifds.length === 0) throw new Error("Could not decode TIFF file");
  return {
    pageCount: ifds.length,
    page(index) {
      const ifd = ifds[index];
      if (!ifd) throw new Error(`This TIFF has no page ${index + 1}`);
      UTIF.decodeImage(arrayBuffer, ifd);
      const result = {
        rgba: new Uint8Array(UTIF.toRGBA8(ifd)),
        width: ifd.width,
        height: ifd.height,
      };
      // utif2 memoizes the decompressed native bitmap on the IFD and the
      // closure keeps every IFD alive, so a per-page sweep (tiff-to-pdf)
      // would otherwise retain ALL pages' bitmaps at once. Dropping it keeps
      // "one page at a time" true; decodeImage re-decodes if asked again.
      delete (ifd as { data?: Uint8Array }).data;
      return result;
    },
  };
}

async function decodeTiff(file: File): Promise<DecodableSource> {
  const doc = await openTiff(await file.arrayBuffer());
  const { rgba, width: w, height: h } = doc.page(0);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  const imageData = ctx.createImageData(w, h);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);

  const warning = tiffPageWarning(doc.pageCount);
  return { blob: await canvasToBlob(canvas, "image/png", 1), warnings: warning ? [warning] : [] };
}

/**
 * Name an output from the format the encoder ACTUALLY wrote.
 *
 * `canvas.toBlob` substitutes PNG for a type it cannot encode rather than
 * failing (the trap recorded at the top of this file), and WebKit is the live
 * case for WebP. `convertImage` above turns that mismatch into a refusal,
 * because there the format is the user's explicit choice. The compressor and
 * the resizer are the other half of the same split: they CHOOSE the format
 * themselves as an alpha-safe default, so the honest response is to follow the
 * encoder and name the file for what is really in it, not to refuse a request
 * the user never made.
 *
 * The worker holds its own copy of this (`image.worker.ts`), for the same
 * reason it holds its own copy of every other canvas helper: it cannot import
 * this module, which reaches the DOM through `canvas-utils.ts`. The two are
 * the documented dual-pipeline duplication, not an oversight.
 *
 * An empty `blob.type` — no opinion from the encoder — leaves the request
 * standing.
 */
export function writtenFormat(
  blob: Blob,
  requestedMime: string,
  requestedExt: string,
): { mime: string; ext: string } {
  if (!blob.type || blob.type === requestedMime) {
    return { mime: requestedMime, ext: requestedExt };
  }
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.replace("image/", "");
  return { mime: blob.type, ext };
}
