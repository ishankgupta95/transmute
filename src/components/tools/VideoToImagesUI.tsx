"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  PageDeck,
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
  DEFAULT_MAX_FRAMES,
  extractVideoFrames,
  frameCapNotice,
  formatFrameTimestamp,
  framesZipName,
  planFrameTimes,
  UNPLAYABLE_SOURCE_MESSAGE,
  UNREADABLE_DURATION_MESSAGE,
  type ExtractedFrame,
  type ExtractFramesResult,
  type FrameImageFormat,
  type FramePlan,
} from "@/lib/tools/video-frames";

/*
  video-to-images: every frame this page hands back is a real decoded picture
  from the clip, drawn onto a canvas and encoded by the browser itself. No
  FFmpeg is downloaded — the decode is the one the <video> element does anyway.

  THE ONE THING THIS PAGE MUST NEVER DO is come back with fewer frames than the
  settings asked for without saying so. There are three ways that can happen and
  all three are on screen:

    1. THE 300-FRAME CEILING. Said BEFORE the run (from the plan) and again
       AFTER it (from `ExtractFramesResult.capped`), with the numbers.
    2. An interval finer than the video's own frame rate, so several planned
       moments land inside one picture — the engine reports it as a warning.
    3. A clip that stops presenting frames early — likewise a warning.

  Both sentences about the cap are computed from `planFrameTimes` /
  `frameCapNotice` in the engine, never written out by hand here, so the page
  and the ZIP cannot end up describing different runs.

  The engine module is imported statically rather than through the usual
  `await import(...)` in `processFn`: its only heavy dependency is jszip, and
  that is already a dynamic import inside `zipFrames`, so a static import here
  costs the page nothing it was not going to load.
*/

const ACCEPT = getToolBySlug("video-to-images")?.acceptFormats ?? ".mp4,.webm,.mov,.avi,.mkv";
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
const PRACTICAL_LIMIT_NOTE = getToolBySlug("video-to-images")?.practicalLimitNote;

/** How many frames are painted into the deck. The ZIP always carries all of them. */
const PREVIEW_LIMIT = 24;

const MODES: readonly { value: "every-n-seconds" | "count"; label: string }[] = [
  { value: "every-n-seconds", label: "Every N sec" },
  { value: "count", label: "Fixed count" },
];

const INTERVALS: readonly { value: number; label: string }[] = [
  { value: 0.5, label: "0.5 s" },
  { value: 1, label: "1 s" },
  { value: 2, label: "2 s" },
  { value: 5, label: "5 s" },
  { value: 10, label: "10 s" },
];

const COUNTS: readonly { value: number; label: string }[] = [
  { value: 4, label: "4" },
  { value: 8, label: "8" },
  { value: 12, label: "12" },
  { value: 24, label: "24" },
  { value: 48, label: "48" },
];

