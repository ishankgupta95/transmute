import {
  runFFmpegTask,
  validateFFmpegInput,
  mountInputFile,
  unmountInputFile,
} from "./ffmpeg-loader";
import { probeMedia, inputExtensionFor, type MediaProbe } from "./video-probe";
import type { ProcessingContext } from "@/hooks/useFileProcessor";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Remux first, re-encode only when it is the only honest option
 * ───────────────────────────────────────────────────────────────────────────
 * Changing a video's container does not have to touch the picture. `-c copy`
 * lifts the encoded streams out of one wrapper and drops them into another;
 * measured on the shipped core, a 2-second clip takes 4-12 ms and the output is
 * bit-identical video. A re-encode of the same clip takes 300-400 ms, and a
 * 10-minute 720p one takes about 8 minutes — and throws away quality on the
 * way. So: copy whenever copying gives the user a file that works, and when it
 * does not, say so and let them choose.
 *
 * The part that makes this worth writing down is the case where a copy
 * SUCCEEDS and is still the wrong answer. An iPhone .mov is routinely H.265,
 * and H.265 muxes into MP4 perfectly happily (measured: EXIT=0, 205,599 B).
 * The user gets a .mp4 that their browser will not play, and the tool would
 * have reported success. That is the silent-failure class this codebase spent
 * Wave 0 removing, so it is handled explicitly below.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASUREMENT 1 — what `-c copy` will actually mux, per container
 * ═══════════════════════════════════════════════════════════════════════════
 * Measured 2026-09-03 against the shipped `public/ffmpeg-core.wasm` (FFmpeg
 * 5.1.4) in headless Chromium. One source file was built per codec with the
 * same core, then `ffmpeg -i <src> -c copy out.<ext>` was run for each target.
 * Exit codes, verbatim:
 *
 *   VIDEO       .mp4   .mov   .mkv
 *   h264          0      0      0
 *   hevc          0      0      0
 *   mpeg4         0      0      0
 *   mjpeg         0      0      0
 *   vp8           1      1      0     mp4: "Could not find tag for codec vp8 in
 *                                     stream #0, codec not currently supported
 *                                     in container"
 *                                     mov: "Not yet implemented in FFmpeg,
 *                                     patches welcome"
 *   theora        1      0      0
 *   wmv2          1      0      0
 *   flv1          1      0      0
 *
 *   AUDIO       .mp4   .mov   .mkv
 *   aac           0      0      0
 *   mp3           0      0      0
 *   ac3           0      0      0
 *   alac          0      0      0
 *   vorbis        0      0      0
 *   opus          0      1      0     mov: "Could not write header ... Invalid
 *                                     argument"
 *   flac          1      1      0     mp4: "... Experimental feature"
 *   pcm_s16le     1      0      0
 *
 * MKV took every codec tried. That is why it is the "keep the streams" target.
 *
 * Every one of those failures was a CLEAN exit 1 — no wasm trap, and a healthy
 * job immediately afterwards returned 0. Re-confirmed the same session. That is
 * what makes the runtime fallback in `remuxVideo` safe: an over-optimistic
 * plan costs one wasted millisecond, not a poisoned engine.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASUREMENT 2 — muxing is not playing
 * ═══════════════════════════════════════════════════════════════════════════
 * The four video codecs that mux into MP4 were each built into a real .mp4 by
 * the shipped core and then loaded into a real <video> element in three
 * engines. "plays" = `loadeddata` fired AND `videoWidth` was non-zero.
 *
 *   in .mp4    Chromium 147   WebKit 26.4   Firefox 148
 *   h264         plays          plays         plays
 *   hevc         NO             plays         plays
 *   mpeg4        NO             plays         NO
 *   mjpeg        NO             plays         NO
 *
 *   Chromium's failures: `canPlayType` returned "" and videoWidth stayed 0.
 *   mjpeg did not even demux: "DEMUXER_ERROR_NO_SUPPORTED_STREAMS".
 *
 * Caveat recorded honestly: this was Playwright's Chromium, which is the
 * open-source build without the proprietary decoders. Real Chrome on recent
 * macOS and Windows does play HEVC through the platform decoder. So "HEVC in
 * MP4 does not play in Chromium" is measured, and "HEVC in MP4 plays nowhere"
 * would be false — the honest claim, and the one the reason strings below make,
 * is that H.264 is the only one that played in EVERY engine tested.
 *
 * That single result is the whole policy: into MP4 and MOV, only H.264 is
 * copied. Everything else is offered a transcode, never given one silently.
 * Into MKV, everything is copied, because MKV's job is to hold the streams as
 * they are and it makes no playback promise to break.
 */

