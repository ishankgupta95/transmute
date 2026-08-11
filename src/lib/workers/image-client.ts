import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";
import type { ImageCompressOptions } from "@/lib/tools/image-compress";
import type { ImageConvertOptions } from "@/lib/tools/image-convert";
import type { ImageResizeOptions } from "@/lib/tools/image-resize";
import { throwIfAborted } from "@/lib/utils/abort";
import { WorkerPool } from "./pool";
import type { ImageJob, ImageJobResult } from "./image-protocol";

/**
 * Main-thread client for the image worker pool.
 *
 * Exports the same three operations as lib/tools/image-{convert,compress,
 * resize}.ts, with the pixel work running in pool workers (decode → draw →
 * encode via OffscreenCanvas). The lib/tools implementations remain the
 * fallback for browsers without worker-side canvas, and the only path for
 * SVG, which needs the DOM's <img> to rasterise.
 *
 * Parallelism model: one file per worker. A batch UI just fires N calls; the
 * pool schedules them across `pool.size` workers under the memory budget.
 */

let pool: WorkerPool | null = null;

/** The image pool singleton — also the honest THREADS count for queue UIs. */
export function getImagePool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool({
      // Pre-bundled by scripts/build-workers.mjs into public/ — Turbopack's
      // production build can't chunk `new Worker(new URL(...))` (it ships
      // the raw .ts), so the workers are self-hosted like the WASM cores.
      createWorker: () =>
        new Worker(`${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/workers/image.worker.js`, {
          type: "module",
        }),
    });
  }
  return pool;
}

/** True when this browser can run the image pipeline inside a worker. */
export function supportsImageWorker(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap !== "undefined"
  );
}

/**
 * Peak-memory estimate for one image task: decoded RGBA typically dwarfs the
 * compressed source (a 40 MB JPEG can be a 100-megapixel, 400 MB raster).
 * ×10 for the decode, roughly ×2 more for the canvas copy and encode buffer,
 * plus a floor for small files. Deliberately pessimistic — the cost of
 * over-estimating is a task waiting its turn; under-estimating is an OOM'd
 * mobile Safari tab.
 */
function estimateImageTaskBytes(file: File): number {
  return file.size * 12 + 16 * 1024 * 1024;
}

function isSvg(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "svg" || file.type === "image/svg+xml";
}

function needsMainThreadDecode(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return (
    ["heic", "heif", "tiff", "tif"].includes(ext) ||
    ["image/heic", "image/heif", "image/tiff"].includes(file.type)
  );
}

/**
 * Build the worker payload: raw bytes for anything the worker can decode
 * itself; HEIC/TIFF are decoded here first (their decoders need the main
 * thread) and cross as pixels.
 */
async function prepareSource(
  file: File,
  signal?: AbortSignal,
): Promise<{ source: Pick<ImageJob, "bytes" | "bitmap">; transfer: Transferable[] }> {
  if (needsMainThreadDecode(file)) {
    const { toDecodableBlob } = await import("@/lib/tools/image-convert");
    const blob = await toDecodableBlob(file);
    throwIfAborted(signal);
    const bitmap = await createImageBitmap(blob);
    return { source: { bitmap }, transfer: [bitmap] };
  }
  const bytes = await file.arrayBuffer();
  return { source: { bytes }, transfer: [bytes] };
}

async function runImageJob(
  file: File,
  job: Omit<ImageJob, "bytes" | "bitmap" | "fileName" | "fileType" | "fileSize">,
  ctx: ProcessingContext,
): Promise<ImageJobResult> {
  throwIfAborted(ctx.signal);
  const { source, transfer } = await prepareSource(file, ctx.signal);
  throwIfAborted(ctx.signal);
  return getImagePool().run<ImageJobResult>(
    {
      ...job,
      ...source,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    },
    {
      transfer,
      memoryBytes: estimateImageTaskBytes(file),
      signal: ctx.signal,
      onProgress: ctx.onProgress,
    },
  );
}

function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "");
}

function toResult(file: File, fileName: string, result: ImageJobResult): ProcessedResult {
  if (result.kind === "original") {
    return { blob: file, fileName: file.name, originalSize: file.size, newSize: file.size };
  }
  const blob = new Blob([result.bytes], { type: result.mime });
  return { blob, fileName, originalSize: file.size, newSize: blob.size };
}

/**
 * Encode already-rendered pixels (a PDF page canvas, a video frame) in a pool
 * worker. The bitmap is transferred — the caller loses it. `pixelBytes` is
 * the decoded RGBA footprint (w × h × 4), used for pool admission.
 */
export async function encodeBitmap(
  bitmap: ImageBitmap,
  mimeType: string,
  quality: number,
  pixelBytes: number,
): Promise<Blob> {
  const targetFormat = mimeType.replace("image/", "") as "jpeg" | "png" | "webp";
  const result = await getImagePool().run<ImageJobResult>(
    {
      op: "convert",
      options: { targetFormat, quality },
      bitmap,
      fileName: "frame",
      fileType: "",
      fileSize: 0,
    } satisfies ImageJob,
    { transfer: [bitmap], memoryBytes: pixelBytes * 3 },
  );
  if (result.kind !== "blob") throw new Error("Unexpected encode result");
  return new Blob([result.bytes], { type: result.mime });
}

// ── the three operations ─────────────────────────────────────────

export async function convertImage(
  file: File,
  options: ImageConvertOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  if (!supportsImageWorker() || isSvg(file)) {
    const { convertImage: fallback } = await import("@/lib/tools/image-convert");
    return fallback(file, options);
  }
  const result = await runImageJob(file, { op: "convert", options }, ctx);
  const ext = options.targetFormat === "jpeg" ? "jpg" : options.targetFormat;
  return toResult(file, `${baseName(file)}.${ext}`, result);
}

export async function compressImage(
  file: File,
  options: ImageCompressOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  if (!supportsImageWorker() || isSvg(file)) {
    const { compressImage: fallback } = await import("@/lib/tools/image-compress");
    return fallback(file, options);
  }
  const result = await runImageJob(file, { op: "compress", options }, ctx);
  const ext = result.kind === "blob" ? result.ext : "";
  return toResult(file, `${baseName(file)}-compressed.${ext}`, result);
}

export async function resizeImage(
  file: File,
  options: ImageResizeOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  if (!supportsImageWorker() || isSvg(file)) {
    const { resizeImage: fallback } = await import("@/lib/tools/image-resize");
    return fallback(file, options);
  }
  const result = await runImageJob(file, { op: "resize", options }, ctx);
  if (result.kind !== "blob") throw new Error("Unexpected resize result");
  return toResult(
    file,
    `${baseName(file)}-${result.width}x${result.height}.${result.ext}`,
    result,
  );
}
