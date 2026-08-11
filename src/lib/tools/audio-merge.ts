import type { ProcessedResult, ProcessingContext } from "@/hooks/useFileProcessor";

export interface AudioMergeOptions {
  outputFormat: "wav" | "mp3";
  bitrate?: number; // for MP3 output
}

/**
 * Merge multiple audio files into a single file by concatenating their AudioBuffers.
 * All files are resampled to the highest sample rate among inputs.
 * Output channel count matches the maximum among inputs.
 * Decode/resample stay on the main thread (Web Audio); the encode runs in
 * the audio worker pool.
 */
export async function mergeAudio(
  files: File[],
  options: AudioMergeOptions,
  ctx: ProcessingContext = {},
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
    const { resampleForMp3 } = await import("./audio-encode-mp3");
    const { encodeMp3 } = await import("@/lib/workers/audio-client");
    blob = await encodeMp3(await resampleForMp3(mergedBuffer), options.bitrate ?? 192, ctx);
    fileName = "merged.mp3";
  } else {
    const { encodeWav } = await import("@/lib/workers/audio-client");
    blob = await encodeWav(mergedBuffer, ctx);
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
