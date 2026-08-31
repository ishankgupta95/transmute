import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the audio modules
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

  it("clamps an end time beyond the decoded duration instead of throwing", async () => {
    // 10s buffer; endTime 15 should clamp to the buffer length, not reject.
    const result = await trimAudio(mockFile, { startTime: 0, endTime: 15, outputFormat: "wav" });
    expect(result.fileName).toMatch(/\.wav$/);
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it("throws when the selected range is empty", async () => {
    await expect(
      trimAudio(mockFile, { startTime: 10, endTime: 12, outputFormat: "wav" }),
    ).rejects.toThrow("Selected range is empty");
  });

  it("decodes the input file, forwarding the cancellation context", async () => {
    // The decode is the long half of a trim on a large file; if the signal
    // stops here, Cancel does nothing until the encode finally starts.
    const { signal } = new AbortController();
    await trimAudio(mockFile, { startTime: 2, endTime: 5, outputFormat: "wav" }, { signal });

    expect(decodeAudioFile).toHaveBeenCalledWith(mockFile, expect.objectContaining({ signal }));
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

    expect(encodeWav).toHaveBeenCalled();
    expect(result.fileName).toBe("test-trimmed.wav");
  });

  it("outputs MP3 when outputFormat is mp3", async () => {
    const result = await trimAudio(mockFile, { startTime: 0, endTime: 5, outputFormat: "mp3", bitrate: 256 });

    expect(encodeMp3).toHaveBeenCalledWith(expect.anything(), 256, expect.anything());
    expect(result.fileName).toBe("test-trimmed.mp3");
  });

  it("uses default bitrate 192 for mp3 when not specified", async () => {
    await trimAudio(mockFile, { startTime: 0, endTime: 5, outputFormat: "mp3" });

    expect(encodeMp3).toHaveBeenCalledWith(expect.anything(), 192, expect.anything());
  });

  it("returns correct ProcessedResult shape", async () => {
    const result = await trimAudio(mockFile, { startTime: 1, endTime: 4, outputFormat: "wav" });

    expect(result).toHaveProperty("blob");
    expect(result).toHaveProperty("fileName");
    expect(result).toHaveProperty("originalSize");
    expect(result).toHaveProperty("newSize");
    expect(result.originalSize).toBe(mockFile.size);
  });

  it("copies the correct slice of samples from source to trimmed buffer", async () => {
    // Use sampleRate=10 for simplicity: 10 samples per second, 100 samples for 10s
    const sampleRate = 10;
    const totalSamples = 100; // 10 seconds * 10 samples/sec

    // Fill channel 0 with 0.0, 0.01, 0.02, ..., 0.99
    const ch0Data = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      ch0Data[i] = i / 100;
    }
    // Fill channel 1 with 1.0, 1.01, 1.02, ..., 1.99
    const ch1Data = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      ch1Data[i] = 1 + i / 100;
    }

    const sourceBuffer = createMockAudioBuffer(2, 10, sampleRate, [ch0Data, ch1Data]);
    vi.mocked(decodeAudioFile).mockReset().mockResolvedValue(sourceBuffer);

    let capturedBuffer: AudioBuffer | null = null;
    vi.mocked(encodeWav).mockImplementation(async (buf: AudioBuffer) => {
      capturedBuffer = buf;
      return new Blob(["wav-data"], { type: "audio/wav" });
    });

    // Trim from 2s to 5s: startSample=20, endSample=50, length=30
    await trimAudio(mockFile, { startTime: 2, endTime: 5, outputFormat: "wav" });

    expect(capturedBuffer).not.toBeNull();
    expect(capturedBuffer!.length).toBe(30);

    const trimmedCh0 = capturedBuffer!.getChannelData(0);
    const trimmedCh1 = capturedBuffer!.getChannelData(1);

    // Verify channel 0 contains samples[20..49] from source
    const expectedCh0 = Array.from(ch0Data.slice(20, 50));
    expect(Array.from(trimmedCh0)).toEqual(expectedCh0);

    // Verify channel 1 contains samples[20..49] from source
    const expectedCh1 = Array.from(ch1Data.slice(20, 50));
    expect(Array.from(trimmedCh1)).toEqual(expectedCh1);
  });
});

describe("trimAudio input validation", () => {
  it("rejects non-finite trim times before touching the decoder", async () => {
    const file = new File(["not audio"], "a.wav", { type: "audio/wav" });
    await expect(
      trimAudio(file, { startTime: NaN, endTime: 1, outputFormat: "wav" }),
    ).rejects.toThrow("Trim times must be numbers");
    await expect(
      trimAudio(file, { startTime: 0, endTime: Infinity, outputFormat: "wav" }),
    ).rejects.toThrow("Trim times must be numbers");
  });
});
