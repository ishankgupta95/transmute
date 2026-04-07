import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockWriteFile, mockExec, mockReadFile, mockDeleteFile } = vi.hoisted(() => ({
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockExec: vi.fn().mockResolvedValue(0),
  mockReadFile: vi.fn().mockResolvedValue(new Uint8Array([0x00, 0x00, 0x00])),
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
}));

const mockValidateVideoFileSize = vi.hoisted(() => vi.fn());
const mockGetFFmpeg = vi.hoisted(() => vi.fn());
const mockFileToUint8Array = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  validateVideoFileSize: mockValidateVideoFileSize,
  getFFmpeg: mockGetFFmpeg.mockResolvedValue({
    writeFile: mockWriteFile,
    exec: mockExec,
    readFile: mockReadFile,
    deleteFile: mockDeleteFile,
  }),
  fileToUint8Array: mockFileToUint8Array.mockResolvedValue(new Uint8Array([0x00])),
}));

import { trimVideo } from "@/lib/tools/video-trim";

describe("trimVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockResolvedValue(0);
    mockReadFile.mockResolvedValue(new Uint8Array([0x00, 0x00, 0x00]));
  });

  it("calls validateVideoFileSize with the file", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockValidateVideoFileSize).toHaveBeenCalledWith(file);
  });

  it("throws if validateVideoFileSize throws", async () => {
    mockValidateVideoFileSize.mockImplementationOnce(() => {
      throw new Error("File too large");
    });
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    await expect(trimVideo(file, { startTime: 0, endTime: 5 })).rejects.toThrow("File too large");
  });

  it("passes progress callback to getFFmpeg", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const onProgress = vi.fn();
    await trimVideo(file, { startTime: 0, endTime: 5 }, onProgress);

    expect(mockGetFFmpeg).toHaveBeenCalledWith(onProgress);
  });

  it("writes input file to FFmpeg filesystem", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockWriteFile).toHaveBeenCalledWith("input.mp4", expect.any(Uint8Array));
    expect(mockFileToUint8Array).toHaveBeenCalledWith(file);
  });

  it("passes correct FFmpeg args with -ss, -t, and -c copy", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 10, endTime: 25 });

    const args = mockExec.mock.calls[0][0] as string[];
    expect(args).toContain("-i");
    expect(args).toContain("input.mp4");
    expect(args).toContain("-ss");
    expect(args).toContain("10");
    expect(args).toContain("-t");
    expect(args).toContain("15"); // endTime - startTime
    expect(args).toContain("-c");
    expect(args).toContain("copy");
    expect(args).toContain("output.mp4");
  });

  it("calculates duration correctly from startTime and endTime", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 3.5, endTime: 7.2 });

    const args = mockExec.mock.calls[0][0] as string[];
    const tIndex = args.indexOf("-t");
    expect(args[tIndex + 1]).toBe(String(7.2 - 3.5));
  });

  it("throws on non-zero FFmpeg return code", async () => {
    mockExec.mockResolvedValueOnce(1);
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    await expect(trimVideo(file, { startTime: 0, endTime: 5 })).rejects.toThrow("FFmpeg trimming failed");
  });

  it("cleans up both input and output temp files", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    expect(mockDeleteFile).toHaveBeenCalledWith("input.mp4");
    expect(mockDeleteFile).toHaveBeenCalledWith("output.mp4");
  });

  it("output filename has -trimmed suffix", async () => {
    const file = new File(["video"], "my-video.mp4", { type: "video/mp4" });
    const result = await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(result.fileName).toBe("my-video-trimmed.mp4");
  });

  it("preserves .webm extension", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockWriteFile).toHaveBeenCalledWith("input.webm", expect.any(Uint8Array));
    expect(mockExec.mock.calls[0][0]).toContain("output.webm");

    const result = await trimVideo(file, { startTime: 0, endTime: 5 });
    expect(result.fileName).toBe("recording-trimmed.webm");
  });

  it("preserves .avi extension", async () => {
    const file = new File(["video"], "old-video.avi", { type: "video/avi" });
    const result = await trimVideo(file, { startTime: 1, endTime: 3 });

    expect(result.fileName).toBe("old-video-trimmed.avi");
  });

  it("returns correct ProcessedResult shape", async () => {
    const file = new File(["video-data-content"], "clip.mp4", { type: "video/mp4" });
    const result = await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(result).toHaveProperty("blob");
    expect(result).toHaveProperty("fileName");
    expect(result).toHaveProperty("originalSize");
    expect(result).toHaveProperty("newSize");
    expect(result.originalSize).toBe(file.size);
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it("uses file type for blob, defaults to video/mp4 when empty", async () => {
    const fileWithType = new File(["video"], "clip.webm", { type: "video/webm" });
    const result1 = await trimVideo(fileWithType, { startTime: 0, endTime: 5 });
    expect(result1.blob.type).toBe("video/webm");

    const fileNoType = new File(["video"], "clip.mp4", { type: "" });
    const result2 = await trimVideo(fileNoType, { startTime: 0, endTime: 5 });
    expect(result2.blob.type).toBe("video/mp4");
  });

  it("reads output file from FFmpeg filesystem", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockReadFile).toHaveBeenCalledWith("output.mp4");
  });
});
