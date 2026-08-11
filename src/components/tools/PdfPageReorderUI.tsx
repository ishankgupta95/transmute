"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { GripVertical } from "lucide-react";
import { reorderPdfPages, getPageCount, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, PageDeck, PageTile } from "@/components/tools/ToolCanvas";

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

  const restoreOrder = useCallback(() => {
    setOrder(Array.from({ length: pageCount }, (_, i) => i));
  }, [pageCount]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  const isReordered = order.some((origIdx, idx) => origIdx !== idx);

  return (
    <>
      {/* ── Canvas: the page deck you drag around ────────────── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={file.name}
          meta={`${pageCount} page${pageCount !== 1 ? "s" : ""}`}
          trailing={isReordered ? "ORDER CHANGED" : "DRAG TO REORDER"}
        />

        <PageDeck>
          {order.map((origIdx, idx) => (
            <PageTile
              key={origIdx}
              number={origIdx + 1}
              thumb={thumbnails[origIdx] || undefined}
              // Every page ships, so the deck reads all-selected — the drag
              // grip, not a selection ring, is what this deck is about.
              selected
              label={`Page ${origIdx + 1}, position ${idx + 1} of ${pageCount}`}
              className="cursor-grab active:cursor-grabbing"
              draggableProps={{
                draggable: true,
                onDragStart: () => handleDragStart(idx),
                onDragOver: (e: React.DragEvent) => handleDragOver(e, idx),
                onDragEnd: () => setDragIdx(null),
              }}
              badge={
                <span className="absolute top-1 left-1 rounded-sm bg-[rgba(12,14,23,.72)] p-0.5">
                  <GripVertical size={11} className="text-accent-200" aria-hidden="true" />
                </span>
              }
            />
          ))}
        </PageDeck>
        {pageCount > 50 && (
          <p className="m-0 font-mono text-[9.5px] leading-none tracking-[0.06em] text-text-muted">
            THUMBNAILS RENDERED FOR THE FIRST 50 OF {pageCount} PAGES — EVERY PAGE STAYS IN THE DECK AND REORDERABLE
          </p>
        )}

        {(status === "loading" || status === "processing") && <ProgressBar progress={null} />}
        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-reordered.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Reordering…" : "Save Reordered PDF"}
                onPrimary={handleReorder}
                primaryDisabled={order.length === 0 || status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="ORDER">
          <div className="flex gap-2">
            <button
              onClick={restoreOrder}
              disabled={!isReordered}
              className="cursor-pointer text-xs text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:text-text-muted"
            >
              Restore original order
            </button>
          </div>
          <ToolOutput
            rows={[
              ["Pages", String(pageCount)],
              ["Order", isReordered ? "changed" : "original"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The number on each thumbnail is its page in the source file, so you can always see
            where a page came from.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
