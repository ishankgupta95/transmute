import type { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  runFFmpegTask,
  validateFFmpegInput,
  mountInputFile,
  unmountInputFile,
  fileToUint8Array,
  STREAM_COPY_MAX_INPUT_BYTES,
} from "./ffmpeg-loader";
import { inputExtensionFor } from "./video-probe";
import { throwIfAborted } from "@/lib/utils/abort";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Joining clips end to end without re-encoding, and refusing when that is a lie
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ⚠⚠⚠ THE MEASUREMENT THIS WHOLE FILE EXISTS FOR
 *   FFmpeg's concat demuxer, given files whose parameters differ, EXITS 0 AND
 *   WRITES A FILE CONTAINING ONLY THE FIRST CLIP. Measured 2026-09-05 against
 *   the shipped core, argv `-f concat -safe 0 -i list.txt -c copy out.mp4`,
 *   list lines `file 'NAME'`:
 *
 *     sample-video.mp4 + clip2.mp4          EXIT 0  expected 4.180  got 4.180  ok
 *     sample-video.mp4 + clip3.mp4          EXIT 0  expected 3.112  got 3.112  ok
 *     sample-video.mp4 + sample-video.mov   EXIT 0  expected 4.180  got 4.180  ok
 *     sample-video.mp4 + sample-video.mkv   EXIT 0  expected 4.180  got 2.090  ** LOST **
 *     sample-video.mp4 + sample-video.webm  EXIT 0  expected 3.976  got 2.090  ** LOST **
 *     sample-video.mp4 + sample-video.avi   EXIT 0  expected 4.180  got 2.090  ** LOST **
 *     sample-video.mp4 + hevc.mov           EXIT 0  expected 4.132  got 5.234  ** WRONG **
 *
 *   The exit code carries no information about whether the join happened. So
 *   this file never trusts it, and instead does two things:
 *
 *     1. PROBES EVERY INPUT FIRST and refuses a set that cannot be joined
 *        losslessly, naming the file and the property that differs
 *        (`checkMergeCompatibility`). The refusal is the product, not an
 *        error page — it is the only way a user learns WHY.
 *     2. PROBES THE OUTPUT AFTERWARDS and throws when its duration differs
 *        from the sum of the inputs by more than `DURATION_TOLERANCE_SECONDS`
 *        IN EITHER DIRECTION. Short means clips were left out; long means the
 *        timeline was rewritten (the hevc row above: 5.234 s written where
 *        4.132 s went in). Belt and braces: (1) can only compare properties
 *        somebody thought to compare, and (2) checks the file that exists.
 *
 * ⚠ WHY BOTH `container` AND `timeBase` ARE COMPARED
 *   The mp4+mkv and mp4+avi rows above lose the second clip while agreeing on
 *   EVERY stream property this file could otherwise compare — same h264, same
 *   320x240, same yuv420p, same 24/1, same aac at 44100 Hz stereo. Measured
 *   side by side:
 *
 *     sample-video.mp4   fmt=mov,mp4,m4a,3gp,3g2,mj2   video tb=1/57600
 *     sample-video.mov   fmt=mov,mp4,m4a,3gp,3g2,mj2   video tb=1/57600   joins
 *     sample-video.mkv   fmt=matroska,webm             video tb=1/1000    LOST
 *     sample-video.avi   fmt=avi                       video tb=1/48      LOST
 *
 *   An earlier revision of this file compared the container ALONE and said the
 *   timebase "differs because of it". That is false, and it was measured false
 *   against the shipped core: the mp4 video-track timescale is a per-file
 *   muxer choice, so files inside one `format_name` carry many of them. Same
 *   container, same h264/320x240/yuv420p/24-1/aac-44100-2ch, differing only in
 *   video `time_base`, joined against the 1/57600 original:
 *
 *     tb=1/90000   format.duration 6.391  ← the ONLY row the duration check sees
 *     tb=1/30000   format.duration 4.180  video track  2.130 s
 *     tb=1/16000   format.duration 4.180  video track  1.971 s
 *     tb=1/12288   format.duration 4.180  video track  1.968 s
 *     tb=1/1000    format.duration 4.180  video track  1.960 s
 *     tb=1/600     format.duration 4.180  video track  1.960 s
 *
 *   Every one of those holds all 96 video frames crushed into the first ~2 s
 *   against 4.18 s of audio — the back half of the join has no picture at all,
 *   and a raw-frame decode at t=3.0 s returns nothing. Two of those timescales
 *   come out of THIS SITE: `video-to-mp4`'s stream-copy rewrap writes 1/16000
 *   and its H.264 re-encode arm writes 1/12288, so the remedy this page points
 *   at is itself a way to reach the mismatch.
 *
 *   ⚠ AND THE DURATION CHECK CANNOT COVER FOR THIS. `format.duration` on the
 *   join is the AUDIO track's length, so five of the six rows above read
 *   exactly 4.180 s — delta 0.000, both arms of the guard silent. Comparing
 *   `time_base` up front is the only thing that separates them, which is why
 *   it is compared and why the pre-flight, not the duration net, is the
 *   primary guard for this class.
 *
 *   The container is compared by ffprobe's `format_name` rather than by
 *   extension — .mp4 and .mov share one demuxer and one name, which is exactly
 *   right here, because they measurably do join (and they share 1/57600).
 *
 * D3, RECORDED: v1 IS LOSSLESS CONCAT ONLY — THERE IS NO TRANSCODE FALLBACK.
 *   An FFmpeg `-filter_complex concat` fallback selects libx264 on an .mp4
 *   output, which deepens the GPL entanglement the repo's checked-in LGPL
 *   recipe exists to remove, on the one tool whose entire pitch is "nothing is
 *   re-encoded". And the measurements above say the honest refusal is the
 *   better product anyway: a table naming the file and the property beats a
 *   silent re-encode nobody asked for. A WebCodecs merge is the door left
 *   open; it needs cross-input audio concatenation and an AAC encoder Firefox
 *   does not have, which is a bigger build than this one.
 */

