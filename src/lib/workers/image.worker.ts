/// <reference lib="webworker" />
import Pica from "pica";
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
  const bitmap = await decodeBitmap(job);
  progress(10);
  try {
    switch (job.op) {
      case "convert":
        return await convert(bitmap, job.options);
      case "compress":
        return await compress(bitmap, job, job.options, progress);
      case "resize":
        return await resize(bitmap, job, job.options, progress);
    }
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

  const finish = async (blob: Blob): Promise<ImageJobResult> => {
    // The never-grow guard: a "compressor" must never hand back a bigger
    // file. The client still holds the original — just say "use it".
    if (blob.size >= job.fileSize) return { kind: "original" };
    return {
      kind: "blob",
      bytes: await toArrayBuffer(blob),
      mime,
      ext,
      width: bitmap.width,
      height: bitmap.height,
    };
  };

  if (options.mode === "quality") {
    const blob = await encode(options.quality);
    progress(90);
    return finish(blob);
  }

  // Target-size mode: binary search for optimal quality.
  const targetBytes = options.targetSizeKb * 1024;
  let lo = 0.01;
  let hi = 1.0;
  let bestBlob = await encode(hi);
  if (bestBlob.size <= targetBytes) return finish(bestBlob);

  let smallestBlob = bestBlob;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const candidate = await encode(mid);
    progress(15 + (i + 1) * 7);

    if (candidate.size < smallestBlob.size) smallestBlob = candidate;

    if (candidate.size <= targetBytes) {
      bestBlob = candidate;
      lo = mid;
    } else {
      hi = mid;
    }

    // Close enough (within 5% of target)
    if (candidate.size <= targetBytes && candidate.size > targetBytes * 0.95) {
      bestBlob = candidate;
      break;
    }
  }

  if (bestBlob.size > targetBytes) bestBlob = smallestBlob;
  return finish(bestBlob);
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
