/// <reference lib="webworker" />
import Pica from "pica";
// LEAF imports — image-frames.ts and target-size.ts have zero runtime
// imports, so they cannot drag a module that names this worker's URL into the
// bundle (which hangs next build).
import { firstFrameWarning } from "@/lib/tools/image-frames";
import {
  MAX_DIMENSION_STEPS,
  nextScale,
  scaledToTargetWarning,
  stepDimensions,
} from "@/lib/tools/target-size";
import type { PoolWorkerRequest, PoolWorkerResponse } from "./pool";
import type { ImageJob, ImageJobResult } from "./image-protocol";
import type { ImageCompressOptions } from "@/lib/tools/image-compress";
import type { ImageConvertOptions } from "@/lib/tools/image-convert";
import type { ImageResizeOptions } from "@/lib/tools/image-resize";

/**
 * Pool worker for the image pipeline: decode (createImageBitmap), draw
 * (OffscreenCanvas), encode (convertToBlob) — the whole pixel path off the
 * main thread. One file per task; parallelism is the pool's job.
 *
 * The ops mirror lib/tools/image-convert|compress|resize.ts, which remain the
 * main-thread fallback for browsers without OffscreenCanvas and for sources a
 * worker cannot decode (SVG needs the DOM's <img>; HEIC/TIFF are pre-decoded
 * on main and arrive here as an ImageBitmap). Behavioural changes must land
 * in BOTH places — the conversion e2e suite runs against whichever path the
 * browser takes.
 */

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<PoolWorkerRequest>) => {
  const { id, payload } = event.data;
  const job = payload as ImageJob;
  const progress = (value: number) =>
    self.postMessage({ id, type: "progress", value } satisfies PoolWorkerResponse);

  try {
    const result = await runJob(job, progress);
    const transfer = result.kind === "blob" ? [result.bytes] : [];
    self.postMessage(
      { id, type: "done", result } satisfies PoolWorkerResponse,
      transfer,
    );
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      message: err instanceof Error ? err.message : "Image processing failed",
    } satisfies PoolWorkerResponse);
  }
};

async function runJob(
  job: ImageJob,
  progress: (value: number) => void,
): Promise<ImageJobResult> {
  // Sniff the encoded bytes BEFORE decoding: createImageBitmap silently keeps
  // only frame 0 of an animated GIF/WebP, so the honest "first frame was kept"
  // notice can only come from the container. (Pre-decoded TIFF/HEIC arrive as
  // an ImageBitmap; their warnings are attached on the main thread.)
  const warning = job.bytes ? firstFrameWarning(new Uint8Array(job.bytes)) : null;
  const bitmap = await decodeBitmap(job);
  progress(10);
  try {
    let result: ImageJobResult;
    switch (job.op) {
      case "convert":
        result = await convert(bitmap, job.options);
        break;
      case "compress":
        result = await compress(bitmap, job, job.options, progress);
        break;
      case "resize":
        result = await resize(bitmap, job, job.options, progress);
        break;
    }
    // Merge, don't overwrite — the op itself may have added its own notices
    // (target-size compress appends "Scaled to …" when it downscaled). Loss
    // warnings attach only to re-encoded outputs: never-grow's kind:"original"
    // hands back the untouched file with every frame still in it, so "only
    // its first frame was kept" would be false there.
    return warning && result.kind === "blob"
      ? { ...result, warnings: [warning, ...(result.warnings ?? [])] }
      : result;
  } finally {
    bitmap.close();
  }
}

/**
 * Decode the source into pixels. Pre-decoded sources (HEIC/TIFF) arrive as a
 * transferred ImageBitmap; everything else is decoded here, honouring EXIF
 * orientation — the same behaviour the main thread's <img> decode has, pinned
 * by the rotated-JPEG e2e. Older engines without the `imageOrientation`
 * option get a plain decode retry.
 */
async function decodeBitmap(job: ImageJob): Promise<ImageBitmap> {
  if (job.bitmap) return job.bitmap;
  const blob = new Blob([job.bytes!], { type: job.fileType });
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(blob);
  }
}

// ── shared canvas helpers (worker-side ports of canvas-utils.ts) ──

/** Only PNG and WebP carry an alpha channel through canvas encoding. */
function mimeSupportsAlpha(mimeType: string): boolean {
  return mimeType === "image/png" || mimeType === "image/webp";
}

