import type { ProcessedResult } from "@/hooks/useFileProcessor";

export interface AudioMergeOptions {
  outputFormat: "wav" | "mp3";
  bitrate?: number; // for MP3 output
}

/**
 * Merge multiple audio files into a single file by concatenating their AudioBuffers.
 * All files are resampled to the highest sample rate among inputs.
 * Output channel count matches the maximum among inputs.
 */
export async function mergeAudio(
  files: File[],
  options: AudioMergeOptions,
): Promise<ProcessedResult> {
  if (files.length < 2) throw new Error("At least 2 files required for merging");

  const { decodeAudioFile } = await import("./audio-decode");

  const buffers = await Promise.all(files.map((f) => decodeAudioFile(f)));

  const maxSampleRate = Math.max(...buffers.map((b) => b.sampleRate));
  const maxChannels = Math.max(...buffers.map((b) => b.numberOfChannels));

  // Resample all buffers to the target sample rate if needed
  const resampledBuffers = await Promise.all(
    buffers.map((buf) => resampleBuffer(buf, maxSampleRate, maxChannels)),
  );

  // Calculate total length
  const totalLength = resampledBuffers.reduce((sum, b) => sum + b.length, 0);

  // Create merged buffer
  const offlineCtx = new OfflineAudioContext(maxChannels, totalLength, maxSampleRate);
  const mergedBuffer = offlineCtx.createBuffer(maxChannels, totalLength, maxSampleRate);

  let offset = 0;
  for (const buf of resampledBuffers) {
    for (let ch = 0; ch < maxChannels; ch++) {
      const targetData = mergedBuffer.getChannelData(ch);
      // If source has fewer channels, duplicate first channel
      const sourceChannel = ch < buf.numberOfChannels ? ch : 0;
      const sourceData = buf.getChannelData(sourceChannel);
      targetData.set(sourceData, offset);
    }
    offset += buf.length;
  }

  const totalOriginalSize = files.reduce((sum, f) => sum + f.size, 0);

  let blob: Blob;
  let fileName: string;

  if (options.outputFormat === "mp3") {
    const { encodeToMp3 } = await import("./audio-encode-mp3");
    blob = encodeToMp3(mergedBuffer, options.bitrate ?? 192);
    fileName = "merged.mp3";
  } else {
    const { encodeToWav } = await import("./audio-encode-wav");
    blob = encodeToWav(mergedBuffer);
    fileName = "merged.wav";
  }

  return {
    blob,
    fileName,
    originalSize: totalOriginalSize,
    newSize: blob.size,
  };
}

/**
 * Resample an AudioBuffer to a target sample rate and channel count
 * using OfflineAudioContext.
 */
async function resampleBuffer(
  buffer: AudioBuffer,
  targetSampleRate: number,
  targetChannels: number,
): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetSampleRate && buffer.numberOfChannels === targetChannels) {
    return buffer;
  }

  const duration = buffer.duration;
  const targetLength = Math.ceil(duration * targetSampleRate);
  const offlineCtx = new OfflineAudioContext(targetChannels, targetLength, targetSampleRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  return await offlineCtx.startRendering();
}
