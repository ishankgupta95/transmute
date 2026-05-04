"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { StatusMessage } from "@/components/tools/StatusMessage";
import {
  resizeImage,
  RESIZE_PRESETS,
  PERCENTAGE_PRESETS,
  type ImageResizeOptions,
} from "@/lib/tools/image-resize";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";

interface ImageResizerUIProps {
  acceptFormats: string;
}

export function ImageResizerUI({ acceptFormats }: ImageResizerUIProps) {
  const [file, setFile] = useState<File | null>(null);
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

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept={acceptFormats} onFiles={handleFiles} label="Upload an image to resize" />
      ) : (
        <>
          {/* Preview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FilePreview
              fileName={file.name}
              fileSize={file.size}
              previewUrl={previewUrl ?? undefined}
              label={naturalSize ? `Original (${naturalSize.w}×${naturalSize.h})` : "Original"}
            />
            {result && (
              <FilePreview
                fileName={result.fileName}
                fileSize={result.newSize}
                previewUrl={resultPreviewUrl ?? undefined}
                label="Resized"
              />
            )}
          </div>

          {/* Mode tabs */}
          <div className="flex items-center justify-center gap-2">
            {(["preset", "custom", "percentage"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  mode === m
                    ? "bg-accent text-bg-primary"
                    : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
                }`}
              >
                {m === "percentage" ? "Percentage" : m === "preset" ? "Presets" : "Custom"}
              </button>
            ))}
          </div>

          {/* Preset buttons */}
          {mode === "preset" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {RESIZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => handlePreset(p.width, p.height)}
                  className={`rounded-md border px-3 py-2 text-sm text-left transition-colors ${
                    width === p.width && height === p.height
                      ? "border-accent bg-accent-muted text-text-primary"
                      : "border-border bg-bg-secondary text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {/* Custom dimensions */}
          {(mode === "custom" || mode === "preset") && (
            <div className="flex items-center justify-center gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Width</label>
                <input
                  type="number"
                  min={1}
                  max={8192}
                  value={width}
                  onChange={(e) => handleWidthChange(Number(e.target.value))}
                  className="w-24 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary"
                  disabled={isProcessing}
                />
              </div>
              <button
                onClick={() => setLockAspect(!lockAspect)}
                className={`mt-4 rounded p-1.5 text-sm transition-colors ${
                  lockAspect ? "text-accent" : "text-text-muted"
                }`}
                title={lockAspect ? "Aspect ratio locked" : "Aspect ratio unlocked"}
                aria-label={lockAspect ? "Unlock aspect ratio" : "Lock aspect ratio"}
                aria-pressed={lockAspect}
              >
                {lockAspect ? "🔗" : "🔓"}
              </button>
              <div>
                <label className="block text-xs text-text-muted mb-1">Height</label>
                <input
                  type="number"
                  min={1}
                  max={8192}
                  value={height}
                  onChange={(e) => handleHeightChange(Number(e.target.value))}
                  className="w-24 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary"
                  disabled={isProcessing}
                />
              </div>
              <span className="mt-4 text-xs text-text-muted">px</span>
            </div>
          )}

          {/* Percentage */}
          {mode === "percentage" && (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {PERCENTAGE_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPercentage(p)}
                  className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                    percentage === p
                      ? "bg-accent text-bg-primary"
                      : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {p}%
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={500}
                value={percentage}
                onChange={(e) => setPercentage(Number(e.target.value))}
                className="w-20 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary"
              />
              <span className="text-xs text-text-muted">%</span>
            </div>
          )}

          {/* Quality */}
          <div>
            <label className="flex items-center justify-between text-sm text-text-secondary mb-2">
              <span>Output quality</span>
              <span className="font-mono text-text-muted">{Math.round(quality * 100)}%</span>
            </label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full accent-accent"
              disabled={isProcessing}
            />
          </div>

          {/* Progress / Error */}
          {isProcessing && (
            <div className="space-y-2">
              <ProgressBar progress={null} label="Resizing image" />
              <StatusMessage>Resizing...</StatusMessage>
            </div>
          )}
          {error && <ErrorMessage message={error} />}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            {!result && !isProcessing && (
              <button
                onClick={handleResize}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Resize
              </button>
            )}
            {result && (
              <DownloadButton blob={result.blob} fileName={result.fileName} />
            )}
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              {result ? "Resize another" : "Cancel"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
