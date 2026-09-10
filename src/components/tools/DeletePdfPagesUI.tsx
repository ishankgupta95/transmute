"use client";

import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { deletePdfPages, getPageCount } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasFootnote, CanvasHeader, RangeField } from "@/components/tools/ToolCanvas";
import { PdfPageDeck, usePdfPageThumbnails } from "@/components/tools/PdfPagePicker";
import { ToolProgress } from "@/components/tools/ToolControls";
import { parsePageRange, toPageRange } from "@/lib/tools/media-preview";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

/*
  Same picker as split-pdf and extract-pdf-pages, INVERTED: here the selection
  is the set of pages that LEAVES. That inversion is the whole tool, and it is
  the one thing a user can get catastrophically wrong by assuming the usual
  meaning, so it is restated at every point the selection is visible — the
  deck badge, the canvas header's trailing stat, the aside's two-row readout,
  and the primary button's own label ("Delete 3 pages", never "Extract").

  The dimming is deliberately NOT inverted. `PageTile` dims what is *not*
  selected, and every other deck in the app reads that way; flipping it here
  would make one deck in three behave differently under the same interaction,
  which trades one confusion for a worse one. The red ✕ badge carries the
  meaning instead.
*/
export function DeletePdfPagesUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [rangeInput, setRangeInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);
  const thumbnails = usePdfPageThumbnails(file, pageCount);
  /*
    MEASURED DEFECT this ref exists to close: the invalidation below used to be
    `setStatus((s) => (s === "done" ? "idle" : s))` plus `setResult(null)`, and
    BOTH are inert while a run is in flight — status is "processing", so the
    ternary is a no-op, and there is no result yet to clear. `deletePdfPages`
    runs in a dedicated worker (`pdf-engine.ts` → `/workers/pdf.worker.js`), so
    the main thread is idle for the whole run and every tile stays clickable.
    A driven repro: select pages 1-2 on a 6-page PDF, press Delete, click page
    5 while it runs — the header read "3 PAGES WILL BE REMOVED", the aside read
    "Removing 3 of 6", and the offered `pages-removed.pdf` still contained page
    5, because the engine had only ever been handed [0,1].

    `PdfPageDeck` takes no `disabled` prop (it is shared with split-pdf and
    extract-pdf-pages), so the deck cannot be switched off from here. Rather
    than half-freeze the surface — range field off, tiles live — the rule is
    made uniform and authoritative: EVERY selection change cancels an in-flight
    run. Each run claims a generation before its first `await`; anything that
    moves the selection, swaps the file or resets bumps it, and a run whose
    generation is stale writes nothing. So a download is only ever offered for
    the selection currently on screen.
  */
  const runGenerationRef = useRef(0);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    // A delete still running against the OUTGOING file must not land on the
    // incoming one — it would offer `pages-removed.pdf` built from a document
    // the user has already replaced.
    runGenerationRef.current += 1;
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
    The RANGE field and the page deck are one control in two shapes, so every
    path writes both: clicking a page re-derives the notation, and committing
    the field re-derives the selection (and normalises what you typed, so
    `3,1,2` comes back as `1-3`).
  */
  const commitSelection = useCallback((pages: Set<number>) => {
    setSelectedPages(pages);
    setRangeInput(toPageRange([...pages].map((i) => i + 1)).replace("—", ""));
    // Single funnel for deck clicks, select-all/none and the RANGE field, so
    // these lines keep a finished document from outliving the selection that
    // produced it — and bring the Delete action back through the footer's
    // ternary so the new selection can actually be run.
    setResult(null);
    setElapsed(null);
    // Cancels a run in flight as well as dropping a finished one; see the
    // note on `runGenerationRef`. "processing" has to be listed explicitly —
    // the old `s === "done"` test was exactly the hole the defect went
    // through, because mid-run the status is never "done".
    runGenerationRef.current += 1;
    setStatus((s) => (s === "done" || s === "processing" ? "idle" : s));
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

  const removedCount = selectedPages.size;
  const remainingCount = pageCount - removedCount;
  /*
    `deletePdfPages` will happily hand back a real, structurally valid 0-page
    PDF when every page is selected — that is deliberate in the engine and it
    is unit-tested there. It is also a file no reader will open, so the guard
    lives HERE, in the only layer that knows the user did not mean it.
  */
  const wouldEmptyDocument = pageCount > 0 && remainingCount === 0;

  const handleDelete = useCallback(async () => {
    if (!file || selectedPages.size === 0 || selectedPages.size >= pageCount) return;
    // Claimed BEFORE the first await. `commitSelection`, `handleFiles` and
    // `handleReset` all bump the same counter, so a mismatch on the way out
    // means "the thing this run was for is gone" — drop the bytes silently
    // rather than publishing a download for a selection nobody is looking at.
    const generation = (runGenerationRef.current += 1);
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const freshData = new Uint8Array(await file.arrayBuffer());
      const indices = Array.from(selectedPages).sort((a, b) => a - b);
      const bytes = await deletePdfPages(freshData, indices);
      if (runGenerationRef.current !== generation) return;
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // An abandoned run's failure is not the user's problem either — the
      // selection it failed on is no longer the one on screen, and surfacing
      // it would put an error box over a perfectly valid new selection.
      if (runGenerationRef.current !== generation) return;
      setError(err instanceof Error ? err.message : "Failed to delete pages");
      setStatus("error");
    }
  }, [file, selectedPages, pageCount]);

  const handleReset = useCallback(() => {
    // Same reason as `handleFiles`: a run in flight must not resolve onto the
    // empty drop zone and re-populate it with the previous file's output.
    runGenerationRef.current += 1;
    setFile(null);
    setPageCount(0);
    setSelectedPages(new Set());
    setRangeInput("");
    setResult(null);
    setElapsed(null);
    setStatus("idle");
    setError(null);
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <>
      {/* ── Canvas: the page deck, and which ones are doomed ─── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={`${pageCount} PAGE${pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`}
          // Not "SELECTED" — the word that matters is what happens to them.
          trailing={`${removedCount} PAGES WILL BE REMOVED`}
        />

        <PdfPageDeck
          pageCount={pageCount}
          selected={selectedPages}
          onToggle={togglePage}
          thumbnails={thumbnails}
          // A visual badge is invisible to a screen reader once the tile
          // carries an aria-label, so the label says it too. The `Page N`
          // prefix stays — the shared deck's locators depend on it.
          tileLabel={(idx, isSelected) =>
            isSelected ? `Page ${idx + 1}, will be removed` : `Page ${idx + 1}, will be kept`
          }
          renderBadge={(_, isSelected) =>
            isSelected ? (
              <span className="absolute top-1 right-1 rounded-sm bg-[rgba(12,14,23,.72)] p-0.5">
                <X size={11} className="text-error" aria-hidden="true" />
              </span>
            ) : undefined
          }
        />

        <RangeField
          value={rangeInput}
          onChange={setRangeInput}
          onApply={applyRange}
          hint="Type the pages to remove, or click them — the two stay in sync."
          // Until the page count is read these controls can only produce an
          // empty selection — `parsePageRange(x, 0)` and `Array.from({length:
          // 0})` both come back empty — so they silently ate the input.
          disabled={status === "processing" || pageCount === 0}
        />

        {wouldEmptyDocument && (
          <WarningMessage
            message={`All ${pageCount} pages are marked for removal. A PDF with no pages cannot be opened by any reader, so leave at least one page behind.`}
          />
        )}

        {/*
          True of the implementation: `deletePdfPages` grafts the surviving
          pages across with pdf-lib's `copyPages`, so their fonts, images and
          layout come over untouched — but that graft does not carry
          `/Outlines`, which is why bookmarks are called out here rather than
          left for someone to discover in the output. Same caveat merge and
          split state.
        */}
        <CanvasFootnote>
          THE PAGES YOU KEEP ARE COPIED WHOLE — FONTS, IMAGES AND FORMATTING SURVIVE EXACTLY ·
          BOOKMARKS AND THE DOCUMENT OUTLINE ARE NOT CARRIED OVER
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "loading" || status === "processing") && (
              <ToolProgress
                phase={status === "loading" ? "READING PAGES" : "REMOVING PAGES"}
                percent={null}
                label={status === "loading" ? "Reading pages" : "Removing pages"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName="pages-removed.pdf"
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing"
                    ? "Removing…"
                    : `Delete ${removedCount} page${removedCount !== 1 ? "s" : ""}`
                }
                onPrimary={handleDelete}
                // Deleting is destructive in intent even though the original
                // file is never touched, so the primary wears the doc's
                // destructive treatment rather than the accent.
                tone="danger"
                primaryDisabled={
                  removedCount === 0 || wouldEmptyDocument || status === "processing"
                }
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="PAGES TO REMOVE">
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
          <p className="m-0 font-body text-[11px] leading-[1.4] text-text-muted">
            Pages you pick are the ones taken out. Everything else stays, in its original order.
          </p>
          <ToolOutput
            rows={[
              ["Removing", `${removedCount} of ${pageCount}`],
              ["Remaining", `${Math.max(remainingCount, 0)} of ${pageCount}`],
              ["Output", result ? "pages-removed.pdf" : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
