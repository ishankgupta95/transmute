"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { StatusMessage } from "@/components/tools/StatusMessage";
// Worker-pool path: conversion runs off the main thread, one file per worker,
// so a batch is genuinely parallel (Phase 3). The old single-file bug — batch
// advertised, only files[0] processed — died with this rewrite.
import { convertImage } from "@/lib/workers/image-client";
import { poolSize } from "@/lib/workers/pool";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { formatFileSize } from "@/lib/utils/file-helpers";
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
  CanvasHeader,
  CompareStage,
  QueueTable,
  StatStrip,
} from "@/components/tools/ToolCanvas";

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

  const applyPreset = useCallback((id: string) => {
    setPreset(id);
    if (id === "web") setQuality(0.72);
    else if (id === "keep") setQuality(0.94);
  }, []);

  const { items, isProcessing, run, reset: resetBatch } = useBatchProcessor(convertImage);
  const results = items.map((item) => item.result);
  const successCount = results.filter((r) => r !== null).length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const firstError = items.find((item) => item.error)?.error ?? null;

  // Both hooks run unconditionally so the early return below cannot change
  // the hook order.
  const singlePreview = useObjectUrl(files.length === 1 ? files[0] : null);
  const singleResultUrl = useObjectUrl(
    files.length === 1 && results[0] ? results[0].blob : null,
  );

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

  return (
    <>
      {/* ── Canvas: one file compares, many files queue ────── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={single ? files[0].name : `${files.length} files`}
          meta={formatFileSize(inputTotal)}
          trailing={targetFormat.toUpperCase()}
        />

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
            footnote={
              // Real pool size for this batch — what actually runs in
              // parallel, never a decorative number.
              `${successCount} OF ${files.length} DONE · ${Math.min(poolSize(), files.length)} THREADS · RUNS ON THIS DEVICE`
            }
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
              value:
                successCount > 0 ? formatSizeComparison(inputTotal, totalNew) : "—",
              tone: "ok",
            },
            { label: "FORMAT", value: targetFormat.toUpperCase(), tone: "neutral" },
          ]}
        />

        {busy && single && (
          <div className="space-y-2">
            <ProgressBar progress={items[0]?.progress ?? null} label="Converting image" />
            <StatusMessage>Converting...</StatusMessage>
          </div>
        )}

        {firstError && (
          <ErrorMessage
            message={
              failedCount > 1
                ? `${failedCount} files failed — first error: ${firstError}`
                : firstError
            }
          />
        )}
      </div>

      <ToolAside
        footer={
          <>
            {successCount > 0 ? (
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
              <ToolActions
                primaryLabel={busy ? "Converting…" : "Convert"}
                onPrimary={handleConvert}
                primaryDisabled={busy}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={successCount > 0 ? "CONVERT ANOTHER" : "CLEAR"}
            />
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
          <ToolAsideSection label="QUALITY">
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
              }}
              disabled={busy}
            />
          </ToolAsideSection>
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
          <ToolOutput
            rows={[
              ["Format", targetFormat.toUpperCase()],
              ...(single ? [] : [["Files", String(files.length)] as [string, string]]),
              ["In", formatFileSize(inputTotal)],
              ["Out", successCount > 0 ? formatFileSize(totalNew) : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

function formatSizeComparison(original: number, converted: number): string {
  const diff = original - converted;
  const pct = Math.abs(Math.round((diff / original) * 100));
  if (diff > 0) {
    return `${pct}% smaller than the original`;
  } else if (diff < 0) {
    return `${pct}% larger than the original`;
  }
  return "Same size as the original";
}
