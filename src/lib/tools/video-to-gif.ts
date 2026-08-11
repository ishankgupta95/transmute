import { GIFEncoder, quantize, applyPalette } from "gifenc";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";
import { throwIfAborted } from "@/lib/utils/abort";
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
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  const { onProgress, signal } = ctx;
  const { startTime, endTime, fps, width } = options;
  const frameInterval = 1 / fps;

  const videoUrl = URL.createObjectURL(file);

  try {
    throwIfAborted(signal);
    const video = createVideo(videoUrl);
    await waitForReady(video);

    const scale = width / video.videoWidth;
    const height = Math.round(video.videoHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const canvasCtx = canvas.getContext("2d", { willReadFrequently: true })!;

    const gif = GIFEncoder();
    const delayMs = Math.round(1000 / fps);

    let lastCapturedTime = -Infinity;
    let isFirst = true;

    await playAndExtractFrames(
      video,
      startTime,
      endTime,
      async (vid, _timestampUs) => {
        throwIfAborted(signal);
        // Only capture frames at the requested FPS interval
        const currentTime = vid.currentTime;
        if (currentTime - lastCapturedTime < frameInterval * 0.8) return;
        // Stamp each frame with the REAL gap since the previous capture.
        // rVFC delivers on display refresh, so captures land at ≥0.8× the
        // target interval — a constant delay made such GIFs play ~20% long.
        const gapMs = isFirst
          ? delayMs
          : Math.max(20, Math.round((currentTime - lastCapturedTime) * 1000));
        lastCapturedTime = currentTime;

        canvasCtx.drawImage(vid, 0, 0, width, height);
        const imageData = canvasCtx.getImageData(0, 0, width, height);

        const palette = quantize(imageData.data, 256, { format: "rgb444" });
        const index = applyPalette(imageData.data, palette, "rgb444");

        gif.writeFrame(index, width, height, {
          palette,
          delay: gapMs,
          dispose: 2,
          ...(isFirst ? { first: true, repeat: 0 } : {}),
        });
        isFirst = false;
      },
      { signal, onProgress },
    );

    gif.finish();

    const blob = new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
    const baseName = file.name.replace(/\.[^.]+$/, "");

    return {
      blob,
      fileName: `${baseName}.gif`,
      originalSize: file.size,
      newSize: blob.size,
    };
  } finally {
    // Previously only revoked on the success path, so every failed or
    // cancelled run leaked the source blob for the life of the tab.
    URL.revokeObjectURL(videoUrl);
  }
}
