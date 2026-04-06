"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { addPageNumbers, type PageNumberPosition } from "@/lib/tools/pdf-engine";

export function AddPageNumbersUI() {
  const [file, setFile] = useState<File | null>(null);
  const [position, setPosition] = useState<PageNumberPosition>("bottom-center");
  const [startNumber, setStartNumber] = useState(1);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  const handleProcess = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const bytes = await addPageNumbers(buf, position, startNumber);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add page numbers");
      setStatus("error");
    }
  }, [file, position, startNumber]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">{file.name}</p>
        <button onClick={handleReset} className="text-sm text-text-muted hover:text-text-secondary transition-colors">
          Change file
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <label className="block text-xs text-text-muted mb-1">Position</label>
          <select
            value={position}
            onChange={(e) => setPosition(e.target.value as PageNumberPosition)}
            className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="bottom-left">Bottom Left</option>
            <option value="bottom-center">Bottom Center</option>
            <option value="bottom-right">Bottom Right</option>
            <option value="top-left">Top Left</option>
            <option value="top-center">Top Center</option>
            <option value="top-right">Top Right</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Start number</label>
          <input
            type="number"
            min={1}
            value={startNumber}
            onChange={(e) => setStartNumber(Math.max(1, Number(e.target.value)))}
            className="w-24 rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {/* Position visual */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4 max-w-xs">
        <p className="text-xs text-text-muted mb-2">Preview position:</p>
        <div className="border border-border-hover rounded aspect-[3/4] relative text-xs text-text-muted">
          {(["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"] as const).map((pos) => (
            <span
              key={pos}
              className={`absolute px-1 ${
                pos === position ? "text-accent font-medium" : "opacity-30"
              } ${pos.startsWith("top") ? "top-1" : "bottom-1"} ${
                pos.endsWith("left") ? "left-1" : pos.endsWith("right") ? "right-1" : "left-1/2 -translate-x-1/2"
              }`}
            >
              {startNumber}
            </span>
          ))}
        </div>
      </div>

      {status === "processing" && <ProgressBar progress={50} />}
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex items-center gap-3">
        {status !== "done" && (
          <button
            onClick={handleProcess}
            disabled={status === "processing"}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {status === "processing" ? "Processing…" : "Add Page Numbers"}
          </button>
        )}
        {result && (
          <DownloadButton
            blob={result}
            fileName={file.name.replace(/\.pdf$/i, "-numbered.pdf")}
          />
        )}
      </div>
    </div>
  );
}
