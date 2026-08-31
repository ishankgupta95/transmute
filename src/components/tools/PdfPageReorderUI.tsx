"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { GripVertical } from "lucide-react";
import { reorderPdfPages, getPageCount, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, PageDeck, PageTile } from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { chipClass, CANVAS_COLUMN } from "@/components/workspace/shared";

export function PdfPageReorderUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [order, setOrder] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Which tile the Move left / Move right buttons act on — the touch path,
  // where there is no drag-and-drop and no keyboard.
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const thumbsLoadedRef = useRef(false);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

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
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    (async () => {
      // Re-read file for thumbnail rendering — avoids buffer detachment issues
      const freshBuf = await file.arrayBuffer();
      doc = await loadPdfjsDocument(freshBuf);
      const thumbs: Record<number, string> = {};
      try {
        for (let i = 0; i < Math.min(pageCount, 50); i++) {
          // `break`, not `return` — the finally below has to run or the pdfjs
          // document stays pinned in its worker for the tab's lifetime.
          if (cancelled) break;
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
      } finally {
        await doc.destroy();
        doc = null;
      }
    })();
    return () => {
      cancelled = true;
      // Cleared on teardown, not only in handleFiles / handleReset — see the
      // note on the identical effect in SplitPdfUI.
      thumbsLoadedRef.current = false;
      void doc?.destroy();
    };
  }, [file, pageCount]);

  /*
    One mover for both input paths. Reordering also drops any saved result:
    the footer swaps the primary action out for a Download the moment
    `result` is set, so without this the button keeps offering a PDF in the
    page order the user has just moved away from, with no way to re-run.
  */
  const move = useCallback((from: number, to: number) => {
    setOrder((prev) => {
      if (to < 0 || to >= prev.length || from === to) return prev;
      const updated = [...prev];
      const [item] = updated.splice(from, 1);
      updated.splice(to, 0, item);
      return updated;
    });
    setResult(null);
    setElapsed(null);
    setStatus((st) => (st === "done" ? "idle" : st));
  }, []);

  /** Bring a tile back under the caret after React has re-ordered the DOM. */
  const refocusPage = useCallback((origIdx: number) => {
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-reorder-page="${origIdx}"]`)
        ?.focus();
    });
  }, []);

  const movePage = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= order.length || from === to) return;
      const origIdx = order[from];
      move(from, to);
      setFocusedIdx(to);
      setAnnouncement(
        `Page ${origIdx + 1} moved to position ${to + 1} of ${order.length}.`,
      );
      refocusPage(origIdx);
    },
    [order, move, refocusPage],
  );

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    // Firefox refuses to start a drag until the payload is seeded. Optional
    // because a synthetic dragstart (tests, some a11y tooling) carries none.
    e.dataTransfer?.setData("text/plain", String(idx));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    move(dragIdx, idx);
    setDragIdx(idx);
  }, [dragIdx, move]);

  const handleReorder = useCallback(async () => {
    if (!file || order.length === 0) return;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      // Re-read file fresh — File objects are never detachable
      const freshData = new Uint8Array(await file.arrayBuffer());
      const bytes = await reorderPdfPages(freshData, order);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
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
    setElapsed(null);
    setStatus("idle");
    setError(null);
    setFocusedIdx(null);
    setAnnouncement("");
  }, []);

  const restoreOrder = useCallback(() => {
    setOrder(Array.from({ length: pageCount }, (_, i) => i));
    setResult(null);
    setElapsed(null);
    setStatus((st) => (st === "done" ? "idle" : st));
    setAnnouncement("Original page order restored.");
  }, [pageCount]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  const isReordered = order.some((origIdx, idx) => origIdx !== idx);

  return (
    <>
      {/* ── Canvas: the page deck you drag around ────────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          // The doc's document-branch readout is a technical line, not prose:
          // "24 PAGES · 12.4 MB". The size was the fact the header was missing.
          meta={`${pageCount} PAGE${pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`}
          trailing={isReordered ? "ORDER CHANGED" : "DRAG OR USE ← →"}
        />

        {/* A listbox, so the tiles are real options and the arrow keys have
            somewhere to live. HTML5 drag never fires from touch and never
            reaches a keyboard, so drag alone made the tool's one function
            unusable on a phone or with a screen reader. */}
        <PageDeck label="Page order">
          {order.map((origIdx, idx) => (
            <PageTile
              key={origIdx}
              number={origIdx + 1}
              thumb={thumbnails[origIdx] || undefined}
              // Every page ships, so the deck reads all-selected — the drag
              // grip, not a selection ring, is what this deck is about.
              selected
              interactive
              label={`Page ${origIdx + 1}, position ${idx + 1} of ${pageCount}`}
              className="cursor-grab active:cursor-grabbing"
              draggableProps={{
                draggable: true,
                "data-reorder-page": origIdx,
                onDragStart: (e: React.DragEvent) => handleDragStart(e, idx),
                onDragOver: (e: React.DragEvent) => handleDragOver(e, idx),
                onDragEnd: () => setDragIdx(null),
                onFocus: () => setFocusedIdx(idx),
                // Tapping a tile makes it the one the Move buttons act on —
                // a div does not take focus from a tap on its own.
                onClick: (e: React.MouseEvent<HTMLElement>) => e.currentTarget.focus(),
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                  e.preventDefault();
                  movePage(idx, idx + (e.key === "ArrowRight" ? 1 : -1));
                },
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

        <span aria-live="polite" className="sr-only">
          {announcement}
        </span>

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "READING PAGES" : "REORDERING"}
                percent={null}
                label={status === "loading" ? "Reading pages" : "Reordering pages"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
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
          {/* The touch fallback: HTML5 drag never fires from a finger, so on a
              phone these buttons are the only way to reorder at all. */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => focusedIdx !== null && movePage(focusedIdx, focusedIdx - 1)}
              disabled={focusedIdx === null || focusedIdx === 0}
              className={chipClass(
                false,
                "flex-1 rounded-[6px] px-2 py-[7px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-45",
              )}
            >
              Move left
            </button>
            <button
              type="button"
              onClick={() => focusedIdx !== null && movePage(focusedIdx, focusedIdx + 1)}
              disabled={focusedIdx === null || focusedIdx >= order.length - 1}
              className={chipClass(
                false,
                "flex-1 rounded-[6px] px-2 py-[7px] text-[11.5px] disabled:cursor-not-allowed disabled:opacity-45",
              )}
            >
              Move right
            </button>
          </div>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {focusedIdx === null
              ? "Tap or focus a page to move it, or drag it with a mouse."
              : `Moving page ${order[focusedIdx] + 1} (position ${focusedIdx + 1} of ${order.length}).`}
          </span>
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
            where a page came from. With a keyboard, focus a page and use ← / → to move it.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
