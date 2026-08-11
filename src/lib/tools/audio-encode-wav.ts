import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";
import { encodePcmToWav } from "./audio-pcm";

/**
 * AudioBuffer-level WAV encoding. The pure PCM writer lives in audio-pcm.ts
 * (the worker-safe leaf module); this file owns AudioBuffer access and the
 * file-level orchestration that routes encodes into the worker pool.
 */

export { encodePcmToWav };

/** Encode an AudioBuffer to WAV (synchronously, on the calling thread). */
export function encodeToWav(buffer: AudioBuffer): Blob {
  // getChannelData is a live view; grab each once rather than per sample.
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  return encodePcmToWav(channels, buffer.sampleRate);
}

/**
 * Convert any browser-decodable audio file to WAV. Decoding stays on the
 * main thread (AudioContext doesn't exist in workers); the sample
 * interleave/quantise loop runs in the audio worker pool.
 */
export async function convertToWav(
  file: File,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  const { decodeAudioFile } = await import("./audio-decode");
  const audioBuffer = await decodeAudioFile(file);
  const { encodeWav } = await import("@/lib/workers/audio-client");
  const blob = await encodeWav(audioBuffer, ctx);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}.wav`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
