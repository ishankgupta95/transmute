import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockWriteFile,
  mockExec,
  mockReadFile,
  mockDeleteFile,
  mockMountInputFile,
  mockUnmountInputFile,
  mockValidateFFmpegInput,
} = vi.hoisted(() => ({
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMountInputFile: vi.fn(),
  mockUnmountInputFile: vi.fn().mockResolvedValue(undefined),
  mockValidateFFmpegInput: vi.fn(),
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
  validateFFmpegInput: mockValidateFFmpegInput,
  runFFmpegTask: vi.fn((task: (ffmpeg: unknown) => Promise<unknown>) =>
    task({
      writeFile: mockWriteFile,
      exec: mockExec,
      readFile: mockReadFile,
      deleteFile: mockDeleteFile,
    }),
  ),
  // The source is MOUNTED, never written: `mountInputFile` answers with the
  // virtual path FFmpeg is handed as `-i`.
  mountInputFile: mockMountInputFile.mockImplementation(
    (_ffmpeg: unknown, _file: File, name: string) => Promise.resolve(`/mnt-input/${name}`),
  ),
  unmountInputFile: mockUnmountInputFile,
}));

import { mp4ToMp3 } from "@/lib/tools/mp4-to-mp3";

describe("mp4ToMp3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockResolvedValue(0);
    mockReadFile.mockResolvedValue(new Uint8Array([0xff, 0xfb]));
    mockMountInputFile.mockImplementation((_ffmpeg: unknown, _file: File, name: string) =>
      Promise.resolve(`/mnt-input/${name}`),
    );
    mockDeleteFile.mockResolvedValue(undefined);
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

  it("falls back to a real input extension for a dot-less filename", async () => {
    // "myclip" used to become "inputmyclip", leaving FFmpeg no demuxer hint.
    const file = new File(["video"], "myclip", { type: "video/mp4" });
    const result = await mp4ToMp3(file, { bitrate: 192 });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.mp4");
    expect(result.fileName).toBe("myclip.mp3");
  });

  it("falls back to .webm for a dot-less WebM", async () => {
    const file = new File(["video"], "recording", { type: "video/webm" });
    await mp4ToMp3(file, { bitrate: 192 });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.webm");
  });

  it("validates as an audio-extract job, which carries no size cap", async () => {
    // Passing "stream-copy" here would re-impose a 1.5 GB limit on a job that
    // provably does not need one (a 2500 MB source was verified to extract).
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });
    await mp4ToMp3(file, { bitrate: 192 });

    expect(mockValidateFFmpegInput).toHaveBeenCalledWith(file, "audio-extract");
  });

  it("mounts the source instead of copying its bytes into the FS", async () => {
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });
    await mp4ToMp3(file, { bitrate: 192 });

    expect(mockExec.mock.calls[0][0]).toContain("/mnt-input/input.mp4");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("cleans up the output and releases the mounted source", async () => {
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });
    await mp4ToMp3(file, { bitrate: 192 });

    // Only the output is a real MEMFS file now; the input is a mount.
    expect(mockDeleteFile).toHaveBeenCalledTimes(1);
    expect(mockDeleteFile).toHaveBeenCalledWith("output.mp3");
    expect(mockUnmountInputFile).toHaveBeenCalledTimes(1);
  });

  it("unmounts the source even when FFmpeg fails", async () => {
    mockExec.mockResolvedValueOnce(1);
    const file = new File(["video"], "video.mp4", { type: "video/mp4" });

    await expect(mp4ToMp3(file, { bitrate: 192 })).rejects.toThrow();
    expect(mockUnmountInputFile).toHaveBeenCalled();
  });
});
