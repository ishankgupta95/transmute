"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { splitPdf, getPageCount } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, RangeField } from "@/components/tools/ToolCanvas";
import { PdfPageDeck, usePdfPageThumbnails } from "@/components/tools/PdfPagePicker";
import { ToolProgress } from "@/components/tools/ToolControls";
import { parsePageRange, toPageRange } from "@/lib/tools/media-preview";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

export function SplitPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [rangeInput, setRangeInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);
  const thumbnails = usePdfPageThumbnails(file, pageCount);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus("loading");
    setError(null);
    setSelectedPages(new Set());
    setRangeInput("");
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

        <PdfPageDeck
          pageCount={pageCount}
          selected={selectedPages}
          onToggle={togglePage}
          thumbnails={thumbnails}
        />

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
