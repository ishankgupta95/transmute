"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
// Worker-pool path: conversion runs off the main thread, one file per worker,
// so a batch is genuinely parallel (Phase 3). The old single-file bug — batch
// advertised, only files[0] processed — died with this rewrite.
import { convertImage } from "@/lib/workers/image-client";
import { poolSize } from "@/lib/workers/pool";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { formatDelta, formatFileSize } from "@/lib/utils/file-helpers";
import { downloadFilesAsZip } from "@/lib/utils/download";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolPresets,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import {
  ToolControl,
  ToolControlGroup,
  ToolProgress,
} from "@/components/tools/ToolControls";
import {
  CanvasHeader,
  CompareStage,
  QueueTable,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

/*
  The doc's "batch-convert" presets trimmed to this tool's one control — its
  "Thumbnails: 512 px cropped" needs resize/crop that don't exist here.
  Only shown for lossy targets, where quality means something.
*/
const PRESETS = [
  { id: "web", label: "Web ready", note: "Quality 72 — the web sweet spot." },
  { id: "keep", label: "Keep quality", note: "Quality 94. Format change only." },
  { id: "custom", label: "Custom", note: "Every control unlocked. Nothing is assumed." },
] as const;

interface ImageConverterUIProps {
  acceptFormats: string;
  targetFormat: "jpeg" | "png" | "webp";
  sourceFormat: string;
}

export function ImageConverterUI({
  acceptFormats,
  targetFormat,
  sourceFormat,
}: ImageConverterUIProps) {
  const [quality, setQuality] = useState(0.85);
  const [files, setFiles] = useState<File[]>([]);
  const [split, setSplit] = useState(50);
  const [preset, setPreset] = useState<string>("custom");

  const { items, isProcessing, run, cancel: cancelBatch, reset: resetBatch } =
    useBatchProcessor(convertImage);

  // Changing quality invalidates every blob already produced, so the results go
  // with it — which also brings the Convert action back so the new setting can
  // actually be applied. Leaving them would hand the user the old bytes under
  // new stats.
  const applyPreset = useCallback(
    (id: string) => {
      resetBatch();
      setPreset(id);
      if (id === "web") setQuality(0.72);
      else if (id === "keep") setQuality(0.94);
    },
    [resetBatch],
  );

  const results = items.map((item) => item.result);
  const successCount = results.filter((r) => r !== null).length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const firstError = items.find((item) => item.error)?.error ?? null;
  // Deduped across the batch: fifty animated GIFs are one fact, not fifty rows.
  const warnings = [...new Set(items.flatMap((item) => item.result?.warnings ?? []))];

  // Both hooks run unconditionally so the early return below cannot change
  // the hook order.
  const singlePreview = useObjectUrl(files.length === 1 ? files[0] : null);
  const singleResultUrl = useObjectUrl(
    files.length === 1 && results[0] ? results[0].blob : null,
  );
  // The doc's header reads "4032 × 3024 · 4.28 MB", not the byte size alone.
  const sourceDims = useImageDimensions(files.length === 1 ? files[0] : null);

  const handleFiles = useCallback(
    (incoming: File[]) => {
      setFiles(incoming);
      resetBatch();
    },
    [resetBatch],
  );

  const handleConvert = useCallback(() => {
    if (files.length === 0) return;
    void run(files, { targetFormat, quality });
  }, [files, run, targetFormat, quality]);

  const handleReset = useCallback(() => {
    setFiles([]);
    resetBatch();
  }, [resetBatch]);

  const downloadAll = useCallback(() => {
    // One ZIP rather than N synchronous downloads, which browsers throttle.
    void downloadFilesAsZip(
      results
        .filter((r): r is ProcessedResult => r !== null)
        .map((r) => ({ blob: r.blob, name: r.fileName })),
      "converted-images.zip",
    );
  }, [results]);

  if (files.length === 0) {
    return (
      <DropZone
        accept={acceptFormats}
        multiple
        onFiles={handleFiles}
        label={`Upload ${sourceFormat.toUpperCase()} images to convert`}
      />
    );
  }

  const lossy = targetFormat === "jpeg" || targetFormat === "webp";
  const busy = isProcessing;
  const inputTotal = files.reduce((s, f) => s + f.size, 0);
  const totalNew = results.reduce((sum, r) => sum + (r?.newSize ?? 0), 0);
  const single = files.length === 1;
  const threads = Math.min(poolSize(), files.length);
  const runningCount = items.filter((item) => item.status === "running").length;
  // Averaged over the queue, so the footer bar tracks the whole batch rather
  // than whichever file happens to be first.
  const overallPct =
    items.length > 0
      ? Math.round(items.reduce((sum, item) => sum + (item.progress ?? 0), 0) / items.length)
      : null;

  return (
    <>
      {/* ── Canvas: one file compares, many files queue ────── */}
      <div className={CANVAS_COLUMN}>
        {single ? (
          <CanvasHeader
            file={files[0].name}
            meta={imageMeta(sourceDims, formatFileSize(inputTotal))}
            trailing={targetFormat.toUpperCase()}
          />
        ) : (
          /* The doc's batch branch heads the canvas with the queue itself.
             Every number is measured — `threads` is the real pool size. */
          <CanvasHeader
            file="Queue"
            meta={`${files.length} FILES · ${formatFileSize(inputTotal)} IN · ${threads} THREADS`}
            trailing={`${successCount} DONE · ${runningCount} RUNNING · ${
              files.length - successCount - runningCount - failedCount
            } QUEUED`}
          />
        )}

        {single ? (
          <CompareStage
            beforeUrl={singlePreview}
            afterUrl={singleResultUrl}
            inLabel={sourceFormat.toUpperCase()}
            outLabel={targetFormat.toUpperCase()}
            split={split}
            onSplitChange={setSplit}
            busy={busy}
            caption={successCount > 0 ? "drag to compare" : "convert to see the result"}
          />
        ) : (
          <QueueTable
            rows={files.map((f, i) => {
              const item = items[i];
              return {
                name: f.name,
                inSize: formatFileSize(f.size),
                outSize: item?.result ? formatFileSize(item.result.newSize) : "—",
                pct: item?.progress ?? 0,
                state:
                  item?.status === "done"
                    ? ("DONE" as const)
                    : item?.status === "failed"
                      ? ("FAILED" as const)
                      : item?.status === "running"
                        ? ("RUNNING" as const)
                        : ("QUEUED" as const),
              };
            })}
            /*
              The doc's queue footer is ELAPSED · PEAK RSS · WORKER POOL, two
              thirds of which a browser cannot measure. What stays is the one
              line that was always true and is not repeated anywhere else on a
              desktop tool page: the batch runs here.
            */
            footnote="RUNS ON THIS DEVICE"
          />
        )}

        <StatStrip
          stats={[
            ...(single
              ? []
              : [{ label: "FILES", value: String(files.length), tone: "neutral" as const }]),
            { label: "IN", value: formatFileSize(inputTotal), tone: "neutral" },
            { label: "OUT", value: successCount > 0 ? formatFileSize(totalNew) : "—" },
            {
              label: "DELTA",
              value: successCount > 0 ? formatDelta(inputTotal, totalNew) : "—",
              // Green is a claim. A file that grew is not a win.
              tone: totalNew <= inputTotal ? "ok" : "accent",
            },
            { label: "FORMAT", value: targetFormat.toUpperCase(), tone: "neutral" },
          ]}
        />

        {firstError && (
          <ErrorMessage
            message={
              failedCount > 1
                ? `${failedCount} files failed — first error: ${firstError}`
                : firstError
            }
          />
        )}

        {/* Every distinct warning renders — a mixed batch can drop frames in
            one file and pages in another, and each is its own fact. */}
        {warnings.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}
      </div>

      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer, directly
                above the button that started it. */}
            {busy && (
              <ToolProgress phase="CONVERTING" percent={overallPct} label="Converting images" />
            )}
            {/*
              `busy` is tested FIRST. The other order let the primary flip to
              "Download all (ZIP)" the moment the first file of a batch landed,
              while the rest were still queued — pressing it handed over a
              partial set under a label promising all of them.
            */}
            {busy ? (
              // Cancel replaces the disabled primary rather than sitting next
              // to it: a large queue is otherwise unstoppable, and the files
              // already converted keep their blobs. The reset link stays
              // hidden while it runs — nothing labelled Cancel drops the input.
              <ToolActions primaryLabel="Cancel" onPrimary={cancelBatch} />
            ) : successCount > 0 ? (
              single && results[0] ? (
                <DownloadButton
                  blob={results[0].blob}
                  fileName={results[0].fileName}
                  className="w-full justify-center"
                />
              ) : (
                <ToolActions primaryLabel="Download all (ZIP)" onPrimary={downloadAll} />
              )
            ) : (
              <ToolActions primaryLabel="Convert" onPrimary={handleConvert} />
            )}
            {!busy && (
              <ToolResetLink
                onClick={handleReset}
                label={successCount > 0 ? "CONVERT ANOTHER" : "CLEAR"}
              />
            )}
          </>
        }
      >
        {lossy && (
          <ToolPresets
            presets={PRESETS}
            active={preset}
            onSelect={applyPreset}
            disabled={busy}
          />
        )}

        {lossy && (
          <ToolControlGroup>
            <ToolControl label="QUALITY">
              <ToolSlider
                label="Quality"
                display={`${Math.round(quality * 100)}%`}
                hint="Lower quality means a smaller file. 85% keeps detail on photographs."
                min={0.1}
                max={1}
                step={0.05}
                value={quality}
                onChange={(v) => {
                  setPreset("custom");
                  setQuality(v);
                  resetBatch();
                }}
                disabled={busy}
              />
            </ToolControl>
          </ToolControlGroup>
        )}

        {/* Engine facts — true of image-convert.ts for this target format. */}
        <ToolAdvanced
          rows={[
            ["EXIF + GPS", "STRIPPED"],
            ["Colour space", "sRGB"],
            [
              "Transparency",
              targetFormat === "jpeg" ? "WHITE FILL" : "PRESERVED",
            ],
          ]}
        />

        <ToolAsideSection label="OUTPUT">
          {/* `ToolOutput` accents its SECOND row, so the measured output size
              sits there — the doc highlights what comes out. */}
          <ToolOutput
            rows={[
              ["Format", targetFormat.toUpperCase()],
              ["Out", successCount > 0 ? formatFileSize(totalNew) : "—"],
              ...(single
                ? sourceDims
                  ? [["Dimensions", `${sourceDims.w} × ${sourceDims.h}`] as [string, string]]
                  : []
                : [["Files", String(files.length)] as [string, string]]),
              ["In", formatFileSize(inputTotal)],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

/**
 * A stat cell is a mono token slot, not a sentence: `−58%` / `+829%` fits on
 * one line where "829% larger than the original" wrapped and broke the strip.
 */
