import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

/*
 * The mock target is a URL, not a package name, and that is the point.
 *
 * lamejs is LGPL, so it is no longer bundled: `npm run copy:wasm` copies
 * upstream's dist to `public/vendor/lamejs.js` and lib/tools/audio-pcm.ts
 * fetches it at first encode through a deliberately non-analyzable specifier
 * (see the `vendorUrl` comment there). Vitest resolves that computed specifier
 * at runtime, so mocking "/vendor/lamejs.js" intercepts exactly the request
 * the browser would make. It also means these tests fail loudly if anyone
 * reinstates `import { Mp3Encoder } from "@breezystack/lamejs"` — the spy
 * below would simply never be called.
 */
const lame = vi.hoisted(() => ({
  Mp3Encoder: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.encodeBuffer = vi.fn().mockReturnValue(new Int8Array([0xff, 0xfb]));
    this.flush = vi.fn().mockReturnValue(new Int8Array([0x00]));
  }),
}));

vi.mock("/vendor/lamejs.js", () => ({ Mp3Encoder: lame.Mp3Encoder }));

// Mock audio-decode
vi.mock("@/lib/tools/audio-decode", () => ({
  decodeAudioFile: vi.fn(),
}));

import { encodeToMp3 } from "@/lib/tools/audio-encode-mp3";

const { Mp3Encoder } = lame;

/** Swap in an encoder whose two methods are individually observable. */
function stubEncoder(encodeBuffer: Mock, flush: Mock): void {
  Mp3Encoder.mockImplementation(function (this: Record<string, unknown>) {
    this.encodeBuffer = encodeBuffer;
    this.flush = flush;
  });
}

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

  it("creates an Mp3Encoder with correct parameters", async () => {
    const buffer = createMockAudioBuffer(2, 4410, 44100);
    await encodeToMp3(buffer, 192);

    expect(Mp3Encoder).toHaveBeenCalledWith(2, 44100, 192);
  });

  it("returns a Blob with audio/mpeg type", async () => {
    const buffer = createMockAudioBuffer(1, 4410, 44100);
    const result = await encodeToMp3(buffer, 128);

    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe("audio/mpeg");
  });

  it("processes mono audio with single channel", async () => {
    const mockEncode = vi.fn().mockReturnValue(new Int8Array([0xff]));
    const mockFlush = vi.fn().mockReturnValue(new Int8Array([0x00]));
    stubEncoder(mockEncode, mockFlush);

    const buffer = createMockAudioBuffer(1, 2304, 44100);
    await encodeToMp3(buffer, 192);

    // With 2304 samples and chunk size 1152, should be called 2 times
    expect(mockEncode).toHaveBeenCalledTimes(2);
    // Mono: encodeBuffer is called with just the left channel
    const firstCallArgs = mockEncode.mock.calls[0];
    expect(firstCallArgs[0]).toBeInstanceOf(Int16Array);
  });

  it("processes stereo audio with two channels", async () => {
    const mockEncode = vi.fn().mockReturnValue(new Int8Array([0xff]));
    const mockFlush = vi.fn().mockReturnValue(new Int8Array([0x00]));
    stubEncoder(mockEncode, mockFlush);

    const buffer = createMockAudioBuffer(2, 1152, 44100);
    await encodeToMp3(buffer, 256);

    // Stereo: encodeBuffer should receive both left and right
    const firstCallArgs = mockEncode.mock.calls[0];
    expect(firstCallArgs[0]).toBeInstanceOf(Int16Array);
    expect(firstCallArgs[1]).toBeInstanceOf(Int16Array);
  });

  it("flushes the encoder after processing all chunks", async () => {
    const mockFlush = vi.fn().mockReturnValue(new Int8Array([0x00]));
    stubEncoder(vi.fn().mockReturnValue(new Int8Array([0xff])), mockFlush);

    const buffer = createMockAudioBuffer(1, 1152, 44100);
    await encodeToMp3(buffer, 128);

    expect(mockFlush).toHaveBeenCalledTimes(1);
  });

  it("converts float32 samples to int16 correctly", async () => {
    const mockEncode = vi.fn().mockReturnValue(new Int8Array([]));
    const mockFlush = vi.fn().mockReturnValue(new Int8Array([]));
    stubEncoder(mockEncode, mockFlush);

    // Create a buffer with known float32 values
    const channelData = new Float32Array([0, 1, -1, 0.5, -0.5]);
    const buffer = {
      numberOfChannels: 1,
      length: 5,
      sampleRate: 44100,
      duration: 5 / 44100,
      getChannelData: () => channelData,
    } as unknown as AudioBuffer;

    await encodeToMp3(buffer, 192);

    const samples = mockEncode.mock.calls[0][0] as Int16Array;
    expect(samples[0]).toBe(0);       // 0 → 0
    expect(samples[1]).toBe(32767);   // 1.0 → 0x7FFF
    expect(samples[2]).toBe(-32768);  // -1.0 → -0x8000
    expect(samples[3]).toBeGreaterThan(16000); // ~0.5 * 32767
    expect(samples[4]).toBeLessThan(-16000);   // ~-0.5 * 32768
  });

  it("handles different bitrate values", async () => {
    const buffer = createMockAudioBuffer(2, 4410, 44100);

    for (const bitrate of [128, 192, 256, 320]) {
      vi.clearAllMocks();
      await encodeToMp3(buffer, bitrate);
      expect(Mp3Encoder).toHaveBeenCalledWith(2, 44100, bitrate);
    }
  });
});
