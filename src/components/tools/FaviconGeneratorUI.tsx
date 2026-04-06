"use client";

import { useCallback, useState } from "react";
import JSZip from "jszip";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { encodeIcoAsync } from "@/lib/tools/ico-encode";
import { formatFileSize } from "@/lib/utils/file-helpers";

const FAVICON_SIZES = [
  { size: 16, name: "favicon-16x16.png", label: "16×16 (Browser tab)" },
  { size: 32, name: "favicon-32x32.png", label: "32×32 (Browser tab)" },
  { size: 48, name: "favicon-48x48.png", label: "48×48 (Windows)" },
  { size: 180, name: "apple-touch-icon.png", label: "180×180 (Apple Touch)" },
  { size: 192, name: "android-chrome-192x192.png", label: "192×192 (PWA)" },
  { size: 512, name: "android-chrome-512x512.png", label: "512×512 (PWA)" },
];

export function FaviconGeneratorUI({ acceptFormats }: { acceptFormats: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ blob: Blob } | null>(null);
  const [htmlSnippet, setHtmlSnippet] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);

    try {
      const img = await loadImage(file);
      const zip = new JSZip();

      // Generate each size as PNG
      for (const { size, name } of FAVICON_SIZES) {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context not available");
        ctx.drawImage(img, 0, 0, size, size);
        const blob = await canvasToBlob(canvas, "image/png");
        zip.file(name, blob);
      }

      // Generate ICO (16, 32, 48)
      const icoSizes = [16, 32, 48];
      const icoImages = icoSizes.map((size) => {
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context not available");
        ctx.drawImage(img, 0, 0, size, size);
        return { canvas, size };
      });
      const icoBlob = await encodeIcoAsync(icoImages);
      zip.file("favicon.ico", icoBlob);

      const zipBlob = await zip.generateAsync({ type: "blob" });
      setResult({ blob: zipBlob });

      setHtmlSnippet(
        `<link rel="icon" type="image/x-icon" href="/favicon.ico" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    }
    setIsProcessing(false);
  }, [file]);

  const handleCopySnippet = useCallback(() => {
    navigator.clipboard.writeText(htmlSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [htmlSnippet]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    setHtmlSnippet("");
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
          </div>

          {/* Sizes to generate */}
          {!result && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {FAVICON_SIZES.map(({ label }) => (
                <div
                  key={label}
                  className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted"
                >
                  {label}
                </div>
              ))}
              <div className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted">
                favicon.ico (multi-size)
              </div>
            </div>
          )}

          {/* Progress */}
          {isProcessing && (
            <div className="space-y-2">
              <ProgressBar progress={50} />
              <p className="text-sm text-text-muted text-center">Generating favicons...</p>
            </div>
          )}
          {error && <p className="text-sm text-error text-center">{error}</p>}

          {/* HTML snippet */}
          {htmlSnippet && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-text-secondary">
                  Add this to your {"<head>"}:
                </span>
                <button
                  onClick={handleCopySnippet}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="rounded-lg border border-border bg-bg-elevated p-3 text-xs text-text-secondary font-mono overflow-x-auto">
                {htmlSnippet}
              </pre>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            {!result && !isProcessing && (
              <button
                onClick={handleGenerate}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Generate All Favicons
              </button>
            )}
            {result && (
              <DownloadButton blob={result.blob} fileName="favicons.zip" />
            )}
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              {result ? "Generate for another" : "Cancel"}
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

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas export failed"));
      },
      mimeType,
    );
  });
}