function draw(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  opaqueFill: boolean,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  if (opaqueFill) {
    // Alpha-less formats flatten transparency to black without this.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

function toArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

/** Port of imageHasTransparency: probe a ≤256px raster for any alpha < 255. */
function bitmapHasTransparency(bitmap: ImageBitmap): boolean {
  const { width: w, height: h } = bitmap;
  if (!w || !h) return false;
  const scale = Math.min(1, 256 / Math.max(w, h));
  const pw = Math.max(1, Math.round(w * scale));
  const ph = Math.max(1, Math.round(h * scale));
  const canvas = new OffscreenCanvas(pw, ph);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, pw, ph);
  try {
    const { data } = ctx.getImageData(0, 0, pw, ph);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
  } catch {
    return false;
  }
  return false;
}

// ── convert (mirrors lib/tools/image-convert.ts) ─────────────────

async function convert(
  bitmap: ImageBitmap,
  options: ImageConvertOptions,
): Promise<ImageJobResult> {
  const mime = `image/${options.targetFormat}`;
  const outWidth = options.width ?? bitmap.width;
  const outHeight = options.height ?? bitmap.height;
  if (outWidth === 0 || outHeight === 0) {
    throw new Error("Could not determine the image's dimensions");
  }

  const canvas = draw(bitmap, outWidth, outHeight, !mimeSupportsAlpha(mime));
  const blob = await canvas.convertToBlob({ type: mime, quality: options.quality });
  return {
    kind: "blob",
    bytes: await toArrayBuffer(blob),
    mime,
    ext: options.targetFormat === "jpeg" ? "jpg" : options.targetFormat,
    width: outWidth,
    height: outHeight,
  };
}

// ── compress (mirrors lib/tools/image-compress.ts) ───────────────

/** Choose an output format that compresses well *and* preserves transparency. */
function chooseOutput(job: ImageJob, bitmap: ImageBitmap): { mime: string; ext: string } {
  const ext = job.fileName.split(".").pop()?.toLowerCase() ?? "";
  const mightHaveAlpha =
    ["png", "webp", "gif", "avif"].includes(ext) || /(png|webp|gif|avif)/.test(job.fileType);
  if (mightHaveAlpha && bitmapHasTransparency(bitmap)) {
    return { mime: "image/webp", ext: "webp" };
  }
  return { mime: "image/jpeg", ext: "jpg" };
}

/**
 * The quality half of the target-size engine: binary-search encode quality
 * for the largest result at or under `targetBytes`. Returns that under-target
 * blob (null when quality alone cannot get there) plus the smallest blob
 * seen, which drives the dimension step and is the honest fallback when
 * nothing fits. Mirrored in lib/tools/image-compress.ts.
 */
async function searchQuality(
  encode: (quality: number) => Promise<Blob>,
  targetBytes: number,
  tick: () => void,
): Promise<{ under: Blob | null; smallest: Blob }> {
  let lo = 0.01;
  let hi = 1.0;
  let smallest = await encode(hi);
  tick();
  if (smallest.size <= targetBytes) return { under: smallest, smallest };

  let under: Blob | null = null;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const candidate = await encode(mid);
    tick();
    if (candidate.size < smallest.size) smallest = candidate;
    if (candidate.size <= targetBytes) {
      under = candidate;
      lo = mid;
      // Close enough (within 5% of target) — stop refining.
      if (candidate.size > targetBytes * 0.95) break;
    } else {
      hi = mid;
    }
  }
  return { under, smallest };
}

