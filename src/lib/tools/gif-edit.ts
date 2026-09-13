import { closeFrames, decodeAnimation, type GifFrame } from "./gif-decode";

/**
 * The GIF verbs: resize, re-time, reverse — decode, transform, re-encode.
 *
 * Encoding is `gifenc`, which this site already bundles for `video-to-gif`, so
 * the whole cluster adds **no served bytes**: `omggif` (~31 KB) and `gifenc`
 * are ordinary JavaScript inside the importing chunk, not origin-root
 * artifacts. That is the reason `compress-gif` is NOT here — it wants
 * gisicle-wasm, 0.34 MB of served WebAssembly, which is a disclosure cycle
 * rather than a small addition, and pricing it as one is how it stays undone.
 */

export interface GifEditResult {
  readonly blob: Blob;
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  /** Total play time in milliseconds. */
  readonly durationMs: number;
}

export interface GifEditOptions {
  /** Scale factor, 0 < s <= 1. Omit or 1 to keep the size. */
  readonly scale?: number;
  /** Multiply every delay by this. >1 is slower, <1 is faster. */
  readonly speed?: number;
  readonly reverse?: boolean;
  readonly onProgress?: (fraction: number) => void;
}

/**
 * The shortest delay worth writing.
 *
 * A GIF stores delay in hundredths of a second, so anything under 10 ms cannot
 * be represented at all, and browsers substitute 100 ms for a stored 0 or 1.
 * Speeding an animation up therefore hits a floor: past a point the file
 * cannot say "faster" and the result stops changing. The UI says so rather
 * than letting someone drag a slider that has quietly stopped working.
 */
export const MIN_GIF_DELAY_MS = 20;

/** Round to the 10 ms grid the format actually stores. */
function quantiseDelay(ms: number): number {
  return Math.max(MIN_GIF_DELAY_MS, Math.round(ms / 10) * 10);
}

/** Draw a frame at the target size and read its pixels back. */
function rasterise(frame: GifFrame, width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser would not give the page a 2D canvas to work on.");
  /*
    A GIF frame is already composited by the decoder, so each one is a whole
    picture and can be drawn straight down. Clearing first still matters: a
    reused canvas would otherwise show the previous frame through any
    transparency.
  */
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(frame.bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

export async function editGif(file: Blob, options: GifEditOptions = {}): Promise<GifEditResult> {
  const { scale = 1, speed = 1, reverse = false, onProgress } = options;
  const decoded = await decodeAnimation(file);

  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));

  /*
    REVERSING TAKES THE DELAYS WITH THE FRAMES, and that is not obvious.
    A GIF's delay belongs to the frame it is stored with — "show this picture
    for N ms" — so reversing the picture order while leaving the delays in
    place produces an animation whose timing no longer matches its own frames.
    Reversing the pairs is what makes a reversed GIF actually play backwards.
  */
  const ordered = reverse ? [...decoded.frames].reverse() : decoded.frames;

  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const encoder = GIFEncoder();

  let durationMs = 0;
  try {
    for (let i = 0; i < ordered.length; i += 1) {
      const frame = ordered[i];
      const rgba = rasterise(frame, width, height);
      /*
        Per-frame palette, not one palette for the whole animation. A shared
        palette is smaller but bands badly whenever the colours change across
        the animation — which is the normal case for anything but a logo.
      */
      const palette = quantize(rgba, 256);
      const indexed = applyPalette(rgba, palette);
      const delay = quantiseDelay(frame.delayMs * speed);
      durationMs += delay;
      encoder.writeFrame(indexed, width, height, { palette, delay });
      onProgress?.((i + 1) / ordered.length);
    }
    encoder.finish();
  } finally {
    // The bitmaps are the expensive part and a thrown run has allocated them.
    closeFrames(decoded.frames);
  }

  return {
    blob: new Blob([encoder.bytes() as BlobPart], { type: "image/gif" }),
    frameCount: ordered.length,
    width,
    height,
    durationMs,
  };
}

export interface SplitFrame {
  readonly name: string;
  readonly blob: Blob;
  readonly delayMs: number;
}

