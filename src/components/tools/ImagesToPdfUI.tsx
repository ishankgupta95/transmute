"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { imagesToPdf, type PageSize } from "@/lib/tools/pdf-engine";
import { prepareForPdf, type PreparedPage } from "@/lib/tools/images-to-pdf-prep";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasHeader, DocCard, DocStrip, StatStrip } from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

interface ImageEntry {
  file: File;
  url: string;
  /** PDF-ready bytes, one per output page — a 3-page TIFF carries 3. */
  pages: PreparedPage[];
  warnings: string[];
}

/**
 * The doc's `Add PDF` slot at the end of the assembly strip, here as
 * `Add image`: `border-radius:8px;border:1px dashed var(--color-neutral-700);
 * gap:8px;color:var(--color-neutral-600)` with a 20px `+` and an 11px label.
 * Width matches `DocCard`'s `w-44` (the doc's 176px); height is inherited
 * rather than restated — `DocStrip` is a stretch row, so the slot tracks the
 * real cards instead of naming a second, drifting number.
 *
 * Duplicated (not imported) from `MergePdfUI`: sharing it across two tool UIs
 * would pull one tool's chunk into the other's route bundle.
 */
const ADD_SLOT_CLASS =
  "flex w-44 flex-none cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-neutral-700 text-text-muted transition-colors duration-200 hover:border-accent/50 hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

interface ImagesToPdfUIProps {
  /**
   * The registry's `acceptFormats` for whichever slug mounted this UI — the
   * parent takes the whole family, the format children (jpg/png/heic/webp/
   * tiff-to-pdf) narrow it. Both accept sites below read this prop.
   */
  acceptFormats: string;
}

