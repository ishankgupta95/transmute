"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { mergeAudio, type AudioMergeOptions } from "@/lib/tools/audio-merge";
import { formatFileSize } from "@/lib/utils/file-helpers";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

export function AudioMergerUI() {
  const [files, setFiles] = useState<File[]>([]);
  const [outputFormat, setOutputFormat] = useState<"wav" | "mp3">("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback((newFiles: File[]) => {
    setFiles((prev) => [...prev, ...newFiles]);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveFile = useCallback((from: number, to: number) => {
    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const handleMerge = useCallback(async () => {
    if (files.length < 2) return;
    setStatus("processing");
    setError(null);
    setResult(null);
    try {
      const opts: AudioMergeOptions = { outputFormat, bitrate };
      const output = await mergeAudio(files, opts);
      setResult(output);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
      setStatus("error");
    }
  }, [files, outputFormat, bitrate]);

  const handleReset = useCallback(() => {
    setFiles([]);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      <DropZone
        accept=".mp3,.wav,.ogg,.m4a,.flac,.aac"
        multiple
        onFiles={handleFiles}
      />

      {files.length > 0 && (
        <>
          {/* File list */}
          <div className="rounded-lg border border-border divide-y divide-border">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 px-4 py-3"
              >
                <span className="text-xs font-mono text-text-muted w-6 text-center">
                  {index + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
                  <p className="text-xs text-text-muted">{formatFileSize(file.size)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => index > 0 && moveFile(index, index - 1)}
                    disabled={index === 0 || status === "processing"}
                    className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                  <button
                    onClick={() => index < files.length - 1 && moveFile(index, index + 1)}
                    disabled={index === files.length - 1 || status === "processing"}
                    className="rounded p-1 text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  <button
                    onClick={() => removeFile(index)}
                    disabled={status === "processing"}
                    className="rounded p-1 text-text-muted hover:text-error hover:bg-bg-hover transition-colors disabled:opacity-30"
                    aria-label="Remove file"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="text-sm text-text-muted text-center">
            {files.length} file{files.length !== 1 ? "s" : ""} &middot;{" "}
            {formatFileSize(files.reduce((sum, f) => sum + f.size, 0))} total
          </p>

          {/* Output format */}
          <div className="flex items-center gap-4">
            <span className="text-sm text-text-secondary">Output format:</span>
            <div className="flex gap-2">
              {(["mp3", "wav"] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setOutputFormat(fmt)}
                  disabled={status === "processing"}
                  className={`rounded-md border px-4 py-1.5 text-sm font-medium transition-colors ${
                    outputFormat === fmt
                      ? "border-accent bg-accent-muted text-accent"
                      : "border-border text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Bitrate for MP3 */}
          {outputFormat === "mp3" && (
            <div>
              <label className="flex items-center justify-between text-sm text-text-secondary mb-2">
                <span>Bitrate</span>
                <span className="font-mono text-text-muted">{bitrate} kbps</span>
              </label>
              <div className="flex gap-2">
                {[128, 192, 256, 320].map((b) => (
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
          )}

          {status === "processing" && (
            <div className="space-y-2">
              <ProgressBar progress={50} />
              <p className="text-sm text-text-muted text-center">Merging audio files...</p>
            </div>
          )}

          {status === "error" && (
            <p className="text-sm text-error text-center">{error}</p>
          )}

          {result && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-bg-elevated p-5">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider">Merged</span>
              <p className="text-sm font-medium text-text-primary">{result.fileName}</p>
              <p className="text-xs text-text-muted">{formatFileSize(result.newSize)}</p>
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            {status !== "done" && status !== "processing" && files.length >= 2 && (
              <button
                onClick={handleMerge}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Merge {files.length} files
              </button>
            )}
            {result && (
              <DownloadButton blob={result.blob} fileName={result.fileName} />
            )}
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              {result ? "Start over" : "Clear all"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