/**
 * How far the joined file may fall short of the sum of its parts before this
 * is called a failure. The measured losses are whole clips — 2.090 s against
 * an expected 4.180 s — so the tolerance only has to absorb the rounding of
 * three-decimal durations at each join.
 */
export const DURATION_TOLERANCE_SECONDS = 0.15;

export interface MergeInputInfo {
  fileName: string;
  durationSeconds: number;
  /**
   * ffprobe `format.format_name`, verbatim — "mov,mp4,m4a,3gp,3g2,mj2",
   * "matroska,webm", "avi". Not in the original module contract; added because
   * the measurement in this file's header proves the stream properties alone
   * do not separate a join that works from one that silently loses a clip.
   */
  container: string;
  /**
   * The VIDEO stream's ffprobe `time_base`, verbatim — "1/57600", "1/1000".
   * The unit every timestamp in that track is counted in. Two files that agree
   * on every other field and disagree here produce a join whose picture has
   * been re-timed against its own sound; the header's table is the
   * measurement. Null when the file has no video stream.
   */
  timeBase: string | null;
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  pixFmt: string | null;
  /** ffprobe `r_frame_rate`, verbatim — "24/1", "30000/1001". */
  frameRate: string | null;
  audioCodec: string | null;
  sampleRate: number | null;
  channels: number | null;
}

export interface MergeMismatch {
  fileName: string;
  property: string;
  expected: string;
  found: string;
}

export interface MergeVideoResult extends ProcessedResult {
  /**
   * Derived from the argv that actually ran, not asserted. Always true in v1
   * because `concatArgs` is the only argv this file builds — but if a
   * transcode arm is ever added, the claim moves with it instead of being left
   * behind as a lie.
   */
  streamCopied: boolean;
  inputs: MergeInputInfo[];
  totalSeconds: number;
  outputSeconds: number;
}

/** Where the merge's ffprobe writes its JSON. One FFmpeg job runs at a time. */
const PROBE_OUTPUT = "merge-probe.json";

/** The concat demuxer's manifest, inside MEMFS. */
const LIST_NAME = "concat-list.txt";

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  time_base?: string;
  r_frame_rate?: string;
  sample_rate?: string | number;
  channels?: number;
}

