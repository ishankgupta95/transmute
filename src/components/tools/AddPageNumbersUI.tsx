"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import {
  addPageNumbers,
  loadPdfjsDocument,
  renderPageFromDoc,
  type PageNumberPosition,
} from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAside,
  ToolDone,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { chipClass, CANVAS_COLUMN } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

/**
 * The doc's one field box, from the RANGE strip:
 * `height:30px;border-radius:7px;background:var(--color-surface);border:1px
 * solid var(--color-divider);font:400 12px/1 mono;padding:0 10px`.
 * Same shape `RangeField` and the regex pattern input already wear.
 */
const FIELD_CLASS =
  "h-[30px] w-24 rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** The six anchors pdf-engine understands, in visual grid order. */
const POSITIONS = [
  { value: "top-left" as const, label: "TL" },
  { value: "top-center" as const, label: "TC" },
  { value: "top-right" as const, label: "TR" },
  { value: "bottom-left" as const, label: "BL" },
  { value: "bottom-center" as const, label: "BC" },
  { value: "bottom-right" as const, label: "BR" },
];

export function AddPageNumbersUI() {
  const [file, setFile] = useState<File | null>(null);
  const [position, setPosition] = useState<PageNumberPosition>("bottom-center");
  const [startNumber, setStartNumber] = useState(1);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pagePreview, setPagePreview] = useState<string | null>(null);
  // Read off the same pdf.js document the preview already opens, so the
  // header can carry the doc's technical readout ("24 PAGES · 12.4 MB")
  // without a second parse.
  const [pageCount, setPageCount] = useState(0);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus("idle");
    setError(null);
    setPagePreview(null);
    setPageCount(0);
  }, []);

  /*
    Show the user's actual first page, not a drawn mock. The whole point of
    this tool's canvas is "where will the number land relative to my
    margins and my content" — a question a ruled-paper placeholder cannot
    answer. Every sibling PDF tool already rasterises with pdf.js.
  */
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let doc: Awaited<ReturnType<typeof loadPdfjsDocument>> | null = null;
    (async () => {
      try {
        doc = await loadPdfjsDocument(await file.arrayBuffer());
        if (!cancelled) setPageCount(doc.numPages);
        const canvas = await renderPageFromDoc(doc, 1, 1.0);
        if (!cancelled) setPagePreview(canvas.toDataURL("image/jpeg", 0.85));
      } catch {
        // Fall back to the placeholder page rather than blocking the tool.
      } finally {
        await doc?.destroy();
        doc = null;
      }
    })();
    return () => { cancelled = true; void doc?.destroy(); };
  }, [file]);

  /*
    Position and start number both change what a run produces, and the footer
    swaps the primary action out for a Download once `result` is set — so
    without this the button keeps offering a PDF numbered at the old corner
    while the preview shows the new one, with no way to re-run.
  */
  const invalidate = useCallback(() => {
    setResult(null);
    setElapsed(null);
    setStatus((s) => (s === "done" ? "idle" : s));
  }, []);

  const handleProcess = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const buf = await file.arrayBuffer();
      const bytes = await addPageNumbers(buf, position, startNumber);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add page numbers");
      setStatus("error");
    }
  }, [file, position, startNumber]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setElapsed(null);
    setStatus("idle");
    setError(null);
    setPagePreview(null);
    setPageCount(0);
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <>
      {/* ── Canvas: the page, with the number where it will land ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={
            pageCount
              ? `${pageCount} PAGE${pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`
              : formatFileSize(file.size)
          }
          trailing="PDF"
        />

        <CanvasStage className="flex justify-center p-[15px]">
          {/*
            The real first page, at whatever aspect it actually has — the
            image's intrinsic ratio sizes the frame, so landscape and A4 both
            come out right. A viewport-relative height rather than `h-full`:
            the stage is an auto-height flex item, so `h-full` would resolve
            to `auto` and the page would stay postage-stamp sized.
          */}
          <div
            className={cn(
              "relative overflow-hidden rounded-[5px] border-2 border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_22%,transparent)]",
              pagePreview
                ? "inline-block max-w-full bg-bg-elevated"
                : "aspect-3/4 w-[188px] bg-[linear-gradient(170deg,#f3f5fe_0%,#dfe3f0_100%)]",
            )}
          >
            {pagePreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- data: URL from pdf.js, nothing for next/image to optimise
              <img
                src={pagePreview}
                alt=""
                className="block h-[min(62vh,720px)] w-auto max-w-full object-contain"
              />
            ) : (
              <span className="absolute inset-x-[13px] top-4 flex flex-col gap-[5px]">
                <span className="h-[5px] w-[70%] rounded-sm bg-[#75798c]" />
                <span className="h-[3px] w-full rounded-sm bg-[#b2b6ca]" />
                <span className="h-[3px] w-[92%] rounded-sm bg-[#b2b6ca]" />
                <span className="h-[3px] w-[97%] rounded-sm bg-[#b2b6ca]" />
                <span className="h-[3px] w-[64%] rounded-sm bg-[#b2b6ca]" />
              </span>
            )}
            {POSITIONS.map(({ value: pos }) => (
              <span
                key={pos}
                className={`absolute rounded-sm bg-white/70 px-1.5 font-mono text-[11px] leading-none ${
                  pos === position ? "font-medium text-[#2b2741]" : "text-[#75798c] opacity-25"
                } ${pos.startsWith("top") ? "top-2" : "bottom-2"} ${
                  pos.endsWith("left")
                    ? "left-2"
                    : pos.endsWith("right")
                      ? "right-2"
                      : "left-1/2 -translate-x-1/2"
                }`}
              >
                {startNumber}
              </span>
            ))}
          </div>
        </CanvasStage>

        <CanvasFootnote>
          {pagePreview
            ? "YOUR FIRST PAGE · NUMBER SHOWN AT ITS CHOSEN CORNER · EVERY PAGE GETS ONE"
            : "NUMBER SHOWN AT ITS CHOSEN CORNER · EVERY PAGE GETS ONE"}
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress phase="NUMBERING" percent={null} label="Adding page numbers" />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-numbered.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Processing…" : "Add page numbers"}
                onPrimary={handleProcess}
                primaryDisabled={status === "processing"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        {/* One bordered block for the whole control set — the doc gives its
            own rule only to START FROM, ADVANCED and OUTPUT. */}
        <ToolControlGroup>
          <ToolControl label="POSITION">
            <div className="grid grid-cols-3 gap-1.5">
              {POSITIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setPosition(value);
                    invalidate();
                  }}
                  aria-pressed={position === value}
                  className={chipClass(
                    position === value,
                    cn(
                      "rounded-[6px] px-1 py-[7px] text-[11.5px]",
                      position !== value && "text-text-muted",
                    ),
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </ToolControl>

          <ToolControl label="START NUMBER">
            <input
              type="number"
              min={1}
              value={startNumber}
              onChange={(e) => {
                setStartNumber(Math.max(1, Number(e.target.value)));
                invalidate();
              }}
              aria-label="Start number"
              className={FIELD_CLASS}
            />
          </ToolControl>
        </ToolControlGroup>
      </ToolAside>
    </>
  );
}
