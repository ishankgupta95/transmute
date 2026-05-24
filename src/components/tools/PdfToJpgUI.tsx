"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { Download } from "lucide-react";
import { pdfToImages } from "@/lib/tools/pdf-engine";
import { triggerDownload } from "@/lib/utils/download";

export function PdfToJpgUI() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<"jpeg" | "png">("jpeg");
  const [quality, setQuality] = useState(0.85);
  const [scale, setScale] = useState(2);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [results, setResults] = useState<{ blob: Blob; name: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResults([]);
    setStatus("idle");
    setError(null);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const images = await pdfToImages(buf, format, quality, scale);
      setResults(images.map((img) => ({ ...img, url: URL.createObjectURL(img.blob) })));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert PDF");
      setStatus("error");
    }
  }, [file, format, quality, scale]);

  const handleReset = useCallback(() => {
    results.forEach((r) => URL.revokeObjectURL(r.url));
    setFile(null);
    setResults([]);
    setStatus("idle");
    setError(null);
  }, [results]);

  const downloadAll = useCallback(() => {
    results.forEach((r) => triggerDownload(r.blob, r.name));
  }, [results]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">{file.name}</p>
        <button onClick={handleReset} className="text-sm text-text-muted hover:text-text-secondary transition-colors">
          Change file
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <label className="block text-xs text-text-muted mb-1">Format</label>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as "jpeg" | "png")}
            className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="jpeg">JPG</option>
            <option value="png">PNG</option>
          </select>
        </div>
        {format === "jpeg" && (
          <div>
            <label className="block text-xs text-text-muted mb-1">Quality: {Math.round(quality * 100)}%</label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-32 accent-accent"
            />
          </div>
        )}
        <div>
          <label className="block text-xs text-text-muted mb-1">Scale: {scale}x</label>
          <input
            type="range"
            min={1}
            max={4}
            step={0.5}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            className="w-32 accent-accent"
          />
        </div>
      </div>

      {status !== "done" && (
        <button
          onClick={handleConvert}
          disabled={status === "processing"}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {status === "processing" ? "Converting…" : "Convert to Images"}
        </button>
      )}

      {status === "processing" && <ProgressBar progress={null} />}
      {error && <ErrorMessage message={error} />}

      {results.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">{results.length} page{results.length !== 1 ? "s" : ""} converted</p>
            <button
              onClick={downloadAll}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
            >
              <Download size={14} />
              Download All
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {results.map((r, idx) => (
              <div key={idx} className="rounded-lg border border-border overflow-hidden bg-bg-secondary">
                <img src={r.url} alt={`Page ${idx + 1}`} className="w-full" />
                <div className="flex items-center justify-between p-2">
                  <span className="text-xs text-text-muted">Page {idx + 1}</span>
                  <button
                    onClick={() => triggerDownload(r.blob, r.name)}
                    className="text-accent hover:text-accent-hover transition-colors"
                  >
                    <Download size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
