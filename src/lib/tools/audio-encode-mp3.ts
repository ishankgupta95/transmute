import { Mp3Encoder } from "lamejs";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

export interface Mp3EncodeOptions {
  bitrate: number; // kbps: 128, 192, 256, 320
}

/**
 * Encode an AudioBuffer to MP3 using lamejs.
 * Processes in chunks to avoid blocking the main thread for too long.
 */
export function encodeToMp3(buffer: AudioBuffer, bitrate: number): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const encoder = new Mp3Encoder(channels, sampleRate, bitrate);

  const left = floatTo16Bit(buffer.getChannelData(0));
  const right = channels > 1 ? floatTo16Bit(buffer.getChannelData(1)) : undefined;

  const chunkSize = 1152; // MP3 frame size
  const chunks: Int8Array[] = [];

  for (let i = 0; i < left.length; i += chunkSize) {
    const leftChunk = left.subarray(i, i + chunkSize);
    const rightChunk = right?.subarray(i, i + chunkSize);
    const encoded = channels > 1
      ? encoder.encodeBuffer(leftChunk, rightChunk)
      : encoder.encodeBuffer(leftChunk);
    if (encoded.length > 0) chunks.push(encoded);
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(flushed);

  return new Blob(chunks as unknown as BlobPart[], { type: "audio/mpeg" });
}

/**
 * Convert any browser-decodable audio file to MP3.
 */
export async function convertToMp3(
  file: File,
  options: Mp3EncodeOptions,
): Promise<ProcessedResult> {
  const { decodeAudioFile } = await import("./audio-decode");
  const audioBuffer = await decodeAudioFile(file);
  const blob = encodeToMp3(audioBuffer, options.bitrate);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}.mp3`,
    originalSize: file.size,
    newSize: blob.size,
  };
}

function floatTo16Bit(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}
