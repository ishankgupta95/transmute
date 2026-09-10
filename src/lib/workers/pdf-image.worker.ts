/// <reference lib="webworker" />
// LEAF imports only — both of these are type-only, and pdf-image-protocol.ts
// has zero runtime imports of its own. A worker entrypoint whose import chain
// reaches a module that names this worker's own URL hangs `next build` forever
// at 0% CPU; pdf-image-core (and pdf-lib with it) is reached through the
// dynamic import below, exactly as pdf.worker.ts reaches pdf-engine-core.
import type { PoolWorkerRequest, PoolWorkerResponse } from "./pool";
import type { PdfImageJob, PdfImageJobResult } from "./pdf-image-protocol";
// A real (value) import, and safe under the leaf rule: jpeg-orientation.ts has
// zero imports of its own.
import { neutraliseJpegOrientation } from "@/lib/tools/jpeg-orientation";

/**
 * Pool worker for the lossy PDF image recompressor.
 *
 * It owns the only DOM-shaped part of the job — decode a JPEG, redraw it
 * smaller, re-encode it — and hands that to `pdf-image-core` as a callback,
 * which is what keeps the core itself DOM-free and unit-testable. A run in
 * target-size mode rebuilds the whole document up to 24 times, so this is
 * precisely the kind of work that used to freeze the tab.
 *
 * One worker only (see pdf-image.ts): a pass holds the document's parsed
 * object graph, its source bytes and its serialised output at once, so N
 * workers would buy nothing but N documents' worth of peak memory for a tool
 * that processes one document at a time.
 */

declare const self: DedicatedWorkerGlobalScope;

/**
 * Decode → redraw at `scale` → re-encode as JPEG.
 *
 * DUPLICATED, deliberately, in `lib/tools/pdf-image.ts` for the no-Worker
 * fallback — the same arrangement image.worker.ts has with lib/tools/image-*.
 * The two copies must change together; there is no third module to hoist it
 * into that both a worker entrypoint and a main-thread client may import
 * without breaking the leaf rule above.
 *
 * `null` means the decoder refused the bytes; the core counts that as
 * `undecodable` and leaves the image exactly as it found it. The white fill is
 * the alpha-less-format rule from image.worker.ts's `draw`: a JPEG carries no
 * alpha, and any pixel the drawImage does not cover would otherwise be encoded
 * as black rather than white.
 *
 * `bitmap.close()` runs in a finally, so peak memory stays at one decoded
 * image no matter how many the document holds.
 */
async function recode(
  jpegBytes: Uint8Array,
  opts: { scale: number; quality: number },
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  // Copied into a freshly allocated buffer rather than passed straight to
  // Blob: the parser hands back a view onto the whole PDF, and the copy keeps
  // the blob from pinning the entire source document.
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

self.onmessage = async (event: MessageEvent<PoolWorkerRequest>) => {
  const { id, payload } = event.data;
  const job = payload as PdfImageJob;

  try {
    const core = await import("@/lib/tools/pdf-image-core");
    const result: PdfImageJobResult = await core.recompressPdfImages(
      job.data,
      job.mode,
      recode,
      (value) => self.postMessage({ id, type: "progress", value } satisfies PoolWorkerResponse),
    );
    /*
      The produced document is TRANSFERRED, not copied — structured-cloning a
      whole PDF would double peak memory at exactly the moment this worker is
      holding the most. The stats object rides along as an ordinary clone; it
      is a handful of numbers. The INPUT is deliberately not transferred (see
      pdf-image-protocol.ts): the UI keeps its bytes to re-run at another
      quality and to hand the original back when the output came out bigger.
    */
    self.postMessage({ id, type: "done", result } satisfies PoolWorkerResponse, [
      result.bytes.buffer as ArrayBuffer,
    ]);
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      message: err instanceof Error ? err.message : "PDF image re-compression failed",
    } satisfies PoolWorkerResponse);
  }
};
