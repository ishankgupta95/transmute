"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { imagesToPdf, type PageSize } from "@/lib/tools/pdf-engine";
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

export function ImagesToPdfUI() {
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

  const handleFiles = useCallback((files: File[]) => {
    const newEntries = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    setEntries((prev) => [...prev, ...newEntries]);
    setResult(null);
    setElapsed(null);
    setStatus("idle");
  }, []);

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
      const images = await Promise.all(
        entries.map(async (e) => {
          const bytes = new Uint8Array(await e.file.arrayBuffer());
          return { bytes, type: e.file.type };
        }),
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
  useEffect(
    () => () => {
      entriesRef.current.forEach((e) => URL.revokeObjectURL(e.url));
    },
    [],
  );

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <DropZone accept=".jpg,.jpeg,.png" multiple onFiles={handleFiles} disabled={status === "processing"} />

        {entries.length > 0 && (
          <>
            {/* Same assembly language as Merge PDF — both tools order source
                files into one document, so they share the doc's card strip. */}
            <CanvasHeader
              file="Assembly order"
              meta={
                `DRAG TO REORDER · ${entries.length} ` +
                `${entries.length === 1 ? "IMAGE" : "IMAGES"} · ${entries.length} ` +
                `${entries.length === 1 ? "PAGE" : "PAGES"}`
              }
            />

            <DocStrip>
              {entries.map((entry, idx) => (
                <DocCard
                  key={`${entry.file.name}-${idx}`}
                  index={idx + 1}
                  name={entry.file.name}
                  meta={formatFileSize(entry.file.size)}
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
                accept=".jpg,.jpeg,.png"
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
            { label: "PAGES OUT", value: String(entries.length) },
            { label: "PAGE SIZE", value: pageSize.toUpperCase(), tone: "neutral" },
            { label: "SIZE OUT", value: result ? formatFileSize(result.size) : "—", tone: "ok" },
          ]}
        />

        {error && <ErrorMessage message={error} />}
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
              ["Pages", String(entries.length)],
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
