/*
  Frame extraction: /video-to-images (many frames, zipped) and /video-thumbnail
  (one frame, at a time the user picks).

  WHY THERE IS NO FFMPEG HERE. Both tools decode pictures and re-encode them as
  PNG/JPEG/WebP, which is exactly what the browser's own `<video>` element plus
  a 2D canvas already do — hardware-accelerated, with no 32 MB WASM core to
  download first. `playAndExtractFrames` (video-utils.ts) is the walk this
  repo already ships for video-to-gif and compress-video; this module is a
  caller of it, not a second implementation.

  It is also decode-only, so — like video-to-gif, and for the reason spelled
  out at the top of `utils/webcodecs-support.ts` — it must NOT be gated on
  `assertWebCodecsSupported()`. That predicate is about ENCODING video, and
  gating on it would take these two tools away from Firefox for nothing.

  THE THING THIS FILE IS MOST CAREFUL ABOUT is that the number of frames the
  user gets back is never quietly smaller than the number they asked for. Three
  separate things can shrink a run — the `maxFrames` ceiling, an interval finer
  than the source's own frame period, and a clip that ends before the last
  planned moment is presented — and all three are reported: the first through
  `capped` / `requestedFrames`, the other two through `warnings`.
*/

import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";
import { throwIfAborted } from "@/lib/utils/abort";
import { canvasToBlob } from "./canvas-utils";
import { createVideo, playAndExtractFrames, resolveDuration, waitForReady } from "./video-utils";

export type FrameImageFormat = "png" | "jpeg" | "webp";

export interface ExtractFramesOptions {
  mode: "every-n-seconds" | "count";
  /** mode "every-n-seconds" */
  intervalSeconds?: number;
  /** mode "count" */
  frameCount?: number;
  format: FrameImageFormat;
  /** 0..1, lossy formats only. Ignored by the browser for PNG. */
  quality?: number;
  /**
   * Hard ceiling on how many frames one run may produce. NOT a suggestion and
   * never silent: when it bites, `capped` is true and the UI says so with the
   * number it stopped at.
   */
  maxFrames: number;
}

export interface ExtractedFrame {
  /** 1-based, and the same number that appears in `fileName`. */
  index: number;
  /**
   * When the saved picture actually came from, in seconds. This is the
   * presented frame's own timestamp, NOT the moment the plan asked for — the
   * two differ by up to one frame period, and the filename carries this one.
   */
  timeSeconds: number;
  blob: Blob;
  fileName: string;
}

export interface ExtractFramesResult extends ProcessedResult {
  /** Every frame, in order. `blob` on the result is the ZIP of all of them. */
  frames: ExtractedFrame[];
  /** How many frames the settings asked for BEFORE `maxFrames` was applied. */
  requestedFrames: number;
  /** TRUE when `maxFrames` capped the run — the UI MUST say so. */
  capped: boolean;
  durationSeconds: number;
}

export interface ThumbnailOptions {
  timeSeconds: number;
  format: FrameImageFormat;
  quality?: number;
  /** Output width in pixels. Absent, or wider than the source, keeps the source size. */
  width?: number;
}

export interface ThumbnailResult extends ProcessedResult {
  /** The frame's REAL timestamp. A seek lands on a decodable frame, not on the number asked for. */
  timeSeconds: number;
  /** The size actually written, after clamping `width` against the source. */
  width: number;
  height: number;
}

/**
 * The ceiling both `/video-to-images` and this module default to.
 *
 * 300 is a product decision, not a measured limit: every frame is held in the
 * tab as its own encoded blob until the ZIP is built, and PNG is lossless, so
 * a long run at source resolution is the case that runs a tab out of memory.
 * The number is exported so the page's copy and the engine's ceiling are one
 * value, and a run that hits it stops loudly rather than truncating.
 */
export const DEFAULT_MAX_FRAMES = 300;

const MIME_BY_FRAME_FORMAT: Record<FrameImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Reverse of the above, for reading back what `toBlob` actually wrote. */
const FRAME_FORMAT_BY_MIME: Record<string, FrameImageFormat> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

/** `.jpg`, not `.jpeg` — matching the extension the PDF image tools already save. */
const EXTENSION_BY_FRAME_FORMAT: Record<FrameImageFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

