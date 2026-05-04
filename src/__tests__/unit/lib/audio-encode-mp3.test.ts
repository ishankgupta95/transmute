import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock lamejs before importing the module under test
vi.mock("@breezystack/lamejs", () => {
  return {
    Mp3Encoder: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.encodeBuffer = vi.fn().mockReturnValue(new Int8Array([0xff, 0xfb]));
      this.flush = vi.fn().mockReturnValue(new Int8Array([0x00]));
    }),
  };
});

// Mock audio-decode
vi.mock("@/lib/tools/audio-decode", () => ({
  decodeAudioFile: vi.fn(),
}));

import { encodeToMp3 } from "@/lib/tools/audio-encode-mp3";
import { Mp3Encoder } from "@breezystack/lamejs";

function createMockAudioBuffer(
  channels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const channelData: Float32Array[] = [];
  for (let i = 0; i < channels; i++) {
    const data = new Float32Array(length);
    for (let j = 0; j < length; j++) {
      data[j] = Math.sin((2 * Math.PI * 440 * j) / sampleRate);
    }
    channelData.push(data);
  }

  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => channelData[ch],
  } as unknown as AudioBuffer;
}

describe("encodeToMp3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates an Mp3Encoder with correct parameters", () => {
    const buffer = createMockAudioBuffer(2, 4410, 44100);
    encodeToMp3(buffer, 192);

    expect(Mp3Encoder).toHaveBeenCalledWith(2, 44100, 192);
  });

  it("returns a Blob with audio/mpeg type", () => {
    const buffer = createMockAudioBuffer(1, 4410, 44100);
    const result = encodeToMp3(buffer, 128);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("audio/mpeg");
  });

  it("processes mono audio with single channel", () => {
    const mockEncode = vi.fn().mockReturnValue(new Int8Array([0xff]));
    const mockFlush = vi.fn().mockReturnValue(new Int8Array([0x00]));
    vi.mocked(Mp3Encoder).mockImplementation(function (this: Record<string, unknown>) {
      this.encodeBuffer = mockEncode;
      this.flush = mockFlush;
    } as unknown as () => InstanceType<typeof Mp3Encoder>);

    const buffer = createMockAudioBuffer(1, 2304, 44100);
    encodeToMp3(buffer, 192);

    // With 2304 samples and chunk size 1152, should be called 2 times
    expect(mockEncode).toHaveBeenCalledTimes(2);
    // Mono: encodeBuffer is called with just the left channel
    const firstCallArgs = mockEncode.mock.calls[0];
    expect(firstCallArgs[0]).toBeInstanceOf(Int16Array);
  });

  it("processes stereo audio with two channels", () => {
    const mockEncode = vi.fn().mockReturnValue(new Int8Array([0xff]));
    const mockFlush = vi.fn().mockReturnValue(new Int8Array([0x00]));
    vi.mocked(Mp3Encoder).mockImplementation(function (this: Record<string, unknown>) {
      this.encodeBuffer = mockEncode;
      this.flush = mockFlush;
    } as unknown as () => InstanceType<typeof Mp3Encoder>);

    const buffer = createMockAudioBuffer(2, 1152, 44100);
    encodeToMp3(buffer, 256);

    // Stereo: encodeBuffer should receive both left and right
    const firstCallArgs = mockEncode.mock.calls[0];
    expect(firstCallArgs[0]).toBeInstanceOf(Int16Array);
    expect(firstCallArgs[1]).toBeInstanceOf(Int16Array);
  });

  it("flushes the encoder after processing all chunks", () => {
    const mockFlush = vi.fn().mockReturnValue(new Int8Array([0x00]));
    vi.mocked(Mp3Encoder).mockImplementation(function (this: Record<string, unknown>) {
      this.encodeBuffer = vi.fn().mockReturnValue(new Int8Array([0xff]));
      this.flush = mockFlush;
    } as unknown as () => InstanceType<typeof Mp3Encoder>);

    const buffer = createMockAudioBuffer(1, 1152, 44100);
    encodeToMp3(buffer, 128);

    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it("converts float32 samples to int16 correctly", () => {
    const mockEncode = vi.fn().mockReturnValue(new Int8Array([]));
    const mockFlush = vi.fn().mockReturnValue(new Int8Array([]));
    vi.mocked(Mp3Encoder).mockImplementation(function (this: Record<string, unknown>) {
      this.encodeBuffer = mockEncode;
      this.flush = mockFlush;
    } as unknown as () => InstanceType<typeof Mp3Encoder>);

    // Create a buffer with known float32 values
    const channelData = new Float32Array([0, 1, -1, 0.5, -0.5]);
    const buffer = {
      numberOfChannels: 1,
      length: 5,
      sampleRate: 44100,
      duration: 5 / 44100,
      getChannelData: () => channelData,
    } as unknown as AudioBuffer;

    encodeToMp3(buffer, 192);

    const samples = mockEncode.mock.calls[0][0] as Int16Array;
    expect(samples[0]).toBe(0);       // 0 → 0
    expect(samples[1]).toBe(32767);   // 1.0 → 0x7FFF
    expect(samples[2]).toBe(-32768);  // -1.0 → -0x8000
    expect(samples[3]).toBeGreaterThan(16000); // ~0.5 * 32767
    expect(samples[4]).toBeLessThan(-16000);   // ~-0.5 * 32768
  });

  it("handles different bitrate values", () => {
    const buffer = createMockAudioBuffer(2, 4410, 44100);

    for (const bitrate of [128, 192, 256, 320]) {
      vi.clearAllMocks();
      encodeToMp3(buffer, bitrate);
      expect(Mp3Encoder).toHaveBeenCalledWith(2, 44100, bitrate);
    }
  });
});