interface RawProbe {
  streams?: RawStream[];
  format?: { format_name?: string; duration?: string | number };
}

function parseNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * ffprobe JSON for one input, in the shape the comparison needs.
 *
 * Separate from `video-probe.ts`'s `parseProbeJson` because that one does not
 * carry `pix_fmt`, `sample_rate` or the raw `r_frame_rate` string, and those
 * are three of the properties this tool refuses on. Exported so the parsing —
 * where every ffprobe quirk lives — is testable without a wasm core.
 *
 * Throws rather than returning null for a missing duration: the whole safety
 * net downstream is "compare the output's length against the sum of the
 * inputs'", and a null in that sum would quietly disable it.
 */
export function parseMergeProbe(json: string, fileName: string): MergeInputInfo {
  let parsed: RawProbe;
  try {
    parsed = JSON.parse(json) as RawProbe;
  } catch {
    throw notMediaError(fileName);
  }
  // ffprobe's failure body is literally `{\n\n}\n` — it parses fine and
  // carries nothing, so `format` is what separates "read it" from "gave up".
  if (!parsed.format?.format_name) throw notMediaError(fileName);

  const duration = parseNumber(parsed.format.duration);
  if (duration === null || !(duration > 0)) {
    throw new Error(
      `Couldn't read how long ${fileName} is. This tool checks the joined file against the total length of its parts, and it cannot do that with a clip of unknown length — so it will not start the join.`,
    );
  }

  const streams = parsed.streams ?? [];
  // Found by `codec_type`, never by index: a macOS-written HEVC .mov puts its
  // AUDIO stream at index 0 (measured in video-probe.ts), so `streams[0]` is
  // not the video.
  const video = streams.find((s) => s.codec_type === "video" && s.codec_name);
  const audio = streams.find((s) => s.codec_type === "audio" && s.codec_name);

  return {
    fileName,
    durationSeconds: duration,
    container: parsed.format.format_name,
    timeBase: video?.time_base ?? null,
    videoCodec: video?.codec_name ?? null,
    width: parseNumber(video?.width),
    height: parseNumber(video?.height),
    pixFmt: video?.pix_fmt ?? null,
    frameRate: video?.r_frame_rate ?? null,
    audioCodec: audio?.codec_name ?? null,
    sampleRate: parseNumber(audio?.sample_rate),
    channels: parseNumber(audio?.channels),
  };
}

function notMediaError(fileName: string): Error {
  return new Error(
    `${fileName || "That file"} is not a video this tool can read. It may be damaged, or it may be a format the browser build of FFmpeg was not compiled with.`,
  );
}

/** ffprobe's `format_name` as a person would say it. */
export function containerLabel(formatName: string): string {
  if (formatName === "mov,mp4,m4a,3gp,3g2,mj2") return "MP4/MOV";
  if (formatName === "matroska,webm") return "MKV/WebM";
  return formatName.toUpperCase();
}

const CODEC_LABELS: Record<string, string> = {
  h264: "H.264",
  hevc: "H.265",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
  mpeg4: "MPEG-4",
  mjpeg: "Motion JPEG",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC",
  ac3: "AC-3",
};

/** ffprobe's `codec_name` as a person would say it. */
export function codecLabel(codec: string): string {
  return CODEC_LABELS[codec] ?? codec.toUpperCase();
}

/**
 * The properties a lossless join needs to agree on, each with the string the
 * mismatch table shows for it.
 *
 * `frameRate` is deliberately NOT here. It is carried on `MergeInputInfo` and
 * shown in the table, and a difference raises a warning on the finished file —
 * but nothing measured this session says a frame-rate difference loses a clip,
 * and refusing on an unmeasured property would turn away joins that work.
 *
 * The output-duration check is the net under all of this, but it is NOT the
 * catch-all an earlier revision called it: the number it reads is the output's
 * `format.duration`, which on a video+audio join is the AUDIO track's length,
 * so it cannot see a video track that has been squashed or stretched under it.
 * That class is caught by comparing `timeBase` up front — the header's second
 * table — which is why a property lands here rather than being left to the net
 * whenever a measurement says the net will not see it.
 */
