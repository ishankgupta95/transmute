import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { createVideo, waitForReady, detectAudio, playAndExtractFrames } from "./video-utils";

export type CompressionPreset = "whatsapp" | "email" | "web";

interface PresetConfig {
  maxHeight: number;
  bitrate: number;
  audioBitrate: number;
}

const PRESET_CONFIG: Record<CompressionPreset, PresetConfig> = {
  whatsapp: { maxHeight: 720, bitrate: 1_000_000, audioBitrate: 96_000 },
  email: { maxHeight: 480, bitrate: 500_000, audioBitrate: 64_000 },
  web: { maxHeight: 1080, bitrate: 2_000_000, audioBitrate: 128_000 },
};

/**
 * Compress a video using WebCodecs (HW-accelerated H.264) + mp4-muxer.
 */
export async function compressVideo(
  file: File,
  preset: CompressionPreset,
  onProgress?: (progress: number) => void,
): Promise<ProcessedResult> {
  const config = PRESET_CONFIG[preset];
  const videoUrl = URL.createObjectURL(file);

  try {
    const video = createVideo(videoUrl);
    await waitForReady(video);

    const { videoWidth, videoHeight, duration } = video;
    const hasAudio = await detectAudio(file);

    let outWidth = videoWidth;
    let outHeight = videoHeight;
    if (videoHeight > config.maxHeight) {
      const scale = config.maxHeight / videoHeight;
      outWidth = Math.round(videoWidth * scale);
      outHeight = config.maxHeight;
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
      bitrate: config.bitrate,
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
      await encodeAudio(file, muxer, config.audioBitrate);
      onProgress?.(95);
    }

    muxer.finalize();
    onProgress?.(100);

    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const baseName = file.name.replace(/\.[^.]+$/, "");

    return {
      blob,
      fileName: `${baseName}-compressed.mp4`,
      originalSize: file.size,
      newSize: blob.size,
    };
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}

async function encodeAudio(
  file: File,
  muxer: Muxer<ArrayBufferTarget>,
  bitrate: number,
): Promise<void> {
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
    bitrate,
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
