"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { FilePreview } from "@/components/tools/FilePreview";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { StatusMessage } from "@/components/tools/StatusMessage";
import { useFileProcessor } from "@/hooks/useFileProcessor";
import { trimAudio, type AudioTrimOptions } from "@/lib/tools/audio-trim";
import { formatFileSize } from "@/lib/utils/file-helpers";

export function AudioTrimmerUI() {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [outputFormat, setOutputFormat] = useState<"wav" | "mp3">("mp3");
  const [bitrate, setBitrate] = useState(192);
  const [loadError, setLoadError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const processFn = useCallback(
    (f: File, opts: AudioTrimOptions) => trimAudio(f, opts),
    [],
  );

  const { status, result, error, process, reset } = useFileProcessor(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      // Revoke any prior URL before allocating a new one.
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(f);
      });
      setFile(f);
      setLoadError(null);
      setDuration(0);
      reset();
    },
    [reset],
  );

  // Read duration from the rendered <audio> via onLoadedMetadata + onError —
  // no separate hidden Audio element to leak.
  const handleAudioLoadedMetadata = useCallback(() => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(a.duration)) return;
    setDuration(a.duration);
    setStartTime(0);
    setEndTime(a.duration);
  }, []);

  const handleAudioError = useCallback(() => {
    setLoadError("Could not read this audio file. Try a different file.");
  }, []);

  const handleTrim = useCallback(() => {
    if (!file) return;
    process(file, { startTime, endTime, outputFormat, bitrate });
  }, [file, process, startTime, endTime, outputFormat, bitrate]);

  const handleReset = useCallback(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setFile(null);
    setAudioUrl(null);
    setDuration(0);
    setLoadError(null);
    reset();
  }, [audioUrl, reset]);

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone
          accept=".mp3,.wav,.ogg,.m4a,.flac,.aac"
          onFiles={handleFiles}
          label="Upload an audio file to trim"
        />
      ) : (
        <>
          {/* Audio player */}
          {audioUrl && (
            <div className="rounded-lg border border-border bg-bg-elevated p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-text-primary truncate">{file.name}</p>
                <span className="text-xs text-text-muted">{formatFileSize(file.size)}</span>
              </div>
              <audio
                ref={audioRef}
                src={audioUrl}
                controls
                onLoadedMetadata={handleAudioLoadedMetadata}
                onError={handleAudioError}
                className="w-full h-10"
              />
              <p className="text-xs text-text-muted mt-2">
                Duration: {formatTime(duration)}
              </p>
            </div>
          )}

          {loadError && <ErrorMessage message={loadError} />}

          {/* Time range inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Start time</label>
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
              <label className="block text-sm text-text-secondary mb-1">End time</label>
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

          {/* Selection duration */}
          <p className="text-sm text-text-secondary text-center">
            Selected: {formatTime(Math.max(0, endTime - startTime))}
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

          {/* Bitrate selector for MP3 */}
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
              <ProgressBar progress={null} label="Trimming audio" />
              <StatusMessage>Trimming...</StatusMessage>
            </div>
          )}

          {status === "error" && error && <ErrorMessage message={error} />}

          {result && (
            <FilePreview fileName={result.fileName} fileSize={result.newSize} label="Trimmed" />
          )}

          <div className="flex items-center justify-center gap-3">
            {status !== "done" && status !== "processing" && (
              <button
                onClick={handleTrim}
                disabled={loadError !== null}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
