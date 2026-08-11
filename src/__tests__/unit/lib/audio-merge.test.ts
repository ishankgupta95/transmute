import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock audio modules
vi.mock("@/lib/tools/audio-decode", () => ({
  decodeAudioFile: vi.fn(),
}));

// Encodes route through the worker-pool client (Phase 3); the pure encoders
// have their own coverage — these tests only care the right encode is reached.
vi.mock("@/lib/workers/audio-client", () => ({
  encodeWav: vi.fn(async () => new Blob(["wav-data"], { type: "audio/wav" })),
  encodeMp3: vi.fn(async () => new Blob(["mp3-data"], { type: "audio/mpeg" })),
}));

vi.mock("@/lib/tools/audio-encode-mp3", () => ({
  // Pass-through: rate handling has its own coverage.
  resampleForMp3: vi.fn(async (buffer: AudioBuffer) => buffer),
}));

// Mock OfflineAudioContext
function MockOfflineAudioContext(channels: number, length: number, sampleRate: number) {
  const channelData: Float32Array[] = [];
  for (let i = 0; i < channels; i++) {
    channelData.push(new Float32Array(length));
  }
  const mockBuffer = {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => channelData[ch],
  };
  return {
    createBuffer: vi.fn().mockReturnValue(mockBuffer),
    createBufferSource: vi.fn().mockReturnValue({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
    }),
    destination: {},
    startRendering: vi.fn().mockResolvedValue(mockBuffer),
  };
}
vi.stubGlobal("OfflineAudioContext", MockOfflineAudioContext);

import { mergeAudio } from "@/lib/tools/audio-merge";
import { decodeAudioFile } from "@/lib/tools/audio-decode";
import { encodeWav, encodeMp3 } from "@/lib/workers/audio-client";

function createMockAudioBuffer(
  channels: number,
  durationSecs: number,
  sampleRate: number,
  channelDataArrays?: Float32Array[],
): AudioBuffer {
  const length = Math.floor(durationSecs * sampleRate);
  const channelData: Float32Array[] = channelDataArrays ?? [];
  if (!channelDataArrays) {
    for (let i = 0; i < channels; i++) {
      channelData.push(new Float32Array(length));
    }
  }
  return {
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: durationSecs,
    getChannelData: (ch: number) => channelData[ch],
  } as unknown as AudioBuffer;
}

