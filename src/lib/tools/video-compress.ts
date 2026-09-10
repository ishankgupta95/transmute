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

/**
 * The second arm of this engine: a size CEILING in KB instead of one of the
 * three named presets. `compressVideo` accepts either.
 */
export interface VideoSizeTarget {
  targetSizeKb: number;
}

export type VideoCompressionMode = CompressionPreset | VideoSizeTarget;

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
 * Everything the MP4 container spends that the two bitrates do not: the moov
 * atom, the per-sample tables, the chunk headers. It scales with the number of
 * SAMPLES rather than with the bitrate, so this 6% is an allowance, not a
 * measurement — which is precisely why the finished size is measured and
 * reported (`VideoSizeTargetOutcome.met`) rather than promised anywhere.
 */
const MUX_HEADROOM = 0.94;

/**
 * The bitrate below which H.264 stops being video and becomes a slideshow of
 * blocks. A target that would need less than this is clamped UP to it and
 * reported as `atFloor`, so the run comes back honestly over the ceiling
 * instead of silently mangled and under it.
 *
 * Exported because the UI names this floor when it explains a missed target.
 */
export const SIZE_TARGET_MIN_VIDEO_BITRATE = 120_000;

/**
 * AAC rungs, descending. The solver takes the highest one that fits inside
 * `AUDIO_BUDGET_SHARE` of the whole budget so a long clip squeezed into a
 * small ceiling does not spend its entire allowance on the soundtrack — a
 * 40-minute recording at 25 MB has ~87 kbps TOTAL, and a fixed 128 kbps track
 * would have left the video a negative budget.
 */
const AUDIO_LADDER = [128_000, 96_000, 64_000, 48_000, 32_000] as const;
const AUDIO_BUDGET_SHARE = 0.25;

/**
 * Resolution the solved bitrate can actually carry, largest first. A pure
 * bitrate solve with no height rule encodes 1080p at 90 kbps, which is a
 * target met and a video destroyed; stepping the height down spends the same
 * bits on fewer pixels. These thresholds are conventional H.264 streaming
 * rules of thumb, not measurements — the copy calls them a heuristic and the
 * chosen height is reported back so nothing here is a hidden decision.
 *
 * Only ever a CEILING: `compressVideo` scales down to `maxHeight` and never
 * up, so a 480p source handed a 1080p rung is left at 480p.
 */
const HEIGHT_LADDER: readonly { minBitrate: number; height: number }[] = [
  { minBitrate: 4_000_000, height: 2160 },
  { minBitrate: 1_500_000, height: 1080 },
  { minBitrate: 800_000, height: 720 },
  { minBitrate: 400_000, height: 480 },
  { minBitrate: 200_000, height: 360 },
  { minBitrate: 0, height: 240 },
];

/**
 * The share of the source's own bitrate the never-inflate cap allows a
 * re-encode to spend. Applied to the WHOLE plan — video plus audio — because
 * that sum is what the muxer writes; capping the video alone and then adding
 * a freshly-chosen AAC track beside it is how a 4 MB clip came back at 4.5 MB
 * under a page saying it could not.
 */
const NEVER_INFLATE_SHARE = 0.9;

/**
 * The MP4 an H.264 encoder cannot write here, in one sentence.
 *
 * A WebCodecs encoder is supposed to hand the codec description back on the
 * metadata of its FIRST chunk. mp4-muxer keeps that as `track.info.decoderConfig`
 * and reaches straight into `.colorSpace`, so an encoder that omits it does not
 * produce a diagnosable failure — it produces the raw library exception
 * "null is not an object (evaluating 'track.info.decoderConfig.colorSpace')",
 * which is what Safari users were shown as their error message. WebKit encodes
 * the frames fine; it is the description it does not return.
 *
 * Exported so `CompressVideoUI` can print the SAME sentence from its
 * pre-flight probe — the page and the post-click error must never disagree,
 * which is the rule `WEBCODECS_UNSUPPORTED_MESSAGE` already keeps for the
 * missing-encoder case.
 */
