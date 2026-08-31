import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";
import { throwIfAborted } from "@/lib/utils/abort";
import {
  createVideo,
  waitForReady,
  decodeAudio,
  playAndExtractFrames,
  resolveDuration,
  assertWebCodecsSupported,
  pickH264Config,
} from "./video-utils";

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
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  const { onProgress, signal } = ctx;
  const config = PRESET_CONFIG[preset];
  const videoUrl = URL.createObjectURL(file);

  try {
    throwIfAborted(signal);
    assertWebCodecsSupported();
    const video = createVideo(videoUrl);
    await waitForReady(video);

    const { videoWidth, videoHeight } = video;
    // Not `video.duration`: a MediaRecorder WebM (every browser screen
    // recording, this site's own included) declares none, so the element
    // reports Infinity until the demuxer is forced to resolve it.
    const duration = await resolveDuration(video);
    if (!Number.isFinite(duration) || duration <= 0 || !videoWidth || !videoHeight) {
      throw new Error(
        "Couldn't read this video — its codec or container may not be supported in-browser. Try an MP4 (H.264).",
      );
    }
    /*
      The presets are fixed TARGET bitrates. Aimed at a clip that is already
      leaner than the target they inflate it — a 158 KB source came back at
      213 KB and was still presented as "compressed". Cap the target at 90% of
      what the source actually spends per second so the output cannot be a
      bigger file than the input, with a 200 kbps floor so a tiny clip is not
      re-encoded into mush.
    */
    const sourceBitrate = (file.size * 8) / duration;
    const targetBitrate = Math.min(
      config.bitrate,
      Math.max(200_000, Math.round(sourceBitrate * 0.9)),
    );

    // Decode the audio once up front so we can both detect it and reuse the
    // buffer (the old code decoded the whole file twice — easy to OOM).
    const audioBuffer = await decodeAudio(file);
    throwIfAborted(signal);
    const hasAudio = audioBuffer !== null;

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
      ...(audioBuffer
        ? {
            audio: {
              codec: "aac",
              numberOfChannels: Math.min(audioBuffer.numberOfChannels, 2),
              sampleRate: audioBuffer.sampleRate,
            },
          }
        : {}),
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });

    let encoderError: Error | null = null;
    // Wakes a parked backpressure waiter so a fatal encoder error can't leave
    // the frame loop awaiting an ondequeue that will never fire (the encoder is
    // "closed" after an error) — which would freeze the UI on "Compressing…".
    let wakeBackpressure: (() => void) | null = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => { muxer.addVideoChunk(chunk, meta); },
      // Capture rather than throw — a throw here fires async and becomes an
      // uncaught rejection, freezing the UI on "Compressing…" forever.
      error: (e) => {
        encoderError = e instanceof Error ? e : new Error(String(e));
        wakeBackpressure?.();
      },
    });

    // A cancel has to wake a parked waiter for the same reason a fatal encoder
    // error does: once we stop feeding frames, `ondequeue` never fires again.
    const onAbort = () => wakeBackpressure?.();
    signal?.addEventListener("abort", onAbort);

    try {
      videoEncoder.configure(
        await pickH264Config({
          width: outWidth,
          height: outHeight,
          bitrate: targetBitrate,
          framerate: 30,
        }),
      );

      const needsScale = outWidth !== videoWidth || outHeight !== videoHeight;
      let canvas: HTMLCanvasElement | null = null;
      let canvasCtx: CanvasRenderingContext2D | null = null;
      if (needsScale) {
        canvas = document.createElement("canvas");
        canvas.width = outWidth;
        canvas.height = outHeight;
        canvasCtx = canvas.getContext("2d")!;
      }

      let frameCount = 0;
      await playAndExtractFrames(
        video,
        0,
        duration,
        async (vid, timestampUs) => {
          throwIfAborted(signal);
          if (encoderError) throw encoderError;
          let frame: VideoFrame;
          if (needsScale && canvasCtx && canvas) {
            canvasCtx.drawImage(vid, 0, 0, outWidth, outHeight);
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
              wakeBackpressure = () => { videoEncoder.ondequeue = null; wakeBackpressure = null; r(); };
              videoEncoder.ondequeue = wakeBackpressure;
            });
            throwIfAborted(signal);
            if (encoderError) throw encoderError;
          }
        },
        { signal, onProgress: (pct) => onProgress?.(Math.round(pct * (hasAudio ? 0.8 : 1))) },
      );

      await videoEncoder.flush();
      if (encoderError) throw encoderError;

      if (audioBuffer) {
        onProgress?.(85);
        await encodeAudio(audioBuffer, muxer, config.audioBitrate, signal);
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
      signal?.removeEventListener("abort", onAbort);
      // Cancelling or failing mid-encode used to leak the encoder (and its
      // hardware session) until GC.
      if (videoEncoder.state !== "closed") videoEncoder.close();
    }
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}

async function encodeAudio(
  audioBuffer: AudioBuffer,
  muxer: Muxer<ArrayBufferTarget>,
  bitrate: number,
  signal?: AbortSignal,
): Promise<void> {
  const numberOfChannels = Math.min(audioBuffer.numberOfChannels, 2);
  const sampleRate = audioBuffer.sampleRate;

  let encoderError: Error | null = null;
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => { muxer.addAudioChunk(chunk, meta); },
    error: (e) => { encoderError = e instanceof Error ? e : new Error(String(e)); },
  });

  try {
    audioEncoder.configure({
      codec: "mp4a.40.2",
      numberOfChannels,
      sampleRate,
      bitrate,
    });

    const chunkSize = 1024;
    const totalSamples = audioBuffer.length;

    for (let offset = 0; offset < totalSamples; offset += chunkSize) {
      // A long track is thousands of iterations — check often enough that
      // cancelling feels immediate.
      throwIfAborted(signal);
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
    if (encoderError) throw encoderError;
  } finally {
    if (audioEncoder.state !== "closed") audioEncoder.close();
  }
}
