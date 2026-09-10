"use client";

import { useCallback, useMemo, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { getPageCount, splitPdf, splitPdfToPages } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasFootnote, CanvasHeader, RangeField } from "@/components/tools/ToolCanvas";
import { PdfPageDeck, usePdfPageThumbnails } from "@/components/tools/PdfPagePicker";
import { ToolProgress } from "@/components/tools/ToolControls";
import { parsePageRange, toPageRange } from "@/lib/tools/media-preview";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { downloadFilesAsZip } from "@/lib/utils/download";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

type OutputMode = "single" | "per-page";

/*
  What this tool has that `split-pdf` does not: the OUTPUT MODE.

  `splitPdf(data, indices)` is "selected pages → one document", which is
  exactly what split-pdf already does. The reason this page exists is the other
  half of the job — one document PER selected page — which `splitPdfToPages`
  does in a single parse and which no other tool here offers. The picker,
  the range field and the selection semantics are deliberately identical to
  split-pdf's (shared via PdfPagePicker); only the mode control and everything
  downstream of it differ.
*/

/** One finished document, named as it will be saved. */
interface OutFile {
  blob: Blob;
  name: string;
}

export function ExtractPdfPagesUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [rangeInput, setRangeInput] = useState("");
  const [mode, setMode] = useState<OutputMode>("single");
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">("idle");
  const [results, setResults] = useState<OutFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);
  const thumbnails = usePdfPageThumbnails(file, pageCount);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResults([]);
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
    The RANGE field and the page deck are one control in two shapes, so every
    path writes both: clicking a page re-derives the notation, and committing
    the field re-derives the selection (and normalises what you typed, so
    `3,1,2` comes back as `1-3`).
  */
  const commitSelection = useCallback((pages: Set<number>) => {
    setSelectedPages(pages);
    setRangeInput(toPageRange([...pages].map((i) => i + 1)).replace("—", ""));
    // Single funnel for deck clicks, select-all/none and the RANGE field, so
    // this one line keeps a finished extraction from outliving the selection
    // that produced it — and brings the Extract action back through the
    // footer's ternary so the new selection can actually be run.
    setResults([]);
    setElapsed(null);
    setStatus((s) => (s === "done" ? "idle" : s));
    setError(null);
  }, []);

  // The mode decides how many files come out, so it invalidates a finished run
  // exactly as hard as the selection does. Without this the footer would still
  // be offering the previous mode's download under the new mode's readout.
  const changeMode = useCallback((next: OutputMode) => {
    setMode(next);
    setResults([]);
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
      // they typed, which is indistinguishable from the tool having eaten the
      // input. Keep both and say what went wrong instead.
      setError(
        `No pages matched "${typed}" — this PDF has ${pageCount} page${pageCount === 1 ? "" : "s"}. Try 1-${pageCount}.`,
      );
      return;
    }
    commitSelection(parsed);
  }, [rangeInput, pageCount, commitSelection]);

  const selectedCount = selectedPages.size;

  /*
    How many files the current settings will actually produce, and what the
    save is called. `downloadFilesAsZip` hands over the bare file when the list
    has length 1 rather than zipping a single member — so a one-page per-page
    run saves `page-7.pdf`, NOT a ZIP, and the readout has to say that or the
    copy is a promise the download breaks.
  */
  const plannedName = useMemo(() => {
    if (selectedCount === 0) return "—";
    if (mode === "single") return "extracted-pages.pdf";
    if (selectedCount === 1) {
      const only = [...selectedPages][0];
      return `page-${only + 1}.pdf`;
    }
    return "extracted-pages.zip";
  }, [mode, selectedCount, selectedPages]);

  const plannedFileCount = mode === "single" ? (selectedCount > 0 ? 1 : 0) : selectedCount;

  const handleExtract = useCallback(async () => {
    if (!file || selectedPages.size === 0) return;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const freshData = new Uint8Array(await file.arrayBuffer());
      const indices = Array.from(selectedPages).sort((a, b) => a - b);
      if (mode === "single") {
        const bytes = await splitPdf(freshData, indices);
        setResults([
          {
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            name: "extracted-pages.pdf",
          },
        ]);
      } else {
        const docs = await splitPdfToPages(freshData, indices);
        // Named by SOURCE page number, not by position in the batch — picking
        // pages 3 and 9 gives page-3.pdf and page-9.pdf, which is the only
        // naming that survives being unzipped next to the original.
        setResults(
          docs.map((bytes, i) => ({
            blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
            name: `page-${indices[i] + 1}.pdf`,
          })),
        );
      }
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract pages");
      setStatus("error");
    }
  }, [file, selectedPages, mode]);

  const downloadAll = useCallback(() => {
    // One ZIP rather than N synchronous downloads — browsers throttle those
    // and only the first would save.
    void downloadFilesAsZip(results, "extracted-pages.zip");
  }, [results]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setRangeInput("");
    setResults([]);
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
          meta={`${pageCount} PAGE${pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`}
          trailing={`${selectedCount} PAGES SELECTED`}
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

        {/*
          True of the implementation: `splitPdf` / `splitPdfToPages` graft whole
          page objects across with pdf-lib's `copyPages`, so fonts, images and
          layout come over untouched — but that graft does not carry
          `/Outlines`, which is why bookmarks are called out here rather than
          left for someone to discover in the output. Same caveat merge and
          split state.
        */}
        <CanvasFootnote>
          PAGES ARE COPIED WHOLE — FONTS, IMAGES AND FORMATTING SURVIVE EXACTLY · BOOKMARKS AND
          THE DOCUMENT OUTLINE ARE NOT CARRIED OVER
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "READING PAGES" : "EXTRACTING"}
                percent={null}
                label={status === "loading" ? "Reading pages" : "Extracting pages"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {results.length === 1 ? (
              // One file, whichever mode produced it: hand it over directly.
              // Routing a single file through `downloadFilesAsZip` would save
              // it bare anyway, under a button that had promised a ZIP.
              <DownloadButton
                blob={results[0].blob}
                fileName={results[0].name}
                className="w-full justify-center"
              />
            ) : results.length > 1 ? (
              <ToolActions primaryLabel="Download all (ZIP)" onPrimary={downloadAll} />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing"
                    ? "Extracting…"
                    : `Extract ${selectedCount} page${selectedCount !== 1 ? "s" : ""}`
                }
                onPrimary={handleExtract}
                primaryDisabled={selectedCount === 0 || status === "processing"}
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
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolChoice
            label="Output mode"
            value={mode}
            onChange={changeMode}
            disabled={status === "processing"}
            options={[
              { value: "single" as const, label: "One PDF" },
              { value: "per-page" as const, label: "One per page" },
            ]}
          />
          <p className="m-0 font-body text-[11px] leading-[1.4] text-text-muted">
            {mode === "single"
              ? "One PDF containing the selected pages, in page order."
              : selectedCount === 1
                ? "A separate PDF for each selected page. One page is selected, so it downloads on its own rather than in a ZIP."
                : "A separate PDF for each selected page, delivered as a single ZIP."}
          </p>
          <ToolOutput
            rows={[
              ["Selected", `${selectedCount} of ${pageCount}`],
              [
                "Files out",
                `${plannedFileCount} file${plannedFileCount !== 1 ? "s" : ""}`,
              ],
              ["Output", plannedName],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
