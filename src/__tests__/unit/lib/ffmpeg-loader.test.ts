import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoad = vi.fn().mockResolvedValue(true);
const mockOn = vi.fn();

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.loaded = false;
    this.load = mockLoad;
    this.on = mockOn;
  }),
}));

vi.mock("@ffmpeg/util", () => ({
  toBlobURL: vi.fn().mockResolvedValue("blob:mock"),
}));

describe("validateVideoFileSize", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("throws for files over 100MB", async () => {
    const { validateVideoFileSize } = await import("@/lib/tools/ffmpeg-loader");
    const largeFile = new File(["x"], "video.mp4", { type: "video/mp4" });
    Object.defineProperty(largeFile, "size", { value: 101 * 1024 * 1024 });

    expect(() => validateVideoFileSize(largeFile)).toThrow("too large");
  });

  it("does not throw for files under 100MB", async () => {
    const { validateVideoFileSize } = await import("@/lib/tools/ffmpeg-loader");
    const smallFile = new File(["x"], "video.mp4", { type: "video/mp4" });
    Object.defineProperty(smallFile, "size", { value: 50 * 1024 * 1024 });

    expect(() => validateVideoFileSize(smallFile)).not.toThrow();
  });

  it("does not throw for files at exactly 100MB", async () => {
    const { validateVideoFileSize } = await import("@/lib/tools/ffmpeg-loader");
    const file = new File(["x"], "video.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: 100 * 1024 * 1024 });

    expect(() => validateVideoFileSize(file)).not.toThrow();
  });
});

describe("fileToUint8Array", () => {
  it("converts a File to Uint8Array", async () => {
    const { fileToUint8Array } = await import("@/lib/tools/ffmpeg-loader");
    const content = new Uint8Array([1, 2, 3, 4, 5]);
    const file = new File([content], "test.mp4");

    const result = await fileToUint8Array(file);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(5);
    expect(result[0]).toBe(1);
    expect(result[4]).toBe(5);
  });
});

describe("getFFmpeg", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates and loads FFmpeg instance", async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { getFFmpeg } = await import("@/lib/tools/ffmpeg-loader");
    await getFFmpeg();

    expect(FFmpeg).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it("attaches progress listener when callback provided", async () => {
    const { getFFmpeg } = await import("@/lib/tools/ffmpeg-loader");
    const progressFn = vi.fn();
    await getFFmpeg(progressFn);

    expect(mockOn).toHaveBeenCalledWith("progress", expect.any(Function));
  });
});
