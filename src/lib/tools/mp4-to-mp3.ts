import {
  runFFmpegTask,
  validateFFmpegInput,
  mountInputFile,
  unmountInputFile,
} from "./ffmpeg-loader";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

export interface Mp4ToMp3Options {
  bitrate: number;
}

export async function mp4ToMp3(
  file: File,
  options: Mp4ToMp3Options,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  // No input-size cap for this shape: the source is mounted rather than
  // copied, and the MP3 is a fraction of it. Verified end to end at 2500 MB.
  // See the derivation at the top of ffmpeg-loader.ts.
  validateFFmpegInput(file, "audio-extract");

  // A dot-less name would otherwise make the whole filename the "extension"
  // (see video-trim.ts), leaving FFmpeg without a demuxer hint.
  const inputExt = /\.[^./]+$/.exec(file.name)?.[0] ?? (file.type === "video/webm" ? ".webm" : ".mp4");
  const inputName = "input" + inputExt;
  const outputName = "output.mp3";

  const blob = await runFFmpegTask(async (ffmpeg) => {
    // Mounted, not written: the source never becomes an ArrayBuffer on either
    // thread, so a 2 GB video costs no more memory here than a 20 MB one.
    const inputPath = await mountInputFile(ffmpeg, file, inputName);

    try {
      // -vn skips video decoding entirely = much faster
      const ret = await ffmpeg.exec([
        "-i", inputPath,
        "-vn",
        "-b:a", `${options.bitrate}k`,
        outputName,
      ]);

      if (ret !== 0) throw new Error("FFmpeg audio extraction failed");

      const data = await ffmpeg.readFile(outputName);
      return new Blob([data as BlobPart], { type: "audio/mpeg" });
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
    fileName: `${baseName}.mp3`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
