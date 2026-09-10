import init, { optimise } from "@jsquash/oxipng/codec/pkg/squoosh_oxipng.js";
import type { PngOptimiseOptions } from "@/lib/workers/image-protocol";

/**
 * oxipng, the one image job a canvas re-encode cannot do at all.
 *
 * `canvas.toBlob(cb, "image/png")` has no compression-level, filter-strategy or
 * palette knob anywhere in the API, so "compress this PNG" through a canvas is
 * a re-encode at whatever the browser feels like — often BIGGER. oxipng does
 * the real thing: it searches filters and deflate strategies and rewrites the
 * colour type, and every pixel round-trips unchanged.
 *
 * Which build, and why the explicit init: the deep single-thread specifier
 * above is the only legal one (eslint.config.mjs pins that, with the reasons).
 * Its glue locates the binary as `new URL("squoosh_oxipng_bg.wasm",
 * import.meta.url)`, esbuild leaves that expression VERBATIM, and inside
 * `public/workers/image.worker.js` it would resolve to
 * `/workers/squoosh_oxipng_bg.wasm` → 404. Passing the fetch response to
 * `init()` never lets that default fire. It is the same hazard
 * scripts/build-workers.mjs:18-22 records for qpdf's Emscripten glue.
 *
 * DOM-FREE. The image worker imports this file; nothing here touches
 * `document`, `Image` or a canvas, so the sniff, the header reader and the
 * megapixel guard are all exercisable in jsdom. (The wasm itself is not — it
 * needs a real fetch of a real binary.)
 */

/** The 8 bytes every PNG starts with. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Hard input cap on PIXELS. MEASURED: oxipng's wasm linear memory NEVER
 * shrinks — a 4000×3000 8-bit RGB PNG left the heap at 298 MB, and it was
 * still 298 MB after a 1.3 KB image went through next. wasm32 cannot return
 * that memory, and the pool reuses workers, so the high-water mark is
 * permanent for the life of the page. 12 MP is where a phone browser can still
 * be expected to survive it, and it is also what bounds the WAIT — ~570 ms per
 * megapixel, so 12 MP is already a five-second job.
 *
 * It is NOT, on its own, what bounds the memory: see the raster cap below.
 */
export const PNG_MEGAPIXEL_LIMIT = 12;

/**
 * Hard input cap on the DECODED RASTER, which is the thing the heap actually
 * tracks: MEASURED at ≈8× it (298 MB on the 34.3 MB raster above).
 *
 * "24 MB per megapixel" is that same measurement divided by pixels, and it
 * holds only at 8-bit RGB. Channel count and bit depth move it, and the pixel
 * cap alone was blind to both: the identical 12.00 megapixels as 16-bit RGBA
 * is four times the raster, and two real 4000×3000 exports MEASURED 372 MB and
 * 751 MB — 2.5× the ~300 MB the pixel cap was chosen for, on files it admits.
 *
 * 48 MB is 12 megapixels of 8-bit RGBA: the largest raster the pixel cap ever
 * let through, so nothing that worked before is refused now, and ~400 MB at
 * the measured ≈8×. The 16-bit files above are 96 MB of raster and stop here.
 */
export const PNG_RASTER_BYTE_LIMIT = 48_000_000;

/**
 * MEASURED: level 5 and 6 return output byte-identical to level 4 at 1.9x and
 * 2.3x the time (og-image.png: 110,876 B at all three). Offering them would be
 * selling a wait for nothing.
 */
export const MAX_OXIPNG_LEVEL = 4;

/** MEASURED: ~570 ms per megapixel at level 2 on Apple silicon. */
export const OXIPNG_MS_PER_MEGAPIXEL = 570;

/**
 * The one message a non-PNG gets. It has to be ours: EVERY oxipng failure —
 * a JPEG, empty bytes, a truncated PNG, random garbage — throws the identical
 * string "`unwrap_throw` failed", which tells a user nothing and looks like a
 * crash. Sniffing the magic ourselves is the only way to say what is wrong.
 */
export const NOT_A_PNG_MESSAGE =
  "That file is not a PNG. This tool re-compresses PNG files only — for a JPEG or WebP, use the image compressor instead.";

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  /** PNG colour type code: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA. */
  colourType: number;
  /**
   * IHDR's interlace method: 0 = one pass, 1 = Adam7. Read because oxipng is
   * asked for `interlace: false` and an input that arrived interlaced comes
   * back without it — a change `describePngColour` cannot see, since colour
   * type and bit depth are unmoved by it.
   */
  interlace: number;
}