export const UNREADABLE_DURATION_MESSAGE =
  "Couldn't read how long this clip is, and frames can only be spaced out once its length is known. Converting it to MP4 first usually fixes this.";

/**
 * The sentence for a file the tab's own decoder will not open AT ALL — a
 * container it has no demuxer for, or a codec it cannot decode.
 *
 * Deliberately NOT `UNREADABLE_DURATION_MESSAGE`: that one blames the clip's
 * LENGTH, which is the wrong diagnosis for a file whose first byte the browser
 * refused. Both pages wire this to their `<video>`'s `error` event, because the
 * alternative — the only button greyed out with nothing on screen — is the
 * silent dead end these tools exist not to have.
 */
export const UNPLAYABLE_SOURCE_MESSAGE =
  "This browser could not open this video. Frames are taken with the browser's own decoder, so a container or codec it has no support for cannot be read on this page at all — convert the clip to MP4 first and it will open.";

const NO_PICTURE_MESSAGE =
  "There is no picture in this file to take frames from — the browser reports no video track.";

const NO_CANVAS_MESSAGE =
  "This browser wouldn't give the page a 2D canvas, which is what each frame is drawn onto.";

/** Mirrors the same guard in video-to-gif.ts: an empty run must never look like a success. */
const NO_FRAMES_MESSAGE = "No frames were captured from this clip.";

const NO_THUMBNAIL_MESSAGE =
  "No frame was presented at that point in the clip, so there was nothing to save. Try a moment nearer the middle of the video.";

/**
 * How far inside the clip the thumbnail's playhead is allowed to land, and how
 * wide a window the walk gets after it.
 *
 * `playAndExtractFrames` resolves the moment `currentTime >= endTime`, checked
 * BEFORE a frame is handed over. Seeking to the very last instant would
 * therefore end the walk with nothing captured, so the requested time is held
 * this far back from the end and the window is at least that wide. The frame
 * that comes back reports its own real timestamp, so the clamp is visible
 * rather than silent.
 */
const THUMBNAIL_MIN_WINDOW_SECONDS = 0.25;
const THUMBNAIL_WINDOW_SECONDS = 1;

/**
 * Thrown by this file's own frame callbacks the moment the plan is satisfied.
 *
 * `playAndExtractFrames` rejects with whatever `onFrame` throws and still runs
 * its cleanup `finally` (pause, detach from the DOM), so this is the cheapest
 * honest way to stop decoding early. The alternative is letting the element
 * play out the rest of its window decoding frames we would only discard.
 */
class FrameWalkDone extends Error {
  constructor() {
    super("frame walk complete");
    this.name = "FrameWalkDone";
  }
}

/* ── Planning ──────────────────────────────────────────────────────────── */

export interface FramePlan {
  /** The moments to capture at, in seconds, ascending. Already capped. */
  times: number[];
  /** How many frames the settings asked for BEFORE the ceiling was applied. */
  requestedFrames: number;
  /** TRUE when the ceiling cut the plan short. */
  capped: boolean;
  /**
   * Where the frame walk is told to stop. One nominal step past the last
   * planned moment (clamped to the clip), so a capped run stops decoding
   * shortly after its last frame instead of playing the whole video out.
   */
  walkEndSeconds: number;
}

/**
 * Turn a clip length and the user's settings into the exact list of moments to
 * capture at. Pure, and deliberately separate from the decode: the frame count
 * and the cap are the whole claim these pages make, so they are unit-testable
 * without a video element.
 *
 * "every-n-seconds" walks 0, i, 2i … while the moment is still inside the clip
 * — a 10 s clip at 1 s asks for 10 frames (0 s through 9 s), not 11: there is
 * no frame AT the end.
 *
 * "count" samples the MIDDLE of each equal slice, which is why 4 frames from a
 * 10 s clip land at 1.25 / 3.75 / 6.25 / 8.75 rather than at 0. Same reasoning
 * as `extractFilmstrip`: the first frame of a clip is very often a black
 * leader, and a set of thumbnails that opens on black is worth less than one
 * that does not.
 */
