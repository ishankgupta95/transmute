"use client";

import { useCallback, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
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
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
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
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<"custom" | "preset" | "percentage">("preset");
  const [width, setWidth] = useState(1080);
  const [height, setHeight] = useState(1080);
  const [lockAspect, setLockAspect] = useState(true);
  // The ratio the lock enforces. Seeded from the source on load, re-seeded from
  // the fields whenever the user re-locks — so a preset's ratio is never
  // silently overwritten by the source photo's.
  const [ratio, setRatio] = useState<number | null>(null);
  const [percentage, setPercentage] = useState(50);
  const [quality, setQuality] = useState(0.9);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both URLs are hook-owned: revoked on unmount and when the source changes,
  // which a hand-rolled createObjectURL in a handler never was.
  const previewUrl = useObjectUrl(file);
  const resultPreviewUrl = useObjectUrl(result?.blob);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);

    // Throwaway URL just to read the intrinsic size; the preview URL belongs
    // to useObjectUrl and must not be revoked here.
    const probe = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
      setRatio(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null);
      URL.revokeObjectURL(probe);
    };
    img.onerror = () => {
      setError("Could not read this image. Try a different file.");
      URL.revokeObjectURL(probe);
    };
    img.src = probe;
  }, []);

  const handleWidthChange = useCallback(
    (w: number) => {
      // Any change to the target invalidates the blob the Download button
      // holds; dropping it restores the Resize action so it can be re-run.
      setResult(null);
      setWidth(w);
      if (lockAspect && ratio) setHeight(Math.max(1, Math.round(w / ratio)));
    },
    [lockAspect, ratio],
  );

  const handleHeightChange = useCallback(
    (h: number) => {
      setResult(null);
      setHeight(h);
      if (lockAspect && ratio) setWidth(Math.max(1, Math.round(h * ratio)));
    },
    [lockAspect, ratio],
  );

  const handlePreset = useCallback((pw: number, ph: number) => {
    setResult(null);
    setMode("preset");
    setWidth(pw);
    setHeight(ph);
    // A preset pins BOTH dimensions. Leaving the lock on would let the next
    // nudge rewrite the preset's ratio back to the source's.
    setLockAspect(false);
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
    setFile(null);
    setNaturalSize(null);
    setRatio(null);
    setResult(null);
    setError(null);
  }, []);

  if (!file) {
    return (
      <DropZone accept={acceptFormats} onFiles={handleFiles} label="Upload an image to resize" />
    );
  }

  const outDims =
    mode === "percentage" && naturalSize
      ? `${Math.round((naturalSize.w * percentage) / 100)} × ${Math.round((naturalSize.h * percentage) / 100)}`
      : `${width} × ${height}`;

  // Mirrors `resizeOutputFormat` in the worker (and `outputFormat` in
  // lib/tools/image-resize.ts): this tool has no target-format control, so the
  // SOURCE extension alone decides the encoder — and PNG ignores `quality`.
  const srcExt = file.name.split(".").pop()?.toLowerCase() ?? "";
  const outFmt = ["png", "gif", "svg"].includes(srcExt)
    ? "PNG"
    : ["webp", "avif"].includes(srcExt)
      ? "WEBP"
      : "JPG";
  const lossyOut = outFmt !== "PNG";

  return (
    <>
      {/* ── Canvas: the doc's before/after wipe + stat strip ── */}
      <div className={CANVAS_COLUMN}>
        {/* The doc's readout is dimensions AND size, not one or the other. */}
        <CanvasHeader
          file={file.name}
          meta={
            naturalSize
              ? `${naturalSize.w} × ${naturalSize.h} · ${formatFileSize(file.size)}`
              : formatFileSize(file.size)
          }
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
            {
              label: "OUT",
              value: result ? formatFileSize(result.newSize) : "—",
              // Success-green only when the file actually got smaller.
              tone: result && result.newSize <= file.size ? "ok" : "accent",
            },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {/* Warnings live on the result, so they clear with it on any option
            change — the same lifecycle the download button follows. Every
            warning renders in full; none hides behind a count. */}
        {(result?.warnings ?? []).map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}
      </div>

      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer, above the
                button that started it. The canvas resize reports no progress,
                so the bar stays indeterminate rather than inventing a number. */}
            {isProcessing && (
              <ToolProgress phase="RESIZING" percent={null} label="Resizing image" />
            )}
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
            {result && <ToolResetLink onClick={handleResize} label="RESIZE AGAIN" />}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "RESIZE ANOTHER" : "CLEAR"}
            />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="MODE">
            <ToolChoice
              label="Resize mode"
              fill
              disabled={isProcessing}
              value={mode}
              onChange={(v: "custom" | "preset" | "percentage") => {
                setMode(v);
                setResult(null);
              }}
              options={[
                { value: "preset" as const, label: "Presets" },
                { value: "custom" as const, label: "Custom" },
                { value: "percentage" as const, label: "%" },
              ]}
            />
          </ToolControl>

          {mode === "preset" && (
            <ToolControl label="PRESET">
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
            </ToolControl>
          )}

          {(mode === "custom" || mode === "preset") && (
            <ToolControl label="DIMENSIONS">
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
                  onClick={() => {
                    const next = !lockAspect;
                    // Re-locking captures what is actually in the fields, so the
                    // lock preserves the ratio the user is looking at.
                    if (next && width > 0 && height > 0) setRatio(width / height);
                    setLockAspect(next);
                  }}
                  className={cn(
                    "mb-1 cursor-pointer rounded p-1.5 transition-colors",
                    lockAspect ? "text-accent" : "text-text-muted",
                  )}
                  title={lockAspect ? "Aspect ratio locked" : "Aspect ratio unlocked"}
                  aria-label={lockAspect ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  aria-pressed={lockAspect}
                >
                  {lockAspect ? (
                    <Link2 className="size-4" aria-hidden="true" />
                  ) : (
                    <Link2Off className="size-4" aria-hidden="true" />
                  )}
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
            </ToolControl>
          )}

          {mode === "percentage" && (
            <ToolControl label="SCALE">
              <ToolChoice
                label="Scale percentage"
                fill
                disabled={isProcessing}
                value={percentage}
                onChange={(v: number) => {
                  setPercentage(v);
                  setResult(null);
                }}
                options={PERCENTAGE_PRESETS.map((p) => ({ value: p, label: `${p}%` }))}
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={percentage}
                  onChange={(e) => {
                    setPercentage(Number(e.target.value));
                    setResult(null);
                  }}
                  aria-label="Scale percentage"
                  className="w-20 rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                />
                <span className="text-xs text-text-muted">%</span>
              </div>
            </ToolControl>
          )}

          {/* PNG output ignores the quality argument entirely, so the slider is
              only offered when the encoder can act on it. */}
          {lossyOut && (
            <ToolControl>
              <ToolSlider
                label="Output quality"
                display={`${Math.round(quality * 100)}%`}
                min={0.1}
                max={1}
                step={0.05}
                value={quality}
                onChange={(v: number) => {
                  setQuality(v);
                  setResult(null);
                }}
                disabled={isProcessing}
              />
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          {/* `ToolOutput` accents its SECOND row, so the measured output size
              sits there — the doc highlights what comes out. */}
          <ToolOutput
            rows={[
              ["Format", outFmt],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              ["Dimensions", outDims],
              ["In", formatFileSize(file.size)],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
