import { describe, it, expect, vi } from "vitest";

// Mock audiobuffer-to-wav
vi.mock("audiobuffer-to-wav", () => ({
  default: vi.fn().mockImplementation((buffer: AudioBuffer) => {
    // Return a mock WAV ArrayBuffer — RIFF header is 44 bytes + PCM data
    const dataLength = buffer.length * buffer.numberOfChannels * 2; // 16-bit PCM
    const totalLength = 44 + dataLength;
    const arrayBuffer = new ArrayBuffer(totalLength);
    const view = new DataView(arrayBuffer);

    // Write RIFF header identifier
    view.setUint32(0, 0x52494646, false); // "RIFF"
    view.setUint32(4, totalLength - 8, true);
    view.setUint32(8, 0x57415645, false); // "WAVE"

    return arrayBuffer;
  }),
}));

// Mock audio-decode
vi.mock("@/lib/tools/audio-decode", () => ({
  decodeAudioFile: vi.fn(),
}));

import { encodeToWav } from "@/lib/tools/audio-encode-wav";
import toWav from "audiobuffer-to-wav";

function createMockAudioBuffer(
  channels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const channelData: Float32Array[] = [];
  for (let i = 0; i < channels; i++) {
    channelData.push(new Float32Array(length));
  }
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => channelData[ch],
  } as unknown as AudioBuffer;
}

describe("encodeToWav", () => {
  it("calls audiobuffer-to-wav with the AudioBuffer", () => {
    const buffer = createMockAudioBuffer(2, 44100, 44100);
    encodeToWav(buffer);

    expect(toWav).toHaveBeenCalledWith(buffer);
  });

  it("returns a Blob with audio/wav type", () => {
    const buffer = createMockAudioBuffer(1, 44100, 44100);
    const result = encodeToWav(buffer);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("audio/wav");
  });

  it("output blob size includes RIFF header + PCM data", () => {
    const length = 44100;
    const channels = 2;
    const buffer = createMockAudioBuffer(channels, length, 44100);
    const result = encodeToWav(buffer);

    // 44 header + (44100 samples × 2 channels × 2 bytes)
    const expectedSize = 44 + length * channels * 2;
    expect(result.size).toBe(expectedSize);
  });

  it("output contains valid RIFF header", async () => {
    const buffer = createMockAudioBuffer(1, 100, 44100);
    const blob = encodeToWav(buffer);
    const arrayBuffer = await blob.arrayBuffer();
    const view = new DataView(arrayBuffer);

    // Check "RIFF" magic bytes
    expect(view.getUint32(0, false)).toBe(0x52494646);
    // Check "WAVE" format
    expect(view.getUint32(8, false)).toBe(0x57415645);
  });
});
