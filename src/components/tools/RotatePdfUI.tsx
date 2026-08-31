"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { RotateCw } from "lucide-react";
import { rotatePdfPages, getPageCount, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolChoice,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, PageDeck, PageTile } from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

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
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    (async () => {
      const freshBuf = await file.arrayBuffer();
      doc = await loadPdfjsDocument(freshBuf);
      const thumbs: string[] = [];
      try {
        for (let i = 1; i <= Math.min(pageCount, 50); i++) {
          // `break`, not `return` — the finally below has to run or the pdfjs
          // document stays pinned in its worker for the tab's lifetime.
          if (cancelled) break;
          try {
            const canvas = await renderPageFromDoc(doc, i, 0.3);
            thumbs.push(canvas.toDataURL("image/jpeg", 0.6));
          } catch {
            thumbs.push("");
          }
          // Publish in batches so the deck fills in as it renders rather than
          // staying blank for several seconds — same as the reorder deck.
          if (!cancelled && i % 5 === 0) setThumbnails([...thumbs]);
        }
        if (!cancelled) setThumbnails(thumbs);
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
    Anything that changes what a run would produce also drops the finished
    one. The footer swaps the primary action out for a Download the moment
    `result` is set, so leaving it in place would offer a file built from the
    previous selection with no way to re-run short of re-uploading.
  */
  const invalidate = useCallback(() => {
    setResult(null);
    setElapsed(null);
    setStatus((s) => (s === "done" ? "idle" : s));
  }, []);

  const togglePage = useCallback((idx: number) => {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
    invalidate();
  }, [invalidate]);

  const selectAll = useCallback(() => {
    setSelectedPages(new Set(Array.from({ length: pageCount }, (_, i) => i)));
    invalidate();
  }, [pageCount, invalidate]);

  const selectNone = useCallback(() => {
    setSelectedPages(new Set());
    invalidate();
  }, [invalidate]);

  const handleRotate = useCallback(async () => {
    if (!file || selectedPages.size === 0) return;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const freshData = new Uint8Array(await file.arrayBuffer());
      const indices = Array.from(selectedPages).sort((a, b) => a - b);
      const bytes = await rotatePdfPages(freshData, indices, angle);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
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
    setElapsed(null);
    setStatus("idle");
    setError(null);
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          // The doc's document-branch readout is a technical line, not prose:
          // "24 PAGES · 12.4 MB". The size was the fact the header was missing.
          meta={`${pageCount} PAGE${pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`}
          trailing={`${selectedPages.size} PAGES SELECTED`}
        />

        <PageDeck>
          {Array.from({ length: pageCount }, (_, idx) => (
            <PageTile
              key={idx}
              number={idx + 1}
              thumb={thumbnails[idx] || undefined}
              selected={selectedPages.has(idx)}
              // Same rule as the split deck: dimming means "left out of the
              // selection", which says nothing when the selection is empty.
              // Rotate opens with every page selected, but `Deselect all`
              // reaches the same all-grey state a split deck opens in.
              dimUnselected={selectedPages.size > 0}
              onClick={() => togglePage(idx)}
              badge={
                selectedPages.has(idx) ? (
                  <span className="absolute top-1 right-1 rounded-sm bg-[rgba(12,14,23,.72)] p-0.5">
                    <RotateCw size={11} className="text-accent" aria-hidden="true" />
                  </span>
                ) : undefined
              }
            />
          ))}
        </PageDeck>
        {pageCount > 50 && (
          <p className="m-0 font-mono text-[9.5px] leading-none tracking-[0.06em] text-text-muted">
            THUMBNAILS RENDERED FOR THE FIRST 50 OF {pageCount} PAGES — EVERY PAGE STAYS SELECTABLE
          </p>
        )}

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "READING PAGES" : "ROTATING"}
                percent={null}
                label={status === "loading" ? "Reading pages" : "Rotating pages"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-rotated.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing"
                    ? "Rotating…"
                    : `Rotate ${selectedPages.size} page${selectedPages.size !== 1 ? "s" : ""}`
                }
                onPrimary={handleRotate}
                primaryDisabled={selectedPages.size === 0 || status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        {/* One bordered block for the whole control set — the doc gives its
            own rule only to START FROM, ADVANCED and OUTPUT. */}
        <ToolControlGroup>
          <ToolControl label="ROTATION">
            <ToolChoice
              label="Rotation angle"
              fill
              value={angle}
              onChange={(v: number) => {
                setAngle(v);
                invalidate();
              }}
              options={[
                { value: 90, label: "90°" },
                { value: 180, label: "180°" },
                { value: 270, label: "270°" },
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Clockwise. 270° is the same as 90° counter-clockwise.
            </span>
          </ToolControl>

          <ToolControl label="PAGES">
            <div className="flex gap-2">
              {/* Before the page count is read, `Select all` can only build an
                  empty set — it looked live but silently cleared the auto
                  selection. */}
              <button
                onClick={selectAll}
                disabled={pageCount === 0}
                className="cursor-pointer text-xs text-accent transition-colors hover:text-accent-hover disabled:cursor-not-allowed disabled:text-text-muted"
              >
                Select all
              </button>
              <button
                onClick={selectNone}
                disabled={pageCount === 0}
                className="cursor-pointer text-xs text-text-muted transition-colors hover:text-text-secondary disabled:cursor-not-allowed"
              >
                Deselect all
              </button>
            </div>
            <ToolOutput
              rows={[
                ["Selected", `${selectedPages.size} of ${pageCount}`],
                ["Angle", `${angle}°`],
              ]}
            />
          </ToolControl>
        </ToolControlGroup>
      </ToolAside>
    </>
  );
}