const COMPARED: readonly { property: string; describe: (info: MergeInputInfo) => string }[] = [
  { property: "file format", describe: (i) => containerLabel(i.container) },
  /*
    Second, right under the container, because the two are read together: a
    container difference almost always brings a timebase difference with it,
    and a timebase difference INSIDE one container is the case the container
    check cannot see. Both measured — the header's two tables.
  */
  { property: "video timebase", describe: (i) => i.timeBase ?? "unknown" },
  {
    property: "video codec",
    describe: (i) => (i.videoCodec ? codecLabel(i.videoCodec) : "no video track"),
  },
  { property: "frame width", describe: (i) => (i.width === null ? "unknown" : `${i.width} px`) },
  { property: "frame height", describe: (i) => (i.height === null ? "unknown" : `${i.height} px`) },
  { property: "pixel format", describe: (i) => i.pixFmt ?? "unknown" },
  { property: "audio track", describe: (i) => (i.audioCodec ? "present" : "none") },
];

/** The audio detail, compared only when both clips actually have audio. */
const COMPARED_AUDIO: readonly {
  property: string;
  describe: (info: MergeInputInfo) => string;
}[] = [
  {
    property: "audio codec",
    describe: (i) => (i.audioCodec ? codecLabel(i.audioCodec) : "none"),
  },
  {
    property: "audio sample rate",
    describe: (i) => (i.sampleRate === null ? "unknown" : `${i.sampleRate} Hz`),
  },
  {
    property: "audio channels",
    describe: (i) => (i.channels === null ? "unknown" : String(i.channels)),
  },
];

/**
 * Every way the clips after the first differ from the first, in the words the
 * page prints. Pure, and the single source of the refusal — `mergeVideos`
 * calls it and stops, and the page calls it on drop so the refusal arrives
 * before anybody clicks anything.
 *
 * The first clip is the reference because it is the one whose container the
 * output is written into.
 */
export function compareMergeInputs(infos: readonly MergeInputInfo[]): MergeMismatch[] {
  if (infos.length < 2) return [];
  const [reference, ...rest] = infos;
  const mismatches: MergeMismatch[] = [];

  for (const info of rest) {
    for (const check of COMPARED) {
      const expected = check.describe(reference);
      const found = check.describe(info);
      if (expected !== found) {
        mismatches.push({ fileName: info.fileName, property: check.property, expected, found });
      }
    }
    // "aac vs none" adds nothing once "audio track: present vs none" has been
    // said, so the detail only runs where both sides have a track to describe.
    if (reference.audioCodec && info.audioCodec) {
      for (const check of COMPARED_AUDIO) {
        const expected = check.describe(reference);
        const found = check.describe(info);
        if (expected !== found) {
          mismatches.push({ fileName: info.fileName, property: check.property, expected, found });
        }
      }
    }
  }

  return mismatches;
}

/**
 * The refusal, as one sentence that names a file and a property.
 *
 * "These files are incompatible" is what this tool must never say: the whole
 * reason the pre-flight exists is that FFmpeg's own answer — a file with a
 * clip missing and an exit code of 0 — told the user nothing.
 */
export function describeMismatches(
  mismatches: readonly MergeMismatch[],
  referenceName: string,
): string {
  const first = mismatches[0];
  const rest = mismatches.length - 1;
  const more =
    rest > 0
      ? ` There ${rest === 1 ? "is 1 other difference" : `are ${rest} other differences`} listed below.`
      : "";
  return `${first.fileName} can't be joined to ${referenceName} without re-encoding: its ${first.property} is ${first.found}, where ${referenceName} is ${first.expected}.${more} Joining copies the clips across untouched, so they have to match — FFmpeg would otherwise write a file with clips missing and report success.`;
}

/**
 * Whether an argv is a genuine stream copy.
 *
 * `MergeVideoResult.streamCopied` is read off this rather than hardcoded to
 * true, so the "nothing was re-encoded" line on the page is derived from what
 * ran. Any encoder selection at all — `-c:v libx264`, `-c:a aac` — makes it
 * false.
 */
