import type { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  runFFmpegTask,
  validateFFmpegInput,
  mountInputFile,
  unmountInputFile,
} from "./ffmpeg-loader";
import { inputExtensionFor } from "./video-probe";
import { throwIfAborted } from "@/lib/utils/abort";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Cutting one video into several without re-encoding a single frame
 * ───────────────────────────────────────────────────────────────────────────
 *
 * WHY ONE `-ss/-t -c copy` RUN PER PART, AND NOT `-f segment`
 *   `-f segment -segment_time N -reset_timestamps 1 s%03d.mp4` works — EXIT 0,
 *   measured 2026-09-05 against the shipped core — but it writes its parts
 *   under a printf pattern and hands back no manifest. The only way to learn
 *   how many files it produced is to read `s000.mp4`, `s001.mp4`, … until
 *   `readFile` raises `ErrnoError: FS error`. Enumerating output by catching
 *   an exception is not a contract, and it gives no per-part exit code either.
 *   One `exec` per part costs a few milliseconds each on a stream copy, and in
 *   exchange every part has its own exit code and its own probe.
 *
 * ⚠ KEYFRAME DRIFT IS REAL, AND IT IS THE ONE THING THIS FILE CANNOT FIX
 *   A stream copy cannot cut between keyframes — there is nothing there to
 *   cut, the frames in between are deltas against one. `-ss` before `-i` seeks
 *   to the keyframe at or before the time asked for. Measured on
 *   `sample-video.mp4` (2.090 s, h264 320x240 24 fps) against the shipped core
 *   on 2026-09-05:
 *
 *       -ss 0    -t 1  -c copy   ->  1.022 s   (asked for 1.000)
 *       -ss 1    -t 1  -c copy   ->  1.022 s   (asked for 1.000)
 *       -ss 0.5  -t 1  -c copy   ->  1.510 s   (the seek snapped back to 0)
 *
 *   So a part can START EARLIER than asked and RUN LONGER: a boundary moves
 *   backwards to the previous keyframe, which duplicates a little content
 *   across the join rather than losing it. That is the honest trade for
 *   "nothing is re-encoded", and it is why every part here is PROBED after it
 *   is written and reports `actualSeconds` — what ffprobe says the file is —
 *   never the number that was requested. A page that printed the request would
 *   be describing a file that does not exist.
 *
 * THE EMPTY-PART TRAP
 *   `video-trim.ts` records it: a zero-length range makes FFmpeg mux a
 *   header-only 591-byte file that plays nothing, and exit 0 while it does so.
 *   Two things stop that reaching a download here — `planSegments` refuses to
 *   plan a part shorter than `MIN_SEGMENT_SECONDS`, and every written part is
 *   probed and rejected if its duration is not a positive number.
 */

export type SplitMode = "equal-parts" | "fixed-duration" | "at-times";

export interface SplitVideoOptions {
  mode: SplitMode;
  /** `equal-parts`: how many parts of the same length. */
  parts?: number;
  /** `fixed-duration`: how long each part should be, in seconds. */
  segmentSeconds?: number;
  /** `at-times`: the cut points, in seconds, inside the clip. */
  cutTimes?: number[];
}

export interface VideoSegment {
  index: number;
  requestedStart: number;
  requestedEnd: number;
  /** What ffprobe says the produced file actually is. Keyframe drift makes this differ. */
  actualSeconds: number;
  blob: Blob;
  fileName: string;
}

export interface SplitVideoResult extends ProcessedResult {
  /** `blob` on the result is the ZIP; these are the parts inside it. */
  segments: VideoSegment[];
  sourceSeconds: number;
  /** TRUE when any part's actual duration differs from its request by >0.25 s. */
  keyframeDrift: boolean;
}

/**
 * Each part is its own FFmpeg run, so the plan decides how many runs happen.
 * A two-hour video cut every second is 7,200 execs, which is not a job a tab
 * should start without saying so. The cap is surfaced in the page's copy and
 * refused here by name, never silently truncated to the first hundred parts.
 */
export const MAX_SEGMENTS = 100;

/**
 * Shorter than this and a stream copy has nothing useful to write: keyframe
 * drift alone is worth ~1 GOP (0.5 s at 24 fps in the measured fixture), so a
 * 20 ms "part" is a header and no picture. Refused at plan time with the two
 * times that produced it, rather than downloaded as a file that will not play.
 */
export const MIN_SEGMENT_SECONDS = 0.05;

/** One planned cut, before FFmpeg has been asked for anything. */
export interface SegmentPlan {
  index: number;
  start: number;
  end: number;
}