export function planFrameTimes(
  durationSeconds: number,
  options: ExtractFramesOptions,
): FramePlan {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(UNREADABLE_DURATION_MESSAGE);
  }
  const ceiling = Math.max(1, Math.floor(options.maxFrames));

  let step: number;
  let requestedFrames: number;
  if (options.mode === "every-n-seconds") {
    const interval = options.intervalSeconds ?? 0;
    if (!(interval > 0)) {
      throw new Error("Choose an interval longer than zero seconds.");
    }
    step = interval;
    requestedFrames = Math.max(1, Math.ceil(durationSeconds / interval));
  } else {
    const count = Math.floor(options.frameCount ?? 0);
    if (count < 1) {
      throw new Error("Ask for at least one frame.");
    }
    step = durationSeconds / count;
    requestedFrames = count;
  }

  const capped = requestedFrames > ceiling;
  const taken = capped ? ceiling : requestedFrames;

  const times: number[] = [];
  for (let i = 0; i < taken; i++) {
    const at = options.mode === "count" ? step * (i + 0.5) : step * i;
    times.push(Math.min(at, durationSeconds));
  }

  return {
    times,
    requestedFrames,
    capped,
    walkEndSeconds: Math.min(durationSeconds, times[times.length - 1] + step),
  };
}

/** The window `captureVideoThumbnail` hands the frame walk. Pure; see the constants above. */
export function planThumbnailWindow(
  durationSeconds: number,
  timeSeconds: number,
): { startSeconds: number; endSeconds: number } {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(UNREADABLE_DURATION_MESSAGE);
  }
  const requested = Number.isFinite(timeSeconds) ? Math.max(0, timeSeconds) : 0;
  const startSeconds = Math.min(
    requested,
    Math.max(0, durationSeconds - THUMBNAIL_MIN_WINDOW_SECONDS),
  );
  return {
    startSeconds,
    endSeconds: Math.min(durationSeconds, startSeconds + THUMBNAIL_WINDOW_SECONDS),
  };
}

/**
 * The output size for a thumbnail. NEVER upscales: asking a 640-wide source
 * for a 1280-wide thumbnail returns 640, because the extra pixels would be
 * invented and the result rows would then be reporting a resolution the file
 * does not really carry.
 */
export function scaleThumbnail(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth?: number,
): { width: number; height: number } {
  if (!targetWidth || !(targetWidth > 0) || targetWidth >= sourceWidth) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const width = Math.max(1, Math.round(targetWidth));
  return { width, height: Math.max(1, Math.round((sourceHeight * width) / sourceWidth)) };
}

/* ── Naming ────────────────────────────────────────────────────────────── */

/**
 * `3.5` → `00m03.500s`. Minutes are zero-padded to two, seconds to two with
 * three decimals, so every stamp in one run is the same width.
 *
 * Sorting is NOT this string's job — past 99 minutes the minute field grows and
 * string order would break. The zero-padded index in front of it is what keeps
 * a 300-file ZIP in order; the stamp is there so a frame can be found in the
 * source video without opening it.
 */
export function formatFrameTimestamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe - mins * 60;
  return `${String(mins).padStart(2, "0")}m${secs.toFixed(3).padStart(6, "0")}s`;
}

/**
 * `frame-007-00m03.500s.png`.
 *
 * The index comes first and is zero-padded to the width of the run (three
 * digits minimum), because a ZIP of 300 files is read in whatever order the
 * unzipper sorts names — `frame-7` would land between `frame-69` and `frame-70`
 * and the strip would be shuffled. The timestamp follows so each file says
 * where in the video it came from.
 */
export function frameFileName(
  index: number,
  timeSeconds: number,
  totalFrames: number,
  format: FrameImageFormat,
): string {
  const pad = Math.max(3, String(Math.max(1, totalFrames)).length);
  return `frame-${String(index).padStart(pad, "0")}-${formatFrameTimestamp(timeSeconds)}.${EXTENSION_BY_FRAME_FORMAT[format]}`;
}

/** `holiday.mp4` → `holiday-frames.zip`, matching `report-images.zip` next door. */
export function framesZipName(sourceName: string): string {
  return `${sourceName.replace(/\.[^./]+$/, "")}-frames.zip`;
}

