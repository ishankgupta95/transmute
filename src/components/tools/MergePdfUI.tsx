"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { GripVertical, X, FileText } from "lucide-react";
import { mergePdfs, getPageCount } from "@/lib/tools/pdf-engine";
import { formatFileSize } from "@/lib/utils/file-helpers";

interface PdfEntry {
  file: File;
  pageCount: number | null;
}

export function MergePdfUI() {
  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const handleFiles = useCallback(async (files: File[]) => {
    const newEntries: PdfEntry[] = [];
    for (const file of files) {
      let pageCount: number | null = null;
      try {
        const buf = await file.arrayBuffer();
        pageCount = await getPageCount(buf);
      } catch {
        // ignore
      }
      newEntries.push({ file, pageCount });
    }
    setEntries((prev) => [...prev, ...newEntries]);
    setResult(null);
    setStatus("idle");
  }, []);

  const removeEntry = useCallback((idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
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

  const handleMerge = useCallback(async () => {
    if (entries.length < 2) return;
    setStatus("processing");
    setError(null);
    try {
      const buffers = await Promise.all(entries.map((e) => e.file.arrayBuffer()));
      const merged = await mergePdfs(buffers);
      setResult(new Blob([merged as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge PDFs");
      setStatus("error");
    }
  }, [entries]);

  const handleReset = useCallback(() => {
    setEntries([]);
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      <DropZone accept=".pdf" multiple onFiles={handleFiles} />

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry, idx) => (
            <div
              key={`${entry.file.name}-${idx}`}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={() => setDragIdx(null)}
              className="flex items-center gap-3 rounded-lg border border-border bg-bg-secondary p-3 cursor-grab active:cursor-grabbing"
            >
              <GripVertical size={16} className="text-text-muted shrink-0" />
              <FileText size={18} className="text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">{entry.file.name}</p>
                <p className="text-xs text-text-muted">
                  {formatFileSize(entry.file.size)}
                  {entry.pageCount !== null && ` · ${entry.pageCount} page${entry.pageCount !== 1 ? "s" : ""}`}
                </p>
              </div>
              <button onClick={() => removeEntry(idx)} className="text-text-muted hover:text-error transition-colors">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {status === "processing" && <ProgressBar progress={null} />}
      {error && <ErrorMessage message={error} />}

      <div className="flex items-center gap-3">
        {entries.length >= 2 && status !== "done" && (
          <button
            onClick={handleMerge}
            disabled={status === "processing"}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {status === "processing" ? "Merging…" : "Merge PDFs"}
          </button>
        )}
        {result && <DownloadButton blob={result} fileName="merged.pdf" />}
        {entries.length > 0 && (
          <button onClick={handleReset} className="text-sm text-text-muted hover:text-text-secondary transition-colors">
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
