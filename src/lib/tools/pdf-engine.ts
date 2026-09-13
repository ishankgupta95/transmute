import type { ProcessingContext } from "@/hooks/useFileProcessor";
import type {
  PageNumberPosition,
  PageSize,
  PdfCropRect,
  PdfFormReport,
  PdfFormValues,
  PdfMetadataReport,
  PdfPageSizeName,
  PdfPageSizeOptions,
  PdfStamp,
} from "./pdf-engine-core";
import type { PdfJob, PdfJobResult } from "@/lib/workers/pdf-protocol";

export type {
  PageNumberPosition,
  PageSize,
  PdfCropRect,
  PdfFormReport,
  PdfFormValues,
  PdfMetadataReport,
  PdfPageSizeName,
  PdfPageSizeOptions,
  PdfStamp,
};
// Straight from the protocol module, NOT through pdf-engine-core: a value
// re-export from the core turns this file's static-import graph into a 705 KB
// eager pdf-lib chunk (measured — see PDF_PAGE_SIZES in pdf-protocol.ts).
export { PDF_PAGE_SIZES } from "@/lib/workers/pdf-protocol";


/**
 * PDF operations, split across two engines (Phase 3):
 *
 * - pdf-lib ops (merge, split, rotate, reorder, page numbers, compress,
 *   images→PDF) run in a single pool worker — parsing and re-serialising a
 *   multi-hundred-page document is seconds of uninterrupted synchronous work
 *   that froze the tab. The implementations live in pdf-engine-core.ts; the
 *   wrappers here keep the old call signatures so UIs don't care where the
 *   work runs. One worker only: each op holds a whole document's object graph
 *   in memory, and these tools handle one document at a time — so N workers
 *   would buy nothing but N documents' worth of peak memory. Ops serialise,
 *   like the FFmpeg queue.
 *
 * - pdfjs rendering (pdfToImages, page thumbnails) stays here: pdfjs ships
 *   its own worker for the raster math, and its output canvases are DOM
 *   objects. Page ENCODING (canvas → JPG/PNG bytes) does go through the
 *   image worker pool, so a 60-page export doesn't serialise 60 encodes on
 *   the main thread.
 *
 * Environments without Worker (jsdom) fall back to running the core inline.
 */

// ── pdf-lib ops via the PDF worker ─────────────────────────────────

let pdfWorkerPool: import("@/lib/workers/pool").WorkerPool | null = null;

async function runPdfJob<T extends PdfJobResult>(job: PdfJob): Promise<T> {
  if (typeof Worker === "undefined") {
    // jsdom / ancient browsers: same code, main thread.
    const core = await import("./pdf-engine-core");
    return dispatchInline(core, job) as Promise<T>;
  }
  if (!pdfWorkerPool) {
    const { WorkerPool } = await import("@/lib/workers/pool");
    pdfWorkerPool = new WorkerPool({
      // Pre-bundled by scripts/build-workers.mjs — see image-client.ts.
      createWorker: () =>
        new Worker(`${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/workers/pdf.worker.js`, {
          type: "module",
        }),
      maxWorkers: 1,
    });
  }
  const bytes = jobBytes(job);
  return pdfWorkerPool.run<T>(job, {
    // Peak ≈ the source bytes the parser holds onto + the object graph it
    // builds from them + the serialised copy on the way back out.
    memoryBytes: bytes * 3,
  });
}

function jobBytes(job: PdfJob): number {
  switch (job.op) {
    case "mergePdfs":
      return job.buffers.reduce((sum, b) => sum + b.byteLength, 0);
    case "imagesToPdf":
      return job.images.reduce((sum, i) => sum + i.bytes.byteLength, 0);
    default:
      return job.data.byteLength;
  }
}

