/**
 * Reading an animated GIF into frames — the capability this site did not have.
 *
 * Until now nothing here decoded animation at all. `image-convert.ts` sniffs an
 * animated GIF or WebP and WARNS that everything past frame 0 will be lost,
 * because the `<img>`/`createImageBitmap` path it uses keeps only the first
 * frame. That warning was the honest thing to ship without a decoder; this is
 * the decoder.
 *
 * TWO PATHS, and the second is not optional — it is the only reason this works
 * in Safari. Measured with `ImageDecoder` in all three engines this repo tests:
 *
 *   | engine   | ImageDecoder | frames from a 3-frame GIF |
 *   |----------|--------------|---------------------------|
 *   | Chromium | yes          | 3, durations exact        |
 *   | Firefox  | yes          | 3, durations exact        |
 *   | WebKit   | **absent**   | — |
 *
 * ⚠ `ImageDecoder` is also absent on a NON-SECURE origin, and the first probe
 * of it reported `false` in all three engines for exactly that reason — it was
 * run against `about:blank`. Feature-detect it, never assume it from the
 * browser.
 *
 * ⚠ `await decoder.tracks.ready` IS REQUIRED and is easy to miss. Chromium
 * resolves `completed` with `tracks.selectedTrack` still null, so a decoder
 * written without it reports ZERO frames in Chrome and works in Firefox —
 * measured, and the sort of split that survives a test suite run on one engine.
 */

/** One decoded frame: pixels, and how long it is shown. */
export interface GifFrame {
  readonly bitmap: ImageBitmap;
  /** Display time in milliseconds, as the file stores it. */
  readonly delayMs: number;
}

export interface DecodedGif {
  readonly frames: readonly GifFrame[];
  readonly width: number;
  readonly height: number;
  /** True when the source really is animated, i.e. more than one frame. */
  readonly animated: boolean;
}

/**
 * The delay a browser substitutes for an implausibly short one.
 *
 * GIF stores delay in hundredths of a second, and a great many real files
 * claim 0 or 1 — a convention meaning "as fast as possible" that dates to
 * Netscape. Every browser silently substitutes 100 ms, so a tool that honours
 * the stored value produces an animation that plays at a speed nobody has ever
 * seen the original run at. Matching the browsers is the honest choice here:
 * the output should look like the input did.
 */
const MIN_SENSIBLE_DELAY_MS = 20;
const SUBSTITUTED_DELAY_MS = 100;

function normaliseDelay(ms: number): number {
  return ms < MIN_SENSIBLE_DELAY_MS ? SUBSTITUTED_DELAY_MS : ms;
}

function hasImageDecoder(): boolean {
  return typeof globalThis.ImageDecoder !== "undefined";
}

/** The native path. Chromium and Firefox. */
async function decodeWithImageDecoder(bytes: Uint8Array, type: string): Promise<DecodedGif> {
  const Decoder = globalThis.ImageDecoder!;
  const decoder = new Decoder({ data: bytes, type });
  try {
    // BOTH awaits, in this order. See the note at the top of the file.
    await decoder.tracks.ready;
    await decoder.completed;

    const track = decoder.tracks.selectedTrack;
    const count = track?.frameCount ?? 0;
    if (count === 0) throw new Error("no frames");

    const frames: GifFrame[] = [];
    let width = 0;
    let height = 0;
    for (let i = 0; i < count; i += 1) {
      const { image } = await decoder.decode({ frameIndex: i });
      width = image.displayWidth;
      height = image.displayHeight;
      // `duration` is MICROseconds and may be null on a still.
      const delayMs = normaliseDelay(Math.round((image.duration ?? 0) / 1000));
      frames.push({ bitmap: await createImageBitmap(image), delayMs });
      image.close();
    }
    return { frames, width, height, animated: frames.length > 1 };
  } finally {
    decoder.close?.();
  }
}

/**
 * The fallback path. WebKit, and anything else without `ImageDecoder`.
 *
 * omggif (MIT, ~31 KB) is BUNDLED rather than served: it is ordinary
 * JavaScript with no WebAssembly, so it rides inside the importing chunk and
 * adds no origin-root artifact and no disclosure surface. That is the whole
 * reason it was chosen over a wasm decoder.
 *
 * ⚠ `decodeAndBlitFrameRGBA` COMPOSITES onto whatever is already in the
 * buffer, which is what makes a GIF's disposal methods work — most frames
 * store only the rectangle that changed. Handing it a fresh buffer per frame
 * produces the classic bug where everything but the moving part is
 * transparent. The buffer is therefore reused deliberately.
 */
async function decodeWithOmggif(bytes: Uint8Array): Promise<DecodedGif> {
  const { GifReader } = await import("omggif");
  const reader = new GifReader(bytes);
  const width = reader.width;
  const height = reader.height;
  const count = reader.numFrames();
  if (count === 0) throw new Error("no frames");

  const rgba = new Uint8ClampedArray(width * height * 4);
  const frames: GifFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    reader.decodeAndBlitFrameRGBA(i, rgba);
    const info = reader.frameInfo(i);
    // omggif reports `delay` in HUNDREDTHS of a second, as the format stores it.
    frames.push({
      bitmap: await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), width, height)),
      delayMs: normaliseDelay(info.delay * 10),
    });
  }
  return { frames, width, height, animated: frames.length > 1 };
}

/**
 * Decode an animated image to frames.
 *
 * Tries the native decoder and falls back to omggif — including when the
 * native one THROWS, not merely when it is absent, because a browser may ship
 * `ImageDecoder` and still refuse a particular file.
 */
export async function decodeAnimation(file: Blob): Promise<DecodedGif> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = file.type || "image/gif";

  if (hasImageDecoder()) {
    try {
      return await decodeWithImageDecoder(bytes, type);
    } catch {
      // Fall through: a present-but-unhappy decoder is not a reason to fail
      // when a pure-JS reader can still read the file.
    }
  }
  if (!/gif/i.test(type)) {
    // omggif reads GIF only. Say so rather than throwing a parse error from
    // inside a library the user has never heard of.
    throw new Error(
      "This browser cannot decode animated images of this type. Animated GIF works everywhere; animated WebP needs Chrome, Edge or Firefox.",
    );
  }
  return await decodeWithOmggif(bytes);
}

/** Release every bitmap. A 200-frame GIF is a lot of retained memory. */
export function closeFrames(frames: readonly GifFrame[]): void {
  for (const frame of frames) frame.bitmap.close();
}