export const WEBCODECS_MP4_METADATA_MESSAGE =
  "This browser can't write the compressed MP4 — its video encoder doesn't return the H.264 codec description the container needs. Please use Chrome or Edge.";

/**
 * The missing-AAC-encoder sentence, shared by `assertAacEncodable` and the
 * pre-flight for the same reason as above.
 */
export const WEBCODECS_AAC_MESSAGE =
  "This browser can't encode the audio track — its WebCodecs implementation doesn't support AAC. Please use Chrome or Edge.";

/** What the solver decided, before a single frame is encoded. */
export interface SizeTargetPlan {
  videoBitrate: number;
  /** null when the source carries no audio track at all. */
  audioBitrate: number | null;
  maxHeight: number;
  /** The solve landed under `SIZE_TARGET_MIN_VIDEO_BITRATE` and was raised to it. */
  atFloor: boolean;
  /**
   * The solve asked for MORE than the source itself spends, so the
   * never-inflate cap bound the plan — video AND audio together.
   *
   * It is not a promise that the output is smaller. `SIZE_TARGET_MIN_VIDEO_BITRATE`
   * is a floor this tool will not encode below, and a near-static screencast
   * can spend less than that on everything it has; when the two collide the
   * floor wins and the file grows anyway. Which is why the UI decides its
   * sentence by WEIGHING the download rather than by reading this flag — see
   * `sourceCappedText`.
   */
  sourceCapped: boolean;
}

/** The plan, plus what the encode actually produced against it. */
export interface VideoSizeTargetOutcome extends SizeTargetPlan {
  targetBytes: number;
  /** MEASURED from the finished blob. Never predicted, never assumed. */
  met: boolean;
}

/** `ProcessedResult`, plus the size-target report when one was requested. */
export interface VideoCompressResult extends ProcessedResult {
  /** Present only for a `VideoSizeTarget` run; absent for the three presets. */
  sizeTarget?: VideoSizeTargetOutcome;
}

/**
 * Solve a video bitrate from a size ceiling and the clip's own length.
 *
 * Pure, and deliberately separate from the encode: this is the whole claim the
 * size-target tool makes, so it is unit-testable without WebCodecs. It TARGETS
 * a size — H.264 rate control is not a promise, and `met` is decided later by
 * weighing the file that came out.
 */
