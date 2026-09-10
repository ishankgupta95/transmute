import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";
import {
  AUDIO_FORMAT_SPECS,
  DEFAULT_MP3_BITRATE,
  OPUS_SAFE_COMPRESSION_LEVEL,
  assertSafeFFmpegAudioArgs,
  audioOutputExtension,
  isLosslessAudioFormat,
  type AudioFormatSpec,
  type AudioOutputFormat,
  type WorkerAudioFormat,
} from "./audio-format";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * One entry point for "turn this audio file into that format"
 * ───────────────────────────────────────────────────────────────────────────
 * Before this file there were two: `convertToMp3` in audio-encode-mp3.ts and
 * `convertToWav` in audio-encode-wav.ts, whose bodies were the same eight
 * lines with one word different, and the format union `"wav" | "mp3"` was
 * re-declared as a literal in three unrelated places. Adding FLAC — which the
 * audio worker pool cannot encode at all — would have made that a third copy.
 * The union now has a name and a home (`WorkerAudioFormat` in
 * `audio-format.ts`); `audio-trim.ts` and `audio-merge.ts` still spell theirs
 * out inline and can adopt it whenever they are next touched.
 *
 * TWO ENGINES, AND WHY THE SPLIT FALLS WHERE IT DOES
 *   - `mp3` / `wav` go through Web Audio: `decodeAudioFile` on the main thread
 *     (AudioContext does not exist in a worker), then the sample-crunching
 *     encode in the audio pool. That path already handles every container the
 *     browser can decode, plus the FFmpeg decode fallback for the ones it
 *     cannot, and it keeps a 31 MB engine out of the common case.
 *   - `flac` goes through FFmpeg, because the pool has exactly two encoders
 *     (lamejs MP3 and a hand-rolled WAV writer) and adding a third would mean
 *     a new pool worker. Three separate mechanisms make that expensive here —
 *     the `build-workers.mjs` entrypoint list, the non-analyzable `vendorUrl`
 *     specifier that keeps lamejs out of the worker bundle (audio-pcm.ts), and
 *     the worker's "import ONLY audio-pcm.ts" rule — and FFmpeg already runs
 *     in its own worker, so the FLAC encoder we need is a dynamic import away.
 *
 * THE FFmpeg ARM IS FILE→FILE, NOT DECODE-THEN-ENCODE
 *   It hands FFmpeg the source and takes the FLAC back. Routing it through
 *   `decodeAudioFile` first would decode twice and, worse, would launder the
 *   samples through the device sample rate — turning a "lossless" conversion
 *   into a resample. Measured against the shipped core, headless Chromium,
 *   2026-09-04 (`sample-audio.wav`, 352 844 B):
 *     -i a.wav -map 0:a:0 -vn -c:a flac cv.flac   EXIT=0   72 656 B   15 ms
 *     -i a.mp3 …                                   EXIT=0  235 330 B    9 ms
 *     -i a.wma …                                   EXIT=0  216 046 B    7 ms
 *   and the 72 656-byte FLAC decoded back in-page to 2.0 s / 2 ch / peak
 *   0.3662, against 0.406 for the source WAV read through the same path.
 *
 * SIZE: THE OUTPUT IS THE CEILING, AND IT CAN BE BIGGER THAN THE INPUT
 *   `validateFFmpegInput` is deliberately NOT called here. It caps only the
 *   `stream-copy` shape, so calling it for this shape would be theatre. The
 *   real ceiling is MEMFS: one output file has to fit in a single JS array
 *   (`MEMFS_MAX_FILE_BYTES`, ~1795 MB — see the derivation in
 *   ffmpeg-loader.ts). For FLAC that is a duration limit, not an input-size
 *   limit, and it is generous: a 32 600-byte MP3 came back as a 235 330-byte
 *   FLAC above, a 7.2x expansion, which still puts the ceiling several hours
 *   out. A run that does reach it fails through `describeFFmpegFailure`, which
 *   says so in those words.
 *
 * WHAT NO ARM PRESERVES: tags and cover art. Web Audio decoding throws
 * metadata away by definition, and the FFmpeg arm passes `-vn`, which drops an
 * attached picture along with any real video stream. Nothing here may claim
 * otherwise.
 */

/**
 * The format facts and the FFmpeg argv guard live in `audio-format.ts`, which
 * imports nothing at all. They are re-exported here because this module is the
 * one every converter page reaches for, and because `extract-audio.ts` must be
 * able to have them WITHOUT having this file — see that leaf's header for what
 * a static edge between the two costs.
 */
export {
  AUDIO_FORMAT_SPECS,
  DEFAULT_MP3_BITRATE,
  OPUS_SAFE_COMPRESSION_LEVEL,
  assertSafeFFmpegAudioArgs,
  audioOutputExtension,
  isLosslessAudioFormat,
};
export type { AudioOutputFormat, WorkerAudioFormat, AudioFormatSpec };

