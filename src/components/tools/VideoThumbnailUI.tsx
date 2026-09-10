"use client";

import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { useFileProcessor, type FileProcessorContext } from "@/hooks/useFileProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { getToolBySlug } from "@/data/tools";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { videoMeta, type Dimensions } from "@/lib/utils/canvas-meta";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
import { resolveDuration } from "@/lib/tools/video-utils";
import {
  captureVideoThumbnail,
  planThumbnailWindow,
  scaleThumbnail,
  UNPLAYABLE_SOURCE_MESSAGE,
  UNREADABLE_DURATION_MESSAGE,
  type FrameImageFormat,
  type ThumbnailResult,
} from "@/lib/tools/video-frames";

/*
  video-thumbnail: one still, from a moment the user picks.

  TWO THINGS ARE REPORTED RATHER THAN ASSUMED, because in both cases what you
  asked for and what you get can differ:

    1. THE TIME. A video only carries pictures at its own frame times, and the
       decoder presents the first one at or after where the playhead landed. So
       the result's `timeSeconds` — not the slider — is what the readouts and
       the filename use. A request inside the last quarter-second is also
       pulled back (the frame walk needs a window to present into), which is
       the same thing said louder.
    2. THE SIZE. `scaleThumbnail` never upscales, so asking a 640-wide clip for
       a 1280-wide still returns 640. The OUTPUT rows print the size that was
       really written.

  No FFmpeg: the picture comes off the browser's own decoder through a canvas.
*/

const ACCEPT = getToolBySlug("video-thumbnail")?.acceptFormats ?? ".mp4,.webm,.mov,.avi,.mkv";
/**
 * Looked up here rather than passed in, matching `CompressVideoUI`: the sentence
 * belongs to the registry so the drop zone and the page header cannot disagree.
 *
 * The slug is spelled out as a LITERAL, not read from a constant, on purpose.
 * `size-claims.test.ts` scans this file's raw source for
 * `getToolBySlug("…")?.practicalLimitNote` and checks the registry really
 * carries a note for that slug — the gate that stops this line silently
 * rendering "NO SIZE CAP" if the registry entry ever loses its note. Hiding the
 * slug behind a constant would slip past the scan.
 */
const PRACTICAL_LIMIT_NOTE = getToolBySlug("video-thumbnail")?.practicalLimitNote;

const FORMATS: readonly { value: FrameImageFormat; label: string }[] = [
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
];

const QUALITIES: readonly { value: number; label: string }[] = [
  { value: 0.7, label: "Smaller" },
  { value: 0.85, label: "Balanced" },
  { value: 0.95, label: "Best" },
];

/** 0 means "whatever the video is". Anything wider than the source is ignored. */
const WIDTHS: readonly { value: number; label: string }[] = [
  { value: 0, label: "Source" },
  { value: 1280, label: "1280" },
  { value: 640, label: "640" },
  { value: 320, label: "320" },
];

const FORMAT_NOTE: Record<FrameImageFormat, string> = {
  jpeg: "Lossy and small — the usual choice for a poster frame or a social card.",
  png: "Lossless, and much larger. Worth it when the still is going to be edited rather than posted.",
  webp: "Lossy and smaller than JPEG at the same setting. A browser that cannot write WebP from a canvas falls back to PNG — if that happens, the file is named .png and the run says so.",
};

