import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockWriteFile, mockExec, mockReadFile, mockDeleteFile, mockFfprobe } = vi.hoisted(() => ({
  mockFfprobe: vi.fn().mockResolvedValue(-1),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockExec: vi.fn().mockResolvedValue(0),
  mockReadFile: vi.fn().mockResolvedValue(new Uint8Array([0x00, 0x00, 0x00])),
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
}));

const mockValidateFFmpegInput = vi.hoisted(() => vi.fn());
const { mockMountInputFile, mockUnmountInputFile } = vi.hoisted(() => ({
  mockMountInputFile: vi.fn(),
  mockUnmountInputFile: vi.fn().mockResolvedValue(undefined),
}));

/**
 * `runFFmpegTask` owns the queue, the scoped progress handler and the
 * terminate-on-abort wiring; from a tool's point of view it just hands over a
 * loaded instance, so the fake runs the task against the mock FFmpeg.
 */
const mockRunFFmpegTask = vi.hoisted(() =>
  vi.fn(),
);

vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  validateFFmpegInput: mockValidateFFmpegInput,
  runFFmpegTask: mockRunFFmpegTask.mockImplementation(
    (task: (ffmpeg: unknown) => Promise<unknown>) =>
      task({
        writeFile: mockWriteFile,
        exec: mockExec,
        readFile: mockReadFile,
        deleteFile: mockDeleteFile,
        ffprobe: mockFfprobe,
      }),
  ),
  // The source is MOUNTED, never written: `mountInputFile` answers with the
  // virtual path FFmpeg is handed as `-i`.
  mountInputFile: mockMountInputFile.mockImplementation(
    (_ffmpeg: unknown, _file: File, name: string) => Promise.resolve(`/mnt-input/${name}`),
  ),
  unmountInputFile: mockUnmountInputFile,
}));

const mockCompressVideo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tools/video-compress", () => ({ compressVideo: mockCompressVideo }));

import { trimVideo } from "@/lib/tools/video-trim";

/** The output bytes for `output.*`, and an ffprobe JSON body for the probe file. */
function fsWith(probedSeconds: number | null) {
  return (path: string) =>
    Promise.resolve(
      path === "split-probe.json"
        ? probedSeconds === null
          ? "{\n\n}\n"
          : JSON.stringify({ format: { duration: String(probedSeconds) } })
        : new Uint8Array([0x00, 0x00, 0x00]),
    );
}