describe("mergeAudio", () => {
  const file1 = new File(["audio1"], "track1.mp3", { type: "audio/mpeg" });
  const file2 = new File(["audio2"], "track2.mp3", { type: "audio/mpeg" });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decodeAudioFile)
      .mockResolvedValueOnce(createMockAudioBuffer(2, 5, 44100))
      .mockResolvedValueOnce(createMockAudioBuffer(2, 5, 44100));
  });

  it("throws if fewer than 2 files provided", async () => {
    await expect(
      mergeAudio([file1], { outputFormat: "wav" }),
    ).rejects.toThrow("At least 2 files required");
  });

  it("decodes all input files", async () => {
    await mergeAudio([file1, file2], { outputFormat: "wav" });

    expect(decodeAudioFile).toHaveBeenCalledTimes(2);
    expect(decodeAudioFile).toHaveBeenCalledWith(file1);
    expect(decodeAudioFile).toHaveBeenCalledWith(file2);
  });

  it("outputs WAV when outputFormat is wav", async () => {
    const result = await mergeAudio([file1, file2], { outputFormat: "wav" });

    expect(encodeWav).toHaveBeenCalled();
    expect(result.fileName).toBe("merged.wav");
  });

  it("outputs MP3 when outputFormat is mp3", async () => {
    const result = await mergeAudio([file1, file2], { outputFormat: "mp3", bitrate: 320 });

    expect(encodeMp3).toHaveBeenCalledWith(expect.anything(), 320, expect.anything());
    expect(result.fileName).toBe("merged.mp3");
  });

  it("uses default bitrate 192 for mp3", async () => {
    await mergeAudio([file1, file2], { outputFormat: "mp3" });

    expect(encodeMp3).toHaveBeenCalledWith(expect.anything(), 192, expect.anything());
  });

  it("returns combined originalSize from all input files", async () => {
    const result = await mergeAudio([file1, file2], { outputFormat: "wav" });

    expect(result.originalSize).toBe(file1.size + file2.size);
  });

  it("returns correct ProcessedResult shape", async () => {
    const result = await mergeAudio([file1, file2], { outputFormat: "wav" });

    expect(result).toHaveProperty("blob");
    expect(result).toHaveProperty("fileName");
    expect(result).toHaveProperty("originalSize");
    expect(result).toHaveProperty("newSize");
  });

  it("handles files with different sample rates", async () => {
    vi.mocked(decodeAudioFile)
      .mockReset()
      .mockResolvedValueOnce(createMockAudioBuffer(2, 3, 44100))
      .mockResolvedValueOnce(createMockAudioBuffer(2, 3, 22050));

    const result = await mergeAudio([file1, file2], { outputFormat: "wav" });

    // Should still produce a valid result
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it("concatenates sample data from both buffers in order", async () => {
    // Buffer1: 3 samples, channel 0 = [1,2,3], channel 1 = [10,20,30]
    const buf1Ch0 = new Float32Array([1, 2, 3]);
    const buf1Ch1 = new Float32Array([10, 20, 30]);
    const buf1 = createMockAudioBuffer(2, 3 / 44100, 44100, [buf1Ch0, buf1Ch1]);

    // Buffer2: 3 samples, channel 0 = [4,5,6], channel 1 = [40,50,60]
    const buf2Ch0 = new Float32Array([4, 5, 6]);
    const buf2Ch1 = new Float32Array([40, 50, 60]);
    const buf2 = createMockAudioBuffer(2, 3 / 44100, 44100, [buf2Ch0, buf2Ch1]);

    vi.mocked(decodeAudioFile)
      .mockReset()
      .mockResolvedValueOnce(buf1)
      .mockResolvedValueOnce(buf2);

    let capturedBuffer: AudioBuffer | null = null;
    vi.mocked(encodeWav).mockImplementation(async (buf: AudioBuffer) => {
      capturedBuffer = buf;
      return new Blob(["wav-data"], { type: "audio/wav" });
    });

    await mergeAudio([file1, file2], { outputFormat: "wav" });

    expect(capturedBuffer).not.toBeNull();
    expect(capturedBuffer!.length).toBe(6);

    const ch0 = capturedBuffer!.getChannelData(0);
    expect(Array.from(ch0)).toEqual([1, 2, 3, 4, 5, 6]);

    const ch1 = capturedBuffer!.getChannelData(1);
    expect(Array.from(ch1)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("concatenates three buffers in the correct order", async () => {
    const buf1 = createMockAudioBuffer(1, 2 / 44100, 44100, [new Float32Array([1, 2])]);
    const buf2 = createMockAudioBuffer(1, 2 / 44100, 44100, [new Float32Array([3, 4])]);
    const buf3 = createMockAudioBuffer(1, 2 / 44100, 44100, [new Float32Array([5, 6])]);

    const file3 = new File(["audio3"], "track3.mp3", { type: "audio/mpeg" });

    vi.mocked(decodeAudioFile)
      .mockReset()
      .mockResolvedValueOnce(buf1)
      .mockResolvedValueOnce(buf2)
      .mockResolvedValueOnce(buf3);

    let capturedBuffer: AudioBuffer | null = null;
    vi.mocked(encodeWav).mockImplementation(async (buf: AudioBuffer) => {
      capturedBuffer = buf;
      return new Blob(["wav-data"], { type: "audio/wav" });
    });

    await mergeAudio([file1, file2, file3], { outputFormat: "wav" });

    expect(capturedBuffer).not.toBeNull();
    expect(capturedBuffer!.length).toBe(6);

    const ch0 = capturedBuffer!.getChannelData(0);
    expect(Array.from(ch0)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
