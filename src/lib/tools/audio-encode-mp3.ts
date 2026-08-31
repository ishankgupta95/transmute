import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";
import { encodePcmToMp3, MAX_MP3_SAMPLE_RATE } from "./audio-pcm";

/**
 * AudioBuffer-level MP3 encoding. The pure PCM encode lives in audio-pcm.ts
 * (the worker-safe leaf module); this file owns everything that needs the
 * main thread — AudioBuffer access, OfflineAudioContext resampling, and the
 * file-level orchestration that routes encodes into the worker pool.
 */

export { encodePcmToMp3, MAX_MP3_SAMPLE_RATE };

export interface Mp3EncodeOptions {
  bitrate: number; // kbps: 128, 192, 256, 320
}

/**
 * MP3 cannot carry rates above 48 kHz. Now that decoding preserves the source
 * rate (see audio-decode.ts), a 96 kHz master would reach lamejs unchanged and
 * come back as garbage — resample down first. ≤48 kHz buffers pass through
 * untouched.
 */
export async function resampleForMp3(buffer: AudioBuffer): Promise<AudioBuffer> {
  if (buffer.sampleRate <= MAX_MP3_SAMPLE_RATE) return buffer;
  const channels = Math.min(buffer.numberOfChannels, 2);
  const length = Math.ceil(buffer.duration * MAX_MP3_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(channels, length, MAX_MP3_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/** Encode an AudioBuffer to MP3 (synchronously, on the calling thread). */
export function encodeToMp3(buffer: AudioBuffer, bitrate: number): Blob {
  return encodePcmToMp3(extractChannels(buffer), buffer.sampleRate, bitrate);
}

/** AudioBuffer → raw channel arrays (the shape a worker can receive). */
export function extractChannels(buffer: AudioBuffer): Float32Array[] {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  return channels;
}

/**
 * Convert any browser-decodable audio file to MP3. Decoding stays on the
 * main thread (AudioContext doesn't exist in workers); the lamejs encode
 * runs in the audio worker pool.
 */
export async function convertToMp3(
  file: File,
  options: Mp3EncodeOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  const { decodeAudioFile } = await import("./audio-decode");
  const audioBuffer = await resampleForMp3(await decodeAudioFile(file, ctx));
  const { encodeMp3 } = await import("@/lib/workers/audio-client");
  const blob = await encodeMp3(audioBuffer, options.bitrate, ctx);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}.mp3`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