function dispatchInline(
  core: typeof import("./pdf-engine-core"),
  job: PdfJob,
): Promise<PdfJobResult> {
  switch (job.op) {
    case "getPageCount":
      return core.getPageCount(job.data);
    case "mergePdfs":
      return core.mergePdfs(job.buffers);
    case "splitPdf":
      return core.splitPdf(job.data, job.pageIndices);
    case "splitPdfToPages":
      return core.splitPdfToPages(job.data, job.pageIndices);
    case "deletePdfPages":
      return core.deletePdfPages(job.data, job.pageIndices);
    case "cropPdfPages":
      return core.cropPdfPages(job.data, job.rect, job.pageIndices);
    case "changePdfPageSize":
      return core.changePdfPageSize(job.data, job.options);
    case "rotatePdfPages":
      return core.rotatePdfPages(job.data, job.pageIndices, job.angle);
    case "reorderPdfPages":
      return core.reorderPdfPages(job.data, job.newOrder);
    case "addPageNumbers":
      return core.addPageNumbers(job.data, job.position, job.startNumber);
    case "compressPdf":
      return core.compressPdf(job.data);
    case "imagesToPdf":
      return core.imagesToPdf(job.images, job.pageSize);
    case "stampPdf":
      return core.stampPdf(job.data, job.stamps);
    case "readPdfForm":
      return core.readPdfForm(job.data);
    case "fillPdfForm":
      return core.fillPdfForm(job.data, job.values, { flatten: job.flatten });
    case "flattenPdfForm":
      return core.flattenPdfForm(job.data);
    case "readPdfMetadata":
      return core.readPdfMetadata(job.data);
    case "removePdfMetadata":
      return core.removePdfMetadata(job.data);
  }
}

function toUint8Array(buf: ArrayBuffer | Uint8Array): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

export async function getPageCount(data: ArrayBuffer | Uint8Array): Promise<number> {
  return runPdfJob({ op: "getPageCount", data: toUint8Array(data) });
}

export async function mergePdfs(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  return runPdfJob({ op: "mergePdfs", buffers });
}

/** Extract specific pages (0-indexed) into a new PDF. */
export async function splitPdf(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  return runPdfJob({ op: "splitPdf", data: toUint8Array(data), pageIndices });
}

/** One single-page PDF per selected page, in the order given. */
export async function splitPdfToPages(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array[]> {
  return runPdfJob({ op: "splitPdfToPages", data: toUint8Array(data), pageIndices });
}

/** Every page EXCEPT the given 0-based indices. */
export async function deletePdfPages(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
): Promise<Uint8Array> {
  return runPdfJob({ op: "deletePdfPages", data: toUint8Array(data), pageIndices });
}

/**
 * Crop pages to `rect`, given in VISUAL page space (origin at the visible
 * page's lower-left, /Rotate already applied). Omit `pageIndices` for every
 * page. Sets the page boxes; does not remove the content outside them.
 */
export async function cropPdfPages(
  data: ArrayBuffer | Uint8Array,
  rect: PdfCropRect,
  pageIndices?: number[],
): Promise<Uint8Array> {
  return runPdfJob({ op: "cropPdfPages", data: toUint8Array(data), rect, pageIndices });
}

/** Resize every page to a target VISUAL page size. */
export async function changePdfPageSize(
  data: ArrayBuffer | Uint8Array,
  options: PdfPageSizeOptions,
): Promise<Uint8Array> {
  return runPdfJob({ op: "changePdfPageSize", data: toUint8Array(data), options });
}

/** Rotate specified pages by the given angle (90, 180, 270). */
export async function rotatePdfPages(
  data: ArrayBuffer | Uint8Array,
  pageIndices: number[],
  angle: number,
): Promise<Uint8Array> {
  return runPdfJob({ op: "rotatePdfPages", data: toUint8Array(data), pageIndices, angle });
}

/** Reorder pages based on the given order (0-indexed). */
export async function reorderPdfPages(
  data: ArrayBuffer | Uint8Array,
  newOrder: number[],
): Promise<Uint8Array> {
  return runPdfJob({ op: "reorderPdfPages", data: toUint8Array(data), newOrder });
}

export async function addPageNumbers(
  data: ArrayBuffer | Uint8Array,
  position: PageNumberPosition = "bottom-center",
  startNumber: number = 1,
): Promise<Uint8Array> {
  return runPdfJob({
    op: "addPageNumbers",
    data: toUint8Array(data),
    position,
    startNumber,
  });
}

export async function compressPdf(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  return runPdfJob({ op: "compressPdf", data: toUint8Array(data) });
}

export async function imagesToPdf(
  images: { bytes: Uint8Array; type: string }[],
  pageSize: PageSize = "a4",
): Promise<Uint8Array> {
  return runPdfJob({ op: "imagesToPdf", images, pageSize });
}

/** Watermarks, signatures, placed images and annotation marks — one op, four tools. */
export async function stampPdf(
  data: ArrayBuffer | Uint8Array,
  stamps: PdfStamp[],
): Promise<Uint8Array> {
  return runPdfJob({ op: "stampPdf", data: toUint8Array(data), stamps });
}

export async function readPdfForm(data: ArrayBuffer | Uint8Array): Promise<PdfFormReport> {
  return runPdfJob({ op: "readPdfForm", data: toUint8Array(data) });
}

export async function fillPdfForm(
  data: ArrayBuffer | Uint8Array,
  values: PdfFormValues,
  options: { flatten?: boolean } = {},
): Promise<Uint8Array> {
  return runPdfJob({
    op: "fillPdfForm",
    data: toUint8Array(data),
    values,
    flatten: options.flatten === true,
  });
}

export async function flattenPdfForm(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  return runPdfJob({ op: "flattenPdfForm", data: toUint8Array(data) });
}

export async function readPdfMetadata(
  data: ArrayBuffer | Uint8Array,
): Promise<PdfMetadataReport> {
  return runPdfJob({ op: "readPdfMetadata", data: toUint8Array(data) });
}

export async function removePdfMetadata(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  return runPdfJob({ op: "removePdfMetadata", data: toUint8Array(data) });
}

// ── PDF to Images (using pdfjs-dist) ────────────────────────────────

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjsLib;
}

