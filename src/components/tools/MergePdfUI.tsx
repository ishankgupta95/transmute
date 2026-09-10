"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { mergePdfs, getPageCount } from "@/lib/tools/pdf-engine";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, DocCard, DocStrip, StatStrip } from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { chipClass, CANVAS_COLUMN } from "@/components/workspace/shared";

interface PdfEntry {
  file: File;
  pageCount: number | null;
}

/**
 * The doc's `Add PDF` slot at the end of the assembly strip:
 * `border-radius:8px;border:1px dashed var(--color-neutral-700);gap:8px;
 * color:var(--color-neutral-600)` with a 20px `+` and an 11px label.
 *
 * Width matches `DocCard`'s `w-44` (the doc's 176px). Height is inherited
 * rather than restated — `DocStrip` is a stretch row, so the slot tracks
 * whatever height the real cards have and cannot drift away from them.
 *
 * Duplicated (not exported) in `ImagesToPdfUI`: importing it across two tool
 * UIs would pull one tool's chunk into the other's route bundle.
 */
const ADD_SLOT_CLASS =
  "flex w-44 flex-none cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-neutral-700 text-text-muted transition-colors duration-200 hover:border-accent/50 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function MergePdfUI() {
  const [entries, setEntries] = useState<PdfEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Which card the Move left / Move right buttons act on — the touch path,
  // where there is no drag-and-drop and no keyboard.
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // One id for the sr-only instructions every card points at, so the keyboard
  // path is discoverable from the card itself and not only from the header.
  const hintId = useId();
  const addInputRef = useRef<HTMLInputElement>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  const handleFiles = useCallback(async (files: File[]) => {
    const newEntries: PdfEntry[] = [];
    for (const file of files) {
      let pageCount: number | null = null;
      try {
        const buf = await file.arrayBuffer();
        pageCount = await getPageCount(buf);
      } catch {
        // ignore
      }
      newEntries.push({ file, pageCount });
    }
    setEntries((prev) => [...prev, ...newEntries]);
    setResult(null);
    setElapsed(null);
    setStatus("idle");
  }, []);

  const removeEntry = useCallback((idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
    setResult(null);
    setElapsed(null);
    setStatus("idle");
    // The Move buttons would otherwise keep pointing at a slot that now holds
    // a different document.
    setFocusedIdx(null);
  }, []);

  /*
    One mover for all three input paths — drag, ← / →, and the Move buttons.
    Reordering also drops any saved merge: the footer swaps the primary action
    out for a Download the moment `result` is set, so without this the button
    keeps offering a PDF in the order the user has just moved away from.
  */
  const move = useCallback(
    (from: number, to: number) => {
      // A keyboard can reach the cards mid-run, which drag never could; moving
      // then would clear the progress readout and re-arm the primary.
      if (status === "processing") return;
      setEntries((prev) => {
        if (to < 0 || to >= prev.length || from === to) return prev;
        const updated = [...prev];
        const [item] = updated.splice(from, 1);
        updated.splice(to, 0, item);
        return updated;
      });
      setResult(null);
      setElapsed(null);
      setStatus("idle");
    },
    [status],
  );

  /**
   * Bring a card back under the caret after React has re-ordered the DOM.
   *
   * The slot attribute carries this instance's `useId` prefix, so the frame
   * that lands after an unmount finds nothing rather than pulling focus into
   * whatever tree replaced it.
   */
  const refocusCard = useCallback(
    (position: number) => {
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`[data-doc-slot="${hintId}${position}"]`)
          ?.focus();
      });
    },
    [hintId],
  );

  /** The keyboard / Move-button path. Drag goes through `handleDragOver`. */
  const moveEntry = useCallback(
    (from: number, to: number) => {
      if (to < 0 || to >= entries.length || from === to) return;
      const name = entries[from].file.name;
      move(from, to);
      setFocusedIdx(to);
      setAnnouncement(`${name} moved to position ${to + 1} of ${entries.length}.`);
      refocusCard(to);
    },
    [entries, move, refocusCard],
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
    // Add and remove already clear the previous merge; a reorder must too,
    // or the download button keeps offering a PDF in the old page order.
    move(dragIdx, idx);
    setDragIdx(idx);
  }, [dragIdx, move]);

  const handleMerge = useCallback(async () => {
    if (entries.length < 2) return;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const buffers = await Promise.all(entries.map((e) => e.file.arrayBuffer()));
      const merged = await mergePdfs(buffers);
      setResult(new Blob([merged as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to merge PDFs");
      setStatus("error");
    }
  }, [entries]);

  const handleReset = useCallback(() => {
    setEntries([]);
    setResult(null);
    setElapsed(null);
    setStatus("idle");
    setError(null);
    setFocusedIdx(null);
    setAnnouncement("");
  }, []);

  const totalPages = entries.reduce((n, e) => n + (e.pageCount ?? 0), 0);

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <DropZone accept=".pdf" multiple onFiles={handleFiles} disabled={status === "processing"} />

        <p className="text-xs text-text-muted">
          Merge combines whole files in the order below. To reorder or delete individual{" "}
          <em>pages</em> within a PDF, use{" "}
          <Link
            href="/pdf-page-reorder"
            className="text-accent underline hover:text-accent-hover"
          >
            Reorder PDF Pages
          </Link>
          .
        </p>

        {entries.length > 0 && (
          <>
            {/* A section title rather than a filename; the counts stay in the
                muted `meta` slot they already sat in, beside the title. */}
            <CanvasHeader
              file="Assembly order"
              meta={
                `DRAG TO REORDER · ${entries.length} DOCS` +
                (totalPages ? ` · ${totalPages} PAGES` : "")
              }
              // The keyboard path goes in the trailing slot, not into `meta`:
              // the identical strip in ImagesToPdfUI has its `meta` string
              // addressed verbatim by five E2E assertions across two spec
              // files, and the two headers are deliberately the same shape.
              trailing="DRAG OR USE ← →"
            />

            <DocStrip>
              {entries.map((entry, idx) => (
                <DocCard
                  key={`${entry.file.name}-${idx}`}
                  index={idx + 1}
                  name={entry.file.name}
                  meta={formatFileSize(entry.file.size)}
                  badge={entry.pageCount !== null ? `${entry.pageCount} p` : undefined}
                  onRemove={() => removeEntry(idx)}
                  /*
                    Everything below the drag handlers is the non-mouse path.
                    HTML5 drag never fires from a finger and never reaches a
                    keyboard, so drag alone made the tool's one function —
                    choosing the order — unusable without a mouse. Ported from
                    PdfPageReorderUI, which solved the same problem; the props
                    ride in through `draggableProps` because `DocCard` spreads
                    it straight onto the card element.
                  */
                  draggableProps={{
                    draggable: true,
                    "data-doc-slot": `${hintId}${idx}`,
                    role: "group",
                    tabIndex: 0,
                    "aria-label": `${entry.file.name}, position ${idx + 1} of ${entries.length}`,
                    "aria-describedby": hintId,
                    onDragStart: (e: React.DragEvent) => handleDragStart(e, idx),
                    onDragOver: (e: React.DragEvent) => handleDragOver(e, idx),
                    onDragEnd: () => setDragIdx(null),
                    onFocus: () => setFocusedIdx(idx),
                    // Tapping a card makes it the one the Move buttons act on —
                    // a div does not take focus from a tap on its own. The card's
                    // own Remove button must not also select the card it deletes.
                    onClick: (e: React.MouseEvent<HTMLElement>) => {
                      if ((e.target as HTMLElement).closest("button")) return;
                      e.currentTarget.focus();
                    },
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                      e.preventDefault();
                      moveEntry(idx, idx + (e.key === "ArrowRight" ? 1 : -1));
                    },
                  }}
                />
              ))}

              {/* The doc's `Add PDF` slot, wired to a real picker. */}
              <button
                type="button"
                onClick={() => addInputRef.current?.click()}
                disabled={status === "processing"}
                className={ADD_SLOT_CLASS}
              >
                <span aria-hidden="true" className="text-[20px] leading-none font-light">
                  +
                </span>
                <span className="font-body text-[11px] leading-none">Add PDF</span>
              </button>
              <input
                ref={addInputRef}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  if (picked.length) void handleFiles(picked);
                  // Same file twice in a row must still fire a change event.
                  e.target.value = "";
                }}
              />
            </DocStrip>

            <StatStrip
              stats={[
                // The doc's labels are DOCUMENTS / PAGES OUT / SIZE (EST.) /
                // BOOKMARKS KEPT. The first two ship verbatim. The estimate is
                // replaced by two measured facts, and BOOKMARKS is NOT shown:
                // `copyDocInfo` in pdf-engine-core deliberately does not graft
                // the /Outlines tree, so "KEPT" would be false.
                { label: "DOCUMENTS", value: String(entries.length), tone: "neutral" },
                { label: "PAGES OUT", value: totalPages ? String(totalPages) : "—" },
                {
                  label: "SIZE IN",
                  value: formatFileSize(entries.reduce((n, e) => n + e.file.size, 0)),
                  tone: "neutral",
                },
                {
                  label: "SIZE OUT",
                  value: result ? formatFileSize(result.size) : "—",
                  tone: "ok",
                },
              ]}
            />
            <span id={hintId} className="sr-only">
              Press the left or right arrow key to move this document one place
              in the merge order, or use the Move left and Move right buttons in
              the settings panel.
            </span>
            <span aria-live="polite" className="sr-only">
              {announcement}
            </span>
          </>
        )}

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer, above
                the primary — not under the canvas, far from the button that
                started the run. */}
            {status === "processing" && (
              <ToolProgress phase="MERGING" percent={null} label="Merging PDFs" />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton blob={result} fileName="merged.pdf" className="w-full justify-center" />
            ) : (
              <ToolActions
                /*
                  T-168 (the doc's `Merge 4 documents`) is deliberately NOT
                  applied here. Four E2E call-sites across three spec files —
                  one of them `conversion/workspace.spec.ts`, outside this
                  scope — address this button by `/Merge PDFs/`, and unlike
                  `Extract N pages` the count adds no fact the canvas is not
                  already showing (`DOCUMENTS n`). Raised as a copy change for
                  the owner rather than taken unilaterally.
                */
                primaryLabel={status === "processing" ? "Merging…" : "Merge PDFs"}
                onPrimary={handleMerge}
                primaryDisabled={entries.length < 2 || status === "processing"}
              />
            )}
            {entries.length > 0 && <ToolResetLink onClick={handleReset} label="START OVER" />}
          </>
        }
      >
        {entries.length > 1 && (
          <ToolAsideSection label="ORDER">
            {/* The touch fallback: HTML5 drag never fires from a finger, so on
                a phone these buttons are the only way to reorder at all.
                WCAG 2.5.7 — no function may require a dragging movement. */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => focusedIdx !== null && moveEntry(focusedIdx, focusedIdx - 1)}
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
                onClick={() => focusedIdx !== null && moveEntry(focusedIdx, focusedIdx + 1)}
                disabled={focusedIdx === null || focusedIdx >= entries.length - 1}
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
                ? "Tap or focus a document to move it, or drag it with a mouse."
                : `Moving ${entries[focusedIdx].file.name} (position ${focusedIdx + 1} of ${entries.length}).`}
            </span>
          </ToolAsideSection>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              // `ToolOutput` accents row index 1, so the headline fact — the
              // page count the merge produces — sits second, as the doc's
              // OUTPUT plate puts its emphasised value there.
              ["Documents", String(entries.length)],
              ["Pages out", totalPages ? String(totalPages) : "—"],
              ["Size in", formatFileSize(entries.reduce((n, e) => n + e.file.size, 0))],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {entries.length < 2
              ? "Add at least two PDFs to merge."
              : "Drag the cards in the canvas to set the order, or focus one and use ← / →."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
