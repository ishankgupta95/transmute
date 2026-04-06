"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";

type Status = "idle" | "processing" | "done" | "error";

const BITRATE_OPTIONS = [128, 192, 256, 320];

export function Mp4ToMp3UI() {
  const [file, setFile] = useState<File | null>(null);
  const [bitrate, setBitrate] = useState(192);
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
      const { mp4ToMp3 } = await import("@/lib/tools/mp4-to-mp3");
      const output = await mp4ToMp3(file, { bitrate }, setProgress);
      setResult({ blob: output.blob, fileName: output.fileName, size: output.newSize });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
      setStatus("error");
    }
  }, [file, bitrate]);

  const handleReset = useCallback(() => {
    setFile(null);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept=".mp4,.webm,.mov,.avi,.mkv" onFiles={handleFiles} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FilePreview fileName={file.name} fileSize={file.size} label="Video" />
            {result && (
              <FilePreview fileName={result.fileName} fileSize={result.size} label="Audio" />
            )}
          </div>

          {/* Bitrate selector */}
          <div>
            <label className="flex items-center justify-between text-sm text-text-secondary mb-2">
              <span>Bitrate</span>
              <span className="font-mono text-text-muted">{bitrate} kbps</span>
            </label>
            <div className="flex gap-2">
              {BITRATE_OPTIONS.map((b) => (
                <button
                  key={b}
                  onClick={() => setBitrate(b)}
                  disabled={status === "processing"}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    bitrate === b
                      ? "border-accent bg-accent-muted text-accent"
                      : "border-border text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          {status === "processing" && (
            <div className="space-y-2">
              <ProgressBar progress={progress} />
              <p className="text-sm text-text-muted text-center">
                Extracting audio{progress > 0 ? ` (${progress}%)` : "..."}
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
                Extract Audio
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

          {result && (
            <p className="text-sm text-text-muted text-center">
              {Math.round(((file.size - result.size) / file.size) * 100)}% smaller than the video
            </p>
          )}
        </>
      )}
    </div>
  );
}