/**
 * Every frame as its own PNG.
 *
 * PNG rather than the GIF's own palette: the frames come out of the decoder
 * already composited to full colour, and writing them back through a 256-colour
 * palette would throw away information the decode just recovered, for no gain.
 */
export async function splitGif(
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<{ frames: SplitFrame[]; width: number; height: number }> {
  const decoded = await decodeAnimation(file);
  const pad = String(decoded.frames.length).length;
  const out: SplitFrame[] = [];
  try {
    for (let i = 0; i < decoded.frames.length; i += 1) {
      const frame = decoded.frames[i];
      const canvas = document.createElement("canvas");
      canvas.width = decoded.width;
      canvas.height = decoded.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("This browser would not give the page a 2D canvas to work on.");
      ctx.drawImage(frame.bitmap, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("frame would not encode"))), "image/png"),
      );
      // Zero-padded so a 200-frame archive unzips in order.
      out.push({
        name: `frame-${String(i + 1).padStart(pad, "0")}.png`,
        blob,
        delayMs: frame.delayMs,
      });
      onProgress?.((i + 1) / decoded.frames.length);
    }
  } finally {
    closeFrames(decoded.frames);
  }
  return { frames: out, width: decoded.width, height: decoded.height };
}


/* ── Building an animation from stills ───────────────────────────────────── */

export interface MakeGifOptions {
  /** Milliseconds each frame is shown. Quantised to the 10 ms grid GIF stores. */
  readonly delayMs?: number;
  /** Longest edge in pixels; frames are fitted inside a square of this size. */
  readonly maxEdge?: number;
  readonly onProgress?: (fraction: number) => void;
}

/**
 * Turn a list of still images into one animated GIF.
 *
 * The mirror of `splitGif`, and the only verb in this file that needs no
 * decoder at all — stills decode through the ordinary image path.
 *
 * ⚠ EVERY FRAME OF A GIF MUST BE THE SAME SIZE; the format has one logical
 * screen and frames are placed on it. Dropped photos are never all the same
 * size, so a tool that ignored this would silently stretch some and crop
 * others. Each picture is instead FITTED inside the canvas with its aspect
 * ratio kept and the spare space left transparent, which is the one behaviour
 * that never distorts anybody's photo.
 */
export async function makeGif(
  files: readonly Blob[],
  options: MakeGifOptions = {},
): Promise<GifEditResult> {
  const { delayMs = 100, maxEdge = 480, onProgress } = options;
  if (files.length === 0) throw new Error("Add at least one image to build an animation from.");

  const bitmaps: ImageBitmap[] = [];
  try {
    for (const file of files) bitmaps.push(await createImageBitmap(file));

    // The canvas is the largest frame, capped — so nothing is enlarged.
    const widest = Math.max(...bitmaps.map((b) => b.width));
    const tallest = Math.max(...bitmaps.map((b) => b.height));
    const fit = Math.min(1, maxEdge / Math.max(widest, tallest));
    const width = Math.max(1, Math.round(widest * fit));
    const height = Math.max(1, Math.round(tallest * fit));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This browser would not give the page a 2D canvas to work on.");

    const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
    const encoder = GIFEncoder();
    const delay = quantiseDelay(delayMs);

    for (let i = 0; i < bitmaps.length; i += 1) {
      const bitmap = bitmaps[i];
      const scale = Math.min(width / bitmap.width, height / bitmap.height);
      const w = bitmap.width * scale;
      const h = bitmap.height * scale;
      // Clear between frames: without it a smaller picture shows the previous
      // one around its edges, which reads as corruption rather than letterboxing.
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);

      const rgba = ctx.getImageData(0, 0, width, height).data;
      const palette = quantize(rgba, 256);
      encoder.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay });
      onProgress?.((i + 1) / bitmaps.length);
    }
    encoder.finish();

    return {
      blob: new Blob([encoder.bytes() as BlobPart], { type: "image/gif" }),
      frameCount: bitmaps.length,
      width,
      height,
      durationMs: delay * bitmaps.length,
    };
  } finally {
    for (const bitmap of bitmaps) bitmap.close();
  }
}
