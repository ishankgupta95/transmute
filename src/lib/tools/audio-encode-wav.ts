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
 *
 * The body lives in `audio-convert.ts` now — see the note on `convertToMp3`,
 * whose body this was a one-word variation of.
 */
export async function convertToWav(
  file: File,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  const { convertAudio } = await import("./audio-convert");
  return convertAudio(file, { format: "wav" }, ctx);
}
