import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  ─────────────────────────────────────────────────────────────────────────────
  What these tests are for
  ─────────────────────────────────────────────────────────────────────────────
  jsdom has no wasm core, so nothing here proves FFmpeg cuts anything. What it
  CAN prove is everything that is genuinely ours and would otherwise ship
  unguarded:

    * the segment plan for all three modes — the whole of what the tool decides
      before FFmpeg is involved;
    * the argv each plan turns into, including `-ss` sitting BEFORE `-i`, which
      is the difference between a fast seek and a clip that opens on frozen
      black frames;
    * that every part's reported length is the one ffprobe MEASURED on the
      written file, not the one that was requested — keyframe drift makes those
      differ (a requested 1.000 s came out 1.022 s against the shipped core),
      and printing the request would describe a file that does not exist;
    * that a part FFmpeg reports success on but writes empty is refused;
    * that the mount and every temp file are released on the failure path.

  Left to the conversion e2e, which runs the real core: that a cut file plays,
  that the drift is what the header says it is, and that the parts reassemble
  into the source.
*/

const execCalls: string[][] = [];
const probeCalls: string[][] = [];
const deletedFiles: string[] = [];
let unmountCount = 0;

/** Virtual-FS path -> what ffprobe will say its duration is. */
const probeDurations = new Map<string, number | null>();
let lastProbedPath: string | null = null;

let execResult: (args: string[]) => number = () => 0;
/** What a written part's real duration comes out as, given what was asked for. */
let driftFor: (requestedSeconds: number) => number | null = (t) => t;

const PROBE_OUTPUT = "split-probe.json";

const fakeFFmpeg = {
  exec: vi.fn(async (args: string[]) => {
    execCalls.push(args);
    const ret = execResult(args);
    if (ret === 0) {
      const outputName = args[args.length - 1];
      const requested = Number(args[args.indexOf("-t") + 1]);
      probeDurations.set(outputName, driftFor(requested));
    }
    return ret;
  }),
  ffprobe: vi.fn(async (args: string[]) => {
    probeCalls.push(args);
    lastProbedPath = args[args.indexOf("-o") - 1];
    return -1; // ffprobe returns -1 on every input in this build.
  }),
  readFile: vi.fn(async (path: string) => {
    if (path !== PROBE_OUTPUT) return new Uint8Array([0x00, 0x01, 0x02]);
    if (!probeDurations.has(lastProbedPath ?? "")) {
      // ffprobe wrote nothing at all.
      throw new Error("ErrnoError: FS error");
    }
    const seconds = probeDurations.get(lastProbedPath ?? "");
    // ffprobe's failure body is literally `{\n\n}\n` — it parses, and carries
    // nothing.
    if (seconds === null) return "{\n\n}\n";
    return JSON.stringify({ format: { duration: String(seconds) } });
  }),
  deleteFile: vi.fn(async (path: string) => {
    deletedFiles.push(path);
    return "OK";
  }),
};

const validateFFmpegInput = vi.fn();

vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  runFFmpegTask: vi.fn(async (task: (ff: unknown) => Promise<unknown>) => task(fakeFFmpeg)),
  validateFFmpegInput: (...args: unknown[]) => validateFFmpegInput(...args),
  mountInputFile: vi.fn(async (_ff: unknown, _file: File, name: string) => `/mnt-input/${name}`),
  unmountInputFile: vi.fn(async () => {
    unmountCount += 1;
  }),
}));

const videoFile = (name = "holiday.mp4") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "video/mp4" });

/** Register the mounted source's length, the way a real probe would report it. */
function sourceIs(seconds: number, name = "holiday.mp4") {
  probeDurations.set(`/mnt-input/split-input${/\.[^.]+$/.exec(name)?.[0] ?? ".mp4"}`, seconds);
}

beforeEach(() => {
  execCalls.length = 0;
  probeCalls.length = 0;
  deletedFiles.length = 0;
  unmountCount = 0;
  probeDurations.clear();
  lastProbedPath = null;
  execResult = () => 0;
  driftFor = (t) => t;
  vi.clearAllMocks();
});

