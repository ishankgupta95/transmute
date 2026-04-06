"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { splitPdf, getPageCount, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";

export function SplitPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [rangeInput, setRangeInput] = useState("");
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thumbsLoadedRef = useRef(false);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus("loading");
    setError(null);
    setSelectedPages(new Set());
    setRangeInput("");
    setThumbnails([]);
    thumbsLoadedRef.current = false;
    try {
      const buf = await f.arrayBuffer();
      const count = await getPageCount(buf);
      setPageCount(count);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PDF");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!file || pageCount === 0 || thumbsLoadedRef.current) return;
    thumbsLoadedRef.current = true;
    let cancelled = false;
    (async () => {
      const freshBuf = await file.arrayBuffer();
      const doc = await loadPdfjsDocument(freshBuf);
      const thumbs: string[] = [];
      for (let i = 1; i <= Math.min(pageCount, 50); i++) {
        if (cancelled) return;
        try {
          const canvas = await renderPageFromDoc(doc, i, 0.3);
          thumbs.push(canvas.toDataURL("image/jpeg", 0.6));
        } catch {
          thumbs.push("");
        }
      }
      if (!cancelled) setThumbnails(thumbs);
    })();
    return () => { cancelled = true; };
  }, [file, pageCount]);

  const togglePage = useCallback((idx: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const parseRange = useCallback(() => {
    const pages = new Set<number>();
    for (const part of rangeInput.split(",")) {
      const trimmed = part.trim();
      const match = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);
        for (let i = start; i <= end && i <= pageCount; i++) {
          if (i >= 1) pages.add(i - 1);
        }
      } else {
        const n = parseInt(trimmed, 10);
        if (n >= 1 && n <= pageCount) pages.add(n - 1);
      }
    }
    setSelectedPages(pages);
  }, [rangeInput, pageCount]);

  const handleSplit = useCallback(async () => {
    if (!file || selectedPages.size === 0) return;
    setStatus("processing");
    setError(null);
    try {
      const freshData = new Uint8Array(await file.arrayBuffer());
      const indices = Array.from(selectedPages).sort((a, b) => a - b);
      const bytes = await splitPdf(freshData, indices);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to split PDF");
      setStatus("error");
    }
  }, [file, selectedPages]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setThumbnails([]);
    thumbsLoadedRef.current = false;
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          {file.name} — {pageCount} page{pageCount !== 1 ? "s" : ""}
        </p>
        <button onClick={handleReset} className="text-sm text-text-muted hover:text-text-secondary transition-colors">
          Change file
        </button>
      </div>

      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs text-text-muted mb-1">Page range (e.g. 1-3, 5, 8-10)</label>
          <input
            type="text"
            value={rangeInput}
            onChange={(e) => setRangeInput(e.target.value)}
            placeholder="1-3, 5, 8-10"
            className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>
        <button
          onClick={parseRange}
          className="rounded-md border border-border px-3 py-2 text-sm text-text-secondary hover:border-border-hover hover:bg-bg-hover transition-colors"
        >
          Apply
        </button>
      </div>

      {thumbnails.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
          {thumbnails.map((thumb, idx) => (
            <button
              key={idx}
              onClick={() => togglePage(idx)}
              className={`relative rounded-md border-2 overflow-hidden transition-colors ${
                selectedPages.has(idx) ? "border-accent" : "border-border hover:border-border-hover"
              }`}
            >
              {thumb ? (
                <img src={thumb} alt={`Page ${idx + 1}`} className="w-full" />
              ) : (
                <div className="aspect-[3/4] bg-bg-elevated flex items-center justify-center text-xs text-text-muted">
                  {idx + 1}
                </div>
              )}
              <span className="absolute bottom-0 left-0 right-0 bg-bg-primary/80 text-center text-xs text-text-secondary py-0.5">
                {idx + 1}
              </span>
              {selectedPages.has(idx) && (
                <div className="absolute inset-0 bg-accent/10" />
              )}
            </button>
          ))}
        </div>
      )}

      {(status === "loading" || status === "processing") && <ProgressBar progress={50} />}
      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex items-center gap-3">
        {selectedPages.size > 0 && status !== "done" && (
          <button
            onClick={handleSplit}
            disabled={status === "processing"}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {status === "processing" ? "Splitting…" : `Extract ${selectedPages.size} page${selectedPages.size !== 1 ? "s" : ""}`}
          </button>
        )}
        {result && <DownloadButton blob={result} fileName="split.pdf" />}
      </div>
    </div>
  );
}