export interface AudioConvertOptions {
  format: AudioOutputFormat;
  /** kbps. MP3 only — the other formats ignore it. */
  bitrate?: number;
}

/** `"song.flac"` -> `"song"`. Shared so every arm names its output the same. */
function baseNameOf(file: File): string {
  return file.name.replace(/\.[^.]+$/, "");
}

/**
 * The virtual filename FFmpeg reads, carrying the extension it uses as a
 * demuxer hint.
 *
 * `.dat` for a dot-less name, NOT the `.mp4` that video-probe.ts's
 * `inputExtensionFor` falls back to: the sources here are audio files, and
 * telling FFmpeg an untitled Ogg is an MP4 is a worse guess than telling it
 * nothing. (The hint is only ever a hint — FFmpeg still probes the bytes.)
 */
function ffmpegInputName(file: File): string {
  return "input" + (/\.[^./]+$/.exec(file.name)?.[0] ?? ".dat");
}

async function convertViaFFmpeg(
  file: File,
  format: AudioOutputFormat,
  ctx: ProcessingContext,
): Promise<Blob> {
  const spec = AUDIO_FORMAT_SPECS[format];
  const { runFFmpegTask, mountInputFile, unmountInputFile } = await import("./ffmpeg-loader");

  const inputName = ffmpegInputName(file);
  const outputName = `output.${spec.ext}`;

  return runFFmpegTask(async (ffmpeg) => {
    // Mounted, not written: WORKERFS reads slices out of the File itself, so a
    // 700 MB WAV never becomes an ArrayBuffer on either thread.
    const inputPath = await mountInputFile(ffmpeg, file, inputName);

    try {
      // `-map 0:a:0` and not FFmpeg's default stream selection: the default
      // picks the "best" audio stream, which is not necessarily the first, and
      // every honest statement this cluster makes about the source is about
      // the FIRST audio stream. `-vn` drops video, which for an audio file
      // means an embedded cover image.
      const args = [
        "-i", inputPath,
        "-map", "0:a:0",
        "-vn",
        "-c:a", spec.codec ?? format,
        outputName,
      ];
      assertSafeFFmpegAudioArgs(args);

      const ret = await ffmpeg.exec(args);
      if (ret !== 0) {
        throw new Error(
          `Could not convert ${file.name || "this file"} to ${spec.ext.toUpperCase()}. It may be damaged, or it may hold no audio at all.`,
        );
      }

      const data = await ffmpeg.readFile(outputName);
      return new Blob([data as BlobPart], { type: spec.mime });
    } finally {
      // Both have to run even when exec threw, or the source stays pinned and
      // the next job cannot mount over it.
      await unmountInputFile(ffmpeg);
      await ffmpeg.deleteFile(outputName).catch(() => {
        /* never written */
      });
    }
  }, ctx);
}

async function convertViaWebAudio(
  file: File,
  format: WorkerAudioFormat,
  bitrate: number,
  ctx: ProcessingContext,
): Promise<Blob> {
  const { decodeAudioFile } = await import("./audio-decode");

  if (format === "wav") {
    const audioBuffer = await decodeAudioFile(file, ctx);
    const { encodeWav } = await import("@/lib/workers/audio-client");
    return encodeWav(audioBuffer, ctx);
  }

  // MP3 cannot carry rates above 48 kHz and decoding preserves the source
  // rate, so a 96 kHz master has to come down before it reaches lamejs.
  const { resampleForMp3 } = await import("./audio-encode-mp3");
  const audioBuffer = await resampleForMp3(await decodeAudioFile(file, ctx));
  const { encodeMp3 } = await import("@/lib/workers/audio-client");
  return encodeMp3(audioBuffer, bitrate, ctx);
}

/**
 * Convert one audio file to `options.format`.
 *
 * Every arm DECODES AND RE-ENCODES — there is no passthrough here, and no page
 * built on this may imply one. Lossy input re-encoded to a lossy output is
 * generational loss whatever the bitrate; lossy input written to WAV or FLAC is
 * a lossless copy of an already-lossy decode, which is a bigger file and not a
 * better one. (The one genuinely lossless path in this cluster is
 * `extract-audio`'s stream copy, and it reports whether it actually happened.)
 */
export async function convertAudio(
  file: File,
  options: AudioConvertOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  const spec = AUDIO_FORMAT_SPECS[options.format];
  if (!spec) throw new Error(`Unsupported audio output format: ${String(options.format)}`);

  const blob =
    spec.engine === "ffmpeg"
      ? await convertViaFFmpeg(file, options.format, ctx)
      : await convertViaWebAudio(
          file,
          options.format as WorkerAudioFormat,
          options.bitrate ?? DEFAULT_MP3_BITRATE,
          ctx,
        );

  return {
    blob,
    fileName: `${baseNameOf(file)}.${spec.ext}`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