export type VideoContainer = "mp4" | "mov" | "mkv";

/** What a remux into `target` would cost, decided from a real probe. */
export type RemuxPlan =
  | { kind: "copy"; reason: string }
  | { kind: "transcode"; reason: string; estimateSeconds: number | null };

export interface RemuxResult {
  blob: Blob;
  fileName: string;
  /** TRUE only when the run was a genuine `-c copy`. Drives the "no re-encode" claim. */
  streamCopied: boolean;
  probe: MediaProbe;
  /**
   * Non-fatal notices for the UI, same contract as `ProcessedResult.warnings`:
   * the run succeeded, but something happened the user probably wants to know.
   */
  warnings?: string[];
}

export type RotationDegrees = 90 | 180 | 270;

const MIME_BY_CONTAINER: Record<VideoContainer, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

/**
 * ffprobe's `format.format_name` for the ISO base-media family. MP4, MOV, M4V
 * and 3GP all report this one string — they share a demuxer — so it is the
 * only honest way to ask "is this an MP4-family file?" from a probe. Measured
 * on all four.
 */
const ISOBMFF_FORMAT_NAME = "mov,mp4,m4a,3gp,3g2,mj2";

/**
 * The one video codec that played in every browser engine tested (see
 * MEASUREMENT 2). MP4 and MOV exist here to produce a file that plays, so this
 * is the only stream they copy.
 */
const PLAYS_EVERYWHERE_VIDEO = new Set(["h264"]);

/**
 * Audio copied into MP4/MOV without question. Both mux cleanly (MEASUREMENT 1)
 * and both are decoded by every mainstream player. Opus, Vorbis, ALAC, AC-3,
 * FLAC and PCM are re-encoded to AAC instead: some of them will not even mux
 * (FLAC into MP4 is "Experimental feature"; Opus into MOV is "Invalid
 * argument"), and the ones that do mux are not universally decodable, which is
 * the same trap as H.265 video. The cost is small — an audio-only re-encode ran
 * at 55x realtime, measured.
 */
const PLAYS_EVERYWHERE_AUDIO = new Set(["aac", "mp3"]);

/**
 * H.264 encode throughput on this build, measured 2026-09-03, two anchors:
 *
 *   1280x720, 30 fps, 10 s (300 frames = 276.5 Mpx)   ->  7,680 ms  = 36.0 Mpx/s
 *   320x240,  24 fps, 2.04 s (49 frames = 3.76 Mpx)   ->    327 ms  = 11.5 Mpx/s
 *
 * The second is dominated by fixed cost, so the model is a constant plus a
 * linear term. 34 Mpx/s and 0.25 s reproduce both within 10%, erring long:
 *   720p  -> 0.25 + 276.5/34 = 8.4 s  (measured 7.7 s)
 *   320p  -> 0.25 +   3.8/34 = 0.36 s (measured 0.33 s)
 * Over-estimating is the safe direction for a number shown before a slow job.
 *
 * Both runs used the argv this file ships (`-preset veryfast -crf 23`), single
 * threaded, no SIMD acceleration in libx264 ("using cpu capabilities: none!").
 */
const H264_PIXELS_PER_SECOND = 34_000_000;
const TRANSCODE_FIXED_SECONDS = 0.25;

/**
 * Audio-only re-encode to AAC: 1.886 s of Opus re-encoded with `-c:v copy
 * -c:a aac` took 34 ms (55x realtime); 2.04 s of AAC with `-vn` took 66 ms
 * (31x). 25x is the conservative end of that range.
 */
const AAC_REALTIME_MULTIPLE = 25;

interface StreamActions {
  video: "copy" | "transcode" | "absent";
  audio: "copy" | "transcode" | "absent";
}

