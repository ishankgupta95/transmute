import {
  runFFmpegTask,
  validateFFmpegInput,
  mountInputFile,
  unmountInputFile,
} from "./ffmpeg-loader";
import { probeMedia, inputExtensionFor } from "./video-probe";
import { assertSafeFFmpegAudioArgs, DEFAULT_MP3_BITRATE } from "./audio-format";
import { isAbortError } from "@/lib/utils/abort";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * Pull the audio out of a video — and, when it can, WITHOUT re-encoding it
 * ───────────────────────────────────────────────────────────────────────────
 * This generalises what `mp4-to-mp3.ts` did for one container and one output.
 * The container half was already general: FFmpeg's demuxers cover MP4, MOV,
 * MKV, WebM and AVI, and the hint comes from the user's own extension. What is
 * new is the output half, and specifically the arm that does not encode at all.
 *
 * THE STREAM COPY IS THE POINT
 *   A video's audio track is already a finished MP3/AAC/Opus/… bitstream. When
 *   the target container can carry that codec, FFmpeg can lift it out
 *   byte-for-byte: no decode, no encode, no generational loss, and it finishes
 *   in milliseconds instead of seconds. Measured against the shipped core,
 *   headless Chromium, 2026-09-04, on this repo's own fixtures:
 *
 *     -i input.mp4  -map 0:a:0 -vn -c:a copy o.m4a    EXIT=0  11 549 B  27 ms
 *     -i input.mkv  -map 0:a:0 -vn -c:a copy o2.m4a   EXIT=0  11 555 B   5 ms
 *     -i input.avi  -map 0:a:0 -vn -c:a copy o3.m4a   EXIT=0  11 547 B   5 ms
 *     -i input.mov  -map 0:a:0 -vn -c:a copy o4.m4a   EXIT=0  11 547 B   2 ms
 *     -i input.webm -map 0:a:0 -vn -c:a copy o.opus   EXIT=0  30 052 B   4 ms
 *     -i input.mkv  -map 0:a:0 -vn -b:a 192k o.mp3    EXIT=0  51 453 B  37 ms
 *
 *   and the two copies played back in-page through `decodeAudioData`:
 *   o.m4a  -> 2.09 s / 2 ch / peak 0.406   (identical to the re-encoded WAV)
 *   o.opus -> 1.86 s / 2 ch / peak 0.3127
 *
 * BUT "IT COPIED" IS A FACT ABOUT A RUN, NOT A PREDICTION
 *   `ExtractAudioResult.streamCopied` is set from what FFmpeg actually did:
 *   the copy was attempted AND it exited 0 AND it produced the bytes we
 *   returned. Whenever the copy is not possible or not attempted the field is
 *   false and a `warning` says what happened instead. No page may print
 *   "nothing was re-encoded" off anything but that flag.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID: FFmpeg WILL WRITE A LIE
 *   `-c:a copy` into a container that cannot hold the codec does not always
 *   fail. Measured, clean core, 2026-09-04:
 *     -i input.mp4 -map 0:a:0 -vn -c:a copy lie.wav   EXIT=0, 10 486 B
 *   That file is an AAC bitstream inside a RIFF/WAVE header. Chromium's
 *   `decodeAudioData` ACCEPTS it and reports a duration of 0.139 s — from a
 *   2.09 s source. Exit code 0, a plausible size, a "successful" decode, and
 *   the audio is gone. So the copy target is never taken from the user's
 *   requested extension: it is looked up from the probed codec in the table
 *   below, every entry of which was measured, and WAV output NEVER copies.
 */

/** What the caller wants out. */
export type ExtractAudioFormat = "mp3" | "wav" | "original";

export interface ExtractAudioOptions {
  format: ExtractAudioFormat;
  /** kbps. `"mp3"` only — the other arms ignore it. */
  bitrate?: number;
}

export interface ExtractAudioResult extends ProcessedResult {
  /**
   * True ONLY when this run executed `-c:a copy` and that exec returned 0, so
   * the bytes below are the source's own audio bitstream. False for every
   * re-encode, including a re-encode the `"original"` arm fell back to.
   */
  streamCopied: boolean;
  /**
   * ffprobe's `codec_name` for the track that was taken, or null when the
   * probe could not read the file (in which case the extraction still runs —
   * the probe is advisory, see `extractAudio`).
   */
  sourceCodec: string | null;
}