/** Where the per-part ffprobe writes its JSON. One FFmpeg job runs at a time. */
const PROBE_OUTPUT = "split-probe.json";

/**
 * Seconds as an argv token: rounded to the millisecond so the argv is
 * legible and deterministic. `String(0.6970000000000001)` is what float
 * arithmetic on part boundaries produces otherwise, and a millisecond is three
 * orders of magnitude below the keyframe drift measured above, so the rounding
 * cannot move a cut anywhere the engine would not have moved it anyway.
 */
function argSeconds(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** `hh:mm:ss.s`-ish, for error messages that quote a time back to the user. */
function readableSeconds(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2)} s`;
}

/**
 * Turn a mode plus its one setting into the interior cut points. Split out so
 * the three modes' arithmetic can be read — and tested — one at a time.
 */
function interiorCuts(sourceSeconds: number, options: SplitVideoOptions): number[] {
  if (options.mode === "equal-parts") {
    const parts = options.parts ?? 0;
    if (!Number.isInteger(parts) || parts < 2) {
      throw new Error("Choose at least 2 parts.");
    }
    if (parts > MAX_SEGMENTS) {
      throw new Error(
        `${parts} parts is more than this tool will cut in one go. Each part is its own pass through the engine, and the limit is ${MAX_SEGMENTS}.`,
      );
    }
    const cuts: number[] = [];
    for (let i = 1; i < parts; i++) cuts.push((sourceSeconds * i) / parts);
    return cuts;
  }

  if (options.mode === "fixed-duration") {
    const every = options.segmentSeconds ?? 0;
    if (!(every > 0) || !Number.isFinite(every)) {
      throw new Error("Choose a part length longer than zero seconds.");
    }
    if (every >= sourceSeconds) {
      throw new Error(
        `This video is ${readableSeconds(sourceSeconds)} long, so a ${readableSeconds(every)} part length gives one part — which is the file you already have.`,
      );
    }
    const cuts: number[] = [];
    /*
      ⚠ WHAT HAPPENS TO THE LEFTOVER, precisely — the page's copy quotes this.
      A leftover becomes its OWN, SHORTER, FINAL PART: 100 s cut every 30 s is
      30 / 30 / 30 / 10, not 30 / 30 / 40. The loop bound absorbs a remainder
      into the part before it in exactly one case — when what is left is under
      MIN_SEGMENT_SECONDS, i.e. a 40 ms sliver that could not be written as a
      playable file anyway. Nothing is ever dropped either way: `planSegments`
      always closes on `sourceSeconds`.

      Absorbing a larger tail was considered and rejected. "Every 30 s" that
      hands back a 59 s part breaks the one promise the mode makes, and people
      pick a fixed length because something downstream (an upload limit, a
      slot) enforces it. A short last part is the honest shape.
    */
    for (let at = every; at < sourceSeconds - MIN_SEGMENT_SECONDS; at += every) {
      cuts.push(at);
    }
    return cuts;
  }

  const times = options.cutTimes ?? [];
  if (times.length === 0) {
    throw new Error("Add at least one time to cut at.");
  }
  for (const t of times) {
    if (!Number.isFinite(t) || t <= 0 || t >= sourceSeconds) {
      throw new Error(
        `${readableSeconds(t)} is outside this ${readableSeconds(sourceSeconds)} video — cut times have to fall inside it.`,
      );
    }
  }
  // Sorted so the parts come out in playing order whatever order they were
  // typed in, and de-duplicated because two cuts at the same instant would
  // otherwise plan a zero-length part.
  return [...new Set(times)].sort((a, b) => a - b);
}

/**
 * One timecode as a person types it: `90`, `1:30`, `1:30.5`, `01:02:03`.
 * Returns null for anything that is not one of those.
 *
 * Lives here rather than in the page because it decides `cutTimes`, which is
 * half of what `planSegments` acts on — a parser that silently read "1:70" as
 * 130 seconds would move a cut somewhere the user did not ask for, and that is
 * exactly the class of bug this file is careful about elsewhere.
 */
export function parseTimecode(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;

  let seconds = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // The last field may carry a decimal; the ones above it may not, and a
    // minutes or seconds field above 59 is a typo rather than an overflow.
    const pattern = i === parts.length - 1 ? /^\d+(\.\d+)?$/ : /^\d+$/;
    if (!pattern.test(part)) return null;
    const value = Number(part);
    if (parts.length > 1 && i > 0 && value >= 60) return null;
    seconds = seconds * 60 + value;
  }
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * A list of timecodes separated by commas, spaces or newlines. `invalid` holds
 * every token that could not be read, so the page can name them rather than
 * quietly cutting at fewer places than the user typed.
 */
export function parseCutTimes(text: string): { times: number[]; invalid: string[] } {
  const times: number[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const seconds = parseTimecode(token);
    if (seconds === null) invalid.push(token);
    else times.push(seconds);
  }
  return { times, invalid };
}

/**
 * The whole of what this tool decides before FFmpeg is involved: which spans
 * of the source become parts. Pure, so the three modes are unit-testable
 * without a wasm core — which is the only place they CAN be tested, since
 * jsdom has no FFmpeg.
 */
export function planSegments(sourceSeconds: number, options: SplitVideoOptions): SegmentPlan[] {
  if (!Number.isFinite(sourceSeconds) || sourceSeconds <= 0) {
    throw new Error(
      "Couldn't read how long this video is, and the cuts can only be worked out from its length.",
    );
  }

  const edges = [0, ...interiorCuts(sourceSeconds, options), sourceSeconds];
  const plans: SegmentPlan[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i];
    const end = edges[i + 1];
    if (end - start < MIN_SEGMENT_SECONDS) {
      throw new Error(
        `A part from ${readableSeconds(start)} to ${readableSeconds(end)} is too short to write as a playable file. Parts have to be at least ${MIN_SEGMENT_SECONDS} s long.`,
      );
    }
    plans.push({ index: i, start, end });
  }

  if (plans.length < 2) {
    throw new Error("These settings produce one part, which is the video you already have.");
  }
  if (plans.length > MAX_SEGMENTS) {
    throw new Error(
      `These settings produce ${plans.length} parts. Each part is its own pass through the engine, and the limit is ${MAX_SEGMENTS} — try longer parts, or fewer of them.`,
    );
  }
  return plans;
}

/**
 * The argv for one part.
 *
 * `-ss` goes BEFORE `-i` — the fast, keyframe-accurate seek. After `-i` with
 * `-c copy` it produces the frozen/black leading frames `video-trim.ts`
 * documents. `-avoid_negative_ts make_zero` restarts each part's timestamps at
 * zero, which is what stops a part that begins at 30 s from being reported as
 * starting at 30 s by a player.
 */
export function splitSegmentArgs(
  inputPath: string,
  plan: SegmentPlan,
  outputName: string,
): string[] {
  return [
    "-ss", argSeconds(plan.start),
    "-i", inputPath,
    "-t", argSeconds(plan.end - plan.start),
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    outputName,
  ];
}

/**
 * `format.duration` out of an ffprobe JSON body, or null.
 *
 * Exported for tests. ffprobe returns -1 on every input in this build (the
 * measurement is in `video-probe.ts`), so the exit code is never consulted —
 * the JSON is the only signal, and its failure body is literally `{\n\n}\n`,
 * which parses fine and carries nothing.
 */
export function durationFromProbeJson(json: string): number | null {
  let parsed: { format?: { duration?: string | number } };
  try {
    parsed = JSON.parse(json) as { format?: { duration?: string | number } };
  } catch {
    return null;
  }
  const raw = parsed.format?.duration;
  if (raw === undefined) return null;
  const seconds = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}

/** Ask ffprobe how long a file already inside the virtual FS is. */
async function probeSecondsInPlace(ffmpeg: FFmpeg, path: string): Promise<number | null> {
  // A probe left over from the previous part would be read as this part's
  // answer — the same hygiene `video-probe.ts` keeps for its own output.
  await ffmpeg.deleteFile(PROBE_OUTPUT).catch(() => {
    /* nothing there yet */
  });
  await ffmpeg.ffprobe([
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    path,
    "-o", PROBE_OUTPUT,
  ]);
  try {
    const data = await ffmpeg.readFile(PROBE_OUTPUT, "utf8");
    return durationFromProbeJson(typeof data === "string" ? data : new TextDecoder().decode(data));
  } catch {
    // ffprobe wrote nothing at all: the file it was pointed at is not readable
    // media. The caller turns that into a named failure for this part.
    return null;
  }
}

export async function splitVideo(
  file: File,
  options: SplitVideoOptions,
  ctx: ProcessingContext = {},
): Promise<SplitVideoResult> {
  // Each part is a stream copy, so the parts together are the size of the
  // source and the tab holds source-plus-parts. Same shape, same cap, as the
  // trimmer — the derivation is at the top of ffmpeg-loader.ts.
  validateFFmpegInput(file, "stream-copy");

  const ext = inputExtensionFor(file);
  const inputName = "split-input" + ext;
  const baseName = file.name.replace(/\.[^.]+$/, "") || "video";
  const mimeType = file.type || "video/mp4";

  const cut = await runFFmpegTask(
    async (ffmpeg) => {
      const inputPath = await mountInputFile(ffmpeg, file, inputName);
      // Names of every part file this run has asked MEMFS for, so the finally
      // can clear them even when a later part threw.
      const written: string[] = [];

      try {
        const sourceSeconds = await probeSecondsInPlace(ffmpeg, inputPath);
        if (sourceSeconds === null || !(sourceSeconds > 0)) {
          throw new Error(
            `${file.name || "That file"} could not be read as a video, so there is no length to cut against.`,
          );
        }

        const plans = planSegments(sourceSeconds, options);
        const pad = Math.max(2, String(plans.length).length);
        const segments: VideoSegment[] = [];

        for (const plan of plans) {
          throwIfAborted(ctx.signal);
          const outputName = `split-part-${String(plan.index).padStart(3, "0")}${ext}`;
          written.push(outputName);

          const ret = await ffmpeg.exec(splitSegmentArgs(inputPath, plan, outputName));
          if (ret !== 0) {
            throw new Error(
              `Part ${plan.index + 1} of ${plans.length} could not be cut — FFmpeg exited ${ret}.`,
            );
          }

          /*
            THE PART IS MEASURED, NOT ASSUMED. Two failures hide behind exit 0
            here: the header-only file a degenerate range produces, and the
            keyframe drift that makes a part longer than it was asked to be.
            Probing catches the first as an error and turns the second into a
            number the page can show.
          */
          const actualSeconds = await probeSecondsInPlace(ffmpeg, outputName);
          if (actualSeconds === null || !(actualSeconds > 0)) {
            throw new Error(
              `Part ${plan.index + 1} of ${plans.length} came out empty. FFmpeg reported success, but the file it wrote has no playable length, so it is not being handed over as a finished cut.`,
            );
          }

          const data = await ffmpeg.readFile(outputName);
          segments.push({
            index: plan.index,
            requestedStart: plan.start,
            requestedEnd: plan.end,
            actualSeconds,
            blob: new Blob([data as BlobPart], { type: mimeType }),
            fileName: `${baseName}-part-${String(plan.index + 1).padStart(pad, "0")}${ext}`,
          });

          // Freed as soon as it is a Blob: MEMFS holds each file in one JS
          // array on the worker heap, so keeping all N parts there at once
          // would double what this job needs for no reason.
          await ffmpeg.deleteFile(outputName).catch(() => {
            /* already gone */
          });

          ctx.onProgress?.(Math.round(((plan.index + 1) / plans.length) * 100));
        }

        return { segments, sourceSeconds };
      } finally {
        // All three have to run even when a part threw, or the source stays
        // pinned and the next job cannot mount over it.
        await unmountInputFile(ffmpeg);
        await ffmpeg.deleteFile(PROBE_OUTPUT).catch(() => {
          /* never written */
        });
        for (const name of written) {
          await ffmpeg.deleteFile(name).catch(() => {
            /* already read and deleted, or never written */
          });
        }
      }
    },
    /*
      `ctx.onProgress` is deliberately NOT handed to the loader. It would wire
      FFmpeg's own progress events straight through, and with one exec per part
      that reads 0→100, 0→100, 0→100. The per-part count above is monotonic and
      is what the user is actually waiting on.
    */
    { signal: ctx.signal },
  );

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const segment of cut.segments) zip.file(segment.fileName, segment.blob);
  const blob = await zip.generateAsync({ type: "blob" });

  const keyframeDrift = cut.segments.some(
    (s) => Math.abs(s.actualSeconds - (s.requestedEnd - s.requestedStart)) > 0.25,
  );

  return {
    blob,
    fileName: `${baseName}-parts.zip`,
    originalSize: file.size,
    newSize: blob.size,
    segments: cut.segments,
    sourceSeconds: cut.sourceSeconds,
    keyframeDrift,
    /*
      Carried on `ProcessedResult.warnings` as well as on `keyframeDrift`, so a
      caller that only knows the generic result shape still meets the fact. The
      page shows every part's measured length in a table; this is the sentence
      for everything that does not.
    */
    warnings: keyframeDrift
      ? [
          "Some parts came out longer than they were asked to be. Cutting without re-encoding can only happen at a keyframe, so a boundary moves back to the nearest one — the lengths listed for each part are what the files actually are.",
        ]
      : undefined,
  };
}
