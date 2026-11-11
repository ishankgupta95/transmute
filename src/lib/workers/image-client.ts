import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";
import type { ImageCompressOptions } from "@/lib/tools/image-compress";
import type { ImageConvertOptions } from "@/lib/tools/image-convert";
// Leaf module, no runtime imports of its own — safe to pull onto the main
// thread so both pipelines name their outputs from the same function.
import { editVerbSuffix, isMultiOutputEdit } from "@/lib/tools/image-edit-core";
import type { ImageResizeOptions } from "@/lib/tools/image-resize";
import { throwIfAborted } from "@/lib/utils/abort";
import { DEFAULT_MAX_WORKERS, memoryBudgetBytes, WorkerPool } from "./pool";
import type {
  ImageEditJobOptions,
  ImageJob,
  ImageJobResult,
  PngOptimiseOptions,
} from "./image-protocol";
/*
  TYPE-ONLY, and for the same reason CompressPngUI.tsx's is: `typeof` pins the
  number below to the engine's, so the two cannot drift, while `import type`
  erases at emit and keeps png-optimise.ts — and with it the oxipng
  wasm-bindgen glue and its `new URL(…, import.meta.url)` — out of every
  main-thread chunk that pulls this client in.
*/
import type { PNG_RASTER_BYTE_LIMIT } from "@/lib/tools/png-optimise";

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

/**
 * Worker ceiling for the image pool: 8 where the device says it has the memory
 * for it, otherwise the pool's default of 4.
 *
 * WHY THIS IS NOT JUST `maxWorkers: 8`. The image pipeline is the one pool that
 * routinely gets a batch — a drop of 20 photos is N independent decode/encode
 * jobs sharing nothing — and on a 14-core desktop the default cap ran 4 of
 * them, which measurably left half the machine idle. So more is worth having.
 *
 * But the cap is also the backstop against `estimateImageTaskBytes` being
 * WRONG, and it is only an estimate: `file.size * 12 + 16 MB` tracks a typical
 * JPEG well (decoded RGBA is 4 bytes a pixel, and a JPEG spends roughly a third
 * to one byte on each) and under-counts a heavily compressed one, where the
 * same bytes decode to several times more raster. `WorkerPool.pump` admits
 * against that estimate, so an under-count admits more real memory than the
 * budget intends, and the worker ceiling is what bounds how far that can go.
 * Doubling the ceiling doubles the exposure.
 *
 * `poolSize` takes `hardwareConcurrency - 1`, which is NOT the guard one might
 * assume: an 8-core phone would have gone from 4 workers to 7 on a device whose
 * whole budget may be 512 MB. So the ceiling follows the one memory signal
 * available instead. `memoryBudgetBytes()` returns a quarter of
 * `navigator.deviceMemory`, and that API is Chromium-only and capped at 8, so a
 * 2 GiB budget means "the device reported 8 GB" — desktop-class. Everywhere the
 * API is absent (Safari, Firefox) the budget is the conservative 4 GB
 * assumption, which lands below the threshold and keeps today's behaviour
 * exactly. Nothing gets a smaller pool than before; only a device that says it
 * can afford more gets more.
 *
 * The better long-term fix is a truer estimate — the decoded dimensions are
 * knowable after `createImageBitmap` but not before admission, which is the
 * whole difficulty. Until then this stays keyed to what the device declares.
 *
 * Hash and regex stay at 1 and audio at 2: those are single-file paths, and the
 * MP3 encoder holds a wasm heap per worker.
 */
function imagePoolCeiling(): number {
  /** A quarter of 8 GB — the most `navigator.deviceMemory` ever reports. */
  const DESKTOP_CLASS_BUDGET = 2 * 1024 ** 3;
  return memoryBudgetBytes() >= DESKTOP_CLASS_BUDGET ? 8 : DEFAULT_MAX_WORKERS;
}

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
      maxWorkers: imagePoolCeiling(),
    });
  }
  return pool;
}

