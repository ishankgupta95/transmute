import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { createVideo, waitForReady, playAndExtractFrames } from "./video-utils";

export interface VideoToGifOptions {
  startTime: number;
  endTime: number;
  fps: number;
  width: number;
}

/**
 * Convert a video clip to an animated GIF using the browser's native
 * <video> element for HW-accelerated decoding + gifenc for encoding.
 */
export async function videoToGif(
  file: File,
  options: VideoToGifOptions,
  onProgress?: (progress: number) => void,
): Promise<ProcessedResult> {
  const { startTime, endTime, fps, width } = options;
  const frameInterval = 1 / fps;

  const videoUrl = URL.createObjectURL(file);
  const video = createVideo(videoUrl);
  await waitForReady(video);

  const scale = width / video.videoWidth;
  const height = Math.round(video.videoHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

  const gif = GIFEncoder();
  const delayMs = Math.round(1000 / fps);

  let lastCapturedTime = -Infinity;
  let isFirst = true;

  await playAndExtractFrames(
    video,
    startTime,
    endTime,
    async (vid, _timestampUs) => {
      // Only capture frames at the requested FPS interval
      const currentTime = vid.currentTime;
      if (currentTime - lastCapturedTime < frameInterval * 0.8) return;
      lastCapturedTime = currentTime;

      ctx.drawImage(vid, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);

      const palette = quantize(imageData.data, 256, { format: "rgb444" });
      const index = applyPalette(imageData.data, palette, "rgb444");

      gif.writeFrame(index, width, height, {
        palette,
        delay: delayMs,
        dispose: 2,
        ...(isFirst ? { first: true, repeat: 0 } : {}),
      });
      isFirst = false;
    },
    onProgress,
  );

  gif.finish();
  URL.revokeObjectURL(videoUrl);

  const blob = new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}.gif`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
