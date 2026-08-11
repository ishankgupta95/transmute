"use client";

import { useCallback, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  CanvasStage,
  Filmstrip,
  StatStrip,
  TrimControls,
} from "@/components/tools/ToolCanvas";
import { extractFilmstrip } from "@/lib/tools/media-preview";

/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

export function VideoTrimmerUI() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const processFn = useCallback(
    async (f: File, _options: void, ctx: FileProcessorContext) => {
      const { trimVideo } = await import("@/lib/tools/video-trim");
      return trimVideo(f, { startTime, endTime }, ctx);
    },
    [startTime, endTime],
  );

  // `void` options: `processFn` closes over the selection. The hook's signal
  // reaches FFmpeg, where cancelling means terminating the worker.
  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      reset();
      setFrames([]);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(f);
      });

      // Decoration only — a container we cannot seek into just leaves the strip
      // as empty cells rather than failing the trim.
      extractFilmstrip(f, FILMSTRIP_FRAMES)
        .then(setFrames)
        .catch(() => setFrames([]));
    },
    [reset],
  );

  // Duration comes off the <video> we already render. The previous detached
  // metadata element was never revoked or released, so every file loaded here
  // leaked one video element plus its object URL.
  const handleVideoLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.duration)) return;
    setDuration(v.duration);
    setStartTime(0);
    setEndTime(v.duration);
  }, []);

  const handleTrim = useCallback(() => {
    if (!file) return;
    process(file);
  }, [file, process]);

  const handleReset = useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(null);
    setVideoUrl(null);
    setDuration(0);
    reset();
  }, [videoUrl, reset]);

  if (!file) {
    return <DropZone accept=".mp4,.webm,.mov,.avi,.mkv" sizeCapMB={100} onFiles={handleFiles} />;
  }

  // The filmstrip overlay works in percentages of the clip.
  const startPct = duration ? (startTime / duration) * 100 : 0;
  const endPct = duration ? (endTime / duration) * 100 : 100;

  return (
    <>
      {/* ── Canvas: the clip, its filmstrip, and the selection ── */}
      <div className="min-w-0 space-y-[13px]">
        {/* No trailing stat — `TrimControls` already carries the CLIP readout. */}
        <CanvasHeader
          file={file.name}
          meta={`${formatFileSize(file.size)} · ${formatTime(duration)}`}
        />

        {videoUrl && (
          <CanvasStage className="flex items-center justify-center bg-black">
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              onLoadedMetadata={handleVideoLoadedMetadata}
              className="max-h-72 w-full bg-black"
            />
          </CanvasStage>
        )}

        <Filmstrip frames={frames} startPct={startPct} endPct={endPct} />

        <TrimControls
          start={startTime}
          end={endTime}
          duration={duration}
          onStartChange={setStartTime}
          onEndChange={setEndTime}
          format={formatTime}
          summaryLabel="CLIP"
          startName="Clip start"
          endName="Clip end"
          disabled={status === "processing"}
        />

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

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
            { label: "CLIP", value: formatTime(Math.max(0, endTime - startTime)), tone: "ok" },
            {
              label: "PROGRESS",
              value: status === "processing" ? `${progress}%` : status === "done" ? "100%" : "—",
              tone: "neutral",
            },
          ]}
        />
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : status === "processing" ? (
              // The one reachable control while FFmpeg runs. It replaces the
              // primary rather than sitting beside it so "Cancel" is never two
              // different things at once.
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions primaryLabel="Trim" onPrimary={handleTrim} />
            )}
            {status !== "processing" && (
              <ToolResetLink onClick={handleReset} label={result ? "TRIM ANOTHER" : "CANCEL"} />
            )}
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Selected", formatTime(Math.max(0, endTime - startTime))],
              ["Trimmed", result ? formatFileSize(result.newSize) : "—"],
              ["Progress", status === "processing" ? `${progress}%` : status === "done" ? "100%" : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${ms}`;
}
