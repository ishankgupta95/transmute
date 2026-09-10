import type {
  PageNumberPosition,
  PageSize,
  PdfCropRect,
  PdfFormReport,
  PdfFormValues,
  PdfMetadataReport,
  PdfPageSizeOptions,
  PdfStamp,
} from "@/lib/tools/pdf-engine-core";

/**
 * Message shapes shared by the pdf-engine wrappers (main thread) and
 * pdf.worker.ts, plus the one shared constant both sides and the UIs need.
 *
 * Inputs are structured-cloned, NOT transferred: callers (MergePdfUI's
 * re-merge after reorder, split's page-range retry) keep using their buffers
 * after the call, and a transfer would detach them mid-flight.
 */

/**
 * Visual page sizes in PDF points (1 pt = 1/72").
 *
 * This lives HERE, in the one module in the PDF cluster with no runtime
 * imports at all, rather than beside the engine that consumes it. A page-size
 * dropdown needs the table at render time, so a UI has to import it
 * statically — and a static import of pdf-engine-core (or of a pdf-engine that
 * re-exports from it) drags the whole of pdf-lib into the eager bundle:
 * pdf-lib's package.json declares no `sideEffects: false`, so the bundler must
 * keep the module. Measured with esbuild over a probe entry that imports
 * `pdf-engine`: re-exporting the constant through pdf-engine-core turned a
 * 2,259-byte entry that lazily loaded a 705 KB pdf-lib chunk into a 2,361-byte
 * entry with a STATIC import of that same 705 KB chunk. Re-exported from here
 * it stays lazy, which is the entire point of the worker split.
 *
 * pdf-engine-core.ts and pdf-engine.ts both re-export it, so callers can reach
 * it from whichever of the three they already depend on.
 *
 * Distinct from `PAGE_SIZES` in pdf-engine-core.ts, which is a smaller map with
 * a "fit" member that belongs to imagesToPdf. The two must not be merged.
 */
export const PDF_PAGE_SIZES = {
  a3: { width: 841.89, height: 1190.55 },
  a4: { width: 595.28, height: 841.89 },
  a5: { width: 419.53, height: 595.28 },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
  tabloid: { width: 792, height: 1224 },
} as const;

export type PdfPageSizeName = keyof typeof PDF_PAGE_SIZES;

export type PdfJob =
  | { op: "getPageCount"; data: Uint8Array }
  | { op: "mergePdfs"; buffers: ArrayBuffer[] }
  | { op: "splitPdf"; data: Uint8Array; pageIndices: number[] }
  | { op: "splitPdfToPages"; data: Uint8Array; pageIndices: number[] }
  | { op: "deletePdfPages"; data: Uint8Array; pageIndices: number[] }
  | { op: "cropPdfPages"; data: Uint8Array; rect: PdfCropRect; pageIndices?: number[] }
  | { op: "changePdfPageSize"; data: Uint8Array; options: PdfPageSizeOptions }
  | { op: "rotatePdfPages"; data: Uint8Array; pageIndices: number[]; angle: number }
  | { op: "reorderPdfPages"; data: Uint8Array; newOrder: number[] }
  | {
      op: "addPageNumbers";
      data: Uint8Array;
      position: PageNumberPosition;
      startNumber: number;
    }
  | { op: "compressPdf"; data: Uint8Array }
  | { op: "imagesToPdf"; images: { bytes: Uint8Array; type: string }[]; pageSize: PageSize }
  | { op: "stampPdf"; data: Uint8Array; stamps: PdfStamp[] }
  | { op: "readPdfForm"; data: Uint8Array }
  | { op: "fillPdfForm"; data: Uint8Array; values: PdfFormValues; flatten: boolean }
  | { op: "flattenPdfForm"; data: Uint8Array }
  | { op: "readPdfMetadata"; data: Uint8Array }
  | { op: "removePdfMetadata"; data: Uint8Array };

/**
 * Page count for getPageCount, a report object for the two READ ops, the
 * produced document's bytes otherwise — and one document per selected page for
 * splitPdfToPages, the only op whose result is a list.
 *
 * ⚠ THE WORKER'S TRANSFER LIST BRANCHES ON THESE SHAPES AND MUST STAY IN STEP.
 * A result that is a plain object has no `.buffer`, and handing `postMessage` an
 * `undefined` transferable throws — so the two report shapes are matched
 * explicitly there rather than falling into the `Uint8Array` branch.
 */
export type PdfJobResult =
  | number
  | Uint8Array
  | Uint8Array[]
  | PdfFormReport
  | PdfMetadataReport;