export function isStreamCopyArgs(args: readonly string[]): boolean {
  let sawCopy = false;
  for (let i = 0; i < args.length - 1; i++) {
    if (!args[i].startsWith("-c")) continue;
    if (args[i + 1] === "copy") sawCopy = true;
    else return false;
  }
  return sawCopy;
}

/**
 * MEMFS names for the inputs. Generated, never the user's filename — the
 * concat manifest quotes each name inside single quotes, and a filename
 * containing one would end the quoted string and turn the rest into demuxer
 * options. The extension is kept because the concat demuxer opens each listed
 * file itself and picks its demuxer from the name.
 */
export function memfsInputName(index: number, file: File): string {
  return `in${index}${inputExtensionFor(file)}`;
}

/**
 * A generated name is only safe if it really is generated. This asserts the
 * property rather than trusting the comment above it: anything outside
 * `[A-Za-z0-9._-]` cannot appear in a name `memfsInputName` produced, so
 * reaching this throw means a name came from somewhere else.
 */
function assertSafeConcatName(name: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`Refusing to write an unsafe name into the concat list: ${name}`);
  }
}

/** The manifest body: one `file 'NAME'` line per input, in join order. */
export function concatListText(names: readonly string[]): string {
  for (const name of names) assertSafeConcatName(name);
  return names.map((name) => `file '${name}'\n`).join("");
}

/**
 * The argv, exactly as measured. Nothing is added to it — `-avoid_negative_ts`
 * and friends read like harmless hygiene, but the table at the top of this
 * file is what a concat in this build was measured to do, and it was measured
 * with these nine tokens.
 */
export function concatArgs(listPath: string, outputName: string): string[] {
  return ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputName];
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".webm": "video/webm",
};

/** Ask ffprobe how long a file already inside the virtual FS is. */
async function probeSecondsInPlace(ffmpeg: FFmpeg, path: string): Promise<number | null> {
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
    const json = typeof data === "string" ? data : new TextDecoder().decode(data);
    const parsed = JSON.parse(json) as RawProbe;
    return parseNumber(parsed.format?.duration);
  } catch {
    return null;
  }
}

/**
 * Probe every input and say why they cannot be joined losslessly. An empty
 * `mismatches` array means the set is compatible.
 *
 * The page calls this on drop, so the table is on screen before the button is
 * pressed; `mergeVideos` calls it again and refuses on the result, so a caller
 * that skipped the pre-flight still cannot start a join that loses a clip.
 */
export async function checkMergeCompatibility(
  files: readonly File[],
  ctx: ProcessingContext = {},
): Promise<{ infos: MergeInputInfo[]; mismatches: MergeMismatch[] }> {
  const infos: MergeInputInfo[] = [];

  for (let i = 0; i < files.length; i++) {
    throwIfAborted(ctx.signal);
    const file = files[i];
    // Mounted, not written: a probe reads a few kilobytes of header, and
    // WORKERFS hands those over without copying the file into the heap.
    const inputName = `merge-probe-${i}${inputExtensionFor(file)}`;
    const json = await runFFmpegTask(
      async (ffmpeg) => {
        const inputPath = await mountInputFile(ffmpeg, file, inputName);
        try {
          await ffmpeg.deleteFile(PROBE_OUTPUT).catch(() => {
            /* nothing there yet */
          });
          // The return value is ignored on purpose: ffprobe returns -1 on
          // every input in this build. The JSON is the only signal — the
          // measurement is in video-probe.ts.
          await ffmpeg.ffprobe([
            "-v", "error",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            inputPath,
            "-o", PROBE_OUTPUT,
          ]);
          const data = await ffmpeg.readFile(PROBE_OUTPUT, "utf8");
          return typeof data === "string" ? data : new TextDecoder().decode(data);
        } finally {
          await unmountInputFile(ffmpeg);
          await ffmpeg.deleteFile(PROBE_OUTPUT).catch(() => {
            /* never written */
          });
        }
      },
      { signal: ctx.signal },
    );

    infos.push(parseMergeProbe(json, file.name));
    ctx.onProgress?.(Math.round(((i + 1) / files.length) * 100));
  }

  return { infos, mismatches: compareMergeInputs(infos) };
}