export function planSizeTarget(input: {
  targetBytes: number;
  durationSeconds: number;
  sourceBytes: number;
  hasAudio: boolean;
}): SizeTargetPlan {
  const { targetBytes, durationSeconds, sourceBytes, hasAudio } = input;
  /*
    A cleared or zeroed field must not quietly become "encode at the floor and
    call it a hit". There is no sane fallback for a target of 0, so say so.
  */
  if (!Number.isFinite(targetBytes) || targetBytes <= 0) {
    throw new Error("Set a target size above 0 MB before compressing.");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(
      "Couldn't read how long this clip is, and a size target can only be solved from its length. Try an MP4 (H.264).",
    );
  }

  const ceilingBudget = ((targetBytes * 8) / durationSeconds) * MUX_HEADROOM;

  /*
    The same never-inflate cap the presets carry (see the block in
    `compressVideo`): aim a 25 MB ceiling at a 4 MB clip and the honest answer
    is a 4 MB clip, not a re-encode padded out to fill the ceiling.

    IT CAPS THE WHOLE PLAN, NOT THE VIDEO TRACK. It used to bound
    `videoBitrate` alone, after which the AAC rung — chosen from the TARGET's
    budget, so up to 128 kbps — was added on top and muxed beside it. The
    planned output was therefore `0.9·source + audio`, which is ABOVE the
    source for any clip spending less than about 1.28 Mbps in total: exactly
    the clips the cap exists for, since a clip already under the ceiling is
    the only kind that reaches it. A 4 MB/60 s clip with a soundtrack planned
    503,316 + 128,000 = 631,316 bps against a 559,241 bps source and came back
    at 4.5 MB.
  */
  const sourceRate =
    Number.isFinite(sourceBytes) && sourceBytes > 0
      ? (sourceBytes * 8) / durationSeconds
      : Number.POSITIVE_INFINITY;
  const neverInflateBudget = sourceRate * NEVER_INFLATE_SHARE;
  const sourceCapped = neverInflateBudget < ceilingBudget;
  const budget = sourceCapped ? neverInflateBudget : ceilingBudget;

  /*
    The audio rung comes out of the CAPPED budget for the same reason: a rung
    picked from the ceiling would be a rung the capped plan cannot afford, and
    the whole point of the cap is that the sum stays under the source.
  */
  const audioBitrate = hasAudio
    ? (AUDIO_LADDER.find((rung) => rung <= budget * AUDIO_BUDGET_SHARE) ??
      AUDIO_LADDER[AUDIO_LADDER.length - 1])
    : null;

  const solved = Math.round(budget - (audioBitrate ?? 0));
  const videoBitrate = Math.max(SIZE_TARGET_MIN_VIDEO_BITRATE, solved);

  return {
    videoBitrate,
    audioBitrate,
    maxHeight: heightForBitrate(videoBitrate),
    atFloor: solved < SIZE_TARGET_MIN_VIDEO_BITRATE,
    /*
      `atFloor` and `sourceCapped` are no longer mutually exclusive, and that
      is the fix rather than a regression. The old code clamped the cap itself
      UP to the floor (`Math.max(FLOOR, sourceRate * 0.9)`) so the two could
      never co-occur — which is precisely what made the cap toothless on the
      leanest clips. A clip spending less per second than this tool's floor is
      genuinely both: capped, and still raised to the floor.
    */
    sourceCapped,
  };
}

function heightForBitrate(bitrate: number): number {
  const rung =
    HEIGHT_LADDER.find((r) => bitrate >= r.minBitrate) ?? HEIGHT_LADDER[HEIGHT_LADDER.length - 1];
  return rung.height;
}

/**
 * Compress a video using WebCodecs (HW-accelerated H.264) + mp4-muxer.
 *
 * `mode` is either one of the three named presets or a `{ targetSizeKb }`
 * ceiling; the ceiling arm solves a bitrate through `planSizeTarget` and
 * reports what it actually achieved on `result.sizeTarget`.
 */
