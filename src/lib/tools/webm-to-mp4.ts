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

const AUDIO_BITRATE = 128_000;

/**
 * Convert WebM to MP4 using WebCodecs (HW-accelerated) + mp4-muxer.
 * Plays the video and captures each decoded frame via requestVideoFrameCallback,
 * re-encodes to H.264 using the GPU, and muxes into an MP4 container.
 */
export async function webmToMp4(
  file: File,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  const { onProgress, signal } = ctx;
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
        "Couldn't read this video — its codec or container may not be supported in-browser. Try an MP4 or WebM.",
      );
    }
    const audioBuffer = await decodeAudio(file);
    throwIfAborted(signal);
    const hasAudio = audioBuffer !== null;

    /*
      Firefox ≥132 passes every coarse WebCodecs probe but ships no AAC
      encoder: configure() closes the codec and the next encode() surfaces a
      raw InvalidStateError to the user. The answer is deterministic, so probe
      the exact config we will use BEFORE any frame is encoded — failing here
      costs seconds, not the minutes of video encoding the user would
      otherwise sit through first. The very same object is later handed to
      audioEncoder.configure() so probe and configure can never diverge.
      (Duplicated in video-compress.ts, mirroring the existing encodeAudio
      duplication — a shared video-utils export would churn every vi.mock
      factory that lists that module's names.)
    */
    const aacConfig: AudioEncoderConfig | null = audioBuffer
      ? {
          codec: "mp4a.40.2",
          numberOfChannels: Math.min(audioBuffer.numberOfChannels, 2),
          sampleRate: audioBuffer.sampleRate,
          bitrate: AUDIO_BITRATE,
        }
      : null;
    if (aacConfig) {
      await assertAacEncodable(aacConfig);
      throwIfAborted(signal);
    }

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
      ...(aacConfig
        ? {
            audio: {
              codec: "aac",
              numberOfChannels: aacConfig.numberOfChannels,
              sampleRate: aacConfig.sampleRate,
            },
          }
        : {}),
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });

    let encoderError: Error | null = null;
    // Wakes a parked backpressure waiter so a fatal encoder error can't leave the
    // frame loop awaiting an ondequeue that never fires (encoder is "closed").
    let wakeBackpressure: (() => void) | null = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => { muxer.addVideoChunk(chunk, meta); },
      // Capture rather than throw — a throw here becomes an uncaught async
      // rejection and freezes the UI on "Converting…".
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
          bitrate: 5_000_000,
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

          // Backpressure: if encoder queue is deep, wait for it to drain
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

      if (audioBuffer && aacConfig) {
        onProgress?.(85);
        await encodeAudio(audioBuffer, muxer, aacConfig, signal);
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
      signal?.removeEventListener("abort", onAbort);
      // Cancelling or failing mid-encode used to leak the encoder (and its
      // hardware session) until GC.
      if (videoEncoder.state !== "closed") videoEncoder.close();
    }
  } finally {
    URL.revokeObjectURL(videoUrl);
  }
}

/**
 * Probe `AudioEncoder.isConfigSupported` with the exact config `encodeAudio`
 * will configure, and translate a refusal (or a probe that itself throws)
 * into the friendly AAC message. Called BEFORE the video encode so the
 * deterministic failure is instant.
 */
async function assertAacEncodable(config: AudioEncoderConfig): Promise<void> {
  let aacSupported = false;
  try {
    const support = await AudioEncoder.isConfigSupported(config);
    aacSupported = support.supported === true;
  } catch {
    aacSupported = false;
  }
  if (!aacSupported) {
    throw new Error(
      "This browser can't encode the audio track — its WebCodecs implementation doesn't support AAC. Please use Chrome or Edge.",
    );
  }
}

async function encodeAudio(
  audioBuffer: AudioBuffer,
  muxer: Muxer<ArrayBufferTarget>,
  // The exact object that already passed assertAacEncodable — configuring
  // with the same identity keeps probe and configure from ever diverging.
  config: AudioEncoderConfig,
  signal?: AbortSignal,
): Promise<void> {
  const { numberOfChannels, sampleRate } = config;

  let encoderError: Error | null = null;
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => { muxer.addAudioChunk(chunk, meta); },
    error: (e) => { encoderError = e instanceof Error ? e : new Error(String(e)); },
  });

  try {
    audioEncoder.configure(config);

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