export function VideoThumbnailUI() {
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap, so navigating away cannot pin the
  // source blob for the tab.
  const videoUrl = useObjectUrl(file);
  /*
    "Capture frame" is disabled until a duration resolves, so a file this tab
    cannot open would otherwise leave a dead button and no sentence. The two
    ways that happens get different messages: a container the browser has no
    demuxer for is not the same problem as a clip whose LENGTH would not
    resolve, and only one of them is fixed by re-containering.
  */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [videoDims, setVideoDims] = useState<Dimensions | null>(null);
  const [timeSeconds, setTimeSeconds] = useState(0);
  const [format, setFormat] = useState<FrameImageFormat>("jpeg");
  const [quality, setQuality] = useState(0.85);
  const [width, setWidth] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  const processFn = useCallback(
    async (f: File, _options: void, ctx: FileProcessorContext) =>
      captureVideoThumbnail(
        f,
        { timeSeconds, format, quality, ...(width > 0 ? { width } : {}) },
        ctx,
      ),
    [timeSeconds, format, quality, width],
  );

  const { status, result, error, process, cancel, reset } = useFileProcessor<void>(processFn);

  /*
    The hook types its slot as the narrower `ProcessedResult` but stores exactly
    what the processor returned, so the real time and the real dimensions are
    still there. Same widening `CompressVideoUI` does for its size target.
  */
  const thumb = result as ThumbnailResult | null;
  const thumbUrl = useObjectUrl(thumb?.blob);

  /** Any control change drops the finished still: it describes settings that are gone. */
  const invalidate = useCallback(() => {
    if (result) reset();
  }, [result, reset]);

  const touch = useCallback(
    <T,>(setter: (v: T) => void) =>
      (value: T) => {
        invalidate();
        setter(value);
      },
    [invalidate],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      reset();
      setFile(f);
      setDuration(0);
      setVideoDims(null);
      setTimeSeconds(0);
      setLoadError(null);
    },
    [reset],
  );

  /*
    Duration comes off the <video> already on screen, through the shared probe:
    a screen recording made by this site's own /screen-recorder declares no
    duration, and without the probe the slider would sit dead at max 0.
  */
  const handleVideoLoadedMetadata = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setVideoDims({ w: v.videoWidth, h: v.videoHeight });
    }
    const seconds = await resolveDuration(v);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      // Metadata arrived, length did not — the case
      // UNREADABLE_DURATION_MESSAGE was written for and, until now, the one
      // nobody could ever read.
      setLoadError(UNREADABLE_DURATION_MESSAGE);
      return;
    }
    setLoadError(null);
    setDuration(seconds);
    // Open on the middle of the clip rather than on the black leader most
    // videos start with — the same reasoning the filmstrip uses.
    setTimeSeconds(seconds / 2);
  }, []);

  /* The element refused the file outright, so `loadedmetadata` never fires. */
  const handleVideoError = useCallback(() => {
    setDuration(0);
    setVideoDims(null);
    setLoadError(UNPLAYABLE_SOURCE_MESSAGE);
  }, []);

  /** Take the moment the user has already scrubbed to; it is the frame they can see. */
  const useCurrentPosition = useCallback(() => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(v.currentTime)) return;
    invalidate();
    setTimeSeconds(Math.max(0, v.currentTime));
  }, [invalidate]);

  const handleReset = useCallback(() => {
    reset();
    setFile(null);
    setDuration(0);
    setVideoDims(null);
    setTimeSeconds(0);
    setLoadError(null);
  }, [reset]);

  if (!file) {
    return (
      <DropZone
        accept={ACCEPT}
        practicalLimitNote={PRACTICAL_LIMIT_NOTE}
        onFiles={handleFiles}
      />
    );
  }

  const busy = status === "processing";
  const lossy = format !== "png";

  /*
    What the run will really do, computed with the engine's own functions so
    the preview of the answer and the answer cannot drift. `planThumbnailWindow`
    throws while the duration is still unknown, which reads here as "nothing to
    promise yet".
  */
  let clampedTime: number | null = null;
  if (duration > 0) {
    try {
      clampedTime = planThumbnailWindow(duration, timeSeconds).startSeconds;
    } catch {
      clampedTime = null;
    }
  }
  const plannedSize = videoDims
    ? scaleThumbnail(videoDims.w, videoDims.h, width > 0 ? width : undefined)
    : null;
  const heldBack = clampedTime !== null && Math.abs(clampedTime - timeSeconds) > 0.005;

  return (
    <>
      {/* ── Canvas: the clip to scrub, then the still it gave up ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={videoMeta(
            videoDims,
            duration > 0 ? formatTime(duration) : null,
            formatFileSize(file.size),
          )}
          trailing={
            thumb
              ? `${thumb.width} × ${thumb.height}`
              : plannedSize
                ? `${plannedSize.width} × ${plannedSize.height}`
                : undefined
          }
        />

        {thumb && thumbUrl ? (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL, and next/image cannot optimise one under output: "export" */}
            <img
              src={thumbUrl}
              alt={`Frame captured at ${formatTime(thumb.timeSeconds)}`}
              className={cn(STAGE_MEDIA, "bg-black")}
            />
          </CanvasStage>
        ) : (
          videoUrl && (
            <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-black")}>
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                onLoadedMetadata={handleVideoLoadedMetadata}
                onError={handleVideoError}
                className={cn(STAGE_MEDIA, "bg-black")}
              />
            </CanvasStage>
          )
        )}

        <StatStrip
          stats={[
            {
              label: "AT",
              value: thumb
                ? formatTime(thumb.timeSeconds)
                : clampedTime !== null
                  ? formatTime(clampedTime)
                  : "—",
            },
            {
              label: "SIZE",
              value: thumb
                ? `${thumb.width} × ${thumb.height}`
                : plannedSize
                  ? `${plannedSize.width} × ${plannedSize.height}`
                  : "—",
              tone: "neutral",
            },
            { label: "FORMAT", value: format.toUpperCase(), tone: "neutral" },
            {
              label: "OUT",
              value: thumb ? formatFileSize(thumb.newSize) : "—",
              tone: thumb ? "ok" : "accent",
            },
          ]}
        />

        {/* A failed run's message wins over a stale load failure: the run is
            the more recent thing that happened. */}
        {(error ?? loadError) && <ErrorMessage message={error ?? loadError} />}

        {/* Not an error: the request was simply too near the end for the
            decoder to present anything, so it was pulled back — said before
            the click rather than discovered in the filename afterwards. */}
        {!thumb && heldBack && clampedTime !== null && (
          <WarningMessage
            message={`A still cannot be taken from the last quarter-second of a clip — the decoder needs a moment after the seek to present a frame. This run will capture at ${formatTime(clampedTime)} instead of ${formatTime(timeSeconds)}.`}
          />
        )}

        {thumb?.warnings?.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}

        {thumb && (
          <CanvasFootnote>
            CAPTURED AT {formatTime(thumb.timeSeconds)} — THE FRAME THE DECODER ACTUALLY
            PRESENTED, WHICH IS THE TIME IN THE FILENAME
          </CanvasFootnote>
        )}
      </div>

      {/* ── Controls ── */}
      <ToolAside
        footer={
          <>
            {busy && (
              <ToolProgress
                phase="SEEKING AND CAPTURING"
                // One seek and one frame: there is no percentage to report that
                // would not be invented.
                percent={null}
                label="Capturing a frame from this video"
              />
            )}
            {thumb ? (
              <DownloadButton
                blob={thumb.blob}
                fileName={thumb.fileName}
                className="w-full justify-center"
              />
            ) : busy ? (
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions
                primaryLabel="Capture frame"
                onPrimary={() => void process(file)}
                primaryDisabled={duration <= 0}
              />
            )}
            {!busy && (
              <ToolResetLink
                onClick={handleReset}
                label={thumb ? "CAPTURE ANOTHER" : "CHANGE FILE"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="MOMENT">
            <ToolSlider
              label="Time"
              display={formatTime(timeSeconds)}
              min={0}
              max={duration || 0}
              step={duration > 600 ? 1 : 0.1}
              value={Math.min(timeSeconds, duration || 0)}
              disabled={busy || duration <= 0}
              onChange={touch(setTimeSeconds)}
              hint="Scrub the video above, then take the frame you can see."
            />
            <button
              type="button"
              onClick={useCurrentPosition}
              disabled={busy || duration <= 0}
              className="h-8 w-full cursor-pointer rounded-md border border-border bg-transparent font-display text-[12px] leading-none font-medium text-text-primary transition-colors duration-200 hover:border-accent/40 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              Use the player&rsquo;s position
            </button>
          </ToolControl>

          <ToolControl label="WIDTH">
            <ToolChoice
              label="Output width"
              disabled={busy}
              value={width}
              onChange={touch(setWidth)}
              options={WIDTHS}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Never upscaled. A width wider than the video keeps the video&rsquo;s own size, so
              the still is always real pixels.
            </span>
          </ToolControl>

          <ToolControl label="FORMAT">
            <ToolChoice
              label="Image format"
              disabled={busy}
              value={format}
              onChange={touch(setFormat)}
              options={FORMATS}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {FORMAT_NOTE[format]}
            </span>
          </ToolControl>

          {lossy && (
            <ToolControl label="QUALITY">
              <ToolChoice
                label="Image quality"
                disabled={busy}
                value={quality}
                onChange={touch(setQuality)}
                options={QUALITIES}
              />
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Asked for", duration > 0 ? formatTime(timeSeconds) : "—"],
              ["Captured at", thumb ? formatTime(thumb.timeSeconds) : "—"],
              [
                "Size",
                thumb
                  ? `${thumb.width} × ${thumb.height}`
                  : plannedSize
                    ? `${plannedSize.width} × ${plannedSize.height}`
                    : "—",
              ],
              ["File", thumb ? formatFileSize(thumb.newSize) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The two time rows are not always the same number, and that is the
            point: a video carries pictures only at its own frame times, so the
            still is the first frame at or after the moment you picked. The
            filename carries the time it really came from.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="HOW THE FRAME IS TAKEN">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The clip is seeked with the browser&rsquo;s own video decoder and the
            first frame it presents is drawn onto a canvas and encoded there.
            Nothing is uploaded, and no conversion engine is downloaded for it.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            One frame is one frame: this is a still from your video, not a
            re-encode of it, so the picture quality is whatever the source
            carries at that moment.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${tenths}`;
}
