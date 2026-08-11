import { runFFmpegTask, fileToUint8Array, validateVideoFileSize } from "./ffmpeg-loader";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

export interface Mp4ToMp3Options {
  bitrate: number;
}

export async function mp4ToMp3(
  file: File,
  options: Mp4ToMp3Options,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  validateVideoFileSize(file);

  const inputName = "input" + file.name.substring(file.name.lastIndexOf("."));
  const outputName = "output.mp3";

  const blob = await runFFmpegTask(async (ffmpeg) => {
    await ffmpeg.writeFile(inputName, await fileToUint8Array(file));

    // -vn skips video decoding entirely = much faster
    const ret = await ffmpeg.exec([
      "-i", inputName,
      "-vn",
      "-b:a", `${options.bitrate}k`,
      outputName,
    ]);

    if (ret !== 0) throw new Error("FFmpeg audio extraction failed");

    const data = await ffmpeg.readFile(outputName);
    const output = new Blob([data as BlobPart], { type: "audio/mpeg" });

    await ffmpeg.deleteFile(inputName);
    await ffmpeg.deleteFile(outputName);

    return output;
  }, ctx);

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return {
    blob,
    fileName: `${baseName}.mp3`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