/*
  The pdfjs side of the two house sentences. Copied verbatim from
  pdf-engine-core.ts — see the note there; the same string must come back
  whichever PDF tool the file was dropped on, and pdf-engine-core.ts is the
  DOM-free pdf-lib core the pool worker bundles, so importing it here for one
  string would drag 705 KB of pdf-lib into a pdfjs-only path. Three homes:
  pdf-engine-core.ts, pdf-image-core.ts, here.
*/
const PASSWORD_MESSAGE =
  "This PDF is password-protected. Run it through Unlock PDF (/unlock-pdf) first — that removes a password you know, or clears an owner-password restriction without one. It cannot crack a password you don't have.";

const DAMAGED_MESSAGE =
  "This PDF could not be read — the file is damaged or is not a PDF. If it really is a PDF, try Repair PDF (/repair-pdf), which rebuilds a broken cross-reference table. If that fails too, re-export it from the program that produced it.";

/**
 * The single pdfjs `getDocument` in this module, so the two load failures
 * users actually hit are mapped in exactly one place.
 *
 * They were not, and the leak was visible: pdf-to-jpg / png / webp opened the
 * document here with no catch at all, and the UIs render `err.message`
 * verbatim, so a protected file put pdfjs's own English on screen — literally
 * "No password given" (pdfjs-dist 5.6.205, pdf.worker.mjs) — as if it were our
 * copy. The pdf-lib path had said the house sentence all along.
 *
 * Matching is on `name`, not `instanceof`: pdfjs's exception classes hang off
 * a `BaseException` whose prototype is a real `new Error()`, so every one of
 * them IS `instanceof Error` and a stock catch cannot tell them apart from
 * ours. Garbage bytes come back as "InvalidPDFException" — verified against
 * the installed build. Anything else is rethrown untouched: we do not know
 * what it was, so we do not get to describe it.
 */
async function openPdfjsDocument(bytes: Uint8Array) {
  const pdfjs = await getPdfjs();
  try {
    return await pdfjs.getDocument({ data: bytes }).promise;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") throw new Error(PASSWORD_MESSAGE);
    if (name === "InvalidPDFException" || name === "MissingPDFException") {
      throw new Error(DAMAGED_MESSAGE);
    }
    throw err;
  }
}

