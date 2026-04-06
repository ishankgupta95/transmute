"use client";

import { useCallback, useState } from "react";

export interface ProcessedResult {
  blob: Blob;
  fileName: string;
  originalSize: number;
  newSize: number;
}

export type ProcessorStatus = "idle" | "loading" | "processing" | "done" | "error";

export function useFileProcessor<TOptions>(
  processFn: (file: File, options: TOptions) => Promise<ProcessedResult>,
) {
  const [status, setStatus] = useState<ProcessorStatus>("idle");
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const process = useCallback(
    async (file: File, options: TOptions) => {
      setStatus("processing");
      setError(null);
      setResult(null);
      try {
        const output = await processFn(file, options);
        setResult(output);
        setStatus("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Processing failed");
        setStatus("error");
      }
    },
    [processFn],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { status, result, error, process, reset };
}
