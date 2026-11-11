import {
  runFFmpegTask,
  validateFFmpegInput,
  mountInputFile,
  unmountInputFile,
} from "./ffmpeg-loader";
import { probeSecondsInPlace } from "./video-split";
import { dropTinyLeadingEmptyEdits, isIsoBmffExtension } from "./mp4-edit-list";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

export interface VideoTrimOptions {
  startTime: number;
  endTime: number;
  /**
   * Re-encode so the clip starts on the exact frame asked for. Off by
   * default: the copy is lossless and near-instant, and for most cuts it lands
   * close enough. See `TrimOutcome` for how the copy reports when it did not.
   */
  exact?: boolean;
}

/**
 * What the finished file actually is, read back off it — not what was asked.
 *
 * WHY THIS EXISTS. A stream copy (`-c copy`) cannot start between keyframes:
 * FFmpeg backs the start up to the keyframe before it, and with
 * `-avoid_negative_ts make_zero` that lead-in plays as part of the clip.
 * Measured 2026-11-11 on the 2.09 s fixture (keyframes at 0 and 1.0 s): asked
 * for 0.5–1.5 s, the copy came out 1.51 s long and began at 0.00 s, while the
 * page said "CLIP 0:01.0". The old tests passed that file — its duration was
 * "between 0.3 and 1.7 s" — and the content check in
 * `e2e/conversion/video.spec.ts` is what caught it.
 *
 * Dropping `make_zero` is NOT the fix, also measured: MP4 then carries an edit
 * list that Chromium honours exactly, but WebKit shows a dark first frame
 * before it, and WebM has no edit list at all (still 1.55 s from 0). So the
 * copy stays as it was and says what it did, and `exact` is the way to get
 * the frame that was asked for.
 */
export interface TrimOutcome {
  mode: "copy" | "exact";
  requestedStart: number;
  requestedEnd: number;
  /** Where the clip really begins in the source, or null if unmeasurable. */
  actualStart: number | null;
  /** The produced file's own duration, or null if unmeasurable. */
  actualSeconds: number | null;
  /** TRUE when the copy began noticeably before the requested start. */
  startedEarly: boolean;
}

export interface VideoTrimResult extends ProcessedResult {
  trim: TrimOutcome;
}

/**
 * How far before the requested start a copy may begin and still count as
 * "where you asked". One frame at 24 fps is 42 ms; container timestamp
 * rounding is a few ms. Anything past this is a keyframe snap the user can see.
 */
export const START_TOLERANCE_SECONDS = 0.05;

export async function trimVideo(
  file: File,
  options: VideoTrimOptions,
  ctx: ProcessingContext = {},
): Promise<VideoTrimResult> {
  // A zero-length range makes FFmpeg mux a header-only 591-byte file that
  // plays nothing, and the tool used to present it as a finished trim.
  if (!(options.endTime - options.startTime > 0)) {
    throw new Error("Select a clip longer than zero seconds.");
  }
  const baseName = file.name.replace(/\.[^.]+$/, "");

  if (options.exact) {
    // WebCodecs, not FFmpeg: an FFmpeg re-encode here would select libx264,
    // and every libx264 argv deepens the GPL entanglement the LGPL-core plan
    // exists to remove (see `ffmpeg-argv-inventory.test.ts`). `compressVideo`
    // already ships the H.264/AAC encode, and decodes from the seek point, so
    // the first frame written is the one at `startTime`.
    const { compressVideo } = await import("./video-compress");
    const encoded = await compressVideo(file, "web", ctx, {
      range: { start: options.startTime, end: options.endTime },
      matchSource: true,
    });
    return {
      blob: encoded.blob,
      fileName: `${baseName}-trimmed.mp4`,
      originalSize: file.size,
      newSize: encoded.blob.size,
      trim: {
        mode: "exact",
        requestedStart: options.startTime,
        requestedEnd: options.endTime,
        actualStart: options.startTime,
        actualSeconds: options.endTime - options.startTime,
        startedEarly: false,
      },
    };
  }

  // A stream copy writes an output the size of the selection, and a
  // full-length selection is the size of the source, so the cap here is what
  // MEMFS can hold — 1.5 GB. See the derivation at the top of ffmpeg-loader.ts.
  validateFFmpegInput(file, "stream-copy");

  // Not `substring(lastIndexOf("."))`: with no dot that returns -1, which
  // substring clamps to 0, so an extension-less "myclip" produced
  // "outputmyclip" — a name FFmpeg cannot pick a muxer for.
  const ext = /\.[^./]+$/.exec(file.name)?.[0] ?? (file.type === "video/webm" ? ".webm" : ".mp4");
  const inputName = "input" + ext;
  const outputName = "output" + ext;

  let actualSeconds: number | null = null;
  const blob = await runFFmpegTask(async (ffmpeg) => {
    // Mounted, not written: the source is read in slices straight off disk, so
    // only the trimmed OUTPUT occupies the heap. That halves what this job has
    // to hold, and is what the 1.5 GB cap is derived against.
    const inputPath = await mountInputFile(ffmpeg, file, inputName);

    try {
      const duration = options.endTime - options.startTime;
      // -ss BEFORE -i does a fast seek and avoids the frozen/black leading
      // frames the old "-ss after -i with -c copy" produced. Stream copy keeps
      // it fast (no full re-encode in the single-threaded wasm build); the
      // start snaps to the keyframe before it — measured and reported below.
      const ret = await ffmpeg.exec([
        "-ss", String(options.startTime),
        "-i", inputPath,
        "-t", String(duration),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        outputName,
      ]);

      if (ret !== 0) throw new Error("FFmpeg trimming failed");

      // Read the clip's real length back off the file. The copy ends where it
      // was asked to, so whatever it holds beyond the selection is lead-in.
      actualSeconds = await probeSecondsInPlace(ffmpeg, outputName);

      const raw = (await ffmpeg.readFile(outputName)) as Uint8Array;
      // A cut whose audio starts a hair before its video keyframe gets a
      // ~1 ms empty edit, which Safari draws as a black first frame.
      const data = isIsoBmffExtension(ext) ? dropTinyLeadingEmptyEdits(raw).bytes : raw;
      return new Blob([data as BlobPart], { type: file.type || "video/mp4" });
    } finally {
      // Both have to run even when exec threw, or the source stays pinned and
      // the next job cannot mount over it.
      await unmountInputFile(ffmpeg);
      await ffmpeg.deleteFile(outputName).catch(() => {
        /* never written */
      });
    }
  }, ctx);

  const measured = actualSeconds as number | null;
  const actualStart =
    measured !== null && measured > 0 ? Math.max(0, options.endTime - measured) : null;
  return {
    blob,
    fileName: `${baseName}-trimmed${ext}`,
    originalSize: file.size,
    newSize: blob.size,
    trim: {
      mode: "copy",
      requestedStart: options.startTime,
      requestedEnd: options.endTime,
      actualStart,
      actualSeconds: measured,
      startedEarly:
        actualStart !== null && options.startTime - actualStart > START_TOLERANCE_SECONDS,
    },
  };
}