/*
  The joined file is the size of every input added together, and — unlike every
  other FFmpeg tool here — the inputs are WRITTEN into MEMFS rather than
  mounted, because the concat demuxer opens each listed file by name from the
  same filesystem the manifest lives on. So the job holds the inputs and an
  output of their combined size at once.

  The cap is `STREAM_COPY_MAX_INPUT_BYTES` applied to the TOTAL, because the
  output is the thing that has to survive MEMFS's 1.125x growth — the same
  derivation as the trimmer's, at the top of ffmpeg-loader.ts. Stated honestly:
  that derivation was measured for ONE file, and the N-file case was not
  measured. It is the ceiling that certainly binds, not a promise that
  everything under it fits.
*/
export const MERGE_TOTAL_MAX_BYTES = STREAM_COPY_MAX_INPUT_BYTES;

/**
 * Why this queue is too big to join, or null when it is not.
 *
 * Exported because the number that binds this tool is a TOTAL and every other
 * size surface on the page is per-file: the drop zone caps each clip, so a
 * queue can be built entirely out of legal files and still be refused. The
 * page calls this while the queue is being built and blocks the button on it,
 * `mergeVideos` calls it again and throws on it — one sentence, one threshold,
 * so what the page says and what the engine does cannot drift apart.
 */
export function describeSizeRefusal(files: readonly { size: number }[]): string | null {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes <= MERGE_TOTAL_MAX_BYTES) return null;
  const subject =
    files.length === 1
      ? "This clip comes"
      : `These ${files.length} clips come`;
  return `${subject} to ${(totalBytes / 1024 / 1024).toFixed(0)} MB. Joining copies them into one file, so the tab has to hold the parts and the whole at once, and the limit here is ${Math.round(MERGE_TOTAL_MAX_BYTES / 1024 / 1024)} MB in total, not per clip. Join them in smaller batches.`;
}

