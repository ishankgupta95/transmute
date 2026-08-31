import type { PageNumberPosition, PageSize } from "@/lib/tools/pdf-engine-core";

/**
 * Message shapes shared by the pdf-engine wrappers (main thread) and
 * pdf.worker.ts. Types only.
 *
 * Inputs are structured-cloned, NOT transferred: callers (MergePdfUI's
 * re-merge after reorder, split's page-range retry) keep using their buffers
 * after the call, and a transfer would detach them mid-flight.
 */

export type PdfJob =
  | { op: "getPageCount"; data: Uint8Array }
  | { op: "mergePdfs"; buffers: ArrayBuffer[] }
  | { op: "splitPdf"; data: Uint8Array; pageIndices: number[] }
  | { op: "rotatePdfPages"; data: Uint8Array; pageIndices: number[]; angle: number }
  | { op: "reorderPdfPages"; data: Uint8Array; newOrder: number[] }
  | {
      op: "addPageNumbers";
      data: Uint8Array;
      position: PageNumberPosition;
      startNumber: number;
    }
  | { op: "compressPdf"; data: Uint8Array }
  | { op: "imagesToPdf"; images: { bytes: Uint8Array; type: string }[]; pageSize: PageSize };

/** Page count for getPageCount, the produced document's bytes otherwise. */
export type PdfJobResult = number | Uint8Array;