describe("planSegments — equal parts", () => {
  it("splits a 10 s clip into four parts of the same length", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    const plans = planSegments(10, { mode: "equal-parts", parts: 4 });

    expect(plans).toEqual([
      { index: 0, start: 0, end: 2.5 },
      { index: 1, start: 2.5, end: 5 },
      { index: 2, start: 5, end: 7.5 },
      { index: 3, start: 7.5, end: 10 },
    ]);
  });

  it("always ends the last part on the end of the video", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    // 7 does not divide 100 evenly; the final boundary still has to be 100 or
    // the tail of the video is silently dropped.
    const plans = planSegments(100, { mode: "equal-parts", parts: 7 });

    expect(plans).toHaveLength(7);
    expect(plans[plans.length - 1].end).toBe(100);
  });

  it.each([
    [1, "one part is the file you already have"],
    [0, "zero"],
    [2.5, "a fraction of a part cannot be cut"],
  ])("refuses %s parts (%s)", async (parts) => {
    const { planSegments } = await import("@/lib/tools/video-split");
    expect(() => planSegments(10, { mode: "equal-parts", parts })).toThrow(/at least 2 parts/i);
  });

  it("refuses more parts than the engine will run in one go", async () => {
    const { planSegments, MAX_SEGMENTS } = await import("@/lib/tools/video-split");
    expect(() => planSegments(600, { mode: "equal-parts", parts: MAX_SEGMENTS + 1 })).toThrow(
      new RegExp(String(MAX_SEGMENTS)),
    );
  });

  it("refuses parts too short to write as a playable file", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    // 1 s into 50 parts is 20 ms each — below MIN_SEGMENT_SECONDS, and a
    // stream copy cannot even reach the next keyframe in that.
    expect(() => planSegments(1, { mode: "equal-parts", parts: 50 })).toThrow(/too short/i);
  });
});

describe("planSegments — a fixed part length", () => {
  it("cuts every N seconds and gives the remainder its own part", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    const plans = planSegments(10, { mode: "fixed-duration", segmentSeconds: 3 });

    expect(plans.map((p) => [p.start, p.end])).toEqual([
      [0, 3],
      [3, 6],
      [6, 9],
      [9, 10],
    ]);
  });

  /*
    The exact shape the page's copy now describes, pinned at the numbers the
    copy quotes. The alternative design — absorbing the leftover so the LAST
    part runs long — was rejected: "every 30 s" that hands back a 59 s part
    breaks the only promise the mode makes, and a fixed length is usually
    chosen because something downstream enforces it. Change the loop bound to
    absorb and this goes red, which is the point: it is the anchor the UI hint
    and the FAQ answer are written against.
  */
  it("cuts 100 s every 30 s into 30 / 30 / 30 / 10 — the tail is its own part", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    const plans = planSegments(100, { mode: "fixed-duration", segmentSeconds: 30 });

    expect(plans.map((p) => [p.start, p.end])).toEqual([
      [0, 30],
      [30, 60],
      [60, 90],
      [90, 100],
    ]);
    // Shorter than a full part, and never merged into the one before it.
    expect(plans[plans.length - 1].end - plans[plans.length - 1].start).toBe(10);
  });

  it("produces no zero-length tail when the length divides exactly", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    const plans = planSegments(10, { mode: "fixed-duration", segmentSeconds: 5 });

    expect(plans.map((p) => [p.start, p.end])).toEqual([
      [0, 5],
      [5, 10],
    ]);
  });

  it("folds a sliver of a remainder into the last part instead of emitting it", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    // 20 ms is left over. A part that short is not writable, and dropping it
    // would lose the end of the video — so the last part runs long.
    const plans = planSegments(10.02, { mode: "fixed-duration", segmentSeconds: 5 });

    expect(plans).toHaveLength(2);
    expect(plans[1]).toEqual({ index: 1, start: 5, end: 10.02 });
  });

  it("refuses a part length that is the whole video", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    expect(() => planSegments(10, { mode: "fixed-duration", segmentSeconds: 10 })).toThrow(
      /one part/i,
    );
  });

  it("refuses a zero or missing part length", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    expect(() => planSegments(10, { mode: "fixed-duration", segmentSeconds: 0 })).toThrow(
      /longer than zero/i,
    );
    expect(() => planSegments(10, { mode: "fixed-duration" })).toThrow(/longer than zero/i);
  });
});

describe("planSegments — at chosen times", () => {
  it("turns cut points into the spans between them", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    const plans = planSegments(10, { mode: "at-times", cutTimes: [2, 7] });

    expect(plans.map((p) => [p.start, p.end])).toEqual([
      [0, 2],
      [2, 7],
      [7, 10],
    ]);
  });

  it("sorts and de-duplicates whatever order the times arrive in", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    // Unsorted would plan a negative-length part; the duplicate would plan a
    // zero-length one.
    const plans = planSegments(10, { mode: "at-times", cutTimes: [7, 2, 7] });

    expect(plans.map((p) => [p.start, p.end])).toEqual([
      [0, 2],
      [2, 7],
      [7, 10],
    ]);
  });

  it.each([
    [0, "the very start"],
    [10, "the very end"],
    [11, "past the end"],
    [-1, "before the start"],
  ])("refuses a cut at %s (%s)", async (at) => {
    const { planSegments } = await import("@/lib/tools/video-split");
    expect(() => planSegments(10, { mode: "at-times", cutTimes: [at] })).toThrow(/outside this/i);
  });

  it("refuses an empty list rather than handing back the whole file", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    expect(() => planSegments(10, { mode: "at-times", cutTimes: [] })).toThrow(/at least one time/i);
  });

  it("refuses two cuts so close together the part between them is unwritable", async () => {
    const { planSegments } = await import("@/lib/tools/video-split");
    expect(() => planSegments(10, { mode: "at-times", cutTimes: [4, 4.001] })).toThrow(/too short/i);
  });
});

