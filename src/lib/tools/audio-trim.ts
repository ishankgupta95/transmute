import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

export interface AudioTrimOptions {
  startTime: number; // seconds
  endTime: number; // seconds
  outputFormat: "wav" | "mp3";
  bitrate?: number; // for MP3 output
}

/**
 * Trim an audio file to a specified time range.
 * Decodes the input (main thread — Web Audio), slices the AudioBuffer, and
 * re-encodes in the audio worker pool.
 */
export async function trimAudio(
  file: File,
  options: AudioTrimOptions,
  ctx: ProcessingContext = {},
): Promise<ProcessedResult> {
  const { startTime, endTime, outputFormat, bitrate } = options;
  // Validate BEFORE the (expensive) decode. NaN survives every relational
  // comparison below, so without this a NaN start/end reached the sample
  // loop and produced silent zero-filled output.
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    throw new Error("Trim times must be numbers");
  }
  if (startTime >= endTime) throw new Error("Start time must be before end time");

  const { decodeAudioFile } = await import("./audio-decode");
  const audioBuffer = await decodeAudioFile(file, ctx);

  const sampleRate = audioBuffer.sampleRate;
  // Clamp to the decoded buffer rather than throwing — a media element's reported
  // duration often slightly exceeds the precisely-decoded duration for VBR MP3 /
  // M4A, which previously rejected a valid full-range trim.
  const startSample = Math.min(Math.max(0, Math.floor(startTime * sampleRate)), audioBuffer.length);
  const endSample = Math.min(Math.floor(endTime * sampleRate), audioBuffer.length);
  const length = endSample - startSample;
  if (length <= 0) throw new Error("Selected range is empty");
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
    const { resampleForMp3 } = await import("./audio-encode-mp3");
    const { encodeMp3 } = await import("@/lib/workers/audio-client");
    blob = await encodeMp3(await resampleForMp3(newBuffer), bitrate ?? 192, ctx);
    fileName = `${baseName}-trimmed.mp3`;
  } else {
    const { encodeWav } = await import("@/lib/workers/audio-client");
    blob = await encodeWav(newBuffer, ctx);
    fileName = `${baseName}-trimmed.wav`;
  }

  return {
    blob,
    fileName,
    originalSize: file.size,
    newSize: blob.size,
  };
}