function decideStreams(probe: MediaProbe, target: VideoContainer): StreamActions {
  // MKV holds every codec measured, and promises nothing about playback, so
  // there is never a reason to re-encode into it.
  if (target === "mkv") {
    return {
      video: probe.video ? "copy" : "absent",
      audio: probe.audio ? "copy" : "absent",
    };
  }
  return {
    video: !probe.video
      ? "absent"
      : PLAYS_EVERYWHERE_VIDEO.has(probe.video.codec)
        ? "copy"
        : "transcode",
    audio: !probe.audio
      ? "absent"
      : PLAYS_EVERYWHERE_AUDIO.has(probe.audio.codec)
        ? "copy"
        : "transcode",
  };
}

/** Human name for a codec id, for reason strings. Unknown ids pass through. */
function codecLabel(codec: string): string {
  const names: Record<string, string> = {
    h264: "H.264",
    hevc: "H.265 (HEVC)",
    vp8: "VP8",
    vp9: "VP9",
    av1: "AV1",
    mpeg4: "MPEG-4 Part 2",
    mjpeg: "Motion JPEG",
    theora: "Theora",
    wmv1: "WMV",
    wmv2: "WMV",
    wmv3: "WMV",
    vc1: "VC-1",
    flv1: "Sorenson Spark",
    prores: "ProRes",
    aac: "AAC",
    mp3: "MP3",
    opus: "Opus",
    vorbis: "Vorbis",
    flac: "FLAC",
    alac: "ALAC",
    ac3: "AC-3",
    wmav2: "WMA",
    pcm_s16le: "uncompressed PCM",
  };
  return names[codec] ?? codec.toUpperCase();
}

/**
 * How long the re-encode would take, or `null` when we cannot say.
 *
 * `null` is a real answer, not a failure: without a duration, a frame rate and
 * a frame size there is no defensible number, and inventing one is worse than
 * showing nothing.
 */
function estimateTranscodeSeconds(probe: MediaProbe, actions: StreamActions): number | null {
  const duration = probe.durationSeconds;
  if (duration === null || duration <= 0) return null;

  if (actions.video !== "transcode") {
    // Only the audio is being re-encoded — a much cheaper job.
    if (actions.audio !== "transcode") return null;
    return Math.max(1, Math.round(TRANSCODE_FIXED_SECONDS + duration / AAC_REALTIME_MULTIPLE));
  }

  const { width, height, frameRate } = probe.video ?? { width: null, height: null, frameRate: null };
  if (!width || !height || !frameRate) return null;

  const pixels = width * height * frameRate * duration;
  return Math.max(1, Math.round(TRANSCODE_FIXED_SECONDS + pixels / H264_PIXELS_PER_SECOND));
}

/**
 * Decide, from a real probe, whether rewrapping into `target` can be a straight
 * stream copy — and if not, why not and roughly what the alternative costs.
 *
 * This is a PREDICTION. `remuxVideo` still verifies it against the muxer at
 * run time and never reports `streamCopied: true` on a run that re-encoded.
 */
export function planRemux(probe: MediaProbe, target: VideoContainer): RemuxPlan {
  const actions = decideStreams(probe, target);

  if (actions.video !== "transcode" && actions.audio !== "transcode") {
    if (target === "mkv") {
      return {
        kind: "copy",
        reason:
          "Matroska holds these streams exactly as they are, so the picture and sound are copied across untouched — nothing is re-encoded and nothing is lost.",
      };
    }
    const parts: string[] = [];
    if (probe.video) parts.push(`${codecLabel(probe.video.codec)} video`);
    if (probe.audio) parts.push(`${codecLabel(probe.audio.codec)} audio`);
    return {
      kind: "copy",
      reason: `${parts.join(" and ") || "These streams"} can go straight into ${target.toUpperCase()}, so the file is rewrapped and nothing is re-encoded.`,
    };
  }

  const estimateSeconds = estimateTranscodeSeconds(probe, actions);
  return { kind: "transcode", reason: transcodeReason(probe, target, actions), estimateSeconds };
}