describe("planSegments — a length it cannot read", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses to plan against a source length of %s",
    async (seconds) => {
      const { planSegments } = await import("@/lib/tools/video-split");
      expect(() => planSegments(seconds, { mode: "equal-parts", parts: 2 })).toThrow(
        /how long this video is/i,
      );
    },
  );
});

describe("parseTimecode / parseCutTimes", () => {
  it.each([
    ["90", 90],
    ["1:30", 90],
    ["1:30.5", 90.5],
    ["0:05", 5],
    ["01:02:03", 3723],
    ["2.5", 2.5],
  ])("reads %s as %s seconds", async (text, seconds) => {
    const { parseTimecode } = await import("@/lib/tools/video-split");
    expect(parseTimecode(text)).toBe(seconds);
  });

  it.each([
    ["1:70", "a minutes-and-seconds field above 59 is a typo, not an overflow"],
    ["1:2:3:4", "four fields is not a timecode"],
    ["abc", "not a number"],
    ["1:2.5:3", "only the last field may carry a decimal"],
    ["", "empty"],
    ["-5", "negative"],
  ])("refuses %s (%s)", async (text) => {
    const { parseTimecode } = await import("@/lib/tools/video-split");
    expect(parseTimecode(text)).toBeNull();
  });

  it("splits a typed list and names what it could not read", async () => {
    const { parseCutTimes } = await import("@/lib/tools/video-split");
    expect(parseCutTimes("0:30, 1:15  banana\n2:00")).toEqual({
      times: [30, 75, 120],
      invalid: ["banana"],
    });
  });
});

describe("splitSegmentArgs", () => {
  it("puts -ss before -i and stream-copies", async () => {
    const { splitSegmentArgs } = await import("@/lib/tools/video-split");
    const args = splitSegmentArgs("/mnt-input/split-input.mp4", { index: 1, start: 3, end: 7 }, "p.mp4");

    expect(args).toEqual([
      "-ss", "3",
      "-i", "/mnt-input/split-input.mp4",
      "-t", "4",
      "-c", "copy",
      "-avoid_negative_ts", "make_zero",
      "p.mp4",
    ]);
    // `-ss` AFTER `-i` with `-c copy` produces the frozen/black leading frames
    // video-trim.ts documents. Order is the whole point of the flag here.
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
  });

  it("rounds float boundaries to the millisecond rather than emitting their binary tail", async () => {
    const { splitSegmentArgs } = await import("@/lib/tools/video-split");
    // 10/3 is what an equal-parts boundary really is.
    const args = splitSegmentArgs("/in.mp4", { index: 1, start: 10 / 3, end: 20 / 3 }, "p.mp4");

    expect(args[1]).toBe("3.333");
    expect(args[5]).toBe("3.333");
    expect(args[1]).not.toMatch(/\d{6}/);
  });
});

describe("durationFromProbeJson", () => {
  it("reads the string ffprobe actually writes", async () => {
    const { durationFromProbeJson } = await import("@/lib/tools/video-split");
    expect(durationFromProbeJson(JSON.stringify({ format: { duration: "2.090000" } }))).toBe(2.09);
  });

  it("returns null for ffprobe's empty failure body", async () => {
    const { durationFromProbeJson } = await import("@/lib/tools/video-split");
    // The literal body a probe of a non-media file writes.
    expect(durationFromProbeJson("{\n\n}\n")).toBeNull();
    expect(durationFromProbeJson("not json at all")).toBeNull();
    expect(durationFromProbeJson(JSON.stringify({ format: { duration: "N/A" } }))).toBeNull();
  });
});

