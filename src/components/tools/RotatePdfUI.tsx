"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { RotateCw } from "lucide-react";
import { rotatePdfPages, getPageCount, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";

export function RotatePdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [angle, setAngle] = useState(90);
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
    setThumbnails([]);
    thumbsLoadedRef.current = false;
    try {
      const buf = await f.arrayBuffer();
      const count = await getPageCount(buf);
      setPageCount(count);
      setSelectedPages(new Set(Array.from({ length: count }, (_, i) => i)));
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

  const selectAll = useCallback(() => {
    setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i)));
  }, [pageCount]);

  const selectNone = useCallback(() => {
    setSelectedPages(new Set());
  }, []);

  const handleRotate = useCallback(async () => {
    if (!file || selectedPages.size === 0) return;
    setStatus("processing");
    setError(null);
    try {
      const freshData = new Uint8Array(await file.arrayBuffer());
      const indices = Array.from(selectedPages).sort((a, b) => a - b);
      const bytes = await rotatePdfPages(freshData, indices, angle);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate PDF");
      setStatus("error");
    }
  }, [file, selectedPages, angle]);

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

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <label className="block text-xs text-text-muted mb-1">Rotation</label>
          <select
            value={angle}
            onChange={(e) => setAngle(Number(e.target.value))}
            className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value={90}>90° clockwise</option>
            <option value={180}>180°</option>
            <option value={270}>270° (90° counter-clockwise)</option>
          </select>
        </div>
        <div className="flex gap-2 self-end">
          <button onClick={selectAll} className="text-xs text-accent hover:text-accent-hover transition-colors">Select all</button>
          <button onClick={selectNone} className="text-xs text-text-muted hover:text-text-secondary transition-colors">Deselect all</button>
        </div>
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
                <div className="absolute top-1 right-1">
                  <RotateCw size={12} className="text-accent" />
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {(status === "loading" || status === "processing") && <ProgressBar progress={null} />}
      {error && <ErrorMessage message={error} />}

      <div className="flex items-center gap-3">
        {selectedPages.size > 0 && status !== "done" && (
          <button
            onClick={handleRotate}
            disabled={status === "processing"}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            <RotateCw size={14} />
            {status === "processing" ? "Rotating…" : `Rotate ${selectedPages.size} page${selectedPages.size !== 1 ? "s" : ""}`}
          </button>
        )}
        {result && (
          <DownloadButton
            blob={result}
            fileName={file.name.replace(/\.pdf$/i, "-rotated.pdf")}
          />
        )}
      </div>
    </div>
  );
}