/**
 * True when this browser can run the image PIXEL pipeline inside a worker:
 * convert, compress, resize and edit all decode with createImageBitmap and
 * draw on an OffscreenCanvas, so all three are genuinely required.
 *
 * NOT the right question for compress-png — see `supportsPngOptimiser`.
 */
export function supportsImageWorker(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap !== "undefined"
  );
}

/**
 * True when this browser can run the oxipng job, which is a different and
 * smaller question.
 *
 * optimise-png never decodes: image.worker.ts returns it before
 * `decodeBitmap`, and its whole call graph (readPngHeader → optimisePngBytes →
 * oxipng → describePngColour) is DOM-free by contract, as png-optimise.ts's
 * header states. MEASURED: the shipped worker bundle takes 31.5% off
 * public/og-image.png with `OffscreenCanvas` and `createImageBitmap` both
 * undefined. Borrowing `supportsImageWorker()` here refused Safari 15.0–16.3
 * (createImageBitmap since 15.0, OffscreenCanvas only since 16.4) for a
 * capability the codec does not have.
 *
 * What it cannot probe is that the worker is an ES module — `{type:"module"}`
 * — which an older engine may not honour. That failure surfaces as a worker
 * load error on the run, so the message below claims only what is tested here.
 */
export function supportsPngOptimiser(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
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

/** The engine's decoded-raster ceiling, pinned by the type-only import above. */
const PNG_OPTIMISE_RASTER_CEILING: typeof PNG_RASTER_BYTE_LIMIT = 48_000_000;

/**
 * Peak-memory charge for a compress-png task: the worst case the input guard
 * admits, flat, for every file.
 *
 * There is no honest function from a PNG's byte count to its memory. oxipng's
 * heap tracks the DECODED raster (MEASURED at ≈8× it — 298 MB on a 34.3 MB
 * raster, and it never shrinks), and a PNG's compression ratio spans two
 * orders of magnitude: every real PNG in this repo runs 0.017–0.227 bytes per
 * pixel, and a flat-colour 12 MP export is smaller still. The version this
 * replaced inferred a pixel count from the file size at "1.5 bytes per pixel"
 * and called itself pessimistic; it was neither. MEASURED, it under-counted a
 * 3840×2160 screenshot by 4.2× — 40 MB declared against 168 MB pinned — and
 * over-admitting is what costs the tab.
 *
 * So the charge is the ceiling png-optimise.ts enforces instead. It is the
 * same number for every file, which is the honest shape: nothing about a PNG's
 * size predicts its heap, and one oxipng burn at a time is what the pool
 * should allow anyway (over-budget tasks still run, just alone — pool.ts:172).
 */
const PNG_OPTIMISE_PEAK_BYTES = PNG_OPTIMISE_RASTER_CEILING * 8;

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
 * thread) and cross as pixels. Pre-decode warnings (a multi-page TIFF cut to
 * page 1) are surfaced here — the worker only ever sees the decoded bitmap.
 */
async function prepareSource(
  file: File,
  signal?: AbortSignal,
): Promise<{
  source: Pick<ImageJob, "bytes" | "bitmap">;
  transfer: Transferable[];
  warnings: string[];
}> {
  if (needsMainThreadDecode(file)) {
    const { toDecodableSource } = await import("@/lib/tools/image-convert");
    const { blob, warnings } = await toDecodableSource(file);
    throwIfAborted(signal);
    const bitmap = await createImageBitmap(blob);
    return { source: { bitmap }, transfer: [bitmap], warnings };
  }
  const bytes = await file.arrayBuffer();
  return { source: { bytes }, transfer: [bytes], warnings: [] };
}

