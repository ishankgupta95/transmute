"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { encodeIcoAsync } from "@/lib/tools/ico-encode";
import { formatFileSize } from "@/lib/utils/file-helpers";

const ICO_SIZES = [16, 32, 48];

interface PngToIcoUIProps {
  acceptFormats: string;
}

export function PngToIcoUI({ acceptFormats }: PngToIcoUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ blob: Blob; fileName: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);

    try {
      const img = await loadImage(file);
      const images = ICO_SIZES.map((size) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context not available");
        ctx.drawImage(img, 0, 0, size, size);
        return { canvas, size };
      });

      const icoBlob = await encodeIcoAsync(images);
      const baseName = file.name.replace(/\.[^.]+$/, "");
      setResult({ blob: icoBlob, fileName: `${baseName}.ico` });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
    }
    setIsProcessing(false);
  }, [file]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept={acceptFormats} onFiles={handleFiles} />
      ) : (
        <>
          {/* File info */}
          <div className="rounded-lg border border-border bg-bg-secondary p-4 text-center">
            <p className="text-sm text-text-primary font-medium">{file.name}</p>
            <p className="text-xs text-text-muted">{formatFileSize(file.size)}</p>
            <p className="text-xs text-text-muted mt-2">
              Will generate ICO with sizes: {ICO_SIZES.join("×, ")}×{ICO_SIZES[ICO_SIZES.length - 1]} px
            </p>
          </div>

          {/* Progress */}
          {isProcessing && (
            <div className="space-y-2">
              <ProgressBar progress={50} />
              <p className="text-sm text-text-muted text-center">Converting...</p>
            </div>
          )}

          {error && <p className="text-sm text-error text-center">{error}</p>}

          {result && (
            <div className="rounded-lg border border-border bg-bg-secondary p-4 text-center">
              <p className="text-sm text-text-muted">
                ICO file ready · {formatFileSize(result.blob.size)}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            {!result && !isProcessing && (
              <button
                onClick={handleConvert}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Convert to ICO
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
        </>
      )}
    </div>
  );
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(file);
  });
}