export async function pdfToImages(
  data: ArrayBuffer | Uint8Array,
  format: "jpeg" | "png" | "webp" = "jpeg",
  quality: number = 0.85,
  scale: number = 2,
  ctx: ProcessingContext = {},
): Promise<{ blob: Blob; name: string }[]> {
  const doc = await openPdfjsDocument(new Uint8Array(data).slice());

  const ext = format === "jpeg" ? "jpg" : format;
  const mimeType = `image/${format}`;
  let encodedCount = 0;
  const reportDone = () => {
    encodedCount++;
    ctx.onProgress?.((encodedCount / doc.numPages) * 100);
  };

  // pdf.js keeps the parsed document, its font/image caches and every page's
  // operator list pinned in its worker until the proxy is destroyed — there is
  // no FinalizationRegistry to clean up after us. The destroy has to wait for
  // the last encode, so `Promise.all` runs inside the try.
  try {
    // Pages render sequentially — pdfjs serialises the raster math in its own
    // worker anyway — but each rendered canvas is handed straight to the image
    // pool for encoding, so a 60-page export overlaps render(n+1) with
    // encode(n..) instead of blocking the main thread per page.
    const encodes: Promise<{ blob: Blob; name: string }>[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, viewport }).promise;
      page.cleanup();

      const encoded = encodePageCanvas(canvas, i, mimeType, quality)
        .then(async (blob) => {
          // Canvas encoders silently substitute PNG when they can't produce
          // the requested type (the image-convert.ts trap) — Safari can't
          // encode WebP, so page-N.webp would hold PNG bytes. blob.type can't
          // catch it either: the worker path stamps the REQUESTED mime onto
          // whatever bytes came back. Only the bytes themselves tell the
          // truth, so sniff the container on every page.
          if (format === "webp" && !(await isWebpBytes(blob))) {
            throw new Error(
              "This browser can't encode WebP images. Use PDF to PNG instead, or open this page in Chrome or Edge.",
            );
          }
          reportDone();
          return { blob, name: `page-${i}.${ext}` };
        });
      encodes.push(encoded);

      // Fail fast: encode support won't change between pages, so if page 1's
      // sniff rejects, a 60-page document must not render 59 more pages just
      // to throw the same error at the end.
      if (i === 1 && format === "webp") await encoded;
    }

    return await Promise.all(encodes);
  } finally {
    await doc.destroy();
  }
}

/**
 * True when the blob's bytes really are a WebP container ("RIFF" at 0,
 * "WEBP" at 8). Both encode paths can lie about the type — see the call site.
 */
async function isWebpBytes(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return (
    head.length === 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  );
}

/**
 * Encode one rendered page. Worker path: pixels cross as an ImageBitmap and
 * the encode runs in the image pool. Fallback (no worker-side canvas): the
 * old toBlob, whose null result — canvas too large for the browser encoder
 * (big page × high scale) — still surfaces as the sized error message.
 */
/*
  Exported for `ocr-pdf.ts` as well as `pdfToImages` above. Handing a canvas
  straight to tesseract.js is the alternative and it is worse: its own
  `loadImage` calls `canvas.toBlob()` with no type and no quality — a default
  PNG encode, on the MAIN THREAD, once per page. This routes the pixels to the
  image worker pool instead, which is the whole reason it exists.
*/
export async function encodePageCanvas(
  canvas: HTMLCanvasElement,
  pageNumber: number,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  const tooLarge = () =>
    new Error(
      `Page ${pageNumber} is too large to render at this quality (${canvas.width}×${canvas.height}). Try a lower scale.`,
    );

  if (
    typeof Worker !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof createImageBitmap !== "undefined"
  ) {
    const { encodeBitmap } = await import("@/lib/workers/image-client");
    const bitmap = await createImageBitmap(canvas);
    try {
      return await encodeBitmap(bitmap, mimeType, quality, canvas.width * canvas.height * 4);
    } catch (err) {
      throw err instanceof Error && /too large|allocation|memory/i.test(err.message)
        ? tooLarge()
        : err;
    }
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(tooLarge());
    }, mimeType, quality);
  });
}

/**
 * Load a pdfjs document once for rendering multiple pages.
 * Slices the buffer to avoid detaching the caller's copy. Load failures come
 * back as the house sentences, not pdfjs internals — see `openPdfjsDocument`.
 */
export async function loadPdfjsDocument(data: ArrayBuffer | Uint8Array) {
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data).slice();
  return openPdfjsDocument(bytes);
}

/** Render a single page from an already-loaded pdfjs document. */
export async function renderPageFromDoc(
  doc: Awaited<ReturnType<typeof loadPdfjsDocument>>,
  pageNumber: number,
  scale: number = 0.5,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvas, viewport }).promise;
  // Release the page's operator list; the pixels we care about are on the
  // canvas now. Without this a 60-page thumbnail sweep keeps all 60 alive.
  page.cleanup();
  return canvas;
}

/** Convenience: render a single page from raw data (opens a new document). */
export async function renderPageToCanvas(
  data: ArrayBuffer | Uint8Array,
  pageNumber: number,
  scale: number = 0.5,
): Promise<HTMLCanvasElement> {
  const doc = await loadPdfjsDocument(data);
  try {
    return await renderPageFromDoc(doc, pageNumber, scale);
  } finally {
    await doc.destroy();
  }
}