describe("trimVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExec.mockResolvedValue(0);
    mockReadFile.mockImplementation(fsWith(null));
    mockMountInputFile.mockImplementation((_ffmpeg: unknown, _file: File, name: string) =>
      Promise.resolve(`/mnt-input/${name}`),
    );
    mockDeleteFile.mockResolvedValue(undefined);
  });

  it("validates the input against the stream-copy limit, not a global one", async () => {
    // The shape matters: a stream copy has to hold a full-size output, which
    // audio extraction does not. Passing the wrong shape here would silently
    // hand the trimmer the uncapped limit.
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockValidateFFmpegInput).toHaveBeenCalledWith(file, "stream-copy");
  });

  it("throws if validateFFmpegInput throws", async () => {
    mockValidateFFmpegInput.mockImplementationOnce(() => {
      throw new Error("File too large");
    });
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    await expect(trimVideo(file, { startTime: 0, endTime: 5 })).rejects.toThrow("File too large");
  });

  it("forwards the processing context to runFFmpegTask", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const onProgress = vi.fn();
    const signal = new AbortController().signal;
    await trimVideo(file, { startTime: 0, endTime: 5 }, { onProgress, signal });

    // Progress *and* signal have to reach the loader: the signal is what turns
    // a cancel into ffmpeg.terminate().
    expect(mockRunFFmpegTask).toHaveBeenCalledWith(expect.any(Function), {
      onProgress,
      signal,
    });
  });

  it("runs even when no context is given", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockRunFFmpegTask).toHaveBeenCalledWith(expect.any(Function), {});
  });

  it("mounts the source instead of copying its bytes into the FS", async () => {
    // Copying was what made a 1.5 GB trim cost ~3 GB of heap; the mount is
    // what the current size cap is derived against, so it must not regress
    // back to writeFile.
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.mp4");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("unmounts the source even when FFmpeg fails", async () => {
    // A mount left behind makes the NEXT job fail on a busy mount point.
    mockExec.mockResolvedValueOnce(1);
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    await expect(trimVideo(file, { startTime: 0, endTime: 5 })).rejects.toThrow();
    expect(mockUnmountInputFile).toHaveBeenCalled();
  });

  it("survives a cleanup delete for an output that was never written", async () => {
    mockExec.mockResolvedValueOnce(1);
    mockDeleteFile.mockRejectedValue(new Error("ENOENT"));
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    // The FFmpeg failure has to be what surfaces, not the cleanup's ENOENT.
    await expect(trimVideo(file, { startTime: 0, endTime: 5 })).rejects.toThrow(
      "FFmpeg trimming failed",
    );
  });

  it("passes correct FFmpeg args with -ss, -t, and -c copy", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 10, endTime: 25 });

    const args = mockExec.mock.calls[0][0] as string[];
    expect(args).toContain("-i");
    expect(args).toContain("/mnt-input/input.mp4");
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

  it("cleans up the output and releases the mounted source", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    // Only the output is a real MEMFS file now; the input is a mount. (The
    // other deletion is the probe clearing a stale JSON before it writes.)
    expect(mockDeleteFile).toHaveBeenCalledWith("output.mp4");
    expect(mockDeleteFile).not.toHaveBeenCalledWith("input.mp4");
    expect(mockUnmountInputFile).toHaveBeenCalledTimes(1);
  });

  it("output filename has -trimmed suffix", async () => {
    const file = new File(["video"], "my-video.mp4", { type: "video/mp4" });
    const result = await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(result.fileName).toBe("my-video-trimmed.mp4");
  });

  it("preserves .webm extension", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.webm");
    expect(mockExec.mock.calls[0][0]).toContain("output.webm");

    const result = await trimVideo(file, { startTime: 0, endTime: 5 });
    expect(result.fileName).toBe("recording-trimmed.webm");
  });

  it("rejects a zero-length range instead of muxing an empty clip", async () => {
    // `-ss 0 -t 0 -c copy` produced a ~591-byte file that plays nothing, and
    // the UI offered it for download as a finished trim.
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    await expect(trimVideo(file, { startTime: 3, endTime: 3 })).rejects.toThrow(
      /longer than zero seconds/i,
    );
    expect(mockRunFFmpegTask).not.toHaveBeenCalled();
  });

  it("rejects an inverted range", async () => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });

    await expect(trimVideo(file, { startTime: 5, endTime: 2 })).rejects.toThrow(
      /longer than zero seconds/i,
    );
  });

  it("falls back to a real extension for a dot-less filename", async () => {
    // `substring(lastIndexOf("."))` returned the WHOLE name for "myclip",
    // producing "inputmyclip" / "outputmyclip" — no muxer, opaque failure.
    const file = new File(["video"], "myclip", { type: "video/mp4" });
    const result = await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.mp4");
    expect(mockExec.mock.calls[0][0]).toContain("output.mp4");
    expect(result.fileName).toBe("myclip-trimmed.mp4");
  });

  it("falls back to .webm for a dot-less WebM", async () => {
    const file = new File(["video"], "recording", { type: "video/webm" });
    const result = await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.webm");
    expect(result.fileName).toBe("recording-trimmed.webm");
  });

  it("uses only the last segment of a multi-dot filename", async () => {
    const file = new File(["video"], "my.cool.video.mov", { type: "video/quicktime" });
    const result = await trimVideo(file, { startTime: 0, endTime: 5 });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.mov");
    expect(result.fileName).toBe("my.cool.video-trimmed.mov");
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

  describe("reports what the copy really produced", () => {
    it("flags a copy that began at an earlier keyframe, with where it began", async () => {
      // The measured case: 0.5–1.5 s asked, a 1.51 s file starting at 0.
      mockReadFile.mockImplementation(fsWith(1.51));
      const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
      const result = await trimVideo(file, { startTime: 0.5, endTime: 1.5 });

      expect(mockFfprobe).toHaveBeenCalledTimes(1);
      expect(mockFfprobe.mock.calls[0][0]).toContain("output.mp4");
      expect(result.trim.mode).toBe("copy");
      expect(result.trim.actualSeconds).toBe(1.51);
      expect(result.trim.actualStart).toBe(0);
      expect(result.trim.startedEarly).toBe(true);
    });

    it("does not flag a copy that starts within a frame of the request", async () => {
      // A cut that lands on a keyframe comes back ~the selection's length.
      mockReadFile.mockImplementation(fsWith(1.02));
      const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
      const result = await trimVideo(file, { startTime: 1, endTime: 2 });

      expect(result.trim.actualStart).toBeCloseTo(0.98, 5);
      expect(result.trim.startedEarly).toBe(false);
    });

    it("says nothing rather than guess when the probe returns nothing", async () => {
      mockReadFile.mockImplementation(fsWith(null));
      const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
      const result = await trimVideo(file, { startTime: 0.5, endTime: 1.5 });

      expect(result.trim.actualSeconds).toBeNull();
      expect(result.trim.actualStart).toBeNull();
      expect(result.trim.startedEarly).toBe(false);
    });
  });

  describe("exact mode", () => {
    it("re-encodes just the selection through WebCodecs, never FFmpeg", async () => {
      const blob = new Blob([new Uint8Array(42)], { type: "video/mp4" });
      mockCompressVideo.mockResolvedValue({ blob, fileName: "x-compressed.mp4", originalSize: 5, newSize: 42 });
      const file = new File(["video"], "holiday.webm", { type: "video/webm" });
      const result = await trimVideo(file, { startTime: 0.5, endTime: 1.5, exact: true });

      expect(mockCompressVideo).toHaveBeenCalledTimes(1);
      expect(mockCompressVideo.mock.calls[0][3]).toEqual({
        range: { start: 0.5, end: 1.5 },
        matchSource: true,
      });
      // No FFmpeg job at all — no libx264 argv, no stream-copy size cap.
      expect(mockExec).not.toHaveBeenCalled();
      expect(mockValidateFFmpegInput).not.toHaveBeenCalled();
      // H.264 cannot go in a WebM, so the name has to say MP4.
      expect(result.fileName).toBe("holiday-trimmed.mp4");
      expect(result.blob).toBe(blob);
      expect(result.trim).toMatchObject({ mode: "exact", actualStart: 0.5, startedEarly: false });
    });

    it("still refuses a zero-length selection", async () => {
      const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
      await expect(trimVideo(file, { startTime: 2, endTime: 2, exact: true })).rejects.toThrow(
        "Select a clip longer than zero seconds.",
      );
      expect(mockCompressVideo).not.toHaveBeenCalled();
    });
  });
});
