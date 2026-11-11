"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
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
  ToolChoice,
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
import {
  isWebCodecsEncodeSupported,
  WEBCODECS_UNSUPPORTED_MESSAGE,
} from "@/lib/utils/webcodecs-support";
import { StatusMessage } from "@/components/tools/StatusMessage";
import { getToolBySlug } from "@/data/tools";
import type { VideoTrimResult } from "@/lib/tools/video-trim";

type CutMode = "fast" | "exact";

const CUT_MODES: readonly { value: CutMode; label: string }[] = [
  { value: "fast", label: "Fast" },
  { value: "exact", label: "Exact frame" },
];

/** Frame count the doc's strip draws. */
const FILMSTRIP_FRAMES = 16;

/*
  Read from the registry rather than repeated as a literal: the zone's caption,
  the tool page's spec table and `trimVideo`'s own guard all have to name the
  same number, and the number is derived (see the block at the top of
  src/lib/tools/ffmpeg-loader.ts) rather than picked.
*/
/**
  How long an Exact cut may sit on one progress value before the page says it
  looks stuck. MEASURED 2026-11-11 in Playwright's WebKit: the encoder passes
  the pre-flight below, yet the real pipeline parks at 15-32% with no error and
  never finishes (compress-video parks the same way, at 16%). A probe cannot see
  that, so the one honest thing left is to notice it happening.
*/
const STALL_MS = 20_000;

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
  const [chosenCutMode, setCutMode] = useState<CutMode>("fast");
  /*
    Exact frame re-encodes through WebCodecs, so it is only as available as the
    encoder. The SAME pre-flight compress-video uses, asked before anything
    starts: Safari's encoder returns no codec description, which fails the
    muxer only after a click. Only an explicit refusal sets this; a probe that
    throws is inconclusive and leaves the choice on offer. The module is
    imported on demand so the trimmer's own chunk does not carry the whole
    compress page.
  */
  const [exactProblem, setExactProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!isWebCodecsEncodeSupported()) {
      setExactProblem(WEBCODECS_UNSUPPORTED_MESSAGE);
      return;
    }
    let live = true;
    import("@/components/tools/CompressVideoUI")
      .then((m) => m.encodePipelineProblem())
      .then((message) => {
        if (live && message) setExactProblem(message);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // A refusal that lands after Exact was clicked still wins.
  const cutMode: CutMode = exactProblem ? "fast" : chosenCutMode;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /** One duration probe per loaded file (see `handleVideoLoadedMetadata`). */
  const probedRef = useRef(false);

  const processFn = useCallback(
    async (f: File, _options: void, ctx: FileProcessorContext) => {
      const { trimVideo } = await import("@/lib/tools/video-trim");
      return trimVideo(f, { startTime, endTime, exact: cutMode === "exact" }, ctx);
    },
    [startTime, endTime, cutMode],
  );

  // `void` options: `processFn` closes over the selection. The hook's signal
  // reaches FFmpeg, where cancelling means terminating the worker.
  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  // Exact cut only: has the progress value stopped moving? See STALL_MS.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    setStalled(false);
    if (status !== "processing" || cutMode !== "exact") return;
    const timer = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(timer);
  }, [status, progress, cutMode]);

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

  const handleCutModeChange = useCallback(
    (v: CutMode) => {
      if (result) reset();
      setCutMode(v);
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
    return (
      <DropZone
        accept=".mp4,.webm,.mov,.avi,.mkv"
        sizeCapMB={SIZE_CAP_MB}
        /*
          The same reason `validateFFmpegInput` gives when the engine-level
          check fires (ffmpeg-loader.ts) — a rejection at the zone should not
          be more mysterious than a rejection one layer down.
        */
        sizeCapReason="A trim keeps the original quality, so the clip comes out as large as the source and has to be held in the tab beside it. Extracting just the audio (MP4 to MP3) reads the video in place and has no cap."
        onFiles={handleFiles}
      />
    );
  }

  /*
    What the download really is, read back off the file by the engine. The
    CLIP readout used to show the SELECTION after a run, so a copy that had
    snapped back to an earlier keyframe — 1.5 s of footage starting at 0:00.0
    for a 0:00.5–0:01.5 pick — was presented as exactly what was asked for.
  */
  const trim = (result as VideoTrimResult | null)?.trim ?? null;
  const clipSeconds = trim?.actualSeconds ?? Math.max(0, endTime - startTime);
  const snapNotice =
    trim?.startedEarly && trim.actualStart !== null
      ? `This clip starts at ${formatTime(trim.actualStart)}, not ${formatTime(trim.requestedStart)}. ` +
        `A fast trim copies the video without re-encoding it, and a copy can only begin on a keyframe — ` +
        `the nearest one before your start is at ${formatTime(trim.actualStart)}, so the clip runs ` +
        `${formatTime(clipSeconds)}. Choose Exact frame to start at ${formatTime(trim.requestedStart)}: ` +
        `it re-encodes to MP4, takes about as long as the clip plays, and re-compresses the picture.`
      : null;

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

        {status === "processing" && stalled && (
          <WarningMessage
            message={`No progress for ${STALL_MS / 1000} seconds. Exact frame may not work in this browser. Cancel and use Fast, or try Chrome or Edge.`}
          />
        )}

        {status === "error" && (
          <ErrorMessage message={error} />
        )}

        {status === "done" && <WarningMessage message={snapNotice} />}

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
            {
              label: "CLIP",
              value: formatTime(clipSeconds),
              tone: trim?.startedEarly ? "accent" : "ok",
            },
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
        <ToolAsideSection label="CUT">
          <ToolChoice
            label="Cut accuracy"
            disabled={status === "processing"}
            value={cutMode}
            onChange={handleCutModeChange}
            options={exactProblem ? CUT_MODES.filter((m) => m.value === "fast") : CUT_MODES}
          />
          {exactProblem && (
            <span className="font-body text-[10.5px] leading-[1.5] text-warning">
              Exact frame is not available here. {exactProblem}
            </span>
          )}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {cutMode === "fast"
              ? "Copies the video without re-encoding: near-instant and lossless, but it can only start on a keyframe, so it may begin a little before your start. If it does, you will be told where."
              : "Re-encodes from exactly your start frame to an MP4. Slower — about as long as the clip plays — and the picture is compressed again. The whole soundtrack is decoded in this tab, so a very long video can run out of memory; use Fast for those."}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Selected", formatTime(Math.max(0, endTime - startTime))],
              ["Starts at", trim?.actualStart != null ? formatTime(trim.actualStart) : "—"],
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
