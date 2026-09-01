import type { ProcessingContext } from "@/hooks/useFileProcessor";
import { throwIfAborted } from "@/lib/utils/abort";
import { WorkerPool } from "./pool";
import type { AudioEncodeJob, AudioEncodeResult } from "./audio-protocol";

/**
 * Main-thread client for the audio encode pool.
 *
 * Split of labour (Web Audio leaves no choice): decode and resample happen on
 * the main thread — AudioContext/OfflineAudioContext don't exist in workers —
 * then the raw channel data crosses into a pool worker for the CPU-heavy
 * encode (lamejs MP3, WAV interleave/quantise). Channel data is copied once
 * (`slice`) so the caller's AudioBuffer stays usable, and the copies are
 * transferred, not cloned.
 *
 * Audio tools are single-file, so the pool stays small: two workers cover an
 * encode overlapping a follow-up without hoarding memory.
 */

let pool: WorkerPool | null = null;

function getAudioPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool({
      // Pre-bundled by scripts/build-workers.mjs — see image-client.ts.
      createWorker: () =>
        new Worker(
          `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/workers/audio-encode.worker.js`,
          { type: "module" },
        ),
      maxWorkers: 2,
    });
  }
  return pool;
}

function supportsAudioWorker(): boolean {
  return typeof Worker !== "undefined";
}

/** Float32 PCM in flight + int16/MP3 output — roughly 1.5× the PCM bytes. */
function estimateEncodeBytes(channels: ArrayBuffer[]): number {
  return channels.reduce((sum, c) => sum + c.byteLength, 0) * 1.5;
}

/** AudioBuffer → per-channel copies. slice() so transferring the copies
 * can't detach the caller's buffer (getChannelData's backing store belongs
 * to the AudioBuffer). */
function copyChannels(buffer: AudioBuffer): ArrayBuffer[] {
  const channels: ArrayBuffer[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch).slice().buffer);
  }
  return channels;
}

async function runEncode(
  buffer: AudioBuffer,
  job: (channels: ArrayBuffer[]) => AudioEncodeJob,
  ctx: ProcessingContext,
): Promise<Blob> {
  throwIfAborted(ctx.signal);
  const channels = copyChannels(buffer);
  const result = await getAudioPool().run<AudioEncodeResult>(job(channels), {
    transfer: channels,
    memoryBytes: estimateEncodeBytes(channels),
    signal: ctx.signal,
    onProgress: ctx.onProgress,
  });
  return new Blob([result.bytes], { type: result.mime });
}

/** MP3-encode an AudioBuffer off the main thread (falls back inline). */
export async function encodeMp3(
  buffer: AudioBuffer,
  bitrate: number,
  ctx: ProcessingContext = {},
): Promise<Blob> {
  if (!supportsAudioWorker()) {
    // Fallback imports the pure leaf module, never the wrappers — the
    // wrappers import this file, and a two-way edge here would recreate the
    // worker-bundle cycle audio-pcm.ts exists to prevent.
    const { encodePcmToMp3 } = await import("@/lib/tools/audio-pcm");
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }
    // Awaited, not just returned: the encode is asynchronous now because
    // lamejs is fetched from /vendor/ rather than bundled, and a rejection
    // from that fetch should surface with this frame on the stack.
    return await encodePcmToMp3(channels, buffer.sampleRate, bitrate);
  }
  return runEncode(buffer, (channels) => ({
    op: "mp3",
    channels,
    sampleRate: buffer.sampleRate,
    bitrate,
  }), ctx);
}

/** WAV-encode an AudioBuffer off the main thread (falls back inline). */
export async function encodeWav(
  buffer: AudioBuffer,
  ctx: ProcessingContext = {},
): Promise<Blob> {
  if (!supportsAudioWorker()) {
    const { encodePcmToWav } = await import("@/lib/tools/audio-pcm");
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }
    return encodePcmToWav(channels, buffer.sampleRate);
  }
  return runEncode(buffer, (channels) => ({
    op: "wav",
    channels,
    sampleRate: buffer.sampleRate,
  }), ctx);
}
