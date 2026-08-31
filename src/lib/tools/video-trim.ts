import {
  runFFmpegTask,
  validateFFmpegInput,
  mountInputFile,
  unmountInputFile,
} from "./ffmpeg-loader";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

export interface VideoTrimOptions {
  startTime: number;
  endTime: number;
}

export async function trimVideo(
  file: File,
  options: VideoTrimOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  // A stream copy writes an output the size of the selection, and a
  // full-length selection is the size of the source, so the cap here is what
  // MEMFS can hold — 1.5 GB. See the derivation at the top of ffmpeg-loader.ts.
  validateFFmpegInput(file, "stream-copy");
  // A zero-length range makes FFmpeg mux a header-only 591-byte file that
  // plays nothing, and the tool used to present it as a finished trim.
  if (!(options.endTime - options.startTime > 0)) {
    throw new Error("Select a clip longer than zero seconds.");
  }

  // Not `substring(lastIndexOf("."))`: with no dot that returns -1, which
  // substring clamps to 0, so an extension-less "myclip" produced
  // "outputmyclip" — a name FFmpeg cannot pick a muxer for.
  const ext = /\.[^./]+$/.exec(file.name)?.[0] ?? (file.type === "video/webm" ? ".webm" : ".mp4");
  const inputName = "input" + ext;
  const outputName = "output" + ext;

  const blob = await runFFmpegTask(async (ffmpeg) => {
    // Mounted, not written: the source is read in slices straight off disk, so
    // only the trimmed OUTPUT occupies the heap. That halves what this job has
    // to hold, and is what the 1.5 GB cap is derived against.
    const inputPath = await mountInputFile(ffmpeg, file, inputName);

    try {
      const duration = options.endTime - options.startTime;
      // -ss BEFORE -i does a fast, keyframe-accurate seek and avoids the frozen/black
      // leading frames the old "-ss after -i with -c copy" produced. Stream copy keeps
      // it fast (no full re-encode in the single-threaded wasm build); the start snaps
      // to the nearest preceding keyframe.
      const ret = await ffmpeg.exec([
        "-ss", String(options.startTime),
        "-i", inputPath,
        "-t", String(duration),
        "-c", "copy",
        "-avoid_negative_ts", "make_zero",
        outputName,
      ]);

      if (ret !== 0) throw new Error("FFmpeg trimming failed");

      const data = await ffmpeg.readFile(outputName);
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

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return {
    blob,
    fileName: `${baseName}-trimmed${ext}`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