async function runImageJob(
  file: File,
  job: Omit<ImageJob, "bytes" | "bitmap" | "fileName" | "fileType" | "fileSize">,
  ctx: ProcessingContext,
  memoryBytes: number = estimateImageTaskBytes(file),
): Promise<ImageJobResult> {
  throwIfAborted(ctx.signal);
  const { source, transfer, warnings } = await prepareSource(file, ctx.signal);
  throwIfAborted(ctx.signal);
  const result = await getImagePool().run<ImageJobResult>(
    {
      ...job,
      ...source,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    },
    {
      transfer,
      memoryBytes,
      signal: ctx.signal,
      onProgress: ctx.onProgress,
    },
  );
  // Merge main-thread pre-decode warnings with whatever the worker sniffed.
  return warnings.length > 0
    ? { ...result, warnings: [...warnings, ...(result.warnings ?? [])] }
    : result;
}

function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "");
}

function toResult(file: File, fileName: string, result: ImageJobResult): ProcessedResult {
  // Loss warnings attach only to re-encoded outputs. kind:"original" is the
  // untouched file — every frame and page still in it — so ALL warnings
  // (the worker's frame sniff and the client's TIFF pre-decode notice alike)
  // are dropped: each would claim a loss that never happened.
  if (result.kind === "original") {
    return { blob: file, fileName: file.name, originalSize: file.size, newSize: file.size };
  }
  if (result.kind !== "blob") {
    // The multi-output edit ("blobs") and compress-png ("png") results carry
    // their own shapes and have their own client functions. One arriving here
    // is a wiring mistake; failing loudly beats inventing a single file out of
    // a list, or a PNG out of a result this function cannot name.
    throw new Error("Unexpected image result");
  }
  const warnings = result.warnings?.length ? { warnings: result.warnings } : {};
  const blob = new Blob([result.bytes], { type: result.mime });
  return { blob, fileName, originalSize: file.size, newSize: blob.size, ...warnings };
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
  // The worker names its output from what the encoder ACTUALLY wrote, because
  // a canvas asked for a type it cannot produce silently writes PNG instead
  // (image-convert.ts:5-9). On THIS op the format is the user's choice — the
  // whole page is called svg-to-webp — so a substitution is a refusal, not a
  // rename. Same sentence as image-edit.ts:112 and the worker's edit op.
  if (result.kind === "blob" && result.mime !== `image/${options.targetFormat}`) {
    throw new Error(`This browser cannot write ${options.targetFormat.toUpperCase()} images.`);
  }
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

// ── the edit verbs ───────────────────────────────────────────────

/**
 * A multi-output edit holds every output's encoded bytes at once — the worker
 * posts them back in one message, not one at a time. Split tiles together
 * cover the source exactly, so they cost about one more encoded copy and the
 * base estimate already carries them; presets can each be any size, so those
 * are charged per output.
 */
function estimateEditTaskBytes(file: File, options: ImageEditJobOptions): number {
  const base = estimateImageTaskBytes(file);
  if (options.edit.kind !== "presets") return base;
  return base + file.size * 4 * Math.max(1, options.edit.outputs.length);
}

/** Rotate / flip / watermark / pixelate / circle crop / border — one output. */
export async function editImage(
  file: File,
  options: ImageEditJobOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  if (isMultiOutputEdit(options.edit)) {
    // A wiring mistake, not user input: split and presets produce a list, and
    // returning only the first of it would silently drop the rest.
    throw new Error(`The ${options.edit.kind} edit produces several files — use editImageToMany.`);
  }
  if (!supportsImageWorker() || isSvg(file)) {
    const { editImage: fallback } = await import("@/lib/tools/image-edit");
    return fallback(file, options);
  }
  const result = await runImageJob(
    file,
    { op: "edit", options },
    ctx,
    estimateEditTaskBytes(file, options),
  );
  if (result.kind !== "blob") throw new Error("Unexpected edit result");
  return toResult(
    file,
    `${baseName(file)}-${editVerbSuffix(options.edit)}.${result.ext}`,
    result,
  );
}

/** split / presets. Returns one ProcessedResult per output, in plan order. */
export async function editImageToMany(
  file: File,
  options: ImageEditJobOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult[]> {
  if (!supportsImageWorker() || isSvg(file)) {
    const { editImageToMany: fallback } = await import("@/lib/tools/image-edit");
    return fallback(file, options);
  }
  const result = await runImageJob(
    file,
    { op: "edit", options },
    ctx,
    estimateEditTaskBytes(file, options),
  );
  const stem = baseName(file);
  if (result.kind === "blob") {
    // A single-output verb routed through here on purpose (a UI that treats
    // every edit as a list). Name it the way editImage would.
    return [toResult(file, `${stem}-${editVerbSuffix(options.edit)}.${result.ext}`, result)];
  }
  if (result.kind !== "blobs") throw new Error("Unexpected edit result");
  return result.items.map((item, index) => {
    const blob = new Blob([item.bytes], { type: item.mime });
    return {
      blob,
      fileName: `${stem}-${item.label}.${item.ext}`,
      // One source produced all of these, so its size is the honest "original"
      // for each. The percentage a compressor would draw from this pair is
      // meaningless for a tile and no tile UI draws one.
      originalSize: file.size,
      newSize: blob.size,
      // The notices describe the SOURCE (an animated GIF flattened to frame 0),
      // not any one tile, so they are stated once instead of N times.
      ...(index === 0 && result.warnings?.length ? { warnings: result.warnings } : {}),
    };
  });
}

// ── compress-png ─────────────────────────────────────────────────

/**
 * Thrown when the browser cannot run the image worker. compress-png has no
 * main-thread fallback ON PURPOSE: the only thing the main thread could do is
 * re-encode the PNG through a canvas, which has no compression knob at all and
 * routinely produces a BIGGER file. Handing that back as "compressed" is the
 * exact no-op this tool exists to replace, so it refuses instead.
 */
export const PNG_OPTIMISE_UNSUPPORTED_MESSAGE =
  "This browser can't run the PNG optimiser — it needs Web Workers and WebAssembly, and one " +
  "of them is missing. That is the whole requirement: oxipng is a WebAssembly codec running " +
  "in a worker, and it never touches a canvas.";

export interface PngOptimiseResult extends ProcessedResult {
  identical: boolean;
  level: number;
  colourBefore: string;
  colourAfter: string;
}

/**
 * Losslessly re-compress a PNG with oxipng.
 *
 * Deliberately does NOT go through runImageJob: that helper pre-decodes
 * HEIC/TIFF sources into an ImageBitmap, and oxipng needs the encoded PNG
 * bytes. This op always sends bytes, and the worker sniffs the PNG magic
 * itself rather than trusting the name or the MIME type.
 */
export async function optimisePng(
  file: File,
  options: PngOptimiseOptions,
  ctx: ProcessingContext = {},
): Promise<PngOptimiseResult> {
  if (!supportsPngOptimiser()) throw new Error(PNG_OPTIMISE_UNSUPPORTED_MESSAGE);
  throwIfAborted(ctx.signal);
  const bytes = await file.arrayBuffer();
  throwIfAborted(ctx.signal);
  const result = await getImagePool().run<ImageJobResult>(
    {
      op: "optimise-png",
      options,
      bytes,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    } satisfies ImageJob,
    {
      transfer: [bytes],
      memoryBytes: PNG_OPTIMISE_PEAK_BYTES,
      signal: ctx.signal,
      onProgress: ctx.onProgress,
    },
  );
  if (result.kind !== "png") throw new Error("Unexpected PNG optimisation result");
  const blob = new Blob([result.bytes], { type: "image/png" });
  return {
    blob,
    fileName: `${baseName(file)}-optimised.png`,
    originalSize: file.size,
    newSize: blob.size,
    // `identical` is the run's own answer to "did this win anything", carried
    // out of the codec rather than inferred from the two sizes — two different
    // PNGs can be the same number of bytes.
    identical: result.identical,
    level: result.level,
    colourBefore: result.colourBefore,
    colourAfter: result.colourAfter,
    ...(result.warnings?.length ? { warnings: result.warnings } : {}),
  };
}