function transcodeReason(
  probe: MediaProbe,
  target: VideoContainer,
  actions: StreamActions,
): string {
  const upper = target.toUpperCase();

  if (actions.video === "transcode" && probe.video) {
    const codec = probe.video.codec;
    const label = codecLabel(codec);
    if (codec === "hevc") {
      // The iPhone case, and the reason this branch exists at all.
      return `This video is ${label}. It can be dropped into a ${upper} without re-encoding, but the result still will not play everywhere — H.265 did not decode in Chromium in our own testing, while H.264 played in every browser engine we tried. Converting the picture to H.264 fixes that, but it re-encodes, which takes time and loses a little quality.`;
    }
    if (PLAYS_EVERYWHERE_VIDEO.has(codec)) {
      // Not reachable today, but keeps the message honest if the set grows.
      return `The picture has to be re-encoded to fit a ${upper}.`;
    }
    return `This video is ${label}, which a ${upper} either cannot carry at all or cannot carry in a form most players will open. Converting the picture to H.264 makes it play, but it re-encodes, which takes time and loses a little quality.`;
  }

  if (actions.audio === "transcode" && probe.audio) {
    return `The picture is copied across untouched, but the ${codecLabel(probe.audio.codec)} soundtrack cannot go into a ${upper} as it is, so the audio is re-encoded to AAC. That is quick, and the video is not touched.`;
  }

  return `Some of this file has to be re-encoded to fit a ${upper}.`;
}

/** `-c copy`, the whole point of this file. */
function copyArgs(inputPath: string, outputName: string): string[] {
  return ["-i", inputPath, "-c", "copy", outputName];
}

/**
 * The transcode argv, pinned.
 *
 * `libx264` and NEVER `libx265`: the shipped core is built `--enable-libx265`
 * but the encoder DEADLOCKS in it — measured, it initialises ("x265 [info]:
 * Thread pool created using 1 threads") and then emits nothing for 80 s+ on a
 * SINGLE 320x240 frame, log line count frozen at 38. `exec`'s own `timeout`
 * parameter does not fire either (single-threaded wasm blocks the worker's
 * event loop), so there would be no way out of it but a page reload. Same for
 * `libvpx-vp9`, which traps after ~25 frames. `libx264` is the only video
 * encoder in this build that is both fast and stable.
 *
 * `-pix_fmt yuv420p` is not decoration: iPhone HEVC is often 10-bit, and
 * letting x264 follow the source into High 10 would produce an H.264 file that
 * browsers refuse for the same reason the H.265 one was refused. Verified on
 * the output: `video=h264/High/yuv420p`.
 */
function transcodeArgs(
  inputPath: string,
  outputName: string,
  actions: StreamActions,
): string[] {
  const args = [
    "-i", inputPath,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
  ];
  if (actions.audio === "copy") args.push("-c:a", "copy");
  else if (actions.audio === "transcode") args.push("-c:a", "aac", "-b:a", "192k");
  args.push(outputName);
  return args;
}

function baseNameOf(file: File): string {
  return file.name.replace(/\.[^.]+$/, "") || "video";
}

/**
 * Rewrap a video into `target`, re-encoding only when a copy would not give the
 * user something that works — and only with permission.
 */