export async function mergeVideos(
  files: readonly File[],
  ctx: ProcessingContext = {},
): Promise<MergeVideoResult> {
  if (files.length < 2) {
    throw new Error("Add at least two clips to join.");
  }
  for (const file of files) validateFFmpegInput(file, "stream-copy");

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const tooBig = describeSizeRefusal(files);
  if (tooBig) throw new Error(tooBig);

  // Probing is roughly the first 40% of the wall clock on a small set and far
  // less on a large one; the scale keeps the bar monotonic either way.
  const { infos, mismatches } = await checkMergeCompatibility(files, {
    signal: ctx.signal,
    onProgress: (pct) => ctx.onProgress?.(Math.round(pct * 0.4)),
  });

  if (mismatches.length > 0) {
    throw new Error(describeMismatches(mismatches, infos[0].fileName));
  }

  const totalSeconds = infos.reduce((sum, info) => sum + info.durationSeconds, 0);
  const ext = inputExtensionFor(files[0]);
  const names = files.map((file, i) => memfsInputName(i, file));
  const outputName = `merged${ext}`;
  const args = concatArgs(LIST_NAME, outputName);

  const joined = await runFFmpegTask(
    async (ffmpeg) => {
      const temps = [LIST_NAME, outputName, ...names];
      try {
        for (let i = 0; i < files.length; i++) {
          throwIfAborted(ctx.signal);
          await ffmpeg.writeFile(names[i], await fileToUint8Array(files[i]));
          ctx.onProgress?.(40 + Math.round(((i + 1) / files.length) * 40));
        }

        await ffmpeg.writeFile(LIST_NAME, new TextEncoder().encode(concatListText(names)));

        const ret = await ffmpeg.exec(args);
        if (ret !== 0) {
          throw new Error(`The clips could not be joined — FFmpeg exited ${ret}.`);
        }
        ctx.onProgress?.(90);

        /*
          ⚠ THE GUARD THE HEADER'S MEASUREMENT EXISTS FOR. Exit 0 above means
          nothing: a mismatched set produces exit 0 and a file holding only the
          first clip, or one holding a rewritten timeline. The joined file is
          measured against the sum of the parts and BOTH directions are a hard
          failure — never a download.

          Two-sided because both directions were measured on this build. Short
          is the mkv/avi/webm rows: 2.090 s written where 4.180 s went in, a
          clip silently gone. Long is the hevc row (5.234 s for 4.132 s) and
          the 1/90000 timebase row (6.391 s for 4.180 s), where nothing is
          missing but a track has been re-timed — 96 video frames stretched
          across 6.39 s against 4.18 s of audio, so the picture ends 2.2 s
          after its own sound. A file that runs long is not a file with a
          rough seam; it is a file that plays wrong.
        */
        const outputSeconds = await probeSecondsInPlace(ffmpeg, outputName);
        if (outputSeconds === null || !(outputSeconds > 0)) {
          throw new Error(
            "The joined file could not be read back, so there is no way to check that every clip made it in. Nothing is being handed over.",
          );
        }
        if (Math.abs(outputSeconds - totalSeconds) > DURATION_TOLERANCE_SECONDS) {
          throw new Error(
            outputSeconds < totalSeconds
              ? `The join dropped content. These clips come to ${totalSeconds.toFixed(2)} s together, but the file FFmpeg wrote is only ${outputSeconds.toFixed(2)} s — it reported success and left clips out. The download has been refused rather than handing you a video with pieces missing.`
              : `The join rewrote the clips' timing. These clips come to ${totalSeconds.toFixed(2)} s together, but the file FFmpeg wrote is ${outputSeconds.toFixed(2)} s — copying clips across cannot add time, so the extra length is a track that has been re-timed and no longer runs in step with the sound beside it. The download has been refused rather than handing you a video that plays wrong.`,
          );
        }

        const data = await ffmpeg.readFile(outputName);
        const blob = new Blob([data as BlobPart], {
          type: MIME_BY_EXTENSION[ext.toLowerCase()] ?? files[0].type ?? "video/mp4",
        });
        return { blob, outputSeconds };
      } finally {
        // Every temp file, on every path — including the two throws above.
        // MEMFS holds each of these in one JS array on the worker heap, so a
        // failed 900 MB join that left them behind would take the next job's
        // memory with it.
        for (const name of temps) {
          await ffmpeg.deleteFile(name).catch(() => {
            /* never written, or already gone */
          });
        }
        await ffmpeg.deleteFile(PROBE_OUTPUT).catch(() => {
          /* never written */
        });
      }
    },
    /*
      `ctx.onProgress` is deliberately not handed to the loader: the writes
      above are most of the wall clock on a big set and FFmpeg reports nothing
      for them, so its own 0→100 over the exec alone would sit at 0 and then
      jump. The counter above covers the whole job.
    */
    { signal: ctx.signal },
  );

  ctx.onProgress?.(100);

  const baseName = files[0].name.replace(/\.[^.]+$/, "") || "video";
  const warnings: string[] = [];

  /*
    Frame rate is reported, not refused on (see COMPARED). Saying it out loud
    is the honest middle: the parts are copied across untouched, and nothing
    here re-times them.
  */
  const rates = [...new Set(infos.map((i) => i.frameRate).filter((r): r is string => r !== null))];
  if (rates.length > 1) {
    warnings.push(
      `These clips do not all report the same frame rate (${rates.join(", ")}). Every frame was copied across untouched — nothing here re-times them — but a player may not show the join as smoothly as it shows either clip on its own.`,
    );
  }

  /*
    There is deliberately no warning arm for a file that came out LONG. It used
    to say "nothing is missing, but a player may pause for a moment" and hand
    over the download — and the file it said that about was the 1/90000 row in
    the header: a video track stretched to 6.39 s against 4.18 s of audio. The
    only thing this function knows at that point is one scalar, `format.duration`
    of the output, which cannot tell a rough seam from a rewritten timeline. So
    it does not guess: the guard above refuses, in both directions.
  */

  return {
    blob: joined.blob,
    fileName: `${baseName}-joined${ext}`,
    originalSize: totalBytes,
    newSize: joined.blob.size,
    streamCopied: isStreamCopyArgs(args),
    inputs: infos,
    totalSeconds,
    outputSeconds: joined.outputSeconds,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
