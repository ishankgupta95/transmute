import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLoad = vi.fn().mockResolvedValue(true);
const mockOn = vi.fn();
const mockTerminate = vi.fn();

/**
 * The fake core models ONE measured behaviour that a plain `vi.fn()` cannot:
 * after a wasm trap, the instance is dead. Every later call on it throws the
 * same trap — measured on the real core, where a trivial `-version` and even a
 * `readFile` of an already-written file both threw `RuntimeError: memory access
 * out of bounds` once anything had trapped.
 *
 * Without that, a test cannot tell "the loader threw the instance away" from
 * "the loader did nothing", because a stateless mock succeeds either way.
 */
interface FakeFFmpeg extends Record<string, unknown> {
  trapped: boolean;
  exec: (args: string[]) => Promise<number>;
}

const instances: FakeFFmpeg[] = [];

vi.mock("@ffmpeg/ffmpeg", () => ({
  FFmpeg: vi.fn().mockImplementation(function (this: FakeFFmpeg) {
    this.loaded = false;
    this.load = mockLoad;
    this.on = mockOn;
    this.terminate = mockTerminate;
    this.trapped = false;
    // "TRAP" traps like the real core; "FAIL" returns a non-zero exit code the
    // way a genuine ffmpeg error does; anything else succeeds.
    this.exec = async (args: string[]) => {
      if (this.trapped) throw "RuntimeError: memory access out of bounds";
      if (args.includes("TRAP")) {
        this.trapped = true;
        throw "RuntimeError: memory access out of bounds";
      }
      if (args.includes("FAIL")) return 1;
      return 0;
    };
    instances.push(this);
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
    "Error: memory allocation failed",
    "abort: Cannot enlarge memory arrays, out of memory",
    "RangeError: WebAssembly.Memory.grow(): Maximum memory size exceeded",
    // emscripten's own abbreviation, and the host OOM killer's prose name. Both
    // are matched on a word boundary rather than as a substring (OOM_TOKEN);
    // these two are what stops that boundary being tightened into nothing.
    "Aborted(OOM)",
    "Killed by the oom-killer",
  ])("reports an out-of-memory as one: %s", async (raw) => {
    const { describeFFmpegFailure } = await import("@/lib/tools/ffmpeg-loader");
    const out = describeFFmpegFailure(raw);

    expect(out.message).toMatch(/ran out of memory/i);
    expect(out.message).toMatch(/shorter selection|smaller source/i);
  });

  /*
    "memory access out of bounds" USED to sit in OOM_SIGNATURES, so a wasm trap
    on a 350 KB file told the user they had exhausted a 1795 MB budget. It is a
    wasm RuntimeError — the module crashed — and it is raised by inputs that are
    nowhere near any memory ceiling (a stereo libopus encode of a 350 KB WAV
    does it every time, measured). Two different failures, two different
    truths, and the wrong one hid the only useful advice: try again.
  */
  it.each([
    "RuntimeError: memory access out of bounds",
    "RuntimeError: unreachable executed",
    "RuntimeError: null function or function signature mismatch",
    "RuntimeError: table index is out of bounds",
  ])("calls a wasm trap a crash, not an out-of-memory: %s", async (raw) => {
    const { describeFFmpegFailure } = await import("@/lib/tools/ffmpeg-loader");
    const out = describeFFmpegFailure(raw);

    expect(out.message).not.toMatch(/ran out of memory/i);
    // The old message quoted the MEMFS ceiling at a user whose file was 350 KB.
    expect(out.message).not.toMatch(/\d+ MB/);
    expect(out.message).toMatch(/crashed/i);
    // The engine restarts itself now, so "try again" is true advice.
    expect(out.message).toMatch(/try again/i);
  });

  /*
    The same mistake as the block above, one layer down: `"oom"` sat in
    OOM_SIGNATURES as a BARE SUBSTRING until 2026-09-05, and it is inside
    "zoom", "room" and "bloom". FFmpeg echoes the input filename into its error
    text, so a file called `zoom-call.mp4` that simply would not demux was
    rewritten into "Ran out of memory … a browser tab can hold about 1795 MB …
    try a shorter selection" — a diagnosis invented about a file nowhere near
    any ceiling, which also threw away the one line that said what was actually
    wrong. The fix is the word boundary in `OOM_TOKEN`; these cases are what
    keeps it from being folded back into the substring list.
  */
  it.each([
    // The filename echo, which is how a real user hits this.
    "zoom-call.mp4: Invalid data found when processing input",
    "Error opening output file mushroom.mov",
    // And the plain English words, which a codec message can carry on its own.
    "bloom filter rejected the packet",
    "No room left on device",
  ])("does not invent an out-of-memory from: %s", async (raw) => {
    const { describeFFmpegFailure } = await import("@/lib/tools/ffmpeg-loader");
    const out = describeFFmpegFailure(raw);

    expect(out.message).not.toMatch(/ran out of memory/i);
    // The fabricated copy quotes the MEMFS ceiling; nothing here may.
    expect(out.message).not.toMatch(/\d+ MB/);
    // The real text is the only diagnosis there is, so it must survive intact.
    expect(out.message).toBe(raw);
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

/*
  ─────────────────────────────────────────────────────────────────────────────
  F1: one wasm trap used to kill every FFmpeg tool in the tab
  ─────────────────────────────────────────────────────────────────────────────
  Measured against the shipped core on 2026-09-03:

    1. healthy remux                EXIT=0         jsErr=null
    2. `-c:a libopus` stereo        EXIT=undefined jsErr=RuntimeError: memory access out of bounds
    3. the SAME remux again         EXIT=undefined jsErr=RuntimeError: memory access out of bounds
    4. a trivial `-version`         EXIT=undefined jsErr=RuntimeError: memory access out of bounds
    --- after terminate() + reload ---
    6. the same remux              EXIT=0         jsErr=null

  The loader caught, described, and kept the corpse. Every later job on that tab
  — a different tool, a different file — failed with the same trap, and because
  the trap string was in OOM_SIGNATURES, each one told the user they were out of
  memory. The fix is to throw the instance away so the next job loads a clean
  core; these tests are what hold it in place.
*/
describe("recovering from a wasm trap", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    instances.length = 0;
  });

  it("lets the NEXT job succeed after one traps", async () => {
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");

    await expect(runFFmpegTask((ff) => ff.exec(["TRAP"]))).rejects.toThrow(/crashed/i);

    // Without the terminate, this runs on the poisoned instance and throws the
    // same trap — which is exactly what shipped.
    await expect(runFFmpegTask((ff) => ff.exec(["-version"]))).resolves.toBe(0);
  });

  it("builds a brand-new core for that next job", async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");

    await expect(runFFmpegTask((ff) => ff.exec(["TRAP"]))).rejects.toThrow();
    await runFFmpegTask((ff) => ff.exec(["-version"]));

    expect(FFmpeg).toHaveBeenCalledTimes(2);
    expect(mockTerminate).toHaveBeenCalledTimes(1);
    // The corpse is not the one the second job ran on.
    expect(instances[0].trapped).toBe(true);
    expect(instances[1].trapped).toBe(false);
  });

  it("does not strand a job that was already queued behind the one that trapped", async () => {
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");

    // Both are queued before either runs, so the second cannot have re-checked
    // anything: it has to survive the first tearing the instance down.
    const trapping = runFFmpegTask((ff) => ff.exec(["TRAP"]));
    const queued = runFFmpegTask((ff) => ff.exec(["-version"]));

    await expect(trapping).rejects.toThrow(/crashed/i);
    await expect(queued).resolves.toBe(0);
  });

  it("keeps the core for an ordinary non-zero exit, which is not a crash", async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");

    // FFmpeg RETURNS a bad exit code, it does not throw one. Tearing the engine
    // down for "this codec does not fit that container" would cost a 31 MB
    // reload on a completely healthy instance.
    await expect(runFFmpegTask((ff) => ff.exec(["FAIL"]))).resolves.toBe(1);
    await runFFmpegTask((ff) => ff.exec(["-version"]));

    expect(mockTerminate).not.toHaveBeenCalled();
    expect(FFmpeg).toHaveBeenCalledTimes(1);
  });

  it("keeps the core when a task throws something that is not a trap", async () => {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");

    await expect(
      runFFmpegTask(async () => {
        throw new Error("FFmpeg trimming failed");
      }),
    ).rejects.toThrow("FFmpeg trimming failed");
    await runFFmpegTask((ff) => ff.exec(["-version"]));

    expect(mockTerminate).not.toHaveBeenCalled();
    expect(FFmpeg).toHaveBeenCalledTimes(1);
  });

  it("does not terminate twice when a cancel is what killed the worker", async () => {
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");
    const controller = new AbortController();

    let markStarted!: () => void;
    const taskStarted = new Promise<void>((r) => {
      markStarted = r;
    });

    const running = runFFmpegTask(
      () =>
        new Promise((_resolve, reject) => {
          // terminate() kills the worker mid-call, and what the caller sees is
          // trap-shaped. It must still be reported as the cancel it was.
          controller.signal.addEventListener("abort", () =>
            reject("RuntimeError: memory access out of bounds"),
          );
          markStarted();
        }),
      { signal: controller.signal },
    );

    await taskStarted;
    controller.abort();

    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(mockTerminate).toHaveBeenCalledTimes(1);
  });
});
