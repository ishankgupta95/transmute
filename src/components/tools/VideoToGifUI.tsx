"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { StatusMessage } from "@/components/tools/StatusMessage";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { useObjectUrl } from "@/hooks/useObjectUrl";

type Status = "idle" | "processing" | "done" | "error";

const FPS_OPTIONS = [8, 10, 15, 20];
const WIDTH_OPTIONS = [240, 320, 480, 640];

export function VideoToGifUI() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [fps, setFps] = useState(10);
  const [width, setWidth] = useState(320);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; fileName: string; size: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const resultUrl = useObjectUrl(result?.blob);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setStatus("idle");
    setResult(null);
    setError(null);

    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
  }, []);

  // Reading metadata: wire to the rendered <video> element via onLoadedMetadata
  // (no need for a hidden video element).
  const handleVideoLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    const dur = v.duration;
    setDuration(dur);
    setStartTime(0);
    setEndTime(Math.min(dur, 10));
  }, []);

  const handleConvert = useCallback(async () => {
    if (!file) return;
    setStatus("processing");
    setProgress(0);
    setError(null);
    setResult(null);
    try {
      const { videoToGif } = await import("@/lib/tools/video-to-gif");
      const output = await videoToGif(file, { startTime, endTime, fps, width }, setProgress);
      setResult({ blob: output.blob, fileName: output.fileName, size: output.newSize });
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversion failed");
      setStatus("error");
    }
  }, [file, startTime, endTime, fps, width]);

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
                onLoadedMetadata={handleVideoLoadedMetadata}
                className="w-full rounded max-h-64 bg-black"
              />
              <p className="text-xs text-text-muted mt-2">
                Duration: {formatTime(duration)}
              </p>
            </div>
          )}

          {/* Time range */}
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
            Clip duration: {formatTime(Math.max(0, endTime - startTime))}
          </p>

          {/* FPS selector */}
          <div>
            <label className="flex items-center justify-between text-sm text-text-secondary mb-2">
              <span>Frame rate</span>
              <span className="font-mono text-text-muted">{fps} fps</span>
            </label>
            <div className="flex gap-2">
              {FPS_OPTIONS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFps(f)}
                  disabled={status === "processing"}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    fps === f
                      ? "border-accent bg-accent-muted text-accent"
                      : "border-border text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Width selector */}
          <div>
            <label className="flex items-center justify-between text-sm text-text-secondary mb-2">
              <span>Width</span>
              <span className="font-mono text-text-muted">{width}px</span>
            </label>
            <div className="flex gap-2">
              {WIDTH_OPTIONS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  disabled={status === "processing"}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    width === w
                      ? "border-accent bg-accent-muted text-accent"
                      : "border-border text-text-secondary hover:bg-bg-hover"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>

          {status === "processing" && (
            <div className="space-y-2">
              <ProgressBar
                progress={progress > 0 ? progress : null}
                label="Converting video to GIF"
              />
              <StatusMessage>
                Converting to GIF{progress > 0 ? ` (${progress}%)` : "..."}
              </StatusMessage>
            </div>
          )}

          {status === "error" && error && <ErrorMessage message={error} />}

          {result && (
            <>
              <FilePreview fileName={result.fileName} fileSize={result.size} label="GIF" />
              {resultUrl && (
                <div className="rounded-lg border border-border bg-bg-elevated p-4">
                  <p className="text-xs text-text-muted mb-2">Preview</p>
                  <img
                    src={resultUrl}
                    alt="GIF preview"
                    className="max-w-full rounded"
                  />
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-center gap-3">
            {status !== "done" && status !== "processing" && (
              <button
                onClick={handleConvert}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
              >
                Convert to GIF
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

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${ms}`;
}
