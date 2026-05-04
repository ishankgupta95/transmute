"use client";

import { useCallback, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { formatFileSize } from "@/lib/utils/file-helpers";

type Status = "idle" | "processing" | "done" | "error";

export function VideoTrimmerUI() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; fileName: string; size: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setStatus("idle");
    setResult(null);
    setError(null);

    const url = URL.createObjectURL(f);
    setVideoUrl(url);

    const video = document.createElement("video");
    video.src = url;
    video.addEventListener("loadedmetadata", () => {
      setDuration(video.duration);
      setStartTime(0);
      setEndTime(video.duration);
    });
  }, []);

  const handleTrim = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setProgress(0);
    setError(null);
    setResult(null);
    try {
      const { trimVideo } = await import("@/lib/tools/video-trim");
      const output = await trimVideo(file, { startTime, endTime }, setProgress);
      setResult({ blob: output.blob, fileName: output.fileName, size: output.newSize });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trimming failed");
      setStatus("error");
    }
  }, [file, startTime, endTime]);

  const handleReset = useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(null);
    setVideoUrl(null);
    setDuration(0);
    setStatus("idle");
    setResult(null);
    setError(null);
  }, [videoUrl]);

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept=".mp4,.webm,.mov,.avi,.mkv" onFiles={handleFiles} />
      ) : (
        <>
          {videoUrl && (
            <div className="rounded-lg border border-border bg-bg-elevated p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
                <span className="text-xs text-text-muted">{formatFileSize(file.size)}</span>
              </div>
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="w-full rounded max-h-64 bg-black"
              />
              <p className="text-xs text-text-muted mt-2">
                Duration: {formatTime(duration)}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Start time (s)</label>
              <input
                type="number"
                min={0}
                max={endTime}
                step={0.1}
                value={startTime}
                onChange={(e) => setStartTime(Number(e.target.value))}
                disabled={status === "processing"}
                className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
              <span className="text-xs text-text-muted">{formatTime(startTime)}</span>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">End time (s)</label>
              <input
                type="number"
                min={startTime}
                max={duration}
                step={0.1}
                value={Number(endTime.toFixed(1))}
                onChange={(e) => setEndTime(Number(e.target.value))}
                disabled={status === "processing"}
                className="w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
              <span className="text-xs text-text-muted">{formatTime(endTime)}</span>
            </div>
          </div>

          <p className="text-sm text-text-secondary text-center">
            Selected: {formatTime(Math.max(0, endTime - startTime))}
          </p>

          {status === "processing" && (
            <div className="space-y-2">
              <ProgressBar progress={progress} />
              <p className="text-sm text-text-muted text-center">
                Trimming{progress > 0 ? ` (${progress}%)` : "..."}
              </p>
            </div>
          )}

          {status === "error" && (
            <ErrorMessage message={error} />
          )}

          {result && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FilePreview fileName={file.name} fileSize={file.size} label="Original" />
              <FilePreview fileName={result.fileName} fileSize={result.size} label="Trimmed" />
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            {status !== "done" && status !== "processing" && (
              <button
                onClick={handleTrim}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Trim
              </button>
            )}
            {result && (
              <DownloadButton blob={result.blob} fileName={result.fileName} />
            )}
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              {result ? "Trim another" : "Cancel"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${ms}`;
}
