/// <reference lib="webworker" />
import type { PoolWorkerRequest, PoolWorkerResponse } from "./pool";
import type { PdfJob, PdfJobResult } from "./pdf-protocol";

/**
 * Pool worker for the pdf-lib operations — copying pages, saving and
 * compressing a multi-hundred-page document is seconds of uninterrupted
 * synchronous work that used to freeze the tab.
 *
 * The pool above this holds ONE worker (see pdf-engine.ts): every op holds a
 * whole document's parsed object graph, so N workers would cost N documents'
 * worth of peak memory for tools that process one document at a time. One
 * worker serialises ops, exactly like the FFmpeg queue.
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
      case "splitPdfToPages":
        result = await core.splitPdfToPages(job.data, job.pageIndices);
        break;
      case "deletePdfPages":
        result = await core.deletePdfPages(job.data, job.pageIndices);
        break;
      case "cropPdfPages":
        result = await core.cropPdfPages(job.data, job.rect, job.pageIndices);
        break;
      case "changePdfPageSize":
        result = await core.changePdfPageSize(job.data, job.options);
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
      case "stampPdf":
        result = await core.stampPdf(job.data, job.stamps);
        break;
      case "readPdfForm":
        result = await core.readPdfForm(job.data);
        break;
      case "fillPdfForm":
        result = await core.fillPdfForm(job.data, job.values, { flatten: job.flatten });
        break;
      case "flattenPdfForm":
        result = await core.flattenPdfForm(job.data);
        break;
      case "readPdfMetadata":
        result = await core.readPdfMetadata(job.data);
        break;
      case "removePdfMetadata":
        result = await core.removePdfMetadata(job.data);
        break;
    }
    /*
      Every byte array in the result is TRANSFERRED, not copied — the outputs
      are whole documents and structured-cloning them would double peak memory
      at exactly the moment the worker is holding the most.

      splitPdfToPages is the case that needs the array branch: handing
      postMessage a bare `result.buffer` for an array is `undefined`, which is
      not a transferable and throws, and omitting the transfer list entirely
      would silently clone N documents instead. Each save() allocates its own
      buffer, so the list can never name the same ArrayBuffer twice (which
      postMessage also rejects). Inputs are deliberately NOT transferred — see
      pdf-protocol.ts.
    */
    const transfer: ArrayBuffer[] =
      typeof result === "number"
        ? []
        : Array.isArray(result)
          ? result.map((bytes) => bytes.buffer as ArrayBuffer)
          : result instanceof Uint8Array
            ? [result.buffer as ArrayBuffer]
            : // A report object: structured-cloned like any other plain value.
              // It has no `.buffer`, and naming `undefined` as a transferable
              // throws, which would turn a successful read into a worker error.
              [];
    self.postMessage({ id, type: "done", result } satisfies PoolWorkerResponse, transfer);
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      message: err instanceof Error ? err.message : "PDF processing failed",
    } satisfies PoolWorkerResponse);
  }
};