/** `holiday.mp4` at 3.5 s → `holiday-frame-00m03.500s.jpg`. */
export function thumbnailFileName(
  sourceName: string,
  timeSeconds: number,
  format: FrameImageFormat,
): string {
  const base = sourceName.replace(/\.[^./]+$/, "");
  return `${base}-frame-${formatFrameTimestamp(timeSeconds)}.${EXTENSION_BY_FRAME_FORMAT[format]}`;
}

/**
 * The one sentence the cap is announced with, so the engine and the page
 * cannot end up describing the same run differently. `null` when nothing was
 * capped — there is then nothing to say.
 */
export function frameCapNotice(result: ExtractFramesResult, maxFrames: number): string | null {
  if (!result.capped) return null;
  const last = result.frames[result.frames.length - 1];
  const covered = last ? formatFrameTimestamp(last.timeSeconds) : formatFrameTimestamp(0);
  return `These settings asked for ${result.requestedFrames} frames and this tool stops at ${maxFrames}. The ZIP holds ${result.frames.length} of them, covering the clip up to ${covered} of ${formatFrameTimestamp(result.durationSeconds)}. Nothing after that point was extracted — widen the interval, or trim the clip first, to cover the whole video.`;
}

/* ── The ZIP ───────────────────────────────────────────────────────────── */

/**
 * Bundle the frames into one archive.
 *
 * The dynamic `import("jszip")` specifier is copied verbatim from
 * `lib/utils/download.ts`, which is the repo's only non-outlier jszip use:
 * bare specifier, dynamic, `.default`, so the library code-splits out of every
 * page that never zips anything.
 *
 * This module zips in the engine rather than leaving it to `downloadFilesAsZip`
 * (the PDF tools' route) for one reason: a frame run is ALWAYS an archive, even
 * when it holds a single frame. `downloadFilesAsZip` hands over the bare file
 * at length 1, which would make the page's stated output name a lie in exactly
 * the case a user is least expecting it.
 */
export async function zipFrames(
  frames: readonly { fileName: string; blob: Blob }[],
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const frame of frames) zip.file(frame.fileName, frame.blob);
  return zip.generateAsync({ type: "blob" });
}

/* ── The two entry points ──────────────────────────────────────────────── */

/**
 * The canvas encode, plus the one check that keeps the file extension honest.
 *
 * Per the HTML spec a canvas asked for a type it cannot write falls back to
 * PNG, and the Blob it returns reports the type it actually wrote. So the
 * first frame's `blob.type` is read back and every filename follows THAT — a
 * browser without a WebP encoder gets PNG bytes named `.png` and a warning,
 * never PNG bytes named `.webp`.
 */
async function encodeFrame(
  canvas: HTMLCanvasElement,
  format: FrameImageFormat,
  quality: number | undefined,
): Promise<{ blob: Blob; format: FrameImageFormat }> {
  const blob = await canvasToBlob(canvas, MIME_BY_FRAME_FORMAT[format], quality);
  const written = FRAME_FORMAT_BY_MIME[blob.type] ?? format;
  return { blob, format: written };
}

interface ThumbnailShot {
  blob: Blob;
  timeSeconds: number;
  format: FrameImageFormat;
}

function formatFallbackWarning(asked: FrameImageFormat, written: FrameImageFormat): string {
  return `This browser can't encode ${asked.toUpperCase()} from a canvas, so the frames were written as ${written.toUpperCase()} and named accordingly.`;
}

