"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
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
// Worker-pool path: compression runs off the main thread, one file per
// worker, so a batch is genuinely parallel (Phase 3).
import { compressImage } from "@/lib/workers/image-client";
import { poolSize } from "@/lib/workers/pool";
import { ssimFromBlobs } from "@/lib/tools/image-metrics";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { downloadFilesAsZip } from "@/lib/utils/download";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

interface ImageCompressorUIProps {
  acceptFormats: string;
  defaultTargetSizeKb?: number;
}

/*
  The doc's START FROM presets, kept to what the tool's controls can actually
  do — the doc's "Web hero" claims a resize this tool doesn't have, so its
  note here describes only what selecting it sets.
*/
const PRESETS = [
  { id: "email", label: "Email attachment", note: "Targets under 2 MB — the common attachment ceiling." },
  { id: "web", label: "Web", note: "Quality 72 — the web sweet spot. Re-encoding strips EXIF either way." },
  { id: "print", label: "Print", note: "Quality 92 keeps near-original detail." },
  { id: "archive", label: "Archive", note: "Quality 98 — visually lossless. Use when the file is the record." },
  { id: "custom", label: "Custom", note: "Every control unlocked. Nothing is assumed." },
] as const;

export function ImageCompressorUI({
  acceptFormats,
  defaultTargetSizeKb,
}: ImageCompressorUIProps) {
  const [mode, setMode] = useState<"quality" | "target-size">(
    defaultTargetSizeKb ? "target-size" : "quality",
  );
  const [quality, setQuality] = useState(0.8);
  const [targetSizeKb, setTargetSizeKb] = useState(defaultTargetSizeKb ?? 200);
  const [files, setFiles] = useState<File[]>([]);
  const [split, setSplit] = useState(50);
  const [ssimScore, setSsimScore] = useState<number | null>(null);
  const [preset, setPreset] = useState<string>("custom");

  const { items, isProcessing, run, cancel: cancelBatch, reset: resetBatch } =
    useBatchProcessor(compressImage);
  const results = items.map((item) => item.result);

  // Any change to the settings invalidates the blobs already produced, so the
  // results go with them and the Compress action comes back. Otherwise the
  // header reads "Q40" while Download still holds the Q80 file.
  const invalidate = useCallback(() => {
    resetBatch();
    setSsimScore(null);
  }, [resetBatch]);

  const applyPreset = useCallback((id: string) => {
    invalidate();
    setPreset(id);
    if (id === "email") {
      setMode("target-size");
      setTargetSizeKb(2048);
    } else if (id === "web" || id === "print" || id === "archive") {
      setMode("quality");
      setQuality(id === "web" ? 0.72 : id === "print" ? 0.92 : 0.98);
    }
    // "custom" applies nothing — it just marks the controls as hand-driven.
  }, [invalidate]);

  // Any hand edit un-lights the preset chip, so what's lit is what runs.
  const touch = useCallback(
    <T,>(setter: (v: T) => void) => {
      return (v: T) => {
        invalidate();
        setPreset("custom");
        setter(v);
      };
    },
    [invalidate],
  );

  const handleFiles = useCallback(
    (incoming: File[]) => {
      setFiles(incoming);
      resetBatch();
      setSsimScore(null);
    },
    [resetBatch],
  );

  const handleCompress = useCallback(async () => {
    if (files.length === 0) return;
    setSsimScore(null);
    // Every file at once — the worker pool schedules them across its threads.
    const out = await run(files, { mode, quality, targetSizeKb });

    // Real SSIM for the single-file compare (the doc's stat). Decoration:
    // a decode failure just leaves the stat as "—".
    if (files.length === 1 && out[0]) {
      setSsimScore(await ssimFromBlobs(files[0], out[0].blob));
    }
  }, [files, run, mode, quality, targetSizeKb]);

  const downloadAll = useCallback(() => {
    // One ZIP rather than N synchronous downloads, which browsers throttle.
    void downloadFilesAsZip(
      results.filter((r): r is ProcessedResult => r !== null).map((r) => ({
        blob: r.blob,
        name: r.fileName,
      })),
      "compressed-images.zip",
    );
  }, [results]);

  const handleReset = useCallback(() => {
    setFiles([]);
    resetBatch();
    setSsimScore(null);
  }, [resetBatch]);

  // The compare stage needs both sides as URLs. Both hooks run unconditionally
  // so the early return below cannot change the hook order.
  const singlePreview = useObjectUrl(files.length === 1 ? files[0] : null);
  const singleResultUrl = useObjectUrl(
    files.length === 1 && results[0] ? results[0].blob : null,
  );
  // The doc's header reads "4032 × 3024 · 4.28 MB", not the byte size alone.
  const sourceDims = useImageDimensions(files.length === 1 ? files[0] : null);

  const totalOriginal = results.reduce((sum, r) => sum + (r?.originalSize ?? 0), 0);
  const totalNew = results.reduce((sum, r) => sum + (r?.newSize ?? 0), 0);
  const successCount = results.filter((r) => r !== null).length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const firstError = items.find((item) => item.error)?.error ?? null;
  const runningCount = items.filter((item) => item.status === "running").length;
  // Averaged over the queue, so the footer bar tracks the whole batch rather
  // than whichever file happens to be first.
  const overallPct =
    items.length > 0
      ? Math.round(items.reduce((sum, item) => sum + (item.progress ?? 0), 0) / items.length)
      : null;

  if (files.length === 0) {
    return <DropZone accept={acceptFormats} multiple onFiles={handleFiles} />;
  }

  const inputTotal = files.reduce((s, f) => s + f.size, 0);
  const threads = Math.min(poolSize(), files.length);

  return (
    <>
      {/* ── Canvas: one file compares, many files queue ────── */}
      <div className={CANVAS_COLUMN}>
        {files.length === 1 ? (
          <CanvasHeader
            file={files[0].name}
            meta={imageMeta(sourceDims, formatFileSize(inputTotal))}
            trailing={mode === "quality" ? `Q${Math.round(quality * 100)}` : `≤ ${targetSizeKb} KB`}
          />
        ) : (
          /*
            The doc's batch branch heads the canvas with the queue itself:
            "Queue · 6 FILES · 38.2 MB IN · 4 THREADS" on the left, the live
            state counts on the right. Every number here is measured — the
            thread count is the real pool size for this batch.
          */
          <CanvasHeader
            file="Queue"
            meta={`${files.length} FILES · ${formatFileSize(inputTotal)} IN · ${threads} THREADS`}
            trailing={`${successCount} DONE · ${runningCount} RUNNING · ${
              files.length - successCount - runningCount - failedCount
            } QUEUED`}
          />
        )}

        {files.length === 1 ? (
          <CompareStage
            beforeUrl={singlePreview}
            afterUrl={singleResultUrl}
            inLabel="ORIGINAL"
            outLabel="COMPRESSED"
            split={split}
            onSplitChange={setSplit}
            busy={isProcessing}
            caption={successCount > 0 ? "drag to compare" : "compress to see the result"}
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

        {/*
          The doc's single-file strip is exactly IN · OUT · SAVED · SSIM.
          `FILES 1` is a cell that says nothing, and carrying it pushed the
          strip to five columns; it stays for a batch, where it is real.
          `OUT` is deliberately not the doc's `OUT (EST.)` — this value is
          measured off the finished blob, so calling it an estimate would
          understate it.
        */}
        <StatStrip
          stats={[
            ...(files.length === 1
              ? []
              : [{ label: "FILES", value: String(files.length), tone: "neutral" as const }]),
            { label: "IN", value: formatFileSize(inputTotal), tone: "neutral" },
            { label: "OUT", value: successCount > 0 ? formatFileSize(totalNew) : "—" },
            {
              label: "SAVED",
              value:
                totalOriginal > totalNew
                  ? `${Math.round(((totalOriginal - totalNew) / totalOriginal) * 100)}%`
                  : "—",
              tone: "ok",
            },
            // Computed, never seeded — only shown for the single-file compare.
            ...(files.length === 1
              ? [{ label: "SSIM", value: ssimScore !== null ? ssimScore.toFixed(3) : "—" }]
              : []),
          ]}
        />

        {firstError && (
          <ErrorMessage
            message={
              failedCount > 1 ? `${failedCount} files failed — first error: ${firstError}` : firstError
            }
          />
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer, directly
                above the button that started it. */}
            {isProcessing && (
              <ToolProgress
                phase="COMPRESSING"
                percent={overallPct}
                label="Compressing images"
              />
            )}
            {/*
              `isProcessing` is tested FIRST. The other order let the primary
              flip to "Download all (ZIP)" the moment the first file of a batch
              landed, while the rest were still queued — pressing it handed
              over a partial set under a label promising all of them, and
              `downloadFilesAsZip` silently drops the ZIP when only one result
              exists, so a two-file batch could yield a single bare image.
            */}
            {isProcessing ? (
              // Cancel replaces the disabled primary rather than sitting next
              // to it: a 200-file queue is the longest job here, and the files
              // already compressed keep their blobs. The reset link stays
              // hidden while it runs — nothing labelled Cancel drops the input.
              <ToolActions primaryLabel="Cancel" onPrimary={cancelBatch} />
            ) : successCount > 0 ? (
              files.length === 1 && results[0] ? (
                <DownloadButton
                  blob={results[0].blob}
                  fileName={results[0].fileName}
                  className="w-full justify-center"
                />
              ) : (
                <ToolActions primaryLabel="Download all (ZIP)" onPrimary={downloadAll} />
              )
            ) : (
              <ToolActions primaryLabel="Compress" onPrimary={handleCompress} />
            )}
            {successCount > 0 && !isProcessing && (
              <ToolResetLink onClick={handleCompress} label="COMPRESS AGAIN" />
            )}
            {!isProcessing && (
              <ToolResetLink
                onClick={handleReset}
                label={results.length > 0 ? "START OVER" : "CLEAR"}
              />
            )}
          </>
        }
      >
        <ToolPresets
          presets={PRESETS}
          active={preset}
          onSelect={applyPreset}
          disabled={isProcessing}
        />

        {/* One bordered block for every control, as the doc draws it — the
            per-control sections each carried their own rule and struck the
            rail through five times. */}
        <ToolControlGroup>
          <ToolControl label="MODE">
            <ToolChoice
              label="Compression mode"
              fill
              disabled={isProcessing}
              value={mode}
              onChange={touch(setMode)}
              options={[
                { value: "quality" as const, label: "Quality" },
                { value: "target-size" as const, label: "Target size" },
              ]}
            />
          </ToolControl>

          {mode === "quality" ? (
            <ToolControl>
              <ToolSlider
                label="Quality"
                display={`${Math.round(quality * 100)}%`}
                hint="Lower quality means a smaller file. 80% is usually indistinguishable."
                min={0.1}
                max={1}
                step={0.05}
                value={quality}
                onChange={touch(setQuality)}
                disabled={isProcessing}
              />
            </ToolControl>
          ) : (
            <ToolControl label="TARGET SIZE">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={10240}
                  value={targetSizeKb}
                  onChange={(e) => touch(setTargetSizeKb)(Number(e.target.value))}
                  aria-label="Target file size in KB"
                  className="w-24 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  disabled={isProcessing}
                />
                <span className="text-sm text-text-muted">KB</span>
              </div>
              <ToolChoice
                label="Target size preset"
                fill
                disabled={isProcessing}
                value={targetSizeKb}
                onChange={touch(setTargetSizeKb)}
                options={[50, 100, 200, 500, 1024].map((kb) => ({
                  value: kb,
                  label: kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`,
                }))}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Quality is binary-searched to land just under the ceiling.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        {/* Engine facts, all true of image-compress.ts as written. */}
        <ToolAdvanced
          rows={[
            ["EXIF + GPS", "STRIPPED"],
            ["Colour space", "sRGB"],
            ["Binary-search passes", "UP TO 10"],
            ["Transparency", "KEPT — WEBP PATH"],
          ]}
        />

        <ToolAsideSection label="OUTPUT">
          {/*
            `ToolOutput` accents its SECOND row, so the measured output size
            sits there — the doc highlights what comes out, not what went in.
            `Dimensions` is the doc's third row and a fact the tool already
            holds: compression re-encodes at the source size, so these are the
            output's dimensions too.
          */}
          <ToolOutput
            rows={[
              files.length === 1
                ? (["File", files[0].name] as [string, string])
                : (["Files", String(files.length)] as [string, string]),
              ["Out", results.length > 0 ? formatFileSize(totalNew) : "—"],
              ...(files.length === 1 && sourceDims
                ? [["Dimensions", `${sourceDims.w} × ${sourceDims.h}`] as [string, string]]
                : [["In", formatFileSize(inputTotal)] as [string, string]]),
              [
                "Saved",
                totalOriginal > totalNew
                  ? `${Math.round(((totalOriginal - totalNew) / totalOriginal) * 100)}%`
                  : "—",
              ],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
