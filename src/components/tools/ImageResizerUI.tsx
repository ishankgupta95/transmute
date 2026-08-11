"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { StatusMessage } from "@/components/tools/StatusMessage";
import {
  RESIZE_PRESETS,
  PERCENTAGE_PRESETS,
  type ImageResizeOptions,
} from "@/lib/tools/image-resize";
// Worker-pool path: resize runs off the main thread (Phase 3); falls back to
// the lib/tools implementation where workers can't do canvas.
import { resizeImage } from "@/lib/workers/image-client";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  CompareStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";

interface ImageResizerUIProps {
  acceptFormats: string;
}

export function ImageResizerUI({ acceptFormats }: ImageResizerUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [split, setSplit] = useState(50);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<"custom" | "preset" | "percentage">("preset");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [lockAspect, setLockAspect] = useState(true);
  const [percentage, setPercentage] = useState(50);
  const [quality, setQuality] = useState(0.9);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resultPreviewUrl = useObjectUrl(result?.blob);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      // Revoke any prior preview URL before replacing.
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(f);
      setResult(null);
      setError(null);
      const url = URL.createObjectURL(f);
      setPreviewUrl(url);

      // Read natural dimensions from the same URL (don't allocate a second one).
      const img = new Image();
      img.onload = () => {
        setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      };
      img.onerror = () => {
        setError("Could not read this image. Try a different file.");
      };
      img.src = url;
    },
    [previewUrl],
  );

  const handleWidthChange = useCallback(
    (w: number) => {
      setWidth(w);
      if (lockAspect && naturalSize) {
        setHeight(Math.round((w / naturalSize.w) * naturalSize.h));
      }
    },
    [lockAspect, naturalSize],
  );

  const handleHeightChange = useCallback(
    (h: number) => {
      setHeight(h);
      if (lockAspect && naturalSize) {
        setWidth(Math.round((h / naturalSize.h) * naturalSize.w));
      }
    },
    [lockAspect, naturalSize],
  );

  const handlePreset = useCallback((pw: number, ph: number) => {
    setMode("preset");
    setWidth(pw);
    setHeight(ph);
  }, []);

  const handleResize = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    try {
      const opts: ImageResizeOptions = {
        mode,
        width,
        height,
        lockAspect,
        percentage,
        quality,
      };
      const output = await resizeImage(file, opts);
      setResult(output);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resize failed");
    }
    setIsProcessing(false);
  }, [file, mode, width, height, lockAspect, percentage, quality]);

  const handleReset = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setNaturalSize(null);
    setResult(null);
    setError(null);
  }, [previewUrl]);

  if (!file) {
    return (
      <DropZone accept={acceptFormats} onFiles={handleFiles} label="Upload an image to resize" />
    );
  }

  const outDims =
    mode === "percentage" && naturalSize
      ? `${Math.round((naturalSize.w * percentage) / 100)} × ${Math.round((naturalSize.h * percentage) / 100)}`
      : `${width} × ${height}`;

  return (
    <>
      {/* ── Canvas: the doc's before/after wipe + stat strip ── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={file.name}
          meta={naturalSize ? `${naturalSize.w} × ${naturalSize.h}` : formatFileSize(file.size)}
          trailing={outDims}
        />

        <CompareStage
          beforeUrl={previewUrl}
          afterUrl={resultPreviewUrl}
          inLabel="ORIGINAL"
          outLabel="RESIZED"
          split={split}
          onSplitChange={setSplit}
          busy={isProcessing}
          caption={result ? "drag to compare" : "resize to see the result"}
        />

        <StatStrip
          stats={[
            {
              label: "SOURCE",
              value: naturalSize ? `${naturalSize.w}×${naturalSize.h}` : "—",
              tone: "neutral",
            },
            { label: "TARGET", value: outDims },
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—", tone: "ok" },
          ]}
        />

        {isProcessing && (
          <div className="space-y-2">
            <ProgressBar progress={null} label="Resizing image" />
            <StatusMessage>Resizing...</StatusMessage>
          </div>
        )}
        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel="Resize"
                onPrimary={handleResize}
                primaryDisabled={isProcessing}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "RESIZE ANOTHER" : "CLEAR"}
            />
          </>
        }
      >
        <ToolAsideSection label="MODE">
          <ToolChoice
            label="Resize mode"
            fill
            disabled={isProcessing}
            value={mode}
            onChange={setMode}
            options={[
              { value: "preset" as const, label: "Presets" },
              { value: "custom" as const, label: "Custom" },
              { value: "percentage" as const, label: "%" },
            ]}
          />
        </ToolAsideSection>

        {mode === "preset" && (
          <ToolAsideSection label="PRESET">
            <div className="flex flex-col gap-1.5">
              {RESIZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => handlePreset(p.width, p.height)}
                  aria-pressed={width === p.width && height === p.height}
                  className={cn(
                    "cursor-pointer rounded-md border px-3 py-2 text-left font-body text-xs transition-colors duration-200",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    width === p.width && height === p.height
                      ? "border-accent bg-accent/12 text-accent"
                      : "border-border text-neutral-400 hover:border-accent/40 hover:text-accent-200",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </ToolAsideSection>
        )}

        {(mode === "custom" || mode === "preset") && (
          <ToolAsideSection label="DIMENSIONS">
            <div className="flex items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-body text-[11px] text-text-muted">Width</span>
                <input
                  type="number"
                  min={1}
                  max={8192}
                  value={width}
                  onChange={(e) => handleWidthChange(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  disabled={isProcessing}
                />
              </label>
              <button
                type="button"
                onClick={() => setLockAspect(!lockAspect)}
                className={cn(
                  "mb-1 cursor-pointer rounded p-1.5 text-sm transition-colors",
                  lockAspect ? "text-accent" : "text-text-muted",
                )}
                title={lockAspect ? "Aspect ratio locked" : "Aspect ratio unlocked"}
                aria-label={lockAspect ? "Unlock aspect ratio" : "Lock aspect ratio"}
                aria-pressed={lockAspect}
              >
                {lockAspect ? "🔗" : "🔓"}
              </button>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-body text-[11px] text-text-muted">Height</span>
                <input
                  type="number"
                  min={1}
                  max={8192}
                  value={height}
                  onChange={(e) => handleHeightChange(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  disabled={isProcessing}
                />
              </label>
            </div>
          </ToolAsideSection>
        )}

        {mode === "percentage" && (
          <ToolAsideSection label="SCALE">
            <ToolChoice
              label="Scale percentage"
              disabled={isProcessing}
              value={percentage}
              onChange={setPercentage}
              options={PERCENTAGE_PRESETS.map((p) => ({ value: p, label: `${p}%` }))}
            />
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={500}
                value={percentage}
                onChange={(e) => setPercentage(Number(e.target.value))}
                aria-label="Scale percentage"
                className="w-20 rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
              <span className="text-xs text-text-muted">%</span>
            </div>
          </ToolAsideSection>
        )}

        <ToolAsideSection>
          <ToolSlider
            label="Output quality"
            display={`${Math.round(quality * 100)}%`}
            min={0.1}
            max={1}
            step={0.05}
            value={quality}
            onChange={setQuality}
            disabled={isProcessing}
          />
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Dimensions", outDims],
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