export async function extractVideoFrames(
  file: File,
  options: ExtractFramesOptions,
  ctx: ProcessingContext = {},
): Promise<ExtractFramesResult> {
  const { onProgress, signal } = ctx;
  const videoUrl = URL.createObjectURL(file);

  try {
    throwIfAborted(signal);
    const video = createVideo(videoUrl);
    await waitForReady(video);

    // A screen recording written by MediaRecorder declares no duration, so this
    // has to run before anything is planned — and before the walk, which drives
    // `currentTime` itself.
    const durationSeconds = await resolveDuration(video);
    const plan = planFrameTimes(durationSeconds, options);

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!(width > 0 && height > 0)) throw new Error(NO_PICTURE_MESSAGE);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const canvasCtx = canvas.getContext("2d");
    if (!canvasCtx) throw new Error(NO_CANVAS_MESSAGE);

    const captured: { timeSeconds: number; blob: Blob }[] = [];
    let writtenFormat = options.format;
    let next = 0;
    /** Planned moments a frame already saved had passed. See the warning below. */
    let absorbed = 0;

    try {
      await playAndExtractFrames(
        video,
        0,
        plan.walkEndSeconds,
        async (vid, timestampUs) => {
          throwIfAborted(signal);
          // The walk starts at 0, so its offset IS the clip time.
          const at = timestampUs / 1_000_000;
          if (at < plan.times[next]) return;

          /*
            ONE canvas serves every frame in the run, and `drawImage` composites
            source-over. A WebM can carry an alpha channel (VP8/VP9 with alpha,
            what a transparent overlay export produces) and that alpha survives
            <video> → drawImage, so without this the transparent regions of
            frame N would still be holding frame N-1's pixels — measurably, and
            silently, in the PNG and WebP the user downloads. PNG is this page's
            default format, which is the one people pick precisely to keep
            transparency.
          */
          canvasCtx.clearRect(0, 0, width, height);
          canvasCtx.drawImage(vid, 0, 0, width, height);
          const encoded = await encodeFrame(canvas, options.format, options.quality);
          if (captured.length === 0) writtenFormat = encoded.format;
          captured.push({ timeSeconds: at, blob: encoded.blob });
          next += 1;

          // One presented frame can satisfy several planned moments when the
          // interval is finer than the source's own frame period — a 1 fps
          // timelapse asked for a frame every 0.25 s has nothing new to give.
          // Saving the same picture four times would be a worse answer than
          // saving it once and saying so, which is what the warning below does.
          while (next < plan.times.length && plan.times[next] <= at) {
            next += 1;
            absorbed += 1;
          }

          if (next >= plan.times.length) throw new FrameWalkDone();
        },
        // The last tenth is the ZIP, which reports nothing of its own.
        { signal, onProgress: (pct) => onProgress?.(Math.round(pct * 0.9)) },
      );
    } catch (err) {
      if (!(err instanceof FrameWalkDone)) throw err;
    }

    // Only reachable when the element presented no frame at all inside the
    // window. `finish()`-ing an empty archive would hand over a valid, empty
    // ZIP and call it a success.
    if (captured.length === 0) throw new Error(NO_FRAMES_MESSAGE);

    const frames: ExtractedFrame[] = captured.map((shot, i) => ({
      index: i + 1,
      timeSeconds: shot.timeSeconds,
      blob: shot.blob,
      fileName: frameFileName(i + 1, shot.timeSeconds, captured.length, writtenFormat),
    }));

    const warnings: string[] = [];
    if (writtenFormat !== options.format) {
      warnings.push(formatFallbackWarning(options.format, writtenFormat));
    }
    if (absorbed > 0) {
      warnings.push(
        `${absorbed} of the moments these settings asked for fell inside a picture that had already been saved — this video does not have a distinct frame that often. ${frames.length} frames were saved instead of ${plan.times.length}.`,
      );
    }
    /*
      WHY THIS SENTENCE DOES NOT BLAME THE CLIP.

      It used to read "the clip stopped presenting frames". That was replaced
      because it sounded like a fault, and then the REPLACEMENT's stated reason
      turned out to be wrong too, so here is what the container actually says.

      `sample-video.mp4`, read straight out of its boxes:

        mvhd                timescale 1000   duration  2090    2.090 s
        mdhd (hdlr `vide`)  timescale 57600  duration 115200   2.000000 s
        mdhd (hdlr `soun`)  timescale 44100  duration  92160   2.089795918 s
        stts (video)        48 x 2400  ->  48 frames at 2400/57600 = 1/24 s

      So the 2.090 s the element reports as `duration` is the AUDIO track. The
      pictures are 48 frames presented at t = k/24 for k = 0..47; the last one
      STARTS at 47/24 = 1.9583 s and its display ends at exactly 2.000 s. At the
      2.000 s moment that "every 1 s" plans, the clip carries no picture at all
      — the previous comment's "the clip really does carry a picture there" was
      simply false.

      That does not rescue the old wording either, because "the clip stopped
      presenting frames" reads as malfunction and this is the ordinary case: a
      video track is routinely a few tens of milliseconds shorter than the
      audio beside it, so the last planned moment lands in the gap. The walk is
      still the honest subject — `playAndExtractFrames` resolves on the
      element's own `ended` event (video-utils.ts), which fires on the LONGER
      track — but the reason it did not reach the moment is that the pictures
      ran out, not that playback ended early. (A truncated or damaged container
      arrives at the same sentence by the other route.)
    */
    const unreached = plan.times.length - captured.length - absorbed;
    if (unreached > 0) {
      warnings.push(
        `The video ran out of pictures before the walk got that far — a clip's stated length is usually its audio, which carries on a little past the final frame, so a moment planned inside that last fraction of a second has no picture to save. So the last ${unreached} of the ${plan.times.length} planned frames are missing from this ZIP.`,
      );
    }

    const blob = await zipFrames(frames);
    onProgress?.(100);

    return {
      blob,
      fileName: framesZipName(file.name),
      originalSize: file.size,
      newSize: blob.size,
      ...(warnings.length > 0 ? { warnings } : {}),
      frames,
      requestedFrames: plan.requestedFrames,
      capped: plan.capped,
      durationSeconds,
    };
  } finally {
    // Revoked on every path — a cancelled run used to pin the source blob for
    // the life of the tab (the bug video-to-gif's own `finally` records).
    URL.revokeObjectURL(videoUrl);
  }
}

