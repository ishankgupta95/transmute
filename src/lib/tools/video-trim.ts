import { getFFmpeg, fileToUint8Array, validateVideoFileSize } from "./ffmpeg-loader";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

export interface VideoTrimOptions {
  startTime: number;
  endTime: number;
}

export async function trimVideo(
  file: File,
  options: VideoTrimOptions,
  onProgress?: (progress: number) => void,
): Promise<ProcessedResult> {
  validateVideoFileSize(file);
  const ffmpeg = await getFFmpeg(onProgress);

  const ext = file.name.substring(file.name.lastIndexOf("."));
  const inputName = "input" + ext;
  const outputName = "output" + ext;

  await ffmpeg.writeFile(inputName, await fileToUint8Array(file));

  const duration = options.endTime - options.startTime;
  const ret = await ffmpeg.exec([
    "-i", inputName,
    "-ss", String(options.startTime),
    "-t", String(duration),
    "-c", "copy",
    outputName,
  ]);

  if (ret !== 0) throw new Error("FFmpeg trimming failed");

  const data = await ffmpeg.readFile(outputName);
  const blob = new Blob([data as BlobPart], { type: file.type || "video/mp4" });

  await ffmpeg.deleteFile(inputName);
  await ffmpeg.deleteFile(outputName);

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return {
    blob,
    fileName: `${baseName}-trimmed${ext}`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
