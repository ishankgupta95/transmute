import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock audio modules
vi.mock("@/lib/tools/audio-decode", () => ({
  decodeAudioFile: vi.fn(),
}));

vi.mock("@/lib/tools/audio-encode-wav", () => ({
  encodeToWav: vi.fn().mockReturnValue(new Blob(["wav-data"], { type: "audio/wav" })),
}));

vi.mock("@/lib/tools/audio-encode-mp3", () => ({
  encodeToMp3: vi.fn().mockReturnValue(new Blob(["mp3-data"], { type: "audio/mpeg" })),
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
import { encodeToWav } from "@/lib/tools/audio-encode-wav";
import { encodeToMp3 } from "@/lib/tools/audio-encode-mp3";

function createMockAudioBuffer(
  channels: number,
  durationSecs: number,
  sampleRate: number,
): AudioBuffer {
  const length = Math.floor(durationSecs * sampleRate);
  const channelData: Float32Array[] = [];
  for (let i = 0; i < channels; i++) {
    channelData.push(new Float32Array(length));
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

    expect(encodeToWav).toHaveBeenCalled();
    expect(result.fileName).toBe("merged.wav");
  });

  it("outputs MP3 when outputFormat is mp3", async () => {
    const result = await mergeAudio([file1, file2], { outputFormat: "mp3", bitrate: 320 });

    expect(encodeToMp3).toHaveBeenCalledWith(expect.anything(), 320);
    expect(result.fileName).toBe("merged.mp3");
  });

  it("uses default bitrate 192 for mp3", async () => {
    await mergeAudio([file1, file2], { outputFormat: "mp3" });

    expect(encodeToMp3).toHaveBeenCalledWith(expect.anything(), 192);
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
});
