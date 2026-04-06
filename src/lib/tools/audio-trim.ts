import type { ProcessedResult } from "@/hooks/useFileProcessor";

export interface AudioTrimOptions {
  startTime: number; // seconds
  endTime: number; // seconds
  outputFormat: "wav" | "mp3";
  bitrate?: number; // for MP3 output
}

/**
 * Trim an audio file to a specified time range.
 * Decodes the input, slices the AudioBuffer, and re-encodes.
 */
export async function trimAudio(
  file: File,
  options: AudioTrimOptions,
): Promise<ProcessedResult> {
  const { decodeAudioFile } = await import("./audio-decode");
  const audioBuffer = await decodeAudioFile(file);

  const { startTime, endTime, outputFormat, bitrate } = options;
  if (startTime >= endTime) throw new Error("Start time must be before end time");
  if (endTime > audioBuffer.duration) throw new Error("End time exceeds audio duration");

  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.floor(endTime * sampleRate);
  const length = endSample - startSample;
  const channels = audioBuffer.numberOfChannels;

  const trimmedBuffer = new OfflineAudioContext(channels, length, sampleRate);
  const newBuffer = trimmedBuffer.createBuffer(channels, length, sampleRate);

  for (let ch = 0; ch < channels; ch++) {
    const sourceData = audioBuffer.getChannelData(ch);
    const targetData = newBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      targetData[i] = sourceData[startSample + i];
    }
  }

  const baseName = file.name.replace(/\.[^.]+$/, "");
  let blob: Blob;
  let fileName: string;

  if (outputFormat === "mp3") {
    const { encodeToMp3 } = await import("./audio-encode-mp3");
    blob = encodeToMp3(newBuffer, bitrate ?? 192);
    fileName = `${baseName}-trimmed.mp3`;
  } else {
    const { encodeToWav } = await import("./audio-encode-wav");
    blob = encodeToWav(newBuffer);
    fileName = `${baseName}-trimmed.wav`;
  }

  return {
    blob,
    fileName,
    originalSize: file.size,
    newSize: blob.size,
  };
}
