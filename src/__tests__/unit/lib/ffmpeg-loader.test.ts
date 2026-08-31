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
  FFFSType: { WORKERFS: "WORKERFS", MEMFS: "MEMFS" },
}));

vi.mock("@ffmpeg/util", () => ({
  toBlobURL: vi.fn().mockResolvedValue("blob:mock"),
}));

/*
  The limits under test are DERIVED (see the block at the top of
  ffmpeg-loader.ts): ~1.8 GB is the most one MEMFS file was observed to hold,
  and the stream-copy cap is that divided by emscripten's 1.125 growth factor,
  rounded down. These tests pin the shape of the rule — per job, not one global
  number — and the fact that the message explains itself, because "Maximum is
  100 MB" with no reason is exactly what was wrong before.
*/
describe("validateFFmpegInput", () => {
  const sized = (bytes: number) => {
    const file = new File(["x"], "video.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: bytes });
    return file;
  };

  it("lets the 125 MB file that prompted this through, on both job shapes", async () => {
    // The owner's actual report: "File is too large (125.4 MB)."
    const { validateFFmpegInput } = await import("@/lib/tools/ffmpeg-loader");
    const file = sized(Math.round(125.4 * 1024 * 1024));

    expect(() => validateFFmpegInput(file, "stream-copy")).not.toThrow();
    expect(() => validateFFmpegInput(file, "audio-extract")).not.toThrow();
  });

  it("does not cap audio extraction at any size", async () => {
    // The source is mounted, not copied, so input size costs no memory. A
    // 2500 MB MP4 was verified end to end.
    const { validateFFmpegInput, ffmpegInputLimitBytes } = await import(
      "@/lib/tools/ffmpeg-loader"
    );

    expect(ffmpegInputLimitBytes("audio-extract")).toBeNull();
    expect(() => validateFFmpegInput(sized(8 * 1024 * 1024 * 1024), "audio-extract")).not.toThrow();
  });

  it("caps a stream copy at 1.5 GB, the size MEMFS can hold after its 1.125x growth", async () => {
    const { validateFFmpegInput, STREAM_COPY_MAX_INPUT_BYTES, MEMFS_MAX_FILE_BYTES } =
      await import("@/lib/tools/ffmpeg-loader");

    expect(STREAM_COPY_MAX_INPUT_BYTES).toBe(1536 * 1024 * 1024);
    // The whole point of the number: input plus its 1.125x realloc has to stay
    // inside what one MEMFS file was measured to survive.
    expect(STREAM_COPY_MAX_INPUT_BYTES * 1.125).toBeLessThan(MEMFS_MAX_FILE_BYTES);

    expect(() => validateFFmpegInput(sized(STREAM_COPY_MAX_INPUT_BYTES), "stream-copy")).not.toThrow();
    expect(() => validateFFmpegInput(sized(STREAM_COPY_MAX_INPUT_BYTES + 1), "stream-copy")).toThrow();
  });

  it("says WHY it refused, not just a number", async () => {
    const { validateFFmpegInput } = await import("@/lib/tools/ffmpeg-loader");
    let message = "";
    try {
      validateFFmpegInput(sized(2500 * 1024 * 1024), "stream-copy");
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain("2500.0 MB"); // what the user actually handed us
    expect(message).toMatch(/browser/i); // the reason
    expect(message).toContain("1536 MB"); // the limit
    expect(message).toMatch(/MP4 to MP3/i); // the way out
  });
});

/*
  The number is written down in two places on purpose — the engine enforces it,
  the registry advertises it on the drop zone and in the tool page's spec table
  — so they get a test rather than a comment asking future readers to remember.
*/
describe("advertised cap vs enforced cap", () => {
  it("video-trimmer advertises exactly what trimVideo enforces", async () => {
    const { STREAM_COPY_MAX_INPUT_BYTES } = await import("@/lib/tools/ffmpeg-loader");
    const { getToolBySlug } = await import("@/data/tools");

    expect(getToolBySlug("video-trimmer")?.maxSizeMB).toBe(
      STREAM_COPY_MAX_INPUT_BYTES / 1024 / 1024,
    );
  });

  it("mp4-to-mp3 advertises no cap, because it has none", async () => {
    // "NO SIZE CAP" on the drop zone is a claim; this is what keeps it true.
    const { ffmpegInputLimitBytes } = await import("@/lib/tools/ffmpeg-loader");
    const { getToolBySlug } = await import("@/data/tools");

    expect(ffmpegInputLimitBytes("audio-extract")).toBeNull();
    expect(getToolBySlug("mp4-to-mp3")?.maxSizeMB).toBeUndefined();
  });
});

describe("describeFFmpegFailure", () => {
  it("turns the worker's bare string into a real Error", async () => {
    // @ffmpeg/ffmpeg's worker posts `e.toString()`, so a core failure arrives
    // as a string and `err instanceof Error` in useFileProcessor was false —
    // which is how every FFmpeg failure surfaced as "Processing failed".
    const { describeFFmpegFailure } = await import("@/lib/tools/ffmpeg-loader");
    const out = describeFFmpegFailure("Error: could not find a demuxer");

    expect(out).toBeInstanceOf(Error);
    expect(out.message).toContain("demuxer");
  });

  it.each([
    "RangeError: Array buffer allocation failed",
    "RangeError: WebAssembly.Memory.grow(): Maximum memory size exceeded",
    "RuntimeError: memory access out of bounds",
  ])("reports an out-of-memory as one: %s", async (raw) => {
    const { describeFFmpegFailure } = await import("@/lib/tools/ffmpeg-loader");
    const out = describeFFmpegFailure(raw);

    expect(out.message).toMatch(/ran out of memory/i);
    expect(out.message).toMatch(/shorter selection|smaller source/i);
  });

  it("passes a real Error through untouched", async () => {
    const { describeFFmpegFailure } = await import("@/lib/tools/ffmpeg-loader");
    const original = new Error("FFmpeg trimming failed");

    expect(describeFFmpegFailure(original)).toBe(original);
  });

  it("never produces an empty message", async () => {
    const { describeFFmpegFailure } = await import("@/lib/tools/ffmpeg-loader");
    expect(describeFFmpegFailure("").message.length).toBeGreaterThan(0);
    expect(describeFFmpegFailure(undefined).message.length).toBeGreaterThan(0);
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