interface CopyTarget {
  /** Extension, without the dot. */
  ext: string;
  mime: string;
}

/**
 * Codec -> the container measured to carry that codec byte-for-byte.
 *
 * Every row was run against the shipped core on 2026-09-04 and exited 0:
 *
 *   aac        -> .m4a    11 549 B   (from sample-video.mp4; muxer resolves to `ipod`)
 *   mp3        -> .mp3    34 419 B
 *   opus       -> .opus   30 052 B   (from sample-video.webm)
 *   vorbis     -> .ogg    11 370 B
 *   flac       -> .flac  224 631 B
 *   alac       -> .m4a   294 599 B
 *   ac3        -> .ac3    50 154 B
 *   pcm_s16le  -> .wav   368 718 B   (header rewritten from `sowt` to 0x0001)
 *   wmav1/2    -> .wma    39 094 B   (wmav2 measured; wmav1 shares the ASF muxer)
 *
 * Nothing else belongs here without its own measurement. A codec that is
 * missing costs one re-encode; a codec that is here wrongly costs the user a
 * file that looks fine and is not (see the header).
 */
export const COPY_CONTAINERS: Record<string, CopyTarget> = {
  aac: { ext: "m4a", mime: "audio/mp4" },
  alac: { ext: "m4a", mime: "audio/mp4" },
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  opus: { ext: "opus", mime: "audio/ogg" },
  vorbis: { ext: "ogg", mime: "audio/ogg" },
  flac: { ext: "flac", mime: "audio/flac" },
  ac3: { ext: "ac3", mime: "audio/ac3" },
  pcm_s16le: { ext: "wav", mime: "audio/wav" },
  wmav1: { ext: "wma", mime: "audio/x-ms-wma" },
  wmav2: { ext: "wma", mime: "audio/x-ms-wma" },
};

/** The container that can hold `codec` as-is, or null when none was measured. */
export function copyContainerFor(codec: string | null): CopyTarget | null {
  if (!codec) return null;
  return COPY_CONTAINERS[codec.toLowerCase()] ?? null;
}

/** Where the re-encode arms land. WAV is `pcm_s16le`, never a copy. */
const REENCODE_TARGETS = {
  mp3: { ext: "mp3", mime: "audio/mpeg" },
  wav: { ext: "wav", mime: "audio/wav" },
} as const;

function baseNameOf(file: File): string {
  return file.name.replace(/\.[^.]+$/, "");
}

function noAudioError(file: File): Error {
  return new Error(
    `${file.name || "That file"} has no audio track, so there is nothing to extract. (The picture is there — it is the sound that is missing.)`,
  );
}

function extractionFailedError(file: File): Error {
  return new Error(
    `Could not extract the audio from ${file.name || "this file"}. It may be damaged, or its audio may use a codec this build cannot decode.`,
  );
}

/**
 * Pull the audio track out of a media file.
 *
 * `format: "original"` asks for the source's own bitstream. When the probed
 * codec has a container measured to hold it, that is exactly what comes back
 * and `streamCopied` is true. When it does not — or when the copy is attempted
 * and FFmpeg refuses it — the audio is re-encoded to MP3 instead,
 * `streamCopied` stays false, and a warning says which of those happened. The
 * caller is never handed a silent substitution.
 */
