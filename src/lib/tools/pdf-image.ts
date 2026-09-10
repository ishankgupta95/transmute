import type { PdfImageJob, PdfImageJobResult, PdfImageMode } from "@/lib/workers/pdf-image-protocol";
import { neutraliseJpegOrientation } from "@/lib/tools/jpeg-orientation";

export type {
  PdfImageJobResult,
  PdfImageMode,
  PdfImageQualityPreset,
  PdfImageSkip,
  PdfImageSkipReason,
  PdfImageStats,
} from "@/lib/workers/pdf-image-protocol";
// Straight from the protocol module, NOT through pdf-image-core: a value
// re-export from the core turns this file's static-import graph into an eager
// 705 KB pdf-lib chunk (measured — see PDF_PAGE_SIZES in pdf-protocol.ts).
export { PDF_IMAGE_QUALITY_PRESETS } from "@/lib/workers/pdf-image-protocol";

/**
 * Main-thread wrapper for the lossy PDF image recompressor — the same
 * worker-routing shape `pdf-engine.ts` gives the pdf-lib operations, so the UI
 * does not have to care where the work runs.
 *
 * Its own pool, not the pdf-engine one: this worker bundles the pixel path
 * (createImageBitmap / OffscreenCanvas) that the pdf-lib worker deliberately
 * has no use for. One worker, for the reason pdf-engine.ts gives — a pass
 * holds a whole document's object graph, and these tools process one document
 * at a time, so more workers would buy nothing but more peak memory.
 */

let pool: import("@/lib/workers/pool").WorkerPool | null = null;

/**
 * Re-encode the JPEG images inside `data` and return the rebuilt document
 * together with an honest account of what was and was not touched.
 *
 * `onProgress` receives a monotonically non-decreasing integer percent that
 * saturates at 90 — target mode performs many whole-document rebuilds, so
 * there is real progress to show. The caller owns the last 10.
 */
export async function recompressPdfImages(
  data: ArrayBuffer | Uint8Array,
  mode: PdfImageMode,
  onProgress?: (percent: number) => void,
): Promise<PdfImageJobResult> {
  const bytes = toUint8Array(data);

  if (typeof Worker === "undefined") {
    return runInline(bytes, mode, onProgress);
  }

  if (!pool) {
    const { WorkerPool } = await import("@/lib/workers/pool");
    pool = new WorkerPool({
      // Pre-bundled by scripts/build-workers.mjs — see image-client.ts.
      createWorker: () =>
        new Worker(`${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/workers/pdf-image.worker.js`, {
          type: "module",
        }),
      maxWorkers: 1,
    });
  }

  const job: PdfImageJob = { op: "recompressPdfImages", data: bytes, mode };
  return pool.run<PdfImageJobResult>(job, {
    /*
      Peak ≈ the source bytes the parser holds + the object graph built from
      them + the serialised copy on the way out (the ×3 pdf-engine.ts uses for
      the same reason), plus one decoded image. The bitmap is the term the PDF
      ops do not have and it does not scale with the file: a 20 MP photograph
      is 80 MB of RGBA whether it arrived in a 2 MB PDF or a 200 MB one, so it
      is a flat addend rather than a multiplier. Over-estimating costs a task
      its turn in the queue; under-estimating costs a mobile Safari tab.
    */
    memoryBytes: bytes.byteLength * 3 + 96 * 1024 * 1024,
    onProgress,
  });
}

/**
 * No `Worker` at all — jsdom, and browsers old enough not to matter.
 *
 * The pixel path is not optional here. If this environment cannot decode and
 * re-encode an image it must SAY so: silently handing back the input unchanged
 * would make a unit suite go green over an engine that never ran, which is
 * this repo's documented blind spot (see project_test_blindspot in the notes
 * and the header of image.worker.ts) and would tell a user their file was
 * processed when it was not.
 */
async function runInline(
  bytes: Uint8Array,
  mode: PdfImageMode,
  onProgress?: (percent: number) => void,
): Promise<PdfImageJobResult> {
  if (typeof createImageBitmap === "undefined" || typeof OffscreenCanvas === "undefined") {
    throw new Error("Image re-compression needs a browser with OffscreenCanvas.");
  }
  const { recompressPdfImages: core } = await import("./pdf-image-core");
  return core(bytes, mode, recode, onProgress);
}

/**
 * Decode → redraw at `scale` → re-encode as JPEG, on the main thread.
 *
 * DUPLICATED, deliberately, from `lib/workers/pdf-image.worker.ts` — the same
 * arrangement image.worker.ts has with lib/tools/image-*. The two copies must
 * change together; there is no third module to hoist it into that both a
 * worker entrypoint and a main-thread client may import without dragging a
 * module that names the worker's URL into the worker's own bundle, which hangs
 * `next build`. Read the copy over there for what each line is doing.
 */
async function recode(
  jpegBytes: Uint8Array,
  opts: { scale: number; quality: number },
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const source = new Uint8Array(jpegBytes.length);
  source.set(jpegBytes);

  /*
    EXIF Orientation is neutralised BEFORE the decoder sees the bytes.
    `createImageBitmap` HONOURS that tag, but a PDF reader ignores EXIF inside
    a /DCTDecode stream entirely — so re-encoding what the decoder returned
    would write rotated samples (and, for orientations 5-8, TRANSPOSED
    dimensions) into a dictionary the page's CTM still reads as the original
    grid. `imageOrientation: "none"` does not help; see jpeg-orientation.ts for
    the measurement. `null` means the file declares an orientation this code
    cannot rewrite, so the image is left exactly as found rather than silently
    corrupted.
  */
  const decodable = neutraliseJpegOrientation(source);
  if (!decodable) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([decodable], { type: "image/jpeg" }));
  } catch {
    return null;
  }

  try {
    const width = Math.max(1, Math.round(bitmap.width * opts.scale));
    const height = Math.max(1, Math.round(bitmap.height * opts.scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: opts.quality });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bitmap.close();
  }
}

function toUint8Array(buf: ArrayBuffer | Uint8Array): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}
