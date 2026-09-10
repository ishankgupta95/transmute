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

/**
 * Encode an AudioBuffer to MP3 on the calling thread — no worker, no
 * progress reporting. Async because the encoder is fetched from
 * `/vendor/lamejs.js` rather than bundled (see audio-pcm.ts); the encode loop
 * itself still blocks whichever thread calls this, which is why the tools go
 * through `convertToMp3` and the worker pool instead.
 */
export async function encodeToMp3(buffer: AudioBuffer, bitrate: number): Promise<Blob> {
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
 *
 * The body moved to `audio-convert.ts` when FLAC arrived: this was one of two
 * functions whose eight lines differed by a single word, and a third copy for
 * an output the worker pool cannot even encode was not worth having. The name
 * stays because the MP3 tools import it, and because "convert this file to
 * MP3" is a real thing to want.
 *
 * The import is dynamic on purpose. `audio-convert.ts` reaches back here for
 * `resampleForMp3` (which `audio-trim.ts` and `audio-merge.ts` also import, so
 * it cannot move), and a static edge in both directions is a cycle. Deferring
 * this half breaks it without changing anything a caller can see.
 */
export async function convertToMp3(
  file: File,
  options: Mp3EncodeOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  const { convertAudio } = await import("./audio-convert");
  return convertAudio(file, { format: "mp3", bitrate: options.bitrate }, ctx);
}