/** True when the bytes carry the PNG signature. Magic decides; the name can lie. */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  for (let i = 0; i < PNG_MAGIC.length; i++) {
    if (bytes[i] !== PNG_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Read IHDR — always the first chunk, always 13 bytes of payload at offset 16.
 * Returns null for anything that is not a PNG with a well-formed IHDR, so a
 * caller never has to decide whether a zero width meant "grey" or "garbage".
 */
export function readPngHeader(bytes: Uint8Array): PngHeader | null {
  // 8 magic + 4 length + 4 type + 13 payload = 29 bytes before the IHDR CRC.
  // That bound covers byte 28 (the interlace method), the last payload byte.
  if (!isPng(bytes) || bytes.length < 29) return null;
  if (
    bytes[12] !== 0x49 || // I
    bytes[13] !== 0x48 || // H
    bytes[14] !== 0x44 || // D
    bytes[15] !== 0x52 // R
  ) {
    return null;
  }
  const u32 = (offset: number) =>
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0;
  const width = u32(16);
  const height = u32(20);
  if (width === 0 || height === 0) return null;
  return {
    width,
    height,
    bitDepth: bytes[24],
    colourType: bytes[25],
    // bytes[26] and [27] are the compression and filter methods; the spec
    // defines exactly one value for each, so neither is worth carrying.
    interlace: bytes[28],
  };
}

/**
 * "RGBA/8", "Palette/4", "Gray/1" — the format the file is actually in.
 *
 * Worth reporting because oxipng REWRITES it, losslessly: a measured
 * RGBA/8 QR code came back Gray/1 (every pixel was opaque, so the alpha
 * channel was dropped), and an RGB/8 screenshot came back Palette/4. The
 * pixels are identical; the container is not, and a user comparing the two
 * files in an image editor deserves to have been told.
 */
export function describePngColour(header: PngHeader): string {
  const names: Record<number, string> = {
    0: "Gray",
    2: "RGB",
    3: "Palette",
    4: "Gray+Alpha",
    6: "RGBA",
  };
  return `${names[header.colourType] ?? `Type ${header.colourType}`}/${header.bitDepth}`;
}

export function megapixels(header: PngHeader): number {
  return (header.width * header.height) / 1_000_000;
}

/**
 * Samples per pixel by colour type, straight from the spec's IHDR table:
 * 0 grey = 1, 2 RGB = 3, 3 palette = 1 index, 4 grey+alpha = 2, 6 RGBA = 4.
 * A code the spec does not define is charged the worst case rather than
 * trusted — the file is malformed and the guard is the wrong place to be
 * generous about it.
 */
const SAMPLES_PER_PIXEL: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Bytes the decoded image occupies — width × height × samples × bit depth.
 * This, not the pixel count, is what oxipng's heap was MEASURED to track.
 */
export function rasterBytes(header: PngHeader): number {
  const samples = SAMPLES_PER_PIXEL[header.colourType] ?? 4;
  return (header.width * header.height * samples * header.bitDepth) / 8;
}

/**
 * The refusal message for an image past either cap, or null when it fits.
 * Checked from the IHDR BEFORE oxipng is called — the point is to never let
 * the allocation happen, so it cannot be caught after the fact.
 *
 * Two caps, because they bound two different things: pixels bound the wait,
 * and the decoded raster bounds the memory. A 4000×3000 PNG passes the first
 * either way; whether it passes the second depends on whether it is 8-bit RGB
 * (34 MB) or 16-bit RGBA (96 MB, MEASURED at 372–751 MB of wasm heap).
 */
export function pngTooLargeMessage(header: PngHeader): string | null {
  const mp = megapixels(header);
  if (mp > PNG_MEGAPIXEL_LIMIT) {
    return (
      `This PNG is ${header.width}×${header.height} (${mp.toFixed(1)} megapixels), ` +
      `over the ${PNG_MEGAPIXEL_LIMIT}-megapixel limit. oxipng holds the whole decoded image ` +
      `in wasm memory and a browser tab cannot give that memory back, so the limit is enforced ` +
      `before the file is opened rather than after the tab has died.`
    );
  }
  const raster = rasterBytes(header);
  if (raster > PNG_RASTER_BYTE_LIMIT) {
    return (
      `This PNG is ${header.width}×${header.height} in ${describePngColour(header)}, which ` +
      `decodes to ${Math.round(raster / 1_000_000)} MB — over the ` +
      `${Math.round(PNG_RASTER_BYTE_LIMIT / 1_000_000)} MB this tool accepts. The memory ` +
      `oxipng holds tracks the decoded image and was MEASURED at roughly eight times its ` +
      `size, so a deeper pixel format costs more than the same picture in 8-bit colour. ` +
      `Exporting this file at 8 bits per channel brings it inside the limit.`
    );
  }
  return null;
}

/**
 * The note attached when oxipng hands back the input unchanged. One producer,
 * one exact string — the UI reports THIS rather than inventing a "0% saved"
 * error, because an already-optimal PNG is a successful run.
 */
export function alreadyOptimalNote(level: number): string {
  return (
    `Already optimal at level ${level} — oxipng returned this PNG byte-for-byte unchanged. ` +
    `Nothing was lost; there was simply nothing left to remove.`
  );
}

/**
 * The note for a PNG that arrived Adam7-interlaced and left stored in one
 * pass. Nothing else on the page can see that happen: the before/after report
 * is built from `describePngColour`, which reads colour type and bit depth,
 * and interlacing moves neither.
 *
 * MEASURED on this repo's own 1200×630 screenshot: level 1 hands an interlaced
 * file straight back (125,391 B, byte-identical), while levels 2–4 de-interlace
 * it — 117,326 B at level 2, the same bytes the non-interlaced source produces.
 */
export function deinterlacedNote(): string {
  return (
    "Progressive (interlaced) rendering was removed: this PNG arrived Adam7-interlaced and " +
    "comes back stored in one pass, so a browser paints it top to bottom rather than in " +
    "progressive passes. Every pixel is identical — interlacing is how the rows are ordered, " +
    "not what they contain — and it costs bytes, which is why it is not written back."
  );
}

/** Rough wall-clock estimate, for copy that has to warn about a multi-second wait. */
export function estimateOptimiseMs(header: PngHeader): number {
  return Math.round(megapixels(header) * OXIPNG_MS_PER_MEGAPIXEL);
}

/** Same-origin URL of a self-hosted engine file; `attempt` busts the module map. */
function engineUrl(name: string, attempt = 0): string {
  const base = `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/${name}`;
  return attempt === 0 ? base : `${base}?retry=${attempt}`;
}

let ready: Promise<void> | null = null;

/**
 * Fetch and instantiate the codec, once per worker. The Response is handed
 * straight to `init` so the browser compiles it streaming (measured 2.3 ms,
 * against 12 ms for the same binary as bytes).
 *
 * The memo is dropped on failure, because a plain `??=` would replay a
 * REJECTED promise forever — the same shape qpdf.worker.ts:104-124 uses.
 */
function loadOxipng(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const response = await fetch(engineUrl("squoosh_oxipng_bg.wasm"));
      if (!response.ok) {
        throw new Error(`The PNG optimiser could not be loaded (HTTP ${response.status}).`);
      }
      await init(response);
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/**
 * Losslessly re-compress PNG bytes. Throws with a message a person can act on;
 * never surfaces oxipng's own.
 *
 * `interlace` is hard-wired false and deliberately not exposed: MEASURED,
 * asking for it makes files BIGGER (og-image 117,326 → 125,391 B) and oxipng
 * ignores the request outright on some inputs, so an "interlace" switch would
 * be a control that sometimes costs bytes and sometimes does nothing.
 *
 * The other direction is real and is DISCLOSED rather than hidden: `false`
 * does not only decline to ADD interlacing, it STRIPS it. MEASURED, an
 * Adam7-interlaced input comes back non-interlaced at levels 2–4 (and
 * untouched at level 1), which is a change of a kind the author chose on
 * purpose — so the worker compares the two IHDRs and attaches
 * `deinterlacedNote()` when it happens.
 */
export async function optimisePngBytes(
  bytes: Uint8Array,
  options: PngOptimiseOptions,
): Promise<Uint8Array> {
  const header = readPngHeader(bytes);
  if (!header) throw new Error(NOT_A_PNG_MESSAGE);
  const tooLarge = pngTooLargeMessage(header);
  if (tooLarge) throw new Error(tooLarge);

  const level = Math.min(MAX_OXIPNG_LEVEL, Math.max(1, Math.round(options.level)));
  await loadOxipng();
  try {
    return optimise(bytes, level, false, options.optimiseAlpha === true);
  } catch {
    // Drop the memo rather than keep handing out a possibly-poisoned instance.
    // Be honest about how much that buys: a DECODE error provably leaves the
    // module usable (measured), but a genuine wasm trap is UNVERIFIED, and the
    // glue memoises its own `wasm` binding at module scope — so re-init hands
    // back the SAME instance and only the fetch is repeated. Escaping a truly
    // trapped module means dropping the worker, which is the pool's job.
    ready = null;
    throw new Error(
      "The PNG optimiser could not read this file. It may be truncated or corrupt — " +
        "try re-exporting it from the app that produced it.",
    );
  }
}
