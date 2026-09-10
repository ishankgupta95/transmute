import {
  runFFmpegTask,
  mountInputFile,
  unmountInputFile,
} from "./ffmpeg-loader";
import type { ProcessingContext } from "@/hooks/useFileProcessor";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Reading what is actually inside a video, before deciding what to do with it
 * ───────────────────────────────────────────────────────────────────────────
 * Every container tool in this cluster is remux-first: rewrap the streams into
 * a new container without touching them. That is only honest if we KNOW the
 * streams fit the target container, and the only way to know is to look.
 *
 * WHY `ffprobe` AND NOT THE LOG
 *   `ffmpeg -i in.mp4` prints the stream layout to stderr, but the loader
 *   swallows FFmpeg's log in production (`ffmpeg-loader.ts`: the handler is
 *   gated to development), so no tool can read it. `ffmpeg.ffprobe()` writes
 *   structured JSON to a file in the virtual FS with `-o`, which needs no log
 *   hook at all, and gives typed fields instead of a regex over prose.
 *
 * THE TRAP THAT MAKES THIS FILE LOOK ODD
 *   `ffprobe` returns -1 UNCONDITIONALLY in this build. Measured 2026-09-03
 *   against the shipped core on four inputs:
 *     valid mp4     EXIT=-1  full JSON
 *     valid wav     EXIT=-1  full JSON
 *     a text file   EXIT=-1  json="{\n\n}\n"
 *     missing file  EXIT=-1  json="{\n\n}\n"
 *   So the exit code carries NO information. Success is "the JSON parsed and
 *   has a `format` object"; anything else is a failure. Never branch on the
 *   return value of `ffprobe` here.
 */

export interface VideoStreamInfo {
  /** ffprobe `codec_name`, e.g. "h264", "hevc", "vp8". */
  codec: string;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  /**
   * How far the picture is turned when a player displays it, clockwise, in
   * degrees — 0, 90, 180 or 270. Derived from the video stream's Display
   * Matrix side data.
   *
   * The sign convention is measured, not assumed. A 64x64 clip with a red
   * block in the TOP-LEFT quadrant was tagged `-metadata:s:v:0 rotate=N` and
   * then rendered twice — once through FFmpeg's own autorotate, once through
   * Chromium's `<video>` element into a canvas. Both agreed exactly:
   *
   *   tag written   ffprobe side_data `rotation`   where the block lands
   *   (none)         -                              top-left
   *   rotate=90      90                             BOTTOM-left
   *   rotate=180     -180                           bottom-right
   *   rotate=270     -90                            TOP-right
   *
   * Top-left landing bottom-left is a COUNTER-clockwise quarter turn, so the
   * `rotate` tag counts counter-clockwise and this field, which counts
   * clockwise for the UI's benefit, is its complement.
   */
  rotationDegreesClockwise: number;
}

export interface AudioStreamInfo {
  /** ffprobe `codec_name`, e.g. "aac", "opus", "mp3". */
  codec: string;
  channels: number | null;
}

export interface MediaProbe {
  /**
   * ffprobe `format.format_name`, verbatim. Measured values for the containers
   * this cluster sees:
   *   .mp4 .mov .m4v .3gp -> "mov,mp4,m4a,3gp,3g2,mj2"   (one name for all four)
   *   .mkv .webm          -> "matroska,webm"
   *   .avi -> "avi"   .flv -> "flv"   .wmv -> "asf"
   *   .ts  -> "mpegts"   .ogv -> "ogg"
   * Note MP4 and MOV are INDISTINGUISHABLE here — the demuxer is shared. Use
   * the filename when the difference matters.
   */
  container: string;
  durationSeconds: number | null;
  sizeBytes: number;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
}

/** Where ffprobe's JSON lands inside the virtual FS. One job runs at a time. */
const PROBE_OUTPUT = "probe.json";

/**
 * FFmpeg picks its demuxer from the extension, so the virtual filename has to
 * carry one. Same rule as `video-trim.ts`: a dot-less name would otherwise make
 * the whole filename the "extension".
 */
