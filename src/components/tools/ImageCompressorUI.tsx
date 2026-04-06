"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { compressImage, type ImageCompressOptions } from "@/lib/tools/image-compress";
import { useFileProcessor, type ProcessedResult } from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";

interface ImageCompressorUIProps {
  acceptFormats: string;
  defaultTargetSizeKb?: number;
}

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
  const [results, setResults] = useState<(ProcessedResult | null)[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback((incoming: File[]) => {
    setFiles(incoming);
    setResults([]);
    setError(null);
  }, []);

  const handleCompress = useCallback(async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setError(null);
    const opts: ImageCompressOptions = { mode, quality, targetSizeKb };
    const out: (ProcessedResult | null)[] = [];

    for (const file of files) {
      try {
        const result = await compressImage(file, opts);
        out.push(result);
      } catch (err) {
        out.push(null);
        setError(err instanceof Error ? err.message : "Compression failed");
      }
    }

    setResults(out);
    setIsProcessing(false);
  }, [files, mode, quality, targetSizeKb]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setResults([]);
    setError(null);
  }, []);

  const totalOriginal = results.reduce((sum, r) => sum + (r?.originalSize ?? 0), 0);
  const totalNew = results.reduce((sum, r) => sum + (r?.newSize ?? 0), 0);
  const successCount = results.filter((r) => r !== null).length;

  return (
    <div className="space-y-6">
      {files.length === 0 ? (
        <DropZone accept={acceptFormats} multiple onFiles={handleFiles} />
      ) : (
        <>
          {/* File count summary */}
          <div className="text-center text-sm text-text-secondary">
            {files.length} file{files.length > 1 ? "s" : ""} selected
            {" · "}
            {formatFileSize(files.reduce((s, f) => s + f.size, 0))} total
          </div>

          {/* Mode toggle */}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setMode("quality")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                mode === "quality"
                  ? "bg-accent text-bg-primary"
                  : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
              }`}
            >
              Quality
            </button>
            <button
              onClick={() => setMode("target-size")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                mode === "target-size"
                  ? "bg-accent text-bg-primary"
                  : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
              }`}
            >
              Target Size
            </button>
          </div>

          {/* Options */}
          {mode === "quality" ? (
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
                disabled={isProcessing}
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm text-text-secondary mb-2">
                Target file size
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={10240}
                  value={targetSizeKb}
                  onChange={(e) => setTargetSizeKb(Number(e.target.value))}
                  className="w-24 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary"
                  disabled={isProcessing}
                />
                <span className="text-sm text-text-muted">KB</span>
              </div>
              <div className="flex gap-2 mt-2">
                {[50, 100, 200, 500, 1024].map((kb) => (
                  <button
                    key={kb}
                    onClick={() => setTargetSizeKb(kb)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      targetSizeKb === kb
                        ? "bg-accent text-bg-primary"
                        : "bg-bg-elevated text-text-muted hover:bg-bg-hover"
                    }`}
                  >
                    {kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Progress */}
          {isProcessing && (
            <div className="space-y-2">
              <ProgressBar progress={50} />
              <p className="text-sm text-text-muted text-center">Compressing...</p>
            </div>
          )}

          {/* Error */}
          {error && <p className="text-sm text-error text-center">{error}</p>}

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-3">
              {results.map((result, i) => {
                if (!result) return null;
                const pct = Math.round(
                  ((result.originalSize - result.newSize) / result.originalSize) * 100,
                );
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-border bg-bg-secondary p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary truncate">{result.fileName}</p>
                      <p className="text-xs text-text-muted">
                        {formatFileSize(result.originalSize)} → {formatFileSize(result.newSize)}
                        {pct > 0 && (
                          <span className="text-success ml-1">({pct}% smaller)</span>
                        )}
                      </p>
                    </div>
                    <DownloadButton blob={result.blob} fileName={result.fileName} className="ml-3 shrink-0" />
                  </div>
                );
              })}
              {successCount > 0 && (
                <p className="text-sm text-text-muted text-center">
                  Total: {formatFileSize(totalOriginal)} → {formatFileSize(totalNew)}
                  {totalOriginal > totalNew && (
                    <span className="text-success ml-1">
                      ({Math.round(((totalOriginal - totalNew) / totalOriginal) * 100)}% saved)
                    </span>
                  )}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            {results.length === 0 && !isProcessing && (
              <button
                onClick={handleCompress}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Compress
              </button>
            )}
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              {results.length > 0 ? "Compress more" : "Cancel"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
