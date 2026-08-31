"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/utils/analytics";
import { isAbortError } from "@/lib/utils/abort";

export interface ProcessedResult {
  blob: Blob;
  fileName: string;
  originalSize: number;
  newSize: number;
  /**
   * Non-fatal notices the UI should surface next to the result — the run
   * succeeded, but something the user probably cares about was dropped (an
   * animated source flattened to frame 0, a multi-page TIFF cut to page 1).
   */
  warnings?: string[];
}

export type ProcessorStatus = "idle" | "loading" | "processing" | "done" | "error";

/**
 * What a processor is handed on every run. Both fields are always present, so a
 * processor can call `ctx.onProgress(n)` and read `ctx.signal` without guards.
 */
export interface FileProcessorContext {
  /** Aborted when the user cancels or the tool unmounts mid-run. */
  signal: AbortSignal;
  /** Report 0-100. Values outside that range are clamped. */
  onProgress: (progress: number) => void;
}

/**
 * What a `lib/tools/` function accepts. Everything is optional so the pure
 * processing layer stays callable on its own — from tests, from scripts, and
 * from the tools that have not been migrated onto the hook yet.
 */
export type ProcessingContext = Partial<FileProcessorContext>;

/**
 * `TOptions` is the per-call options bag. Instantiate with `void` for a
 * processor that closes over its settings — TypeScript then lets callers omit
 * the argument entirely, so no placeholder value has to be invented.
 *
 * Processors receive a third `ctx` argument carrying an `AbortSignal` and a
 * progress reporter. Both are optional to *use* — a processor that ignores them
 * still type-checks — but a long-running one should honour the signal, since
 * `cancel()` is the only way a user can stop a 25 MB video job.
 */
/**
 * The analytics label for a processed file: its extension, and never more.
 *
 * `"board minutes".split(".").pop()` is the WHOLE STRING, so a file with no
 * extension used to send its full name to Google Analytics — which the privacy
 * page explicitly promises never happens. Anything that is not a short
 * alphanumeric extension is reported as "unknown".
 */
export function fileExtensionLabel(name: string): string {
  if (!name.includes(".")) return "unknown";
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : "unknown";
}

export function useFileProcessor<TOptions>(
  processFn: (
    file: File,
    options: TOptions,
    ctx: FileProcessorContext,
  ) => Promise<ProcessedResult>,
) {
  const [status, setStatus] = useState<ProcessorStatus>("idle");
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const controllerRef = useRef<AbortController | null>(null);
  /**
   * Monotonic id for the active run. A run that is no longer current — because
   * it was cancelled, or because a newer `process()` superseded it — must not
   * write state, or a stale result lands on top of a fresh one.
   */
  const runIdRef = useRef(0);

  // Cleanup only: an in-flight FFmpeg/WebCodecs job would otherwise keep
  // burning CPU (and holding its worker) after the user navigates away.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const process = useCallback(
    async (file: File, options: TOptions) => {
      // Supersede whatever was running; its state writes are dropped below.
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const runId = ++runIdRef.current;
      const isCurrent = () => runIdRef.current === runId;

      setStatus("processing");
      setProgress(0);
      setError(null);
      setResult(null);

      try {
        const output = await processFn(file, options, {
          signal: controller.signal,
          onProgress: (value) => {
            if (!isCurrent()) return;
            setProgress(Math.max(0, Math.min(100, Math.round(value))));
          },
        });
        if (!isCurrent()) return;
        setResult(output);
        setProgress(100);
        setStatus("done");
        trackEvent({
          action: "file_processed",
          category: "conversion",
          label: fileExtensionLabel(file.name),
          value: Math.round(output.newSize / 1024),
        });
      } catch (err) {
        if (!isCurrent()) return;
        // A cancel is a user decision, not a failure — go quiet, not red.
        if (controller.signal.aborted || isAbortError(err)) {
          setStatus("idle");
          setProgress(0);
          return;
        }
        setError(err instanceof Error ? err.message : "Processing failed");
        setStatus("error");
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [processFn],
  );

  /** Stop the running job and return to idle, keeping the loaded file. */
  const cancel = useCallback(() => {
    if (!controllerRef.current) return;
    runIdRef.current++;
    controllerRef.current.abort();
    controllerRef.current = null;
    setStatus("idle");
    setProgress(0);
  }, []);

  const reset = useCallback(() => {
    runIdRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus("idle");
    setResult(null);
    setError(null);
    setProgress(0);
  }, []);

  return { status, result, error, progress, process, cancel, reset };
}
