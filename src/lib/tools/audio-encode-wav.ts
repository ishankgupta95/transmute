import toWav from "audiobuffer-to-wav";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

/**
 * Encode an AudioBuffer to WAV format.
 */
export function encodeToWav(buffer: AudioBuffer): Blob {
  const wavArrayBuffer = toWav(buffer);
  return new Blob([wavArrayBuffer], { type: "audio/wav" });
}

/**
 * Convert any browser-decodable audio file to WAV.
 */
export async function convertToWav(
  file: File,
): Promise<ProcessedResult> {
  const { decodeAudioFile } = await import("./audio-decode");
  const audioBuffer = await decodeAudioFile(file);
  const blob = encodeToWav(audioBuffer);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}.wav`,
    originalSize: file.size,
    newSize: blob.size,
  };
}