export function inputExtensionFor(file: File): string {
  return /\.[^./]+$/.exec(file.name)?.[0] ?? (file.type === "video/webm" ? ".webm" : ".mp4");
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
  r_frame_rate?: string;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
}

interface RawProbe {
  streams?: RawStream[];
  format?: { format_name?: string; duration?: string };
}

/** `"24/1"` -> 24, `"30000/1001"` -> 29.97. Anything unusable -> null. */
function parseFrameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [num, den] = value.split("/");
  const n = Number(num);
  const d = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n <= 0) return null;
  return n / d;
}

function parseNumber(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn the Display Matrix's `rotation` into a clockwise 0/90/180/270.
 *
 * ffprobe normalises the angle into (-180, 180], so 270 comes back as -90 and
 * 180 as -180. Bring it back into [0, 360) first, then flip the direction (see
 * the measurement on `rotationDegreesClockwise`). Angles that are not a
 * quarter turn — rare, but a display matrix can hold any affine transform —
 * report 0, because this cluster only ever writes quarter turns and claiming a
 * 37-degree rotation we cannot act on would be worse than saying nothing.
 */
export function rotationClockwiseFrom(stream: RawStream): number {
  const matrix = stream.side_data_list?.find((s) => s.side_data_type === "Display Matrix");
  const raw = matrix?.rotation;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const counterClockwise = ((Math.round(raw) % 360) + 360) % 360;
  if (counterClockwise % 90 !== 0) return 0;
  return (360 - counterClockwise) % 360;
}

/**
 * Read a file's container, streams and codecs.
 *
 * Throws a friendly Error when the file is not decodable media.
 */
export async function probeMedia(file: File, ctx: ProcessingContext = {}): Promise<MediaProbe> {
  const inputName = "probe-input" + inputExtensionFor(file);

  const json = await runFFmpegTask(async (ffmpeg) => {
    const inputPath = await mountInputFile(ffmpeg, file, inputName);

    try {
      // A probe.json left behind by an earlier job would be read as this job's
      // answer, so clear it before writing and after reading.
      await ffmpeg.deleteFile(PROBE_OUTPUT).catch(() => {
        /* nothing there yet */
      });

      // The return value is deliberately ignored: ffprobe returns -1 on every
      // input in this build, valid or not (see the header). The JSON is the
      // only signal.
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
  }, ctx);

  return parseProbeJson(json, file);
}

/**
 * Split out from `probeMedia` so the parsing — which is where the ffprobe
 * quirks live — is testable without a wasm core.
 */
export function parseProbeJson(json: string, file: File): MediaProbe {
  let parsed: RawProbe;
  try {
    parsed = JSON.parse(json) as RawProbe;
  } catch {
    throw notMediaError(file);
  }

  // The failure body is literally `{\n\n}\n` — parses fine, carries nothing.
  // `format` is what separates "ffprobe read this file" from "ffprobe gave up".
  if (!parsed.format?.format_name) throw notMediaError(file);

  const streams = parsed.streams ?? [];
  // Found by `codec_type`, never by index: a macOS-written HEVC .mov puts its
  // AUDIO stream at index 0 (measured), so `streams[0]` is not the video.
  const videoStream = streams.find((s) => s.codec_type === "video" && s.codec_name);
  const audioStream = streams.find((s) => s.codec_type === "audio" && s.codec_name);

  return {
    container: parsed.format.format_name,
    durationSeconds: parseNumber(parsed.format.duration),
    sizeBytes: file.size,
    video: videoStream
      ? {
          codec: videoStream.codec_name as string,
          width: parseNumber(videoStream.width),
          height: parseNumber(videoStream.height),
          frameRate: parseFrameRate(videoStream.r_frame_rate),
          rotationDegreesClockwise: rotationClockwiseFrom(videoStream),
        }
      : null,
    audio: audioStream
      ? {
          codec: audioStream.codec_name as string,
          channels: parseNumber(audioStream.channels),
        }
      : null,
  };
}

function notMediaError(file: File): Error {
  return new Error(
    `${file.name || "That file"} is not a video or audio file this tool can read. It may be damaged, or it may be a format the browser build of FFmpeg was not compiled with.`,
  );
}