export function ImagesToPdfUI({ acceptFormats }: ImagesToPdfUIProps) {
  const [entries, setEntries] = useState<ImageEntry[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    Files are prepared AT ADD TIME (`prepareForPdf`): page counts and frame
    warnings land on the assembly strip before Create PDF is pressed, and
    Create PDF itself is a flatten + engine call. Sequential on purpose — the
    prep decodes whole images (every page of a TIFF), and racing a multi-file
    drop in parallel would spike memory.
  */
  // Flipped on unmount so an in-flight prep batch stops and cleans up after
  // itself instead of leaking object URLs into a component that is gone.
  const disposedRef = useRef(false);

  const prepareAndAdd = useCallback(async (files: File[]) => {
    setError(null);
    const added: ImageEntry[] = [];
    const failures: string[] = [];
    for (const file of files) {
      // Prep is async, so the component can unmount mid-batch; the setEntries
      // below would then no-op and every URL created here would leak.
      if (disposedRef.current) break;
      try {
        const prepared = await prepareForPdf(file);
        const first = prepared.pages[0];
        added.push({
          file,
          // Thumb from the PREPARED first page, not the original bytes —
          // the original may be HEIC or TIFF, which <img> cannot paint.
          url: URL.createObjectURL(new Blob([first.bytes as BlobPart], { type: first.type })),
          pages: prepared.pages,
          warnings: prepared.warnings,
        });
      } catch (err) {
        failures.push(err instanceof Error ? err.message : `Could not read ${file.name}`);
      }
    }
    /*
      One append per drop, after every file has prepared: appending file by
      file would enable Create PDF between file 1 and file 2 of the same
      selection, letting a fast click build a PDF missing the rest. The
      invalidation still runs here (not just up front) so a built PDF cannot
      survive a batch that lands after a slow decode.
    */
    if (disposedRef.current) {
      added.forEach((e) => URL.revokeObjectURL(e.url));
      return;
    }
    if (added.length > 0) {
      setEntries((prev) => [...prev, ...added]);
      setResult(null);
      setElapsed(null);
      setStatus("idle");
    }
    // A rejected file is skipped, never a blocker — the good files stand.
    if (failures.length > 0) {
      setError(
        failures.length > 1
          ? `${failures.length} files failed — first error: ${failures[0]}`
          : failures[0],
      );
    }
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      void prepareAndAdd(files);
    },
    [prepareAndAdd],
  );

  const removeEntry = useCallback((idx: number) => {
    setEntries((prev) => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
    setResult(null);
    setElapsed(null);
    setStatus("idle");
  }, []);

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
    setEntries((prev) => {
      const updated = [...prev];
      const [item] = updated.splice(dragIdx, 1);
      updated.splice(idx, 0, item);
      return updated;
    });
    setDragIdx(idx);
    // Add and remove already invalidate the built PDF; a reorder must too, or
    // the download button keeps serving a document in the old page order.
    // A multi-page entry moves as a unit — its pages stay contiguous.
    setResult(null);
    setElapsed(null);
    setStatus("idle");
  }, [dragIdx]);

  const handleConvert = useCallback(async () => {
    if (entries.length === 0) return;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      // Entries were prepared at add time; flatten their pages in strip order.
      const images = entries.flatMap((e) =>
        e.pages.map((p) => ({ bytes: p.bytes, type: p.type })),
      );
      const pdfBytes = await imagesToPdf(images, pageSize);
      setResult(new Blob([pdfBytes as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PDF");
      setStatus("error");
    }
  }, [entries, pageSize]);

  const handleReset = useCallback(() => {
    entries.forEach((e) => URL.revokeObjectURL(e.url));
    setEntries([]);
    setResult(null);
    setElapsed(null);
    setStatus("idle");
    setError(null);
  }, [entries]);

  /*
    The thumbnails' object URLs outlive a client-side navigation otherwise:
    /workspace remounts the tool by key, which is an unmount without a reset,
    so every blob stays pinned for the tab's lifetime.

    The ref mirrors `entries` from an effect (never during render) and the
    revoking cleanup runs on unmount only — keying it to `entries` would
    revoke URLs that are still painted on the very next add or reorder.
  */
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    // Reset on mount: StrictMode's simulated unmount runs the cleanup below,
    // and the ref must not stay poisoned for the real instance.
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      entriesRef.current.forEach((e) => URL.revokeObjectURL(e.url));
    };
  }, []);

  const totalPages = entries.reduce((sum, e) => sum + e.pages.length, 0);
  // Deduped across entries: three animated WebPs are one fact, not three rows.
  const warnings = [...new Set(entries.flatMap((e) => e.warnings))];

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <DropZone accept={acceptFormats} multiple onFiles={handleFiles} disabled={status === "processing"} />

        {entries.length > 0 && (
          <>
            {/* Same assembly language as Merge PDF — both tools order source
                files into one document, so they share the doc's card strip. */}
            <CanvasHeader
              file="Assembly order"
              meta={
                `DRAG TO REORDER · ${entries.length} ` +
                `${entries.length === 1 ? "IMAGE" : "IMAGES"} · ${totalPages} ` +
                `${totalPages === 1 ? "PAGE" : "PAGES"}`
              }
            />

            <DocStrip>
              {entries.map((entry, idx) => (
                <DocCard
                  key={`${entry.file.name}-${idx}`}
                  index={idx + 1}
                  name={entry.file.name}
                  meta={formatFileSize(entry.file.size)}
                  badge={entry.pages.length > 1 ? `${entry.pages.length} p` : undefined}
                  thumb={entry.url}
                  onRemove={() => removeEntry(idx)}
                  draggableProps={{
                    draggable: true,
                    onDragStart: (e: React.DragEvent) => handleDragStart(e, idx),
                    onDragOver: (e: React.DragEvent) => handleDragOver(e, idx),
                    onDragEnd: () => setDragIdx(null),
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
                <span className="font-body text-[11px] leading-none">Add image</span>
              </button>
              <input
                ref={addInputRef}
                type="file"
                accept={acceptFormats}
                multiple
                className="hidden"
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  if (picked.length) handleFiles(picked);
                  // Same file twice in a row must still fire a change event.
                  e.target.value = "";
                }}
              />
            </DocStrip>
          </>
        )}

        <StatStrip
          stats={[
            // Parallel to Merge PDF's strip, which is the same archetype in
            // the doc. `OUTPUT images.pdf` restated the download's filename;
            // the measured output size is the fact that cell was missing.
            { label: "IMAGES", value: String(entries.length), tone: "neutral" },
            { label: "PAGES OUT", value: String(totalPages) },
            { label: "PAGE SIZE", value: pageSize.toUpperCase(), tone: "neutral" },
            { label: "SIZE OUT", value: result ? formatFileSize(result.size) : "—", tone: "ok" },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {/* Every distinct notice renders — an animated WebP flattened to its
            first frame is a per-file fact the result must not hide. */}
        {warnings.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}
      </div>

      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress phase="BUILDING PDF" percent={null} label="Building PDF" />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName="images.pdf"
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Creating PDF…" : "Create PDF"}
                onPrimary={handleConvert}
                primaryDisabled={entries.length === 0 || status === "processing"}
              />
            )}
            {entries.length > 0 && <ToolResetLink onClick={handleReset} label="START OVER" />}
          </>
        }
      >
        <ToolAsideSection label="PAGE SIZE">
          <ToolChoice
            label="Page size"
            fill
            value={pageSize}
            onChange={(v: PageSize) => {
              // The stat strip reads the live page size, so leaving the old
              // PDF downloadable would label A4 bytes as LETTER. Dropping it
              // also brings the Create PDF action back through the ternary.
              setPageSize(v);
              setResult(null);
              setElapsed(null);
              setStatus("idle");
            }}
            options={[
              { value: "a4" as PageSize, label: "A4" },
              { value: "letter" as PageSize, label: "Letter" },
              { value: "fit" as PageSize, label: "Fit" },
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Images", String(entries.length)],
              ["Pages", String(totalPages)],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {entries.length === 0
              ? "Add images to build a PDF."
              : "Drag the thumbnails to set page order."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
