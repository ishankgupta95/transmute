"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface WorkerMessage<T> {
  type: "result" | "error" | "progress";
  data?: T;
  error?: string;
  progress?: number;
}

export function useWebWorker<TInput, TOutput>(
  workerFactory: () => Worker,
) {
  const workerRef = useRef<Worker | null>(null);
  const [result, setResult] = useState<TOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const run = useCallback(
    (input: TInput) => {
      workerRef.current?.terminate();
      const worker = workerFactory();
      workerRef.current = worker;
      setBusy(true);
      setError(null);
      setResult(null);
      setProgress(0);

      worker.onmessage = (e: MessageEvent<WorkerMessage<TOutput>>) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setProgress(msg.progress ?? 0);
        } else if (msg.type === "result") {
          setResult(msg.data ?? null);
          setBusy(false);
          setProgress(100);
        } else if (msg.type === "error") {
          setError(msg.error ?? "Worker error");
          setBusy(false);
        }
      };

      worker.onerror = () => {
        setError("Worker encountered an error");
        setBusy(false);
      };

      worker.postMessage(input);
    },
    [workerFactory],
  );

  const cancel = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
  }, []);

  return { run, cancel, result, error, progress, busy };
}
