"use client";

import { useCallback, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { useObjectUrl } from "@/hooks/useObjectUrl";
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
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
import { StatusMessage } from "@/components/tools/StatusMessage";
import { getToolBySlug } from "@/data/tools";

/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

/*
  Read from the registry rather than repeated as a literal: the zone's caption,
  the tool page's spec table and `trimVideo`'s own guard all have to name the
  same number, and the number is derived (see the block at the top of
  src/lib/tools/ffmpeg-loader.ts) rather than picked.
*/
const SIZE_CAP_MB = getToolBySlug("video-trimmer")?.maxSizeMB;

export function VideoTrimmerUI() {
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap; the hand-rolled version only
  // revoked on swap, so navigating away pinned the source blob for the tab.
  const videoUrl = useObjectUrl(file);
  const [frames, setFrames] = useState<string[]>([]);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** One duration probe per loaded file (see `handleVideoLoadedMetadata`). */
  const probedRef = useRef(false);

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
      probedRef.current = false;
      reset();
      setFrames([]);

      // Decoration only — a container we cannot seek into just leaves the strip
      // as empty cells rather than failing the trim.
      extractFilmstrip(f, FILMSTRIP_FRAMES)
        .then(setFrames)
        .catch(() => setFrames([]));
    },
    [reset],
  );

  const applyDuration = useCallback((d: number) => {
    setDuration(d);
    setStartTime(0);
    setEndTime(d);
  }, []);

  // Duration comes off the <video> we already render. The previous detached
  // metadata element was never revoked or released, so every file loaded here
  // leaked one video element plus its object URL.
  const handleVideoLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration) && v.duration > 0) {
      applyDuration(v.duration);
      return;
    }
    // A MediaRecorder WebM written with a timeslice — what this site's own
    // /screen-recorder produces — carries no Duration element, so the browser
    // reports Infinity. Seeking past the end forces the demuxer to resolve it.
    // Without this the sliders stayed dead at max=0 and Trim wrote an empty clip.
    if (probedRef.current) return;
    probedRef.current = true;
    const onDurationChange = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return;
      v.removeEventListener("durationchange", onDurationChange);
      const d = v.duration;
      v.currentTime = 0;
      applyDuration(d);
    };
    v.addEventListener("durationchange", onDurationChange);
    v.currentTime = 1e101;
  }, [applyDuration]);

  const handleTrim = useCallback(() => {
    if (!file) return;
    process(file);
  }, [file, process]);

  /*
    Moving either handle invalidates whatever FFmpeg already produced. Drop the
    stale result so the Download button can never hand back a clip that no
    longer matches the CLIP readout beside it — the primary comes back and the
    new selection can be run.
  */
  const handleStartChange = useCallback(
    (v: number) => {
      if (result) reset();
      setStartTime(v);
    },
    [result, reset],
  );

  const handleEndChange = useCallback(
    (v: number) => {
      if (result) reset();
      setEndTime(v);
    },
    [result, reset],
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setDuration(0);
    setStartTime(0);
    setEndTime(0);
    reset();
  }, [reset]);

  if (!file) {
    return <DropZone accept=".mp4,.webm,.mov,.avi,.mkv" sizeCapMB={SIZE_CAP_MB} onFiles={handleFiles} />;
  }

  // The filmstrip overlay works in percentages of the clip.
  const startPct = duration ? (startTime / duration) * 100 : 0;
  const endPct = duration ? (endTime / duration) * 100 : 100;

  return (
    <>
      {/* ── Canvas: the clip, its filmstrip, and the selection ── */}
      <div className={CANVAS_COLUMN}>
        {/* No trailing stat — `TrimControls` already carries the CLIP readout. */}
        <CanvasHeader
          file={file.name}
          meta={`${formatFileSize(file.size)} · ${formatTime(duration)}`}
        />

        {videoUrl && (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              onLoadedMetadata={handleVideoLoadedMetadata}
              className={cn(STAGE_MEDIA, "bg-black")}
            />
          </CanvasStage>
        )}

        <Filmstrip frames={frames} startPct={startPct} endPct={endPct} />

        <TrimControls
          start={startTime}
          end={endTime}
          duration={duration}
          onStartChange={handleStartChange}
          onEndChange={handleEndChange}
          format={formatTime}
          summaryLabel="CLIP"
          startName="Clip start"
          endName="Clip end"
          disabled={status === "processing"}
        />

        {status === "processing" && (
          <div className="space-y-2">
            <ProgressBar progress={progress > 0 ? progress : null} label="Trimming video" />
            <StatusMessage detail={progress > 0 ? ` (${progress}%)` : "..."}>
              Trimming
            </StatusMessage>
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
              <ToolActions
                primaryLabel="Trim"
                onPrimary={handleTrim}
                primaryDisabled={duration <= 0 || endTime - startTime <= 0.05}
              />
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