export async function extractAudio(
  file: File,
  options: ExtractAudioOptions,
  ctx: ProcessingContext = {},
): Promise<ExtractAudioResult> {
  // No input-size cap for this shape: the source is mounted rather than
  // copied, and the audio track is a fraction of it. Verified end to end at
  // 2500 MB. See the derivation at the top of ffmpeg-loader.ts.
  validateFFmpegInput(file, "audio-extract");

  const bitrate = options.bitrate ?? DEFAULT_MP3_BITRATE;

  /*
    The probe is ADVISORY, and that is deliberate. It buys two things — the
    honest "no audio track" refusal below, and the codec that decides whether a
    copy is possible — but a file ffprobe cannot read is not necessarily a file
    ffmpeg cannot demux, and this used to be a tool that just tried. So a
    failed probe drops us back to exactly the old behaviour: run the extract
    and let its exit code speak. Only an abort propagates, because that is the
    user's own decision.

    Progress is not forwarded: ffprobe reports none, and the extraction that
    follows owns the bar.
  */
  let sourceCodec: string | null = null;
  let probed = false;
  try {
    const probe = await probeMedia(file, { signal: ctx.signal });
    probed = true;
    sourceCodec = probe.audio?.codec ?? null;
  } catch (err) {
    if (isAbortError(err)) throw err;
  }

  // Only a probe that SUCCEEDED and found no audio stream is proof of absence.
  if (probed && sourceCodec === null) throw noAudioError(file);

  const copyTarget = options.format === "original" ? copyContainerFor(sourceCodec) : null;
  const fallbackTarget =
    options.format === "wav" ? REENCODE_TARGETS.wav : REENCODE_TARGETS.mp3;

  const warnings: string[] = [];
  if (options.format === "original" && !copyTarget) {
    warnings.push(
      sourceCodec
        ? `This file's audio is ${sourceCodec.toUpperCase()}, which none of the containers this tool writes can hold as-is, so it was re-encoded to MP3 at ${bitrate} kbps.`
        : `The audio codec in this file could not be read, so it was re-encoded to MP3 at ${bitrate} kbps rather than copied.`,
    );
  }

  const inputName = "input" + inputExtensionFor(file);

  const run = await runFFmpegTask(async (ffmpeg) => {
    // Mounted, not written: the source never becomes an ArrayBuffer on either
    // thread, so a 2 GB video costs no more memory here than a 20 MB one.
    const inputPath = await mountInputFile(ffmpeg, file, inputName);
    const written: string[] = [];

    const exec = async (outputName: string, args: string[]): Promise<number> => {
      assertSafeFFmpegAudioArgs(args);
      // Recorded BEFORE the run: a failed exec can still have created the file,
      // and leaving it behind would let the next job read a stale output.
      written.push(outputName);
      return ffmpeg.exec(args);
    };

    try {
      if (copyTarget) {
        // A name of its own, so a failed copy's leftovers can never be read as
        // the re-encode's answer (they share an extension when the source is
        // already MP3).
        const outputName = `copied.${copyTarget.ext}`;
        // `-map 0:a:0` and not FFmpeg's default stream selection: the default
        // picks the "best" audio stream, which need not be the first, and
        // `sourceCodec` — which chose this container — describes the first.
        // Taking a different track than the one we probed is how a copy ends
        // up in a container that cannot hold it.
        const ret = await exec(outputName, [
          "-i", inputPath,
          "-map", "0:a:0",
          "-vn",
          "-c:a", "copy",
          outputName,
        ]);

        if (ret === 0) {
          const data = await ffmpeg.readFile(outputName);
          return {
            blob: new Blob([data as BlobPart], { type: copyTarget.mime }),
            ext: copyTarget.ext,
            streamCopied: true,
            warning: null as string | null,
          };
        }

        // FFmpeg refused the copy. Fall through to the re-encode rather than
        // failing the job, and say so — the user asked for their audio, not
        // for a lecture about muxers.
        warnings.push(
          `This file's ${(sourceCodec ?? "audio").toUpperCase()} track could not be copied out unchanged, so it was re-encoded to MP3 at ${bitrate} kbps.`,
        );
      }

      const outputName = `output.${fallbackTarget.ext}`;
      // -vn skips video decoding entirely = much faster. WAV is an explicit
      // pcm_s16le re-encode and never a copy (see the header).
      const args =
        fallbackTarget.ext === "wav"
          ? ["-i", inputPath, "-map", "0:a:0", "-vn", "-c:a", "pcm_s16le", outputName]
          : ["-i", inputPath, "-map", "0:a:0", "-vn", "-b:a", `${bitrate}k`, outputName];

      const ret = await exec(outputName, args);
      if (ret !== 0) throw extractionFailedError(file);

      const data = await ffmpeg.readFile(outputName);
      return {
        blob: new Blob([data as BlobPart], { type: fallbackTarget.mime }),
        ext: fallbackTarget.ext,
        streamCopied: false,
        warning: null as string | null,
      };
    } finally {
      // Both have to run even when exec threw, or the source stays pinned and
      // the next job cannot mount over it.
      await unmountInputFile(ffmpeg);
      for (const name of written) {
        await ffmpeg.deleteFile(name).catch(() => {
          /* never written */
        });
      }
    }
  }, ctx);

  return {
    blob: run.blob,
    fileName: `${baseNameOf(file)}.${run.ext}`,
    originalSize: file.size,
    newSize: run.blob.size,
    ...(warnings.length > 0 ? { warnings } : {}),
    streamCopied: run.streamCopied,
    sourceCodec,
  };
}
