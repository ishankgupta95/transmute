import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDecodeAudioData = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);

const MockAudioContext = vi.fn(function () {
  return { decodeAudioData: mockDecodeAudioData, close: mockClose };
});
vi.stubGlobal("AudioContext", MockAudioContext);

import { decodeAudioFile, getInt16Samples } from "@/lib/tools/audio-decode";

function createMockAudioBuffer(channelData: Float32Array[]): AudioBuffer {
  return {
    numberOfChannels: channelData.length,
    length: channelData[0]?.length ?? 0,
    sampleRate: 44100,
    duration: (channelData[0]?.length ?? 0) / 44100,
    getChannelData: (ch: number) => channelData[ch],
  } as unknown as AudioBuffer;
}

describe("decodeAudioFile", () => {
  const mockAudioBuffer = createMockAudioBuffer([new Float32Array([0, 0.5, -0.5])]);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecodeAudioData.mockResolvedValue(mockAudioBuffer);
    mockClose.mockResolvedValue(undefined);
  });

  it("reads arrayBuffer from the file", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    const spy = vi.spyOn(file, "arrayBuffer");

    await decodeAudioFile(file);

    expect(spy).toHaveBeenCalled();
  });

  it("creates an AudioContext", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    await decodeAudioFile(file);

    expect(MockAudioContext).toHaveBeenCalledTimes(1);
  });

  it("decodes audio data and returns the AudioBuffer", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    const result = await decodeAudioFile(file);

    expect(mockDecodeAudioData).toHaveBeenCalled();
    expect(result).toBe(mockAudioBuffer);
  });

  it("always closes the AudioContext on success", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    await decodeAudioFile(file);

    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("closes the AudioContext even when decodeAudioData throws", async () => {
    mockDecodeAudioData.mockRejectedValueOnce(new Error("Unsupported format"));
    const file = new File(["bad-data"], "noise.xyz", { type: "audio/unknown" });

    await expect(decodeAudioFile(file)).rejects.toThrow("Unsupported format");
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("passes the file arrayBuffer to decodeAudioData", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    await decodeAudioFile(file);

    const callArg = mockDecodeAudioData.mock.calls[0][0];
    expect(callArg).toBeInstanceOf(ArrayBuffer);
  });
});

describe("getInt16Samples", () => {
  it("converts silence (0.0) to 0", () => {
    const buffer = createMockAudioBuffer([new Float32Array([0.0])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(0);
  });

  it("converts positive max (1.0) to 32767", () => {
    const buffer = createMockAudioBuffer([new Float32Array([1.0])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(32767);
  });

  it("converts negative max (-1.0) to -32768", () => {
    const buffer = createMockAudioBuffer([new Float32Array([-1.0])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(-32768);
  });

  it("clamps values above 1.0", () => {
    const buffer = createMockAudioBuffer([new Float32Array([1.5])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(32767);
  });

  it("clamps values below -1.0", () => {
    const buffer = createMockAudioBuffer([new Float32Array([-1.5])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(-32768);
  });

  it("converts mid-range positive values correctly", () => {
    const buffer = createMockAudioBuffer([new Float32Array([0.5])]);
    const result = getInt16Samples(buffer, 0);

    // 0.5 * 0x7FFF = 0.5 * 32767 = 16383.5 → truncated to 16383
    expect(result[0]).toBe(Math.floor(0.5 * 0x7fff));
  });

  it("converts mid-range negative values correctly", () => {
    const buffer = createMockAudioBuffer([new Float32Array([-0.5])]);
    const result = getInt16Samples(buffer, 0);

    // -0.5 * 0x8000 = -0.5 * 32768 = -16384
    expect(result[0]).toBe(-16384);
  });

  it("handles multiple samples", () => {
    const buffer = createMockAudioBuffer([new Float32Array([0.0, 1.0, -1.0, 0.25])]);
    const result = getInt16Samples(buffer, 0);

    expect(result.length).toBe(4);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(32767);
    expect(result[2]).toBe(-32768);
    expect(result[3]).toBe(Math.floor(0.25 * 0x7fff));
  });

  it("reads correct channel data", () => {
    const ch0 = new Float32Array([0.5]);
    const ch1 = new Float32Array([-0.5]);
    const buffer = createMockAudioBuffer([ch0, ch1]);

    const result0 = getInt16Samples(buffer, 0);
    const result1 = getInt16Samples(buffer, 1);

    expect(result0[0]).toBe(Math.floor(0.5 * 0x7fff));
    expect(result1[0]).toBe(-16384);
  });

  it("returns Int16Array", () => {
    const buffer = createMockAudioBuffer([new Float32Array([0.0, 0.5])]);
    const result = getInt16Samples(buffer, 0);

    expect(result).toBeInstanceOf(Int16Array);
  });

  it("handles empty channel data", () => {
    const buffer = createMockAudioBuffer([new Float32Array([])]);
    const result = getInt16Samples(buffer, 0);

    expect(result.length).toBe(0);
  });
});