export async function remuxVideo(
  file: File,
  target: VideoContainer,
  options: { allowTranscode: boolean },
  ctx: ProcessingContext = {},
): Promise<RemuxResult> {
  // Every operation in this file is a stream copy or, at worst, a same-size
  // re-encode, so the output has to sit in MEMFS beside the input. That is the
  // 1.5 GB shape. See the derivation at the top of ffmpeg-loader.ts.
  validateFFmpegInput(file, "stream-copy");

  const probe = await probeMedia(file, ctx);
  const plan = planRemux(probe, target);

  if (plan.kind === "transcode" && !options.allowTranscode) {
    throw new Error(`${plan.reason} Turn on re-encoding to convert this file.`);
  }

  const inputName = "input" + inputExtensionFor(file);
  const outputName = `output.${target}`;
  const actions = decideStreams(probe, target);
  const warnings: string[] = [];

  const { blob, streamCopied } = await runFFmpegTask(async (ffmpeg) => {
    const inputPath = await mountInputFile(ffmpeg, file, inputName);

    try {
      let copied = plan.kind === "copy";

      if (copied) {
        const ret = await ffmpeg.exec(copyArgs(inputPath, outputName));
        if (ret !== 0) {
          // The plan was optimistic. That is survivable — an incompatible copy
          // is a clean exit 1 that leaves the engine healthy (measured) — but
          // it must never be reported as a successful copy.
          if (!options.allowTranscode) {
            throw new Error(
              `${target.toUpperCase()} could not carry this file's streams as they are${
                probe.video ? ` (the video is ${codecLabel(probe.video.codec)})` : ""
              }, so it cannot be converted without re-encoding.`,
            );
          }
          copied = false;
          warnings.push(
            `A straight copy was tried first and the ${target.toUpperCase()} muxer refused it, so the video was re-encoded to H.264.`,
          );
        }
      }

      if (!copied) {
        // Force the video branch: we are here because a copy is not an option.
        const ret = await ffmpeg.exec(
          transcodeArgs(inputPath, outputName, { ...actions, video: "transcode" }),
        );
        if (ret !== 0) throw new Error("FFmpeg could not convert this video.");
      }

      const data = await ffmpeg.readFile(outputName);
      return {
        blob: new Blob([data as BlobPart], { type: MIME_BY_CONTAINER[target] }),
        streamCopied: copied,
      };
    } finally {
      // Both have to run even when exec threw, or the source stays pinned and
      // the next job cannot mount over it.
      await unmountInputFile(ffmpeg);
      await ffmpeg.deleteFile(outputName).catch(() => {
        /* never written */
      });
    }
  }, ctx);

  return {
    blob,
    fileName: `${baseNameOf(file)}.${target}`,
    streamCopied,
    probe,
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * Drop the audio track. Nothing is re-encoded — `-an -c copy` took 7 ms on a
 * 2-second clip, `speed=4.9e+03x`, `video:147kB audio:0kB`.
 */
export async function muteVideo(file: File, ctx: ProcessingContext = {}): Promise<RemuxResult> {
  validateFFmpegInput(file, "stream-copy");

  const probe = await probeMedia(file, ctx);
  const ext = inputExtensionFor(file);
  const inputName = "input" + ext;
  const outputName = "output" + ext;
  const warnings: string[] = [];

  // Removing a track that is not there produces a copy of the input and would
  // otherwise be reported as a successful edit.
  if (!probe.audio) {
    warnings.push("This video had no audio track, so there was nothing to remove.");
  }

  const blob = await runFFmpegTask(async (ffmpeg) => {
    const inputPath = await mountInputFile(ffmpeg, file, inputName);

    try {
      const ret = await ffmpeg.exec(["-i", inputPath, "-an", "-c", "copy", outputName]);
      if (ret !== 0) throw new Error("FFmpeg could not remove the audio from this video.");

      const data = await ffmpeg.readFile(outputName);
      return new Blob([data as BlobPart], { type: file.type || "video/mp4" });
    } finally {
      await unmountInputFile(ffmpeg);
      await ffmpeg.deleteFile(outputName).catch(() => {
        /* never written */
      });
    }
  }, ctx);

  return {
    blob,
    fileName: `${baseNameOf(file)}-muted${ext}`,
    streamCopied: true,
    probe,
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * Turn the picture by rewriting the container's rotation flag.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A FLAG REWRITE AND NOT A FILTER
 * ═══════════════════════════════════════════════════════════════════════════
 * `-metadata:s:v:0 rotate=N` with `-c copy` took **6 ms** on a 2-second clip
 * (`speed=5.22e+03x`) and re-probing the output showed a real display matrix,
 * `displaymatrix: rotation of 90.00 degrees`. Rotating the same picture by
 * re-encoding it (`-vf transpose=1`, 720p30, 10 s) took **7,579 ms**. That is
 * about a thousand times slower, and it re-compresses every frame.
 *
 * `-display_rotation` — the flag most documentation reaches for — DOES NOT
 * EXIST in this build: "Unrecognized option 'display_rotation'. Error splitting
 * the argument list: Option not found", exit 1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHICH CONTAINERS ACTUALLY KEEP THE FLAG — this one is a trap
 * ═══════════════════════════════════════════════════════════════════════════
 * The command succeeds on containers that then silently discard the rotation.
 * Measured: `-c copy -metadata:s:v:0 rotate=90` into each container, then
 * re-probed for Display Matrix side data.
 *
 *   .mp4  EXIT=0  rotation=90     kept
 *   .mov  EXIT=0  rotation=90     kept
 *   .m4v  EXIT=0  rotation=90     kept
 *   .3gp  EXIT=0  rotation=90     kept
 *   .mkv  EXIT=0  (no side data)  SILENTLY DROPPED
 *   .avi  EXIT=0  (no side data)  SILENTLY DROPPED
 *   .ts   EXIT=0  (no side data)  SILENTLY DROPPED
 *   .flv  EXIT=0  (no side data)  SILENTLY DROPPED
 *
 * Three other spellings were tried on Matroska (an extra uppercase ROTATE tag,
 * explicit per-stream `-c:v copy -c:a copy`, `-write_crc32 0`) and all three
 * produced a file with no rotation. FFmpeg 5.1.4 has no way to set a Matroska
 * rotation on a stream copy. So a non-ISOBMFF input is REFUSED here rather
 * than handed back unrotated with a success message.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DIRECTION, AND WHY `degrees` IS NOT WRITTEN OUT VERBATIM
 * ═══════════════════════════════════════════════════════════════════════════
 * A 64x64 clip with a red block in the TOP-LEFT quadrant was tagged and then
 * rendered by two independent decoders — FFmpeg's own autorotate, and
 * Chromium's <video> element drawn onto a canvas. They agreed exactly:
 *
 *   tag written    where the top-left block ends up
 *   rotate=90      bottom-left   (a quarter turn COUNTER-clockwise)
 *   rotate=180     bottom-right
 *   rotate=270     top-right     (a quarter turn clockwise)
 *
 * So the tag counts counter-clockwise. `degrees` here is CLOCKWISE, because
 * that is what "rotate right" means to a person, and it is converted on the way
 * in. Writing the user's number straight through would have turned every video
 * the wrong way.
 *
 * The tag is also ABSOLUTE, not cumulative: writing `rotate=180` onto a file
 * already tagged 90 leaves it at 180, not 270. And a plain `-c copy` carries an
 * existing tag through untouched. So a video that arrives already rotated — an
 * iPhone portrait clip is the common case — has to have its existing rotation
 * read and added, or "rotate 90" on it would be a no-op the user cannot see.
 * `rotate=0` and `rotate=360` both clear the flag, which is what a rotation
 * that lands back at upright should do.
 */
export async function rotateVideo(
  file: File,
  degrees: RotationDegrees,
  ctx: ProcessingContext = {},
): Promise<RemuxResult> {
  if (degrees !== 90 && degrees !== 180 && degrees !== 270) {
    throw new Error("Rotation has to be 90, 180 or 270 degrees.");
  }
  validateFFmpegInput(file, "stream-copy");

  const probe = await probeMedia(file, ctx);

  if (!probe.video) {
    throw new Error("There is no video track in this file to rotate.");
  }
  if (probe.container !== ISOBMFF_FORMAT_NAME) {
    throw new Error(
      "Rotating without re-encoding works by setting a flag in the file, and this container does not store one — the file would come back looking exactly the same. Convert it to MP4 first, then rotate that.",
    );
  }

  // Clockwise for the user, counter-clockwise for the tag, and composed with
  // whatever rotation the file already declares. See the header.
  const alreadyClockwise = probe.video.rotationDegreesClockwise;
  const totalClockwise = (alreadyClockwise + degrees) % 360;
  const tagValue = (360 - totalClockwise) % 360;

  const ext = inputExtensionFor(file);
  const inputName = "input" + ext;
  const outputName = "output" + ext;

  const blob = await runFFmpegTask(async (ffmpeg) => {
    const inputPath = await mountInputFile(ffmpeg, file, inputName);

    try {
      const ret = await ffmpeg.exec([
        "-i", inputPath,
        "-c", "copy",
        "-metadata:s:v:0", `rotate=${tagValue}`,
        outputName,
      ]);
      if (ret !== 0) throw new Error("FFmpeg could not rotate this video.");

      const data = await ffmpeg.readFile(outputName);
      return new Blob([data as BlobPart], { type: file.type || "video/mp4" });
    } finally {
      await unmountInputFile(ffmpeg);
      await ffmpeg.deleteFile(outputName).catch(() => {
        /* never written */
      });
    }
  }, ctx);

  const warnings: string[] = [];
  if (alreadyClockwise !== 0) {
    warnings.push(
      `This video already carried a ${alreadyClockwise}-degree rotation, so the new one was added to it: it is now ${totalClockwise === 0 ? "upright" : `${totalClockwise} degrees from upright`}.`,
    );
  }

  return {
    blob,
    fileName: `${baseNameOf(file)}-rotated${ext}`,
    streamCopied: true,
    probe,
    ...(warnings.length ? { warnings } : {}),
  };
}