const FORMATS: readonly { value: FrameImageFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

const QUALITIES: readonly { value: number; label: string }[] = [
  { value: 0.7, label: "Smaller" },
  { value: 0.85, label: "Balanced" },
  { value: 0.95, label: "Best" },
];

/** One honest sentence per format, and none of them claims more than the encoder gives. */
const FORMAT_NOTE: Record<FrameImageFormat, string> = {
  png: "Lossless, and the largest of the three. A long run at full resolution is the case that runs a tab out of memory — pick JPEG for hundreds of frames.",
  jpeg: "Lossy and small, and the safe choice for a long run. Every browser can write it.",
  webp: "Lossy and smaller than JPEG at the same setting. A browser that cannot write WebP from a canvas falls back to PNG — if that happens, the files are named .png and the run says so.",
};

/** Said BEFORE the run, off the plan. The post-run twin comes from `frameCapNotice`. */
function plannedCapNotice(plan: FramePlan): string {
  const last = plan.times[plan.times.length - 1];
  return `These settings ask for ${plan.requestedFrames} frames and this tool stops at ${DEFAULT_MAX_FRAMES}. The run will save ${plan.times.length} of them and stop at ${formatFrameTimestamp(last)} into the clip — widen the interval, or trim the clip first, to cover the whole video.`;
}

export function VideoToImagesUI() {
  const [file, setFile] = useState<File | null>(null);
  // The hook revokes on unmount and on swap, so navigating away cannot pin the
  // source blob for the tab.
  const videoUrl = useObjectUrl(file);
  /*
    Why this exists at all: "Extract frames" is disabled until a duration
    resolves, so a file this tab cannot open leaves the page with a dead button
    and, without this, nothing on screen to explain it. The two ways it can
    happen get DIFFERENT sentences, because they have different remedies and
    telling someone whose AVI has no demuxer that we couldn't read its LENGTH
    would be a new inaccuracy rather than a fix.
  */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [videoDims, setVideoDims] = useState<Dimensions | null>(null);
  const [mode, setMode] = useState<"every-n-seconds" | "count">("every-n-seconds");
  const [intervalSeconds, setIntervalSeconds] = useState(1);
  const [frameCount, setFrameCount] = useState(12);
  const [format, setFormat] = useState<FrameImageFormat>("png");
  const [quality, setQuality] = useState(0.85);
  const videoRef = useRef<HTMLVideoElement>(null);

  const processFn = useCallback(
    async (f: File, _options: void, ctx: FileProcessorContext) =>
      extractVideoFrames(
        f,
        {
          mode,
          intervalSeconds,
          frameCount,
          format,
          quality,
          maxFrames: DEFAULT_MAX_FRAMES,
        },
        ctx,
      ),
    [mode, intervalSeconds, frameCount, format, quality],
  );

  const { status, result, error, progress, process, cancel, reset } =
    useFileProcessor<void>(processFn);

  /*
    The hook types its slot as the narrower `ProcessedResult` but stores exactly
    what the processor returned, so the frame list and the cap flag are still
    there. Same widening `CompressVideoUI` does for its size-target outcome.
  */
  const frames = result as ExtractFramesResult | null;

  /** Any control change drops the finished ZIP: it describes settings that are gone. */
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
      setLoadError(null);
    },
    [reset],
  );

  /*
    Duration comes off the <video> already on screen. A screen recording made
    by this site's own /screen-recorder declares no duration at all, so the
    shared `resolveDuration` probe (not `v.duration`) is what makes those files
    plannable.
  */
  const handleVideoLoadedMetadata = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setVideoDims({ w: v.videoWidth, h: v.videoHeight });
    }
    const seconds = await resolveDuration(v);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      // The metadata arrived but the length did not, so the plan cannot be
      // built. This is the case UNREADABLE_DURATION_MESSAGE was written for,
      // and until now it could only be thrown where nobody could see it.
      setLoadError(UNREADABLE_DURATION_MESSAGE);
      return;
    }
    setLoadError(null);
    setDuration(seconds);
  }, []);

  /*
    The element refused the file outright — no `loadedmetadata`, so
    `handleVideoLoadedMetadata` never runs and nothing else would ever speak.
  */
  const handleVideoError = useCallback(() => {
    setDuration(0);
    setVideoDims(null);
    setLoadError(UNPLAYABLE_SOURCE_MESSAGE);
  }, []);

  /*
    The same planner the engine runs, so the count in the rail is the count the
    ZIP will hold — not an estimate computed a second way. It throws on
    settings it cannot plan (a clip whose length never resolved), which reads
    here as "no plan yet" rather than an error on a page nothing has run on.
  */
  const plan = useMemo<FramePlan | null>(() => {
    if (duration <= 0) return null;
    try {
      return planFrameTimes(duration, {
        mode,
        intervalSeconds,
        frameCount,
        format,
        maxFrames: DEFAULT_MAX_FRAMES,
      });
    } catch {
      return null;
    }
  }, [duration, mode, intervalSeconds, frameCount, format]);

  const previewed = useMemo(() => frames?.frames.slice(0, PREVIEW_LIMIT) ?? [], [frames]);

  const handleReset = useCallback(() => {
    reset();
    setFile(null);
    setDuration(0);
    setVideoDims(null);
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
  const capNotice = frames ? frameCapNotice(frames, DEFAULT_MAX_FRAMES) : null;
  const plannedFrames = plan ? plan.times.length : 0;

  return (
    <>
      {/* ── Canvas: the clip, then the frames it gave up ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={videoMeta(videoDims, duration > 0 ? formatTime(duration) : null, formatFileSize(file.size))}
          trailing={
            frames
              ? `${frames.frames.length} FRAME${frames.frames.length === 1 ? "" : "S"}`
              : plan
                ? `${plannedFrames} PLANNED`
                : undefined
          }
        />

        {frames ? (
          <PageDeck>
            {previewed.map((frame) => (
              <FrameTile key={frame.fileName} frame={frame} />
            ))}
          </PageDeck>
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
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            {
              label: "FRAMES",
              value: frames ? String(frames.frames.length) : plan ? String(plannedFrames) : "—",
            },
            { label: "FORMAT", value: format.toUpperCase(), tone: "neutral" },
            {
              label: "ZIP",
              value: frames ? formatFileSize(frames.newSize) : "—",
              tone: frames ? "ok" : "accent",
            },
          ]}
        />

        {frames && frames.frames.length > PREVIEW_LIMIT && (
          <CanvasFootnote>
            SHOWING THE FIRST {PREVIEW_LIMIT} OF {frames.frames.length}{" "}
            FRAMES — THE ZIP CARRIES ALL OF THEM
          </CanvasFootnote>
        )}

        {/* A failed run's message wins over a stale load failure: the run is
            the more recent thing that happened. */}
        {(error ?? loadError) && <ErrorMessage message={error ?? loadError} />}

        {/* The ceiling, said before the click off the plan and after it off the
            result. Never an error: the run succeeds, it just does not reach
            the end of the video. */}
        {!frames && plan?.capped && <WarningMessage message={plannedCapNotice(plan)} />}
        {capNotice && <WarningMessage message={capNotice} />}

        {/* Everything else the engine noticed: a format the canvas could not
            write, moments that fell inside a picture already saved, a clip
            that stopped early. */}
        {frames?.warnings?.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}
      </div>

      {/* ── Controls ── */}
      <ToolAside
        footer={
          <>
            {busy && (
              <ToolProgress
                phase="WALKING THE CLIP"
                // The walk reports nothing until the first frame lands, so stay
                // indeterminate rather than sitting pinned at 0%.
                percent={progress > 0 ? progress : null}
                label="Extracting frames from this video"
              />
            )}
            {frames ? (
              <DownloadButton
                blob={frames.blob}
                fileName={frames.fileName}
                className="w-full justify-center"
              />
            ) : busy ? (
              <ToolActions primaryLabel="Cancel" onPrimary={cancel} />
            ) : (
              <ToolActions
                primaryLabel="Extract frames"
                onPrimary={() => void process(file)}
                primaryDisabled={plan === null}
              />
            )}
            {!busy && (
              <ToolResetLink
                onClick={handleReset}
                label={frames ? "EXTRACT FROM ANOTHER" : "CHANGE FILE"}
              />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="SAMPLING">
            <ToolChoice
              label="Sampling"
              disabled={busy}
              value={mode}
              onChange={touch(setMode)}
              options={MODES}
            />
          </ToolControl>

          {mode === "every-n-seconds" ? (
            <ToolControl label="EVERY">
              <ToolChoice
                label="Interval"
                disabled={busy}
                value={intervalSeconds}
                onChange={touch(setIntervalSeconds)}
                options={INTERVALS}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                The first frame is taken at the very start of the clip, then one
                every {intervalSeconds} s until the end.
              </span>
            </ToolControl>
          ) : (
            <ToolControl label="HOW MANY">
              <ToolChoice
                label="Frame count"
                disabled={busy}
                value={frameCount}
                onChange={touch(setFrameCount)}
                options={COUNTS}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Evenly spaced, each taken from the middle of its slice — so the
                first one is a picture rather than the black leader most clips
                open on.
              </span>
            </ToolControl>
          )}

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
              ["Clip", duration > 0 ? formatTime(duration) : "—"],
              [
                "Frames",
                frames ? String(frames.frames.length) : plan ? String(plannedFrames) : "—",
              ],
              ["Saves as", framesZipName(file.name)],
              ["Size", frames ? formatFileSize(frames.newSize) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Always a ZIP, even for a single frame, so the name above is what the
            download is called either way. Each file inside is named with its
            position in the run and the exact moment it came from — {" "}
            <span className="font-mono">frame-007-00m03.500s.{format === "jpeg" ? "jpg" : format}</span>{" "}
            — so 300 files still unzip in order.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label={`THE ${DEFAULT_MAX_FRAMES}-FRAME CEILING`}>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {/*
              `{DEFAULT_MAX_FRAMES}{" "}frames` and not `{DEFAULT_MAX_FRAMES} frames`.
              MEASURED 2026-09-05 in the running app: the second form rendered
              `<span …>One run saves at most 300frames.` into the DOM — the space
              between the expression and the word was gone, and the e2e assertion
              on this sentence is what caught it. The same shape a few components
              over renders its space correctly, so this is not a rule worth
              reasoning about from memory: when an expression is followed by a
              word inside a text chunk that wraps onto another line, make the
              space explicit. The file already does this above, around the
              filename example.
            */}
            One run saves at most {DEFAULT_MAX_FRAMES}{" "}
            frames. Every frame is held in this tab as its own image until the
            ZIP is built, so the
            ceiling is there to stop a long run exhausting the tab&rsquo;s
            memory.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Time is the other cost, and it does not track the number of frames.
            The clip is played through the decoder up to the last moment in the
            plan, near enough to normal speed, so a run takes about as long as
            playing that stretch of video: four frames spread across a 45-minute
            lecture walk nearly the whole lecture, while 300 frames one second
            apart walk only the first five minutes.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            When the ceiling bites, the run stops there and says so on this page
            — with the number it asked for and the point in the clip it reached.
            It never quietly hands back a shorter set.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="HOW THE FRAMES ARE TAKEN">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The clip is played through the browser&rsquo;s own video decoder and
            each presented frame is drawn onto a canvas — the same walk this
            site&rsquo;s GIF and compression tools use. Nothing is uploaded, and
            no conversion engine is downloaded for it.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A video only has frames where it has frames. Asking for one every
            0.5 s from a clip shot at 1 fps cannot invent the ones in between,
            so the saved frame carries the time it really came from and the run
            reports how many of the moments you asked for landed inside a
            picture already saved.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

/**
 * One painted preview.
 *
 * A component per tile rather than one array of Object URLs held in the
 * parent, so each URL goes through `useObjectUrl` — the hook that already owns
 * the allocate-in-an-effect and deferred-revoke discipline, including the
 * StrictMode double-invoke it documents. The list is keyed by filename and the
 * filenames are unique within a run, so a tile mounts and unmounts with its
 * frame.
 */
function FrameTile({ frame }: { frame: ExtractedFrame }) {
  const url = useObjectUrl(frame.blob);
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[5px] border border-neutral-800 bg-black">
        {url && (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: URL, and next/image cannot optimise one under output: "export"
          <img
            src={url}
            alt={`Frame ${frame.index} at ${formatTime(frame.timeSeconds)}`}
            className="size-full object-contain"
          />
        )}
      </div>
      <figcaption className="flex flex-col gap-1">
        <span className="truncate font-mono text-[9.5px] leading-none text-text-muted">
          {frame.fileName}
        </span>
        {/* The time the picture REALLY came from, which is what the filename
            carries — not the moment the plan asked for. */}
        <span className="font-mono text-[9.5px] leading-none text-accent-300">
          {formatTime(frame.timeSeconds)} · {formatFileSize(frame.blob.size)}
        </span>
      </figcaption>
    </figure>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${tenths}`;
}
