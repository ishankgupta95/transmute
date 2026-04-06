"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { GripVertical, X } from "lucide-react";
import { imagesToPdf, type PageSize } from "@/lib/tools/pdf-engine";

interface ImageEntry {
  file: File;
  url: string;
}

export function ImagesToPdfUI() {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const newEntries = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setEntries((prev) => [...prev, ...newEntries]);
    setResult(null);
    setStatus("idle");
  }, []);

  const removeEntry = useCallback((idx: number) => {
    setEntries((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
    setResult(null);
    setStatus("idle");
  }, []);

  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setEntries((prev) => {
      const updated = [...prev];
      const [item] = updated.splice(dragIdx, 1);
      updated.splice(idx, 0, item);
      return updated;
    });
    setDragIdx(idx);
  }, [dragIdx]);

  const handleConvert = useCallback(async () => {
    if (entries.length === 0) return;
    setStatus("processing");
    setError(null);
    try {
      const images = await Promise.all(
        entries.map(async (e) => {
          const bytes = new Uint8Array(await e.file.arrayBuffer());
          return { bytes, type: e.file.type };
        }),
      );
      const pdfBytes = await imagesToPdf(images, pageSize);
      setResult(new Blob([pdfBytes as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PDF");
      setStatus("error");
    }
  }, [entries, pageSize]);

  const handleReset = useCallback(() => {
    entries.forEach((e) => URL.revokeObjectURL(e.url));
    setEntries([]);
    setResult(null);
    setStatus("idle");
    setError(null);
  }, [entries]);

  return (
    <div className="space-y-6">
      <DropZone accept=".jpg,.jpeg,.png" multiple onFiles={handleFiles} />

      {entries.length > 0 && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {entries.map((entry, idx) => (
              <div
                key={`${entry.file.name}-${idx}`}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={() => setDragIdx(null)}
                className="relative rounded-lg border border-border overflow-hidden bg-bg-secondary cursor-grab active:cursor-grabbing group"
              >
                <img src={entry.url} alt={entry.file.name} className="w-full aspect-[3/4] object-cover" />
                <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVertical size={14} className="text-white drop-shadow" />
                </div>
                <button
                  onClick={() => removeEntry(idx)}
                  className="absolute top-1 right-1 bg-bg-primary/70 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-error"
                >
                  <X size={12} />
                </button>
                <span className="absolute bottom-0 left-0 right-0 bg-bg-primary/80 text-center text-xs text-text-secondary py-0.5">
                  {idx + 1}
                </span>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1">Page size</label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value as PageSize)}
              className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
              <option value="fit">Fit to Image</option>
            </select>
          </div>
        </>
      )}

      {status === "processing" && <ProgressBar progress={50} />}
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex items-center gap-3">
        {entries.length > 0 && status !== "done" && (
          <button
            onClick={handleConvert}
            disabled={status === "processing"}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {status === "processing" ? "Creating PDF…" : `Create PDF (${entries.length} image${entries.length !== 1 ? "s" : ""})`}
          </button>
        )}
        {result && <DownloadButton blob={result} fileName="images.pdf" />}
        {entries.length > 0 && (
          <button onClick={handleReset} className="text-sm text-text-muted hover:text-text-secondary transition-colors">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
