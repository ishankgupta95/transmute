"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { splitPdf, getPageCount, loadPdfjsDocument, renderPageFromDoc } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  PageDeck,
  PageTile,
  RangeField,
} from "@/components/tools/ToolCanvas";
import { parsePageRange, toPageRange } from "@/lib/tools/media-preview";

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

  /*
    The doc's RANGE field and the page deck are one control in two shapes, so
    every path writes both: clicking a page re-derives the notation, and
    committing the field re-derives the selection (and normalises what you
    typed, so `3,1,2` comes back as `1-3`).
  */
  const commitSelection = useCallback((pages: Set<number>) => {
    setSelectedPages(pages);
    setRangeInput(toPageRange([...pages].map((i) => i + 1)).replace("—", ""));
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
    commitSelection(parsePageRange(rangeInput, pageCount));
  }, [rangeInput, pageCount, commitSelection]);

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
    <>
      {/* ── Canvas: the page deck, and which ones you picked ─── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={file.name}
          meta={`${pageCount} page${pageCount !== 1 ? "s" : ""}`}
          trailing={`${selectedPages.size} PAGES SELECTED`}
        />

        <PageDeck>
          {Array.from({ length: pageCount }, (_, idx) => (
            <PageTile
              key={idx}
              number={idx + 1}
              thumb={thumbnails[idx] || undefined}
              selected={selectedPages.has(idx)}
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
          disabled={status === "processing"}
        />

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
              className="cursor-pointer text-xs text-accent transition-colors hover:text-accent-hover"
            >
              Select all
            </button>
            <button
              onClick={selectNone}
              className="cursor-pointer text-xs text-text-muted transition-colors hover:text-text-secondary"
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
