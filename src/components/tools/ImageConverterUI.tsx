"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { convertImage, type ImageConvertOptions } from "@/lib/tools/image-convert";
import { useFileProcessor } from "@/hooks/useFileProcessor";

interface ImageConverterUIProps {
  acceptFormats: string;
  targetFormat: "jpeg" | "png" | "webp" | "bmp";
  sourceFormat: string;
}

export function ImageConverterUI({
  acceptFormats,
  targetFormat,
  sourceFormat,
}: ImageConverterUIProps) {
  const [quality, setQuality] = useState(0.85);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const processFn = useCallback(
    (f: File, opts: ImageConvertOptions) => convertImage(f, opts),
    [],
  );

  const { status, result, error, process, reset } = useFileProcessor(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      reset();

      // Create preview for the input file (if browser can display it)
      const url = URL.createObjectURL(f);
      setPreviewUrl(url);
    },
    [reset],
  );

  const handleConvert = useCallback(() => {
    if (!file) return;
    process(file, { targetFormat, quality });
  }, [file, process, targetFormat, quality]);

  const handleReset = useCallback(() => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    reset();
  }, [previewUrl, reset]);

  const resultPreviewUrl = result ? URL.createObjectURL(result.blob) : null;

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept={acceptFormats} onFiles={handleFiles} />
      ) : (
        <>
          {/* Preview row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FilePreview
              fileName={file.name}
              fileSize={file.size}
              previewUrl={
                sourceFormat !== "heic" && sourceFormat !== "heif" && sourceFormat !== "tiff"
                  ? previewUrl ?? undefined
                  : undefined
              }
              label="Original"
            />
            {result && (
              <FilePreview
                fileName={result.fileName}
                fileSize={result.newSize}
                previewUrl={resultPreviewUrl ?? undefined}
                label="Converted"
              />
            )}
          </div>

          {/* Quality slider */}
          {(targetFormat === "jpeg" || targetFormat === "webp") && (
            <div>
              <label className="flex items-center justify-between text-sm text-text-secondary mb-2">
                <span>Quality</span>
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
                disabled={status === "processing"}
              />
            </div>
          )}

          {/* Progress */}
          {status === "processing" && (
            <div className="space-y-2">
              <ProgressBar progress={50} />
              <p className="text-sm text-text-muted text-center">Converting...</p>
            </div>
          )}

          {/* Error */}
          {status === "error" && (
            <p className="text-sm text-error text-center">{error}</p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            {status !== "done" && status !== "processing" && (
              <button
                onClick={handleConvert}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Convert
              </button>
            )}
            {result && (
              <DownloadButton blob={result.blob} fileName={result.fileName} />
            )}
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              {result ? "Convert another" : "Cancel"}
            </button>
          </div>

          {/* Size comparison */}
          {result && (
            <p className="text-sm text-text-muted text-center">
              {formatSizeComparison(file.size, result.newSize)}
            </p>
          )}
        </>
      )}
    </div>
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
