import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the audio modules
vi.mock("@/lib/tools/audio-decode", () => ({
  decodeAudioFile: vi.fn(),
}));

vi.mock("@/lib/tools/audio-encode-wav", () => ({
  encodeToWav: vi.fn().mockReturnValue(new Blob(["wav-data"], { type: "audio/wav" })),
}));

vi.mock("@/lib/tools/audio-encode-mp3", () => ({
  encodeToMp3: vi.fn().mockReturnValue(new Blob(["mp3-data"], { type: "audio/mpeg" })),
}));

// Must mock OfflineAudioContext since jsdom doesn't have it
const mockCreateBuffer = vi.fn();

function MockOfflineAudioContext(channels: number, length: number, sampleRate: number) {
  return {
    createBuffer: mockCreateBuffer.mockImplementation(() => {
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
      };
    }),
  };
}
vi.stubGlobal("OfflineAudioContext", MockOfflineAudioContext);

import { trimAudio } from "@/lib/tools/audio-trim";
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

describe("trimAudio", () => {
  const mockFile = new File(["audio-data"], "test.mp3", { type: "audio/mpeg" });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decodeAudioFile).mockResolvedValue(
      createMockAudioBuffer(2, 10, 44100),
    );
  });

  it("throws if start time >= end time", async () => {
    await expect(
      trimAudio(mockFile, { startTime: 5, endTime: 3, outputFormat: "wav" }),
    ).rejects.toThrow("Start time must be before end time");
  });

  it("throws if end time exceeds duration", async () => {
    await expect(
      trimAudio(mockFile, { startTime: 0, endTime: 15, outputFormat: "wav" }),
    ).rejects.toThrow("End time exceeds audio duration");
  });

  it("decodes the input file", async () => {
    await trimAudio(mockFile, { startTime: 2, endTime: 5, outputFormat: "wav" });

    expect(decodeAudioFile).toHaveBeenCalledWith(mockFile);
  });

  it("creates OfflineAudioContext with correct trimmed length", async () => {
    await trimAudio(mockFile, { startTime: 2, endTime: 5, outputFormat: "wav" });

    const expectedLength = Math.floor(3 * 44100); // 3 seconds
    // OfflineAudioContext is a plain function mock, verify via mockCreateBuffer calls
    expect(mockCreateBuffer).toHaveBeenCalled();
    const bufferResult = mockCreateBuffer.mock.results[0]?.value;
    expect(bufferResult.numberOfChannels).toBe(2);
    expect(bufferResult.length).toBe(expectedLength);
  });

  it("outputs WAV when outputFormat is wav", async () => {
    const result = await trimAudio(mockFile, { startTime: 0, endTime: 5, outputFormat: "wav" });

    expect(encodeToWav).toHaveBeenCalled();
    expect(result.fileName).toBe("test-trimmed.wav");
  });

  it("outputs MP3 when outputFormat is mp3", async () => {
    const result = await trimAudio(mockFile, { startTime: 0, endTime: 5, outputFormat: "mp3", bitrate: 256 });

    expect(encodeToMp3).toHaveBeenCalledWith(expect.anything(), 256);
    expect(result.fileName).toBe("test-trimmed.mp3");
  });

  it("uses default bitrate 192 for mp3 when not specified", async () => {
    await trimAudio(mockFile, { startTime: 0, endTime: 5, outputFormat: "mp3" });

    expect(encodeToMp3).toHaveBeenCalledWith(expect.anything(), 192);
  });

  it("returns correct ProcessedResult shape", async () => {
    const result = await trimAudio(mockFile, { startTime: 1, endTime: 4, outputFormat: "wav" });

    expect(result).toHaveProperty("blob");
    expect(result).toHaveProperty("fileName");
    expect(result).toHaveProperty("originalSize");
    expect(result).toHaveProperty("newSize");
    expect(result.originalSize).toBe(mockFile.size);
  });
});
