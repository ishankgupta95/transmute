"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { GripVertical } from "lucide-react";
import { reorderPdfPages, getPageCount, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";

export function PdfPageReorderUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [order, setOrder] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const thumbsLoadedRef = useRef(false);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus("loading");
    setError(null);
    setOrder([]);
    setThumbnails({});
    thumbsLoadedRef.current = false;
    try {
      const buf = await f.arrayBuffer();
      const count = await getPageCount(buf);
      setPageCount(count);
      setOrder(Array.from({ length: count }, (_, i) => i));
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PDF");
      setStatus("error");
    }
  }, []);

  // Render thumbnails once when file and pageCount are ready
  useEffect(() => {
    if (!file || pageCount === 0 || thumbsLoadedRef.current) return;
    thumbsLoadedRef.current = true;
    let cancelled = false;
    (async () => {
      // Re-read file for thumbnail rendering — avoids buffer detachment issues
      const freshBuf = await file.arrayBuffer();
      const doc = await loadPdfjsDocument(freshBuf);
      const thumbs: Record<number, string> = {};
      for (let i = 0; i < Math.min(pageCount, 50); i++) {
        if (cancelled) return;
        try {
          const canvas = await renderPageFromDoc(doc, i + 1, 0.3);
          thumbs[i] = canvas.toDataURL("image/jpeg", 0.6);
        } catch {
          // leave empty
        }
        if (!cancelled && (i + 1) % 5 === 0) {
          setThumbnails({ ...thumbs });
        }
      }
      if (!cancelled) setThumbnails({ ...thumbs });
    })();
    return () => { cancelled = true; };
  }, [file, pageCount]);

  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setOrder((prev) => {
      const updated = [...prev];
      const [item] = updated.splice(dragIdx, 1);
      updated.splice(idx, 0, item);
      return updated;
    });
    setDragIdx(idx);
  }, [dragIdx]);

  const handleReorder = useCallback(async () => {
    if (!file || order.length === 0) return;
    setStatus("processing");
    setError(null);
    try {
      // Re-read file fresh — File objects are never detachable
      const freshData = new Uint8Array(await file.arrayBuffer());
      const bytes = await reorderPdfPages(freshData, order);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reorder PDF");
      setStatus("error");
    }
  }, [file, order]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPageCount(0);
    setOrder([]);
    setThumbnails({});
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
          {file.name} — {pageCount} page{pageCount !== 1 ? "s" : ""}. Drag thumbnails to reorder.
        </p>
        <button onClick={handleReset} className="text-sm text-text-muted hover:text-text-secondary transition-colors">
          Change file
        </button>
      </div>

      {order.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
          {order.map((origIdx, idx) => (
            <div
              key={origIdx}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={() => setDragIdx(null)}
              className="relative rounded-md border-2 border-border hover:border-border-hover overflow-hidden bg-bg-secondary cursor-grab active:cursor-grabbing group"
            >
              {thumbnails[origIdx] ? (
                <img src={thumbnails[origIdx]} alt={`Page ${origIdx + 1}`} className="w-full" />
              ) : (
                <div className="aspect-[3/4] bg-bg-elevated flex items-center justify-center text-xs text-text-muted">
                  {origIdx + 1}
                </div>
              )}
              <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical size={12} className="text-white drop-shadow" />
              </div>
              <span className="absolute bottom-0 left-0 right-0 bg-bg-primary/80 text-center text-xs text-text-secondary py-0.5">
                {origIdx + 1}
              </span>
            </div>
          ))}
        </div>
      )}

      {(status === "loading" || status === "processing") && <ProgressBar progress={null} />}
      {error && <ErrorMessage message={error} />}

      <div className="flex items-center gap-3">
        {order.length > 0 && status !== "done" && (
          <button
            onClick={handleReorder}
            disabled={status === "processing"}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {status === "processing" ? "Reordering…" : "Save Reordered PDF"}
          </button>
        )}
        {result && (
          <DownloadButton
            blob={result}
            fileName={file.name.replace(/\.pdf$/i, "-reordered.pdf")}
          />
        )}
      </div>
    </div>
  );
}