export async function captureVideoThumbnail(
  file: File,
  options: ThumbnailOptions,
  ctx: ProcessingContext = {},
): Promise<ThumbnailResult> {
  const { signal } = ctx;
  const videoUrl = URL.createObjectURL(file);

  try {
    throwIfAborted(signal);
    const video = createVideo(videoUrl);
    await waitForReady(video);

    const durationSeconds = await resolveDuration(video);
    const walkWindow = planThumbnailWindow(durationSeconds, options.timeSeconds);

    if (!(video.videoWidth > 0 && video.videoHeight > 0)) throw new Error(NO_PICTURE_MESSAGE);
    const { width, height } = scaleThumbnail(video.videoWidth, video.videoHeight, options.width);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const canvasCtx = canvas.getContext("2d");
    if (!canvasCtx) throw new Error(NO_CANVAS_MESSAGE);

    /*
      An array rather than a `let … | null`: the only write happens inside the
      frame callback, and TypeScript narrows a closed-over `let` back to its
      initialiser at every await boundary, which turns the `if (!shot)` guard
      below into a `never` and stops the file compiling. A push is not narrowed.
    */
    const shots: ThumbnailShot[] = [];

    try {
      await playAndExtractFrames(
        video,
        walkWindow.startSeconds,
        walkWindow.endSeconds,
        async (vid, timestampUs) => {
          throwIfAborted(signal);
          canvasCtx.drawImage(vid, 0, 0, width, height);
          const encoded = await encodeFrame(canvas, options.format, options.quality);
          shots.push({
            blob: encoded.blob,
            // The walk's offset is measured from where it started, and the
            // seek lands on a decodable frame rather than on the exact number
            // asked for. This is the frame's REAL position in the clip.
            timeSeconds: walkWindow.startSeconds + timestampUs / 1_000_000,
            format: encoded.format,
          });
          throw new FrameWalkDone();
        },
        // No progress hook: this is one seek and one frame, so a percentage
        // would be invented. The page shows an indeterminate bar instead.
        { signal },
      );
    } catch (err) {
      if (!(err instanceof FrameWalkDone)) throw err;
    }

    const taken = shots[0];
    if (!taken) throw new Error(NO_THUMBNAIL_MESSAGE);

    const warnings =
      taken.format !== options.format
        ? [formatFallbackWarning(options.format, taken.format)]
        : undefined;

    return {
      blob: taken.blob,
      fileName: thumbnailFileName(file.name, taken.timeSeconds, taken.format),
      originalSize: file.size,
      newSize: taken.blob.size,
      ...(warnings ? { warnings } : {}),
      timeSeconds: taken.timeSeconds,
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}
