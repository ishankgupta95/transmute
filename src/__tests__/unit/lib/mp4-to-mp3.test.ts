import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockWriteFile, mockExec, mockReadFile, mockDeleteFile } = vi.hoisted(() => ({
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockExec: vi.fn().mockResolvedValue(0),
  mockReadFile: vi.fn().mockResolvedValue(new Uint8Array([0xff, 0xfb])),
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
}));

/**
 * `runFFmpegTask` owns the queue, the scoped progress handler and the
 * terminate-on-abort wiring; from a tool's point of view it just hands over a
 * loaded instance, so the fake runs the task against the mock FFmpeg.
 */
vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  validateVideoFileSize: vi.fn(),
  runFFmpegTask: vi.fn((task: (ffmpeg: unknown) => Promise<unknown>) =>
    task({
      writeFile: mockWriteFile,
      exec: mockExec,
      readFile: mockReadFile,
      deleteFile: mockDeleteFile,
    }),
  ),
  fileToUint8Array: vi.fn().mockResolvedValue(new Uint8Array([0x00])),
}));

import { mp4ToMp3 } from "@/lib/tools/mp4-to-mp3";

describe("mp4ToMp3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockResolvedValue(0);
    mockReadFile.mockResolvedValue(new Uint8Array([0xff, 0xfb]));
  });

  it("returns a result with .mp3 extension", async () => {
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });
    const result = await mp4ToMp3(file, { bitrate: 192 });

    expect(result.fileName).toBe("video.mp3");
    expect(result.blob.type).toBe("audio/mpeg");
  });

  it("passes correct bitrate to FFmpeg", async () => {
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });
    await mp4ToMp3(file, { bitrate: 320 });

    const args = mockExec.mock.calls[0][0] as string[];
    expect(args).toContain("-vn");
    expect(args).toContain("-b:a");
    expect(args).toContain("320k");
  });

  it("throws when FFmpeg returns non-zero", async () => {
    mockExec.mockResolvedValueOnce(1);
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });

    await expect(mp4ToMp3(file, { bitrate: 192 })).rejects.toThrow("FFmpeg audio extraction failed");
  });

  it("cleans up temporary files", async () => {
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });
    await mp4ToMp3(file, { bitrate: 192 });

    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
  });
});