describe("splitVideo", () => {
  it("runs one stream copy per part and zips what it read back", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    sourceIs(10);

    const result = await splitVideo(videoFile(), { mode: "equal-parts", parts: 2 });

    expect(execCalls).toHaveLength(2);
    expect(execCalls[0].slice(0, 6)).toEqual(["-ss", "0", "-i", "/mnt-input/split-input.mp4", "-t", "5"]);
    expect(execCalls[1].slice(0, 6)).toEqual(["-ss", "5", "-i", "/mnt-input/split-input.mp4", "-t", "5"]);

    expect(result.segments.map((s) => s.fileName)).toEqual([
      "holiday-part-01.mp4",
      "holiday-part-02.mp4",
    ]);
    expect(result.fileName).toBe("holiday-parts.zip");

    const JSZip = (await import("jszip")).default;
    const read = await JSZip.loadAsync(result.blob);
    expect(Object.keys(read.files).sort()).toEqual([
      "holiday-part-01.mp4",
      "holiday-part-02.mp4",
    ]);
  });

  it("reports the length ffprobe MEASURED on each part, not the length requested", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    sourceIs(10);
    // The measured shape: a stream copy can only cut at a keyframe, so a part
    // asked for 1.000 s came out 1.022 s against the shipped core.
    driftFor = (t) => t + 0.022;

    const result = await splitVideo(videoFile(), { mode: "equal-parts", parts: 2 });

    expect(result.segments.map((s) => s.requestedEnd - s.requestedStart)).toEqual([5, 5]);
    expect(result.segments.map((s) => s.actualSeconds)).toEqual([5.022, 5.022]);
  });

  it("flags keyframe drift, and says so in a warning, once a part misses by more than 0.25 s", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    sourceIs(10);
    driftFor = (t) => t + 0.51; // one GOP at 24 fps in the measured fixture

    const result = await splitVideo(videoFile(), { mode: "equal-parts", parts: 2 });

    expect(result.keyframeDrift).toBe(true);
    expect(result.warnings?.[0]).toMatch(/keyframe/i);
  });

  it("does not flag drift when every part lands where it was asked to", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    sourceIs(10);

    const result = await splitVideo(videoFile(), { mode: "equal-parts", parts: 2 });

    expect(result.keyframeDrift).toBe(false);
    expect(result.warnings).toBeUndefined();
  });

  it("refuses a part FFmpeg reported success on but wrote empty", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    sourceIs(10);
    // The header-only 591-byte file a degenerate range produces: exit 0, and
    // ffprobe can find no duration in it.
    driftFor = () => null;

    await expect(splitVideo(videoFile(), { mode: "equal-parts", parts: 2 })).rejects.toThrow(
      /came out empty/i,
    );
  });

  it("refuses a source whose length cannot be read at all", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    // No entry registered for the mounted path, so ffprobe writes nothing.
    await expect(splitVideo(videoFile(), { mode: "equal-parts", parts: 2 })).rejects.toThrow(
      /could not be read as a video/i,
    );
    expect(execCalls).toHaveLength(0);
  });

  it("names the part that failed rather than saying the run failed", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    sourceIs(10);
    execResult = (args) => (args[args.length - 1].includes("001") ? 1 : 0);

    await expect(splitVideo(videoFile(), { mode: "equal-parts", parts: 3 })).rejects.toThrow(
      /Part 2 of 3/,
    );
  });

  it("releases the mount and every part file when a part throws", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    sourceIs(10);
    execResult = (args) => (args[args.length - 1].includes("002") ? 1 : 0);

    await expect(splitVideo(videoFile(), { mode: "equal-parts", parts: 4 })).rejects.toThrow();

    // The source is unpinned, or the NEXT job cannot mount over it.
    expect(unmountCount).toBe(1);
    // Every part name this run asked MEMFS for is cleared — including the one
    // whose exec failed, which may have left a partial file behind.
    expect(deletedFiles).toContain("split-part-000.mp4");
    expect(deletedFiles).toContain("split-part-001.mp4");
    expect(deletedFiles).toContain("split-part-002.mp4");
    expect(deletedFiles).toContain("split-probe.json");
  });

  it("checks the size cap the same way the trimmer does", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    sourceIs(10);

    await splitVideo(videoFile(), { mode: "equal-parts", parts: 2 });

    expect(validateFFmpegInput).toHaveBeenCalledWith(expect.any(File), "stream-copy");
  });

  it("keeps FFmpeg's own 0-100-per-part progress off the caller's bar", async () => {
    const { splitVideo } = await import("@/lib/tools/video-split");
    const { runFFmpegTask } = await import("@/lib/tools/ffmpeg-loader");
    sourceIs(10);
    const seen: number[] = [];

    await splitVideo(videoFile(), { mode: "equal-parts", parts: 4 }, { onProgress: (p) => seen.push(p) });

    // Monotonic, one step per finished part — not four sweeps from 0 to 100.
    expect(seen).toEqual([25, 50, 75, 100]);
    // …because the loader was never handed the callback that would have wired
    // FFmpeg's own per-exec events straight through.
    expect(vi.mocked(runFFmpegTask).mock.calls[0][1]).not.toHaveProperty("onProgress");
  });
});