async function compress(
  bitmap: ImageBitmap,
  job: ImageJob,
  options: ImageCompressOptions,
  progress: (value: number) => void,
): Promise<ImageJobResult> {
  const { mime, ext } = chooseOutput(job, bitmap);
  // The pixels never change between encode passes — draw once, encode many.
  const canvas = draw(bitmap, bitmap.width, bitmap.height, !mimeSupportsAlpha(mime));
  const encode = (quality: number) => canvas.convertToBlob({ type: mime, quality });

  const finish = async (
    blob: Blob,
    width: number,
    height: number,
    scaled: boolean,
  ): Promise<ImageJobResult> => {
    // The never-grow guard: a "compressor" must never hand back a bigger
    // file. The client still holds the original — just say "use it". The
    // untouched original was never scaled, so no scaled note either.
    if (blob.size >= job.fileSize) return { kind: "original" };
    return {
      kind: "blob",
      bytes: await toArrayBuffer(blob),
      mime,
      ext,
      width,
      height,
      // A downscale changes the picture, not just its bytes — say so, in the
      // one exact wording the shared policy module owns.
      ...(scaled ? { warnings: [scaledToTargetWarning(width, height)] } : {}),
    };
  };

  if (options.mode === "quality") {
    const blob = await encode(options.quality);
    progress(90);
    return finish(blob, bitmap.width, bitmap.height, false);
  }

  // Target-size mode: binary-search quality at the source dimensions first.
  // Stepping (below) only engages when that search bottoms out above the
  // target — a target reachable by quality alone must leave the dims alone.
  const targetBytes = options.targetSizeKb * 1024;
  // Degenerate target (cleared field, 0, NaN): stepping toward it would grind
  // the image to the 64-px floor and present that as success. Encode at the
  // requested quality instead — mirrored in lib/tools/image-compress.ts.
  if (!Number.isFinite(targetBytes) || targetBytes <= 0) {
    const blob = await encode(options.quality);
    progress(90);
    return finish(blob, bitmap.width, bitmap.height, false);
  }
  // One saturating tick per encode pass: the pass count varies with stepping,
  // so progress climbs monotonically and parks at 90 instead of overshooting.
  let passes = 0;
  const tick = () => progress(Math.min(90, 15 + ++passes * 7));

  const first = await searchQuality(encode, targetBytes, tick);
  if (first.under) return finish(first.under, bitmap.width, bitmap.height, false);

  // Quality alone cannot reach the target at these dimensions: step the dims
  // down (shared policy in lib/tools/target-size.ts) and search again. The
  // sqrt heuristic converges in 1–3 steps; the cap bounds total encode work.
  let smallest = first.smallest;
  let smallestDims = { width: bitmap.width, height: bitmap.height, scaled: false };
  let width = bitmap.width;
  let height = bitmap.height;
  for (let step = 0; step < MAX_DIMENSION_STEPS; step++) {
    const next = stepDimensions(width, height, nextScale(smallest.size, targetBytes));
    if (!next) break; // at the 64-px floor — nothing smaller is worth making
    ({ width, height } = next);
    const stepped = draw(bitmap, width, height, !mimeSupportsAlpha(mime));
    const result = await searchQuality(
      (quality) => stepped.convertToBlob({ type: mime, quality }),
      targetBytes,
      tick,
    );
    if (result.under) return finish(result.under, width, height, true);
    if (result.smallest.size < smallest.size) {
      smallest = result.smallest;
      smallestDims = { width, height, scaled: true };
    }
  }

  // Unreachable even at the floor: the smallest achieved is the honest,
  // closest-possible answer — today's behaviour, now across dimensions too.
  return finish(smallest, smallestDims.width, smallestDims.height, smallestDims.scaled);
}

// ── resize (mirrors lib/tools/image-resize.ts) ───────────────────

/** Map the source extension to an alpha-safe output format. */
function resizeOutputFormat(fileName: string): { mime: string; ext: string } {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
    case "gif": // may carry transparency (first frame) — keep alpha-capable PNG
    case "svg":
      return { mime: "image/png", ext: "png" };
    case "webp":
    case "avif":
      return { mime: "image/webp", ext: "webp" };
    // bmp/jpg/jpeg carry no alpha → JPEG (a resized BMP as lossless PNG would bloat).
    default:
      return { mime: "image/jpeg", ext: "jpg" };
  }
}

async function resize(
  bitmap: ImageBitmap,
  job: ImageJob,
  options: ImageResizeOptions,
  progress: (value: number) => void,
): Promise<ImageJobResult> {
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  let outW: number;
  let outH: number;
  if (options.mode === "percentage") {
    const scale = options.percentage / 100;
    outW = Math.round(srcW * scale);
    outH = Math.round(srcH * scale);
  } else {
    outW = options.width;
    outH = options.height;
  }
  outW = Math.max(1, Math.min(outW, 8192));
  outH = Math.max(1, Math.min(outH, 8192));

  const srcCanvas = draw(bitmap, srcW, srcH, false);
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) throw new Error("Canvas 2D context not available");
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH);
  progress(35);

  // Same Lanczos3 math the main-thread path uses — pica maps quality 3 to the
  // lanczos3 filter in both resize() and resizeBuffer(). The buffer API works
  // on raw RGBA, which is what a worker has; features:["js"] keeps pica from
  // spawning its own nested workers inside ours.
  const pica = new Pica({ features: ["js"] });
  const resized = (await pica.resizeBuffer({
    // Same bytes, uint8 view — pica's typings don't accept Uint8ClampedArray.
    src: new Uint8Array(srcData.data.buffer, srcData.data.byteOffset, srcData.data.length),
    width: srcW,
    height: srcH,
    toWidth: outW,
    toHeight: outH,
    quality: 3,
  })) as Uint8Array;
  progress(75);

  const destCanvas = new OffscreenCanvas(outW, outH);
  const destCtx = destCanvas.getContext("2d");
  if (!destCtx) throw new Error("Canvas 2D context not available");
  destCtx.putImageData(new ImageData(new Uint8ClampedArray(resized), outW, outH), 0, 0);

  const { mime, ext } = resizeOutputFormat(job.fileName);
  const blob = await destCanvas.convertToBlob({ type: mime, quality: options.quality });
  return {
    kind: "blob",
    bytes: await toArrayBuffer(blob),
    mime,
    ext,
    width: outW,
    height: outH,
  };
}
