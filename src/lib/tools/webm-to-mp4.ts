import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { createVideo, waitForReady, detectAudio, playAndExtractFrames } from "./video-utils";

/**
 * Convert WebM to MP4 using WebCodecs (HW-accelerated) + mp4-muxer.
 * Plays the video and captures each decoded frame via requestVideoFrameCallback,
 * re-encodes to H.264 using the GPU, and muxes into an MP4 container.
 */
export async function webmToMp4(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<ProcessedResult> {
  const videoUrl = URL.createObjectURL(file);

  try {
    const video = createVideo(videoUrl);
    await waitForReady(video);

    const { videoWidth, videoHeight, duration } = video;
    const hasAudio = await detectAudio(file);

    // Cap to 1920px on the long side; ensure even dims for H.264
    let outWidth = videoWidth;
    let outHeight = videoHeight;
    const MAX_DIM = 1920;
    if (outWidth > MAX_DIM || outHeight > MAX_DIM) {
      const scale = MAX_DIM / Math.max(outWidth, outHeight);
      outWidth = Math.round(outWidth * scale);
      outHeight = Math.round(outHeight * scale);
    }
    outWidth += outWidth % 2;
    outHeight += outHeight % 2;

    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: "avc", width: outWidth, height: outHeight },
      ...(hasAudio ? { audio: { codec: "aac", numberOfChannels: 2, sampleRate: 48000 } } : {}),
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });

    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => { muxer.addVideoChunk(chunk, meta); },
      error: (e) => { throw e; },
    });

    videoEncoder.configure({
      codec: "avc1.640034",
      width: outWidth,
      height: outHeight,
      bitrate: 5_000_000,
      framerate: 30,
      hardwareAcceleration: "prefer-hardware",
    });

    const needsScale = outWidth !== videoWidth || outHeight !== videoHeight;
    let canvas: HTMLCanvasElement | null = null;
    let ctx: CanvasRenderingContext2D | null = null;
    if (needsScale) {
      canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = outHeight;
      ctx = canvas.getContext("2d")!;
    }

    let frameCount = 0;
    await playAndExtractFrames(
      video,
      0,
      duration,
      async (vid, timestampUs) => {
        let frame: VideoFrame;
        if (needsScale && ctx && canvas) {
          ctx.drawImage(vid, 0, 0, outWidth, outHeight);
          frame = new VideoFrame(canvas, { timestamp: timestampUs });
        } else {
          frame = new VideoFrame(vid, { timestamp: timestampUs });
        }

        const keyFrame = frameCount % 60 === 0;
        videoEncoder.encode(frame, { keyFrame });
        frame.close();
        frameCount++;

        // Backpressure: if encoder queue is deep, wait for it to drain
        if (videoEncoder.encodeQueueSize > 5) {
          await new Promise<void>((r) => {
            videoEncoder.ondequeue = () => { videoEncoder.ondequeue = null; r(); };
          });
        }
      },
      (pct) => onProgress?.(Math.round(pct * (hasAudio ? 0.8 : 1))),
    );

    await videoEncoder.flush();
    videoEncoder.close();

    if (hasAudio) {
      onProgress?.(85);
      await encodeAudio(file, muxer);
      onProgress?.(95);
    }

    muxer.finalize();
    onProgress?.(100);

    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const baseName = file.name.replace(/\.[^.]+$/, "");

    return {
      blob,
      fileName: `${baseName}.mp4`,
      originalSize: file.size,
      newSize: blob.size,
    };
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}

async function encodeAudio(file: File, muxer: Muxer<ArrayBufferTarget>): Promise<void> {
  const audioCtx = new AudioContext({ sampleRate: 48000 });
  const arrayBuffer = await file.arrayBuffer();

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  } catch {
    await audioCtx.close();
    return;
  }

  const numberOfChannels = Math.min(audioBuffer.numberOfChannels, 2);
  const sampleRate = audioBuffer.sampleRate;

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => { muxer.addAudioChunk(chunk, meta); },
    error: (e) => { throw e; },
  });

  audioEncoder.configure({
    codec: "mp4a.40.2",
    numberOfChannels,
    sampleRate,
    bitrate: 128_000,
  });

  const chunkSize = 1024;
  const totalSamples = audioBuffer.length;

  for (let offset = 0; offset < totalSamples; offset += chunkSize) {
    const remaining = Math.min(chunkSize, totalSamples - offset);
    const interleaved = new Float32Array(remaining * numberOfChannels);

    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < remaining; i++) {
        interleaved[i * numberOfChannels + ch] = channelData[offset + i];
      }
    }

    const audioData = new AudioData({
      format: "f32",
      sampleRate,
      numberOfFrames: remaining,
      numberOfChannels,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: interleaved,
    });

    audioEncoder.encode(audioData);
    audioData.close();
  }

  await audioEncoder.flush();
  audioEncoder.close();
  await audioCtx.close();
}