export async function compressVideo(
  file: File,
  mode: VideoCompressionMode,
  ctx: ProcessingContext = {},
): Promise<VideoCompressResult> {
  const { onProgress, signal } = ctx;
  const sizeTarget = typeof mode === "string" ? null : mode;
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
    // Decode the audio once up front so we can both detect it and reuse the
    // buffer (the old code decoded the whole file twice — easy to OOM).
    //
    // This now runs BEFORE the bitrate is chosen, because the size-target arm
    // has to know whether there is a soundtrack to pay for out of the same
    // budget. Nothing about the preset arm depends on it, so the presets are
    // unaffected by the move.
    const audioBuffer = await decodeAudio(file);
    throwIfAborted(signal);
    const hasAudio = audioBuffer !== null;

    /*
      The presets are fixed TARGET bitrates. Aimed at a clip that is already
      leaner than the target they inflate it — a 158 KB source came back at
      213 KB and was still presented as "compressed". Cap the target at 90% of
      what the source actually spends per second so the output cannot be a
      bigger file than the input, with a 200 kbps floor so a tiny clip is not
      re-encoded into mush.

      The size-target arm solves its own bitrate from the ceiling and the
      probed duration, carrying the same never-inflate cap — see
      `planSizeTarget`.
    */
    const plan = sizeTarget
      ? planSizeTarget({
          targetBytes: sizeTarget.targetSizeKb * 1024,
          durationSeconds: duration,
          sourceBytes: file.size,
          hasAudio,
        })
      : null;
    const config = plan
      ? {
          maxHeight: plan.maxHeight,
          bitrate: plan.videoBitrate,
          // A silent track still needs a number for the AAC config; the plan
          // only returns null when there is no track to encode at all.
          audioBitrate: plan.audioBitrate ?? AUDIO_LADDER[AUDIO_LADDER.length - 1],
        }
      : PRESET_CONFIG[mode as CompressionPreset];
    const sourceBitrate = (file.size * 8) / duration;
    const targetBitrate = plan
      ? plan.videoBitrate
      : Math.min(config.bitrate, Math.max(200_000, Math.round(sourceBitrate * 0.9)));

    /*
      Firefox ≥132 passes every coarse WebCodecs probe but ships no AAC
      encoder: configure() closes the codec and the next encode() surfaces a
      raw InvalidStateError to the user. The answer is deterministic, so probe
      the exact config we will use BEFORE any frame is encoded — failing here
      costs seconds, not the minutes of video encoding the user would
      otherwise sit through first. The very same object is later handed to
      audioEncoder.configure() so probe and configure can never diverge.
      (Duplicated in webm-to-mp4.ts, mirroring the existing encodeAudio
      duplication — a shared video-utils export would churn every vi.mock
      factory that lists that module's names.)
    */
    const aacConfig: AudioEncoderConfig | null = audioBuffer
      ? {
          codec: "mp4a.40.2",
          numberOfChannels: Math.min(audioBuffer.numberOfChannels, 2),
          sampleRate: audioBuffer.sampleRate,
          bitrate: config.audioBitrate,
        }
      : null;
    if (aacConfig) {
      await assertAacEncodable(aacConfig);
      throwIfAborted(signal);
    }

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
    // Wakes a parked backpressure waiter so a fatal encoder error can't leave
    // the frame loop awaiting an ondequeue that will never fire (the encoder is
    // "closed" after an error) — which would freeze the UI on "Compressing…".
    let wakeBackpressure: (() => void) | null = null;
    /*
      The muxer's one hard requirement, checked here rather than let crash
      inside it. mp4-muxer needs the codec description that rides on the FIRST
      chunk's metadata; without it it dereferences a null `decoderConfig` and
      the library's own exception string becomes the user's error message.
      Until one arrives no chunk is handed over, so a browser that never sends
      it fails with a sentence instead of a stack frame. Once seen, later
      chunks are passed through untested — Chrome sends the description once,
      on the first chunk, and testing every chunk would reject a healthy run.
    */
    let decoderConfigSeen = false;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (!decoderConfigSeen) {
          if (!meta?.decoderConfig) {
            if (!encoderError) encoderError = new Error(WEBCODECS_MP4_METADATA_MESSAGE);
            wakeBackpressure?.();
            return;
          }
          decoderConfigSeen = true;
        }
        muxer.addVideoChunk(chunk, meta);
      },
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
        fileName: `${baseName}-compressed.mp4`,
        originalSize: file.size,
        newSize: blob.size,
        /*
          The whole honesty of the size-target tool sits on this one line:
          `met` is the finished file WEIGHED against the ceiling, not the
          solver's opinion of itself. A rate-control overshoot, a clip whose
          real duration differed from the probe, a container that cost more
          than MUX_HEADROOM allowed — every one of those shows up here as a
          miss, and the UI says so rather than presenting the overshoot as a
          success.
        */
        ...(plan && sizeTarget
          ? {
              sizeTarget: {
                ...plan,
                targetBytes: sizeTarget.targetSizeKb * 1024,
                met: blob.size <= sizeTarget.targetSizeKb * 1024,
              },
            }
          : {}),
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
    throw new Error(WEBCODECS_AAC_MESSAGE);
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
