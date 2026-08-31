"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileProcessorContext, ProcessedResult } from "@/hooks/useFileProcessor";
import { trackEvent } from "@/lib/utils/analytics";
import { isAbortError } from "@/lib/utils/abort";
import { fileExtensionLabel } from "@/hooks/useFileProcessor";

export interface BatchItem {
  /**
   * "queued" until the file's worker actually reports progress — the pool
   * admits work as threads and memory allow, and the queue table must show
   * what is really running, not what was merely submitted.
   */
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  result: ProcessedResult | null;
  error: string | null;
}

/**
 * Batch counterpart of useFileProcessor: fires every file at once and lets
 * the worker pool schedule them. One abort controller covers the whole batch
 * (a batch is cancelled as a unit); per-file progress and failures stay
 * isolated — one broken file marks its row FAILED and the rest complete.
 */
export function useBatchProcessor<TOptions>(
  processFn: (
    file: File,
    options: TOptions,
    ctx: FileProcessorContext,
  ) => Promise<ProcessedResult>,
) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  /** Monotonic id — a superseded or cancelled run must not write state. */
  const runIdRef = useRef(0);

  // Cleanup only: abort in-flight workers when the tool unmounts mid-batch.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(
    async (files: File[], options: TOptions): Promise<(ProcessedResult | null)[]> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const runId = ++runIdRef.current;
      const isCurrent = () => runIdRef.current === runId;

      const patch = (index: number, delta: Partial<BatchItem>) => {
        if (!isCurrent()) return;
        setItems((prev) =>
          prev.map((item, i) => (i === index ? { ...item, ...delta } : item)),
        );
      };

      setIsProcessing(true);
      setItems(
        files.map(() => ({ status: "queued", progress: 0, result: null, error: null })),
      );

      const outputs: (ProcessedResult | null)[] = files.map(() => null);
      await Promise.all(
        files.map(async (file, i) => {
          try {
            const result = await processFn(file, options, {
              signal: controller.signal,
              onProgress: (value) => {
                if (!isCurrent()) return;
                const progress = Math.max(0, Math.min(100, Math.round(value)));
                setItems((prev) =>
                  prev.map((item, idx) =>
                    idx === i
                      ? {
                          ...item,
                          progress,
                          // First progress message = the worker started.
                          status: item.status === "queued" ? "running" : item.status,
                        }
                      : item,
                  ),
                );
              },
            });
            outputs[i] = result;
            patch(i, { status: "done", progress: 100, result });
            trackEvent({
              action: "file_processed",
              category: "conversion",
              label: fileExtensionLabel(file.name),
              value: Math.round(result.newSize / 1024),
            });
          } catch (err) {
            if (controller.signal.aborted || isAbortError(err)) return;
            patch(i, {
              status: "failed",
              error: err instanceof Error ? err.message : "Processing failed",
            });
          }
        }),
      );

      if (isCurrent()) setIsProcessing(false);
      return outputs;
    },
    [processFn],
  );

  /** Abort whatever is running and clear the table. */
  const reset = useCallback(() => {
    runIdRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setItems([]);
    setIsProcessing(false);
  }, []);

  /**
   * Stop the batch but keep what it already produced. A 200-file queue is the
   * longest job on the site and used to be unstoppable — the only exit was
   * leaving the page.
   *
   * Rows that finished keep their blob, so the user can still download the
   * part that ran. Rows that were queued or mid-flight go back to "queued":
   * they produced nothing, and marking them FAILED would put a red error the
   * user caused deliberately next to a file that is simply not converted yet.
   * Nothing is left "running", so the table can't sit spinning against an
   * aborted pool.
   */
  const cancel = useCallback(() => {
    if (!controllerRef.current) return;
    runIdRef.current++;
    controllerRef.current.abort();
    controllerRef.current = null;
    setIsProcessing(false);
    setItems((prev) =>
      prev.map((item) =>
        item.status === "done" && item.result
          ? item
          : { status: "queued", progress: 0, result: null, error: null },
      ),
    );
  }, []);

  return { items, isProcessing, run, cancel, reset };
}
