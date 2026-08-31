import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  `computeWaveform` is canvas decoration, and the trade it encodes is easy to
  undo by accident: routing it through `decodeAudioFile` would make it agree
  with the conversion path, at the price of speculatively pulling the ~31 MB
  FFmpeg core for a file the user has merely dropped, and of queueing a
  throwaway transcode in front of the real job on FFmpeg's serialised
  singleton. The module comment spells that out; these mocks are the tripwire.
  If a change makes them fire, read that comment before deleting the test.
*/
const mockRunFFmpegTask = vi.fn();
vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  runFFmpegTask: mockRunFFmpegTask,
  fileToUint8Array: vi.fn(),
  getFFmpeg: vi.fn(),
  terminateFFmpeg: vi.fn(),
  validateFFmpegInput: vi.fn(),
}));

const mockDecodeAudioFile = vi.fn();
vi.mock("@/lib/tools/audio-decode", () => ({
  decodeAudioFile: mockDecodeAudioFile,
  sniffSampleRate: vi.fn(),
  getInt16Samples: vi.fn(),
}));

const mockDecodeAudioData = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);
const MockAudioContext = vi.fn(function () {
  return { decodeAudioData: mockDecodeAudioData, close: mockClose };
});

import { computeWaveform, toPageRange, parsePageRange } from "@/lib/tools/media-preview";

/** An AudioBuffer stub carrying one channel of the given samples. */
function bufferOf(samples: number[], duration = 3.5): AudioBuffer {
  const data = new Float32Array(samples);
  return {
    numberOfChannels: 1,
    length: data.length,
    sampleRate: 44100,
    duration,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

describe("computeWaveform", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("AudioContext", MockAudioContext);
    mockClose.mockResolvedValue(undefined);
    mockDecodeAudioData.mockResolvedValue(bufferOf([0, 0.25, -0.5, 1, 0, -0.25]));
  });

  it("returns exactly `bars` peaks", async () => {
    const file = new File(["audio"], "clip.wav", { type: "audio/wav" });
    const { peaks } = await computeWaveform(file, 3);

    expect(peaks).toHaveLength(3);
  });

  it("reduces each block to its absolute peak", async () => {
    // Six samples over three bars → blocks [0, .25] [-.5, 1] [0, -.25],
    // peaks .25 / 1 / .25, already normalised against the loudest bar.
    const file = new File(["audio"], "clip.wav", { type: "audio/wav" });
    const { peaks } = await computeWaveform(file, 3);

    expect(peaks[0]).toBeCloseTo(0.25, 5);
    expect(peaks[1]).toBeCloseTo(1, 5);
    expect(peaks[2]).toBeCloseTo(0.25, 5);
  });

  it("normalises a quiet recording so its loudest bar reaches 1", async () => {
    mockDecodeAudioData.mockResolvedValue(bufferOf([0.01, 0.02, 0.005, 0.0025]));
    const file = new File(["audio"], "quiet.wav", { type: "audio/wav" });
    const { peaks } = await computeWaveform(file, 2);

    expect(Math.max(...peaks)).toBeCloseTo(1, 5);
    expect(peaks[1]).toBeCloseTo(0.25, 5);
  });

  it("does not divide by zero on pure silence", async () => {
    mockDecodeAudioData.mockResolvedValue(bufferOf([0, 0, 0, 0]));
    const file = new File(["audio"], "silence.wav", { type: "audio/wav" });
    const { peaks } = await computeWaveform(file, 4);

    expect(peaks.every((p) => p === 0)).toBe(true);
  });

  it("reports the decoded duration, not the container's estimate", async () => {
    mockDecodeAudioData.mockResolvedValue(bufferOf([0, 1], 12.75));
    const file = new File(["audio"], "vbr.mp3", { type: "audio/mpeg" });

    await expect(computeWaveform(file, 2)).resolves.toMatchObject({ duration: 12.75 });
  });

  it("closes the AudioContext on success", async () => {
    const file = new File(["audio"], "clip.wav", { type: "audio/wav" });
    await computeWaveform(file, 4);

    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("closes the AudioContext when the decode rejects", async () => {
    mockDecodeAudioData.mockRejectedValue(new Error("Unsupported format"));
    const file = new File(["audio"], "clip.m4a", { type: "audio/mp4" });

    await expect(computeWaveform(file, 4)).rejects.toThrow("Unsupported format");
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("fails loudly when Web Audio is missing rather than drawing nothing", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const file = new File(["audio"], "clip.wav", { type: "audio/wav" });

    await expect(computeWaveform(file, 4)).rejects.toThrow("Web Audio is unavailable");
  });

  it("uses webkitAudioContext where that is the only constructor", async () => {
    vi.stubGlobal("AudioContext", undefined);
    vi.stubGlobal("webkitAudioContext", MockAudioContext);
    const file = new File(["audio"], "clip.wav", { type: "audio/wav" });

    await expect(computeWaveform(file, 2)).resolves.toBeTruthy();
    vi.stubGlobal("webkitAudioContext", undefined);
  });

  /*
    The trade, pinned. A container the browser cannot decode (m4a in Firefox,
    Ogg in Safari) is exactly where `decodeAudioFile` reaches for FFmpeg; the
    preview must not, or dropping a file downloads ~31 MB for decoration and
    queues a transcode ahead of the conversion the user actually wants.
  */
  it("never falls back to FFmpeg for an undecodable container", async () => {
    mockDecodeAudioData.mockRejectedValue(new Error("Unsupported format"));
    const file = new File(["audio"], "podcast.m4a", { type: "audio/mp4" });

    await expect(computeWaveform(file, 8)).rejects.toThrow();
    expect(mockRunFFmpegTask).not.toHaveBeenCalled();
    expect(mockDecodeAudioFile).not.toHaveBeenCalled();
  });
});

describe("toPageRange", () => {
  it("marks an empty selection with an em dash", () => {
    expect(toPageRange([])).toBe("—");
  });

  it("collapses a consecutive run into a range", () => {
    expect(toPageRange([1, 2, 3])).toBe("1-3");
  });

  it("keeps isolated pages separate and sorts the input", () => {
    expect(toPageRange([8, 1, 5, 9, 2, 10, 3])).toBe("1-3, 5, 8-10");
  });

  it("writes a two-page run as a range, not a pair", () => {
    expect(toPageRange([4, 5])).toBe("4-5");
  });
});

describe("parsePageRange", () => {
  it("returns zero-based indices", () => {
    expect([...parsePageRange("1", 10)]).toEqual([0]);
  });

  it("round-trips the compact notation", () => {
    expect([...parsePageRange("1-3, 5, 8-10", 10)].sort((a, b) => a - b)).toEqual([
      0, 1, 2, 4, 7, 8, 9,
    ]);
  });

  it("clamps a range that runs past the end of the document", () => {
    expect([...parsePageRange("2-99", 4)].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("drops page 0 and other out-of-range numbers", () => {
    expect([...parsePageRange("0, 5", 3)]).toEqual([]);
  });

  it("ignores junk between the commas", () => {
    expect([...parsePageRange("2, banana, 3", 5)].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("tolerates whitespace around the dash", () => {
    expect([...parsePageRange(" 2 - 4 ", 6)].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });
});
