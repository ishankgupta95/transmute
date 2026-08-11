"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
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
import { formatFileSize } from "@/lib/utils/file-helpers";
import { downloadFilesAsZip } from "@/lib/utils/download";

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

  const { items, isProcessing, run, reset: resetBatch } = useBatchProcessor(compressImage);
  const results = items.map((item) => item.result);

  const applyPreset = useCallback((id: string) => {
    setPreset(id);
    if (id === "email") {
      setMode("target-size");
      setTargetSizeKb(2048);
    } else if (id === "web" || id === "print" || id === "archive") {
      setMode("quality");
      setQuality(id === "web" ? 0.72 : id === "print" ? 0.92 : 0.98);
    }
    // "custom" applies nothing — it just marks the controls as hand-driven.
  }, []);

  // Any hand edit un-lights the preset chip, so what's lit is what runs.
  const touch = useCallback(<T,>(setter: (v: T) => void) => {
    return (v: T) => {
      setPreset("custom");
      setter(v);
    };
  }, []);

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

  const totalOriginal = results.reduce((sum, r) => sum + (r?.originalSize ?? 0), 0);
  const totalNew = results.reduce((sum, r) => sum + (r?.newSize ?? 0), 0);
  const successCount = results.filter((r) => r !== null).length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const firstError = items.find((item) => item.error)?.error ?? null;

  if (files.length === 0) {
    return <DropZone accept={acceptFormats} multiple onFiles={handleFiles} />;
  }

  const inputTotal = files.reduce((s, f) => s + f.size, 0);

  return (
    <>
      {/* ── Canvas: one file compares, many files queue ────── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={files.length === 1 ? files[0].name : `${files.length} files`}
          meta={formatFileSize(inputTotal)}
          trailing={mode === "quality" ? `Q${Math.round(quality * 100)}` : `≤ ${targetSizeKb} KB`}
        />

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
            footnote={
              // Real pool size for this batch — what actually runs in
              // parallel, never a decorative number.
              `${successCount} OF ${files.length} DONE · ${Math.min(poolSize(), files.length)} THREADS · RUNS ON THIS DEVICE`
            }
          />
        )}

        <StatStrip
          stats={[
            { label: "FILES", value: String(files.length), tone: "neutral" },
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

        {isProcessing && files.length === 1 && (
          <div className="space-y-2">
            <ProgressBar progress={items[0]?.progress ?? null} />
            <p className="text-sm text-text-muted text-center">Compressing...</p>
          </div>
        )}

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
            {successCount > 0 ? (
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
              <ToolActions
                primaryLabel={isProcessing ? "Compressing…" : "Compress"}
                onPrimary={handleCompress}
                primaryDisabled={isProcessing}
              />
            )}
            {successCount > 0 && (
              <ToolResetLink onClick={handleCompress} label="COMPRESS AGAIN" />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={results.length > 0 ? "START OVER" : "CLEAR"}
            />
          </>
        }
      >
        <ToolPresets
          presets={PRESETS}
          active={preset}
          onSelect={applyPreset}
          disabled={isProcessing}
        />

        <ToolAsideSection label="MODE">
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
        </ToolAsideSection>

        {mode === "quality" ? (
          <ToolAsideSection>
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
          </ToolAsideSection>
        ) : (
          <ToolAsideSection label="TARGET SIZE">
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
          </ToolAsideSection>
        )}

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
          <ToolOutput
            rows={[
              ["Files", String(files.length)],
              ["In", formatFileSize(inputTotal)],
              ["Out", results.length > 0 ? formatFileSize(totalNew) : "—"],
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
