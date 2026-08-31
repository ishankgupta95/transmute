"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { splitPdf, getPageCount, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  PageDeck,
  PageTile,
  RangeField,
} from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { parsePageRange, toPageRange } from "@/lib/tools/media-preview";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

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
      /*
        The ref means "a thumbnail pass is in flight, or finished, for this
        file + page count". Tearing the effect down makes both false, so it
        has to clear HERE and not only in handleFiles / handleReset —
        otherwise any teardown-then-rerun of the same effect instance
        (StrictMode's mount double-invoke, Fast Refresh) leaves it stuck
        true, the re-run returns early, and the deck never fills in. Kept
        identical in RotatePdfUI and PdfPageReorderUI.
      */
      thumbsLoadedRef.current = false;
      void doc?.destroy();
    };
  }, [file, pageCount]);

  /*
    The doc's RANGE field and the page deck are one control in two shapes, so
    every path writes both: clicking a page re-derives the notation, and
    committing the field re-derives the selection (and normalises what you
    typed, so `3,1,2` comes back as `1-3`).
  */
  const commitSelection = useCallback((pages: Set<number>) => {
    setSelectedPages(pages);
    setRangeInput(toPageRange([...pages].map((i) => i + 1)).replace("—", ""));
    // Single funnel for deck clicks, select-all/none and the RANGE field, so
    // this one line keeps a finished split from outliving the selection that
    // produced it — and brings the Extract action back through the footer's
    // ternary so the new selection can actually be run.
    setResult(null);
    setElapsed(null);
    setStatus((s) => (s === "done" ? "idle" : s));
    setError(null);
  }, []);

  const togglePage = useCallback(
    (idx: number) => {
      // Read-then-write rather than a functional update: the updater must stay
      // pure, and `commitSelection` also writes the range field.
      const next = new Set(selectedPages);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      commitSelection(next);
    },
    [selectedPages, commitSelection],
  );

  const selectAll = useCallback(() => {
    commitSelection(new Set(Array.from({ length: pageCount }, (_, i) => i)));
  }, [pageCount, commitSelection]);

  const selectNone = useCallback(() => {
    commitSelection(new Set());
  }, [commitSelection]);

  const applyRange = useCallback(() => {
    const typed = rangeInput.trim();
    const parsed = parsePageRange(typed, pageCount);
    if (typed !== "" && parsed.size === 0) {
      // Committing an empty parse would blank both the selection AND the text
      // they typed (toPageRange([]) is "—", which the replace strips), which
      // is indistinguishable from the tool having eaten the input. Keep both
      // and say what went wrong instead.
      setError(
        `No pages matched "${typed}" — this PDF has ${pageCount} page${pageCount === 1 ? "" : "s"}. Try 1-${pageCount}.`,
      );
      return;
    }
    commitSelection(parsed);
  }, [rangeInput, pageCount, commitSelection]);

  const handleSplit = useCallback(async () => {
    if (!file || selectedPages.size === 0) return;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const freshData = new Uint8Array(await file.arrayBuffer());
      const indices = Array.from(selectedPages).sort((a, b) => a - b);
      const bytes = await splitPdf(freshData, indices);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
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
    setElapsed(null);
    setStatus("idle");
    setError(null);
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <>
      {/* ── Canvas: the page deck, and which ones you picked ─── */}
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
              // Dimming marks pages the selection has left out. With nothing
              // selected yet there is nothing to contrast against, so a freshly
              // loaded deck would grey out whole and read as disabled.
              dimUnselected={selectedPages.size > 0}
              onClick={() => togglePage(idx)}
            />
          ))}
        </PageDeck>
        {pageCount > 50 && (
          <p className="m-0 font-mono text-[9.5px] leading-none tracking-[0.06em] text-text-muted">
            THUMBNAILS RENDERED FOR THE FIRST 50 OF {pageCount} PAGES — EVERY PAGE STAYS SELECTABLE VIA THE RANGE FIELD
          </p>
        )}

        <RangeField
          value={rangeInput}
          onChange={setRangeInput}
          onApply={applyRange}
          // Until the page count is read these controls can only produce an
          // empty selection — `parsePageRange(x, 0)` and `Array.from({length:
          // 0})` both come back empty — so they silently ate the input.
          disabled={status === "processing" || pageCount === 0}
        />

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer, above the
                primary — not under the canvas, far from the button that started
                the run. */}
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "READING PAGES" : "EXTRACTING"}
                percent={null}
                label={status === "loading" ? "Reading pages" : "Extracting pages"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName="split.pdf"
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing"
                    ? "Splitting…"
                    : `Extract ${selectedPages.size} page${selectedPages.size !== 1 ? "s" : ""}`
                }
                onPrimary={handleSplit}
                primaryDisabled={selectedPages.size === 0 || status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="PAGES">
          <div className="flex gap-2">
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
              ["Output", result ? "split.pdf" : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
