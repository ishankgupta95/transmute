"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { videoMeta, type Dimensions } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import {
  CanvasHeader,
  CanvasStage,
  Filmstrip,
  StatStrip,
  TrimControls,
} from "@/components/tools/ToolCanvas";
import { extractFilmstrip } from "@/lib/tools/media-preview";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolPresets,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

const FPS_OPTIONS = [8, 10, 15, 20];
const WIDTH_OPTIONS = [240, 320, 480, 640];

/* The doc's presets, constrained to fps/width values the chips offer. */
const PRESETS = [
  { id: "chat", label: "Chat / Slack", note: "480 px at 10 fps — small enough to drop in a thread." },
  { id: "readme", label: "README demo", note: "640 px, 15 fps. Crisp on a code host." },
  { id: "tiny", label: "Smallest", note: "320 px, 8 fps. The smallest usable file." },
  { id: "custom", label: "Custom", note: "Every control unlocked. Nothing is assumed." },
] as const;
/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

export function VideoToGifUI() {
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap; the hand-rolled version only
  // revoked on swap, so navigating away pinned the source blob for the tab.
  const videoUrl = useObjectUrl(file);
  const [frames, setFrames] = useState<string[]>([]);
  const [duration, setDuration] = useState(0);
  /* The doc's video readout leads with the frame size: "1920 × 1080 · 00:47.2
     · 28.6 MB". It comes off the same `loadedmetadata` the duration does. */
  const [videoDims, setVideoDims] = useState<Dimensions | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [fps, setFps] = useState(10);
  const [width, setWidth] = useState(320);
  const [preset, setPreset] = useState<string>("custom");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const processFn = useCallback(
    async (f: File, _options: void, ctx: FileProcessorContext) => {
      const { videoToGif } = await import("@/lib/tools/video-to-gif");
      return videoToGif(f, { startTime, endTime, fps, width }, ctx);
    },
    [startTime, endTime, fps, width],
  );

  // `void` options: `processFn` closes over the clip and encoder settings. The
  // hook's signal stops the frame walk, which is where the time goes here.
  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  const resultUrl = useObjectUrl(result?.blob);

  /*
    Every control below changes what the next run would produce, so each drops a
    finished GIF first. Without that the FRAMES / WIDTH / CLIP readouts recompute
    from the new settings while the Download button still holds the old bytes,
    and there is no way to re-run — the primary has been replaced by Download.
    Clearing the result puts the primary back.
  */
  const invalidate = useCallback(() => {
    if (result) reset();
  }, [result, reset]);

  const applyPreset = useCallback(
    (id: string) => {
      invalidate();
      setPreset(id);
      if (id === "chat") {
        setWidth(480);
        setFps(10);
      } else if (id === "readme") {
        setWidth(640);
        setFps(15);
      } else if (id === "tiny") {
        setWidth(320);
        setFps(8);
      }
    },
    [invalidate],
  );

  // Any hand edit un-lights the preset chip, so what's lit is what runs.
  const touch = useCallback(
    <T,>(setter: (v: T) => void) => {
      return (v: T) => {
        invalidate();
        setPreset("custom");
        setter(v);
      };
    },
    [invalidate],
  );

  const handleStartChange = useCallback(
    (v: number) => {
      invalidate();
      setStartTime(v);
    },
    [invalidate],
  );

  const handleEndChange = useCallback(
    (v: number) => {
      invalidate();
      setEndTime(v);
    },
    [invalidate],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      reset();
      setFrames([]);
      setVideoDims(null);

      // Decoration only — see VideoTrimmerUI.
      extractFilmstrip(f, FILMSTRIP_FRAMES)
        .then(setFrames)
        .catch(() => setFrames([]));
    },
    [reset],
  );

  // Reading metadata: wire to the rendered <video> element via onLoadedMetadata
  // (no need for a hidden video element). `resolveDuration` covers the
  // MediaRecorder WebM case, where the container declares no duration and the
  // element reports Infinity — that used to leave the sliders dead at max=0 and
  // the conversion produced a 1-byte "GIF".
  const handleVideoLoadedMetadata = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setVideoDims({ w: v.videoWidth, h: v.videoHeight });
    }
    const { resolveDuration } = await import("@/lib/tools/video-utils");
    const dur = await resolveDuration(v);
    if (!Number.isFinite(dur) || dur <= 0) return;
    setDuration(dur);
    setStartTime(0);
    setEndTime(Math.min(dur, 10));
  }, []);

  const handleConvert = useCallback(() => {
    if (!file) return;
    process(file);
  }, [file, process]);

  const handleReset = useCallback(() => {
    setFile(null);
    setDuration(0);
    setVideoDims(null);
    setStartTime(0);
    setEndTime(0);
    reset();
  }, [reset]);

  if (!file) {
    return <DropZone accept=".mp4,.webm,.mov" onFiles={handleFiles} />;
  }

  // The filmstrip overlay works in percentages of the clip.
  const startPct = duration ? (startTime / duration) * 100 : 0;
  const endPct = duration ? (endTime / duration) * 100 : 100;

  return (
    <>
      {/* ── Canvas: the source clip, then the finished GIF ───── */}
      <div className={CANVAS_COLUMN}>
        {/* No trailing stat — `TrimControls` already carries the CLIP readout. */}
        <CanvasHeader
          file={file.name}
          meta={videoMeta(videoDims, duration ? formatTime(duration) : null, formatFileSize(file.size))}
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
            <span className="absolute top-3 right-3.5 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-accent-300">
              GIF
            </span>
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

        {status === "error" && error && <ErrorMessage message={error} />}

        <StatStrip
          stats={[
            { label: "CLIP", value: formatTime(Math.max(0, endTime - startTime)), tone: "neutral" },
            { label: "FRAMES", value: String(Math.max(0, Math.round((endTime - startTime) * fps))) },
            { label: "WIDTH", value: `${width}px`, tone: "neutral" },
            { label: "GIF", value: result ? formatFileSize(result.newSize) : "—", tone: "ok" },
          ]}
        />

        {/*
          The finished GIF gets the same plate and the same mono label as every
          other panel on this canvas. The height bound matters: without it
          `max-h-full` resolves against an auto-height parent and a large GIF
          paints at natural size, past the canvas band.
        */}
        {result && resultUrl && (
          <>
            <CanvasHeader
              file={result.fileName}
              meta={formatFileSize(result.newSize)}
              trailing="GIF"
            />
            <CanvasStage className="flex max-h-[clamp(12rem,34vh,28rem)] items-center justify-center bg-black p-3">
              <img
                src={resultUrl}
                alt="Animated GIF result"
                className="max-h-full max-w-full object-contain"
              />
            </CanvasStage>
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/* The doc pins the running readout to the rail footer, above the
                button that started it. The frame walk reports nothing until
                the first frame lands, so stay indeterminate rather than
                sitting pinned at 0%. */}
            {status === "processing" && (
              <ToolProgress
                phase="ENCODING GIF"
                percent={progress > 0 ? progress : null}
                label="Converting video to GIF"
              />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : status === "processing" ? (
              // The one reachable control while the frame walk runs. It
              // replaces the primary rather than sitting beside it so "Cancel"
              // is never two different things at once.
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions
                primaryLabel="Convert to GIF"
                onPrimary={handleConvert}
                primaryDisabled={duration <= 0 || endTime - startTime <= 0.05}
              />
            )}
            {status !== "processing" && (
              <ToolResetLink
                onClick={handleReset}
                label={result ? "CONVERT ANOTHER" : "CANCEL"}
              />
            )}
          </>
        }
      >
        <ToolPresets
          presets={PRESETS}
          active={preset}
          onSelect={applyPreset}
          disabled={status === "processing"}
        />

        <ToolControlGroup>
          <ToolControl label="FRAME RATE">
            <ToolChoice
              label="Frame rate"
              fill
              value={fps}
              onChange={touch(setFps)}
              disabled={status === "processing"}
              options={FPS_OPTIONS.map((f) => ({ value: f, label: String(f) }))}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              fps. Every frame is stored whole in a GIF, so this drives the file size hardest.
            </span>
          </ToolControl>

          <ToolControl label="WIDTH">
            <ToolChoice
              label="Width"
              fill
              value={width}
              onChange={touch(setWidth)}
              disabled={status === "processing"}
              options={WIDTH_OPTIONS.map((w) => ({ value: w, label: String(w) }))}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              px — height follows the source aspect ratio.
            </span>
          </ToolControl>
        </ToolControlGroup>

        {/* Engine facts, all true of video-to-gif.ts (gifenc) as written. */}
        <ToolAdvanced
          rows={[
            ["Palette", "256 / FRAME (RGB444)"],
            ["Dither", "NONE — NEAREST MATCH"],
            ["Loop", "INFINITE"],
          ]}
        />

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Clip", formatTime(Math.max(0, endTime - startTime))],
              ["Frames", String(Math.max(0, Math.round((endTime - startTime) * fps)))],
              ["GIF", result ? formatFileSize(result.newSize) : "—"],
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
