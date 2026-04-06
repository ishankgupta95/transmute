/**
 * Decode an audio file into an AudioBuffer using the Web Audio API.
 * Supports MP3, WAV, OGG, M4A, FLAC, and any format the browser can decode.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  try {
    return await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    await audioCtx.close();
  }
}

/**
 * Extract raw Int16 samples from an AudioBuffer for a given channel.
 * Converts float32 [-1, 1] to int16 [-32768, 32767].
 */
export function getInt16Samples(buffer: AudioBuffer, channel: number): Int16Array {
  const float32 = buffer.getChannelData(channel);
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}
