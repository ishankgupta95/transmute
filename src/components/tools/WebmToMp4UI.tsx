"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";

type Status = "idle" | "processing" | "done" | "error";

export function WebmToMp4UI() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; fileName: string; size: number } | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setProgress(0);
    setError(null);
    setResult(null);
    try {
      const { webmToMp4 } = await import("@/lib/tools/webm-to-mp4");
      const output = await webmToMp4(file, setProgress);
      setResult({ blob: output.blob, fileName: output.fileName, size: output.newSize });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
      setStatus("error");
    }
  }, [file]);

  const handleReset = useCallback(() => {
    setFile(null);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept=".webm" onFiles={handleFiles} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FilePreview fileName={file.name} fileSize={file.size} label="Original" />
            {result && (
              <FilePreview fileName={result.fileName} fileSize={result.size} label="Converted" />
            )}
          </div>

          {status === "processing" && (
            <div className="space-y-2">
              <ProgressBar progress={progress} />
              <p className="text-sm text-text-muted text-center">
                Converting to MP4{progress > 0 ? ` (${progress}%)` : "..."}
              </p>
            </div>
          )}

          {status === "error" && (
            <p className="text-sm text-error text-center">{error}</p>
          )}

          <div className="flex items-center justify-center gap-3">
            {status !== "done" && status !== "processing" && (
              <button
                onClick={handleConvert}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Convert to MP4
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
