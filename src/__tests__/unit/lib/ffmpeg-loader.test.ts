import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoad = vi.fn().mockResolvedValue(true);
const mockOn = vi.fn();
const mockTerminate = vi.fn();

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.loaded = false;
    this.load = mockLoad;
    this.on = mockOn;
    this.terminate = mockTerminate;
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

  it("attaches one progress listener per instance", async () => {
    const { getFFmpeg } = await import("@/lib/tools/ffmpeg-loader");
    await getFFmpeg();

    expect(mockOn).toHaveBeenCalledWith("progress", expect.any(Function));
  });
});

describe("runFFmpegTask", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("hands the loaded instance to the task and returns its value", async () => {
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");
    const task = vi.fn().mockResolvedValue("output");

    await expect(runFFmpegTask(task)).resolves.toBe("output");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("runs tasks one at a time", async () => {
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");
    const order: string[] = [];
    const slow = runFFmpegTask(async () => {
      order.push("a:start");
      await new Promise((r) => setTimeout(r, 10));
      order.push("a:end");
    });
    const fast = runFFmpegTask(async () => {
      order.push("b");
    });

    await Promise.all([slow, fast]);
    // Overlapping execs would clobber each other's virtual-FS files and
    // interleave their progress events.
    expect(order).toEqual(["a:start", "a:end", "b"]);
  });

  it("keeps the queue usable after a task throws", async () => {
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");
    const failing = runFFmpegTask(async () => {
      throw new Error("exec failed");
    });

    await expect(failing).rejects.toThrow("exec failed");
    await expect(runFFmpegTask(async () => "ok")).resolves.toBe("ok");
  });

  it("does not start a task whose signal is already aborted", async () => {
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn();

    await expect(runFFmpegTask(task, { signal: controller.signal })).rejects.toThrow(
      /aborted/i,
    );
    expect(task).not.toHaveBeenCalled();
  });

  it("terminates the worker when the signal aborts mid-task", async () => {
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");
    const controller = new AbortController();

    let markStarted!: () => void;
    const taskStarted = new Promise<void>((r) => {
      markStarted = r;
    });

    const running = runFFmpegTask(
      () =>
        new Promise((_resolve, reject) => {
          // Stand in for @ffmpeg/ffmpeg, which rejects its in-flight calls
          // when terminate() kills the worker.
          controller.signal.addEventListener("abort", () =>
            reject(new Error("called FFmpeg.terminate()")),
          );
          markStarted();
        }),
      { signal: controller.signal },
    );

    // Aborting before the task dequeues is a different path (covered above) —
    // wait until it is genuinely running.
    await taskStarted;
    controller.abort();

    // The caller sees the cancellation it asked for, not the library's
    // internal terminate error.
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });

  it("reloads the core on the next task after a terminate", async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { runFFmpegTask, terminateFFmpeg } = await import("@/lib/tools/ffmpeg-loader");

    await runFFmpegTask(async () => "first");
    expect(FFmpeg).toHaveBeenCalledTimes(1);

    terminateFFmpeg();
    await runFFmpegTask(async () => "second");

    expect(FFmpeg).toHaveBeenCalledTimes(2);
  });
});
