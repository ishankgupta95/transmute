"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { StatusMessage } from "@/components/tools/StatusMessage";
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
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [frames, setFrames] = useState<string[]>([]);
  const [duration, setDuration] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [fps, setFps] = useState(10);
  const [width, setWidth] = useState(320);
  const [preset, setPreset] = useState<string>("custom");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const applyPreset = useCallback((id: string) => {
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
  }, []);

  // Any hand edit un-lights the preset chip, so what's lit is what runs.
  const touch = useCallback(<T,>(setter: (v: T) => void) => {
    return (v: T) => {
      setPreset("custom");
      setter(v);
    };
  }, []);

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

      // Decoration only — see VideoTrimmerUI.
      extractFilmstrip(f, FILMSTRIP_FRAMES)
        .then(setFrames)
        .catch(() => setFrames([]));
    },
    [reset],
  );

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

  const handleConvert = useCallback(() => {
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
    return <DropZone accept=".mp4,.webm,.mov" onFiles={handleFiles} />;
  }

  // The filmstrip overlay works in percentages of the clip.
  const startPct = duration ? (startTime / duration) * 100 : 0;
  const endPct = duration ? (endTime / duration) * 100 : 100;

  return (
    <>
      {/* ── Canvas: the source clip, then the finished GIF ───── */}
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

        <StatStrip
          stats={[
            { label: "CLIP", value: formatTime(Math.max(0, endTime - startTime)), tone: "neutral" },
            { label: "FRAMES", value: String(Math.max(0, Math.round((endTime - startTime) * fps))) },
            { label: "WIDTH", value: `${width}px`, tone: "neutral" },
            { label: "GIF", value: result ? formatFileSize(result.newSize) : "—", tone: "ok" },
          ]}
        />

        {result && (
          <>
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
              // The one reachable control while the frame walk runs. It
              // replaces the primary rather than sitting beside it so "Cancel"
              // is never two different things at once.
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions primaryLabel="Convert to GIF" onPrimary={handleConvert} />
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

        <ToolAsideSection label="FRAME RATE">
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
        </ToolAsideSection>

        <ToolAsideSection label="WIDTH">
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
        </ToolAsideSection>

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
