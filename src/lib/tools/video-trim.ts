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
  // -ss BEFORE -i does a fast, keyframe-accurate seek and avoids the frozen/black
  // leading frames the old "-ss after -i with -c copy" produced. Stream copy keeps
  // it fast (no full re-encode in the single-threaded wasm build); the start snaps
  // to the nearest preceding keyframe.
  const ret = await ffmpeg.exec([
    "-ss", String(options.startTime),
    "-i", inputName,
    "-t", String(duration),
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
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
