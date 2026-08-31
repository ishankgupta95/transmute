/// <reference lib="webworker" />
import type { PoolWorkerRequest, PoolWorkerResponse } from "./pool";
import type { PdfJob, PdfJobResult } from "./pdf-protocol";

/**
 * Pool worker for the MuPDF / pdf-lib operations — graft, save, compress on
 * multi-hundred-page documents are seconds of synchronous WASM that used to
 * freeze the tab.
 *
 * The pool above this holds ONE worker (see pdf-engine.ts): every op loads
 * the same ~10 MB MuPDF heap, so N workers would cost N heaps for tools that
 * process one document at a time. One worker serialises ops, exactly like
 * the FFmpeg queue.
 */

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<PoolWorkerRequest>) => {
  const { id, payload } = event.data;
  const job = payload as PdfJob;

  try {
    const core = await import("@/lib/tools/pdf-engine-core");
    let result: PdfJobResult;
    switch (job.op) {
      case "getPageCount":
        result = await core.getPageCount(job.data);
        break;
      case "mergePdfs":
        result = await core.mergePdfs(job.buffers);
        break;
      case "splitPdf":
        result = await core.splitPdf(job.data, job.pageIndices);
        break;
      case "rotatePdfPages":
        result = await core.rotatePdfPages(job.data, job.pageIndices, job.angle);
        break;
      case "reorderPdfPages":
        result = await core.reorderPdfPages(job.data, job.newOrder);
        break;
      case "addPageNumbers":
        result = await core.addPageNumbers(job.data, job.position, job.startNumber);
        break;
      case "compressPdf":
        result = await core.compressPdf(job.data);
        break;
      case "imagesToPdf":
        result = await core.imagesToPdf(job.images, job.pageSize);
        break;
    }
    const transfer = typeof result === "number" ? [] : [result.buffer as ArrayBuffer];
    self.postMessage({ id, type: "done", result } satisfies PoolWorkerResponse, transfer);
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      message: err instanceof Error ? err.message : "PDF processing failed",
    } satisfies PoolWorkerResponse);
  }
};
