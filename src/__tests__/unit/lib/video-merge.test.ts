import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MergeInputInfo } from "@/lib/tools/video-merge";

/*
  ─────────────────────────────────────────────────────────────────────────────
  What these tests are for
  ─────────────────────────────────────────────────────────────────────────────
  jsdom has no wasm core, so nothing here proves FFmpeg joins anything. What it
  CAN prove is the pair of guards this tool exists for, and both are guards
  against a measurement, not against a theory.

  MEASURED 2026-09-05 against the shipped core, `-f concat -safe 0 -i list.txt
  -c copy out.mp4`:

    sample-video.mp4 + clip2.mp4          EXIT 0  expected 4.180  got 4.180  ok
    sample-video.mp4 + sample-video.mov   EXIT 0  expected 4.180  got 4.180  ok
    sample-video.mp4 + sample-video.mkv   EXIT 0  expected 4.180  got 2.090  LOST
    sample-video.mp4 + sample-video.webm  EXIT 0  expected 3.976  got 2.090  LOST
    sample-video.mp4 + sample-video.avi   EXIT 0  expected 4.180  got 2.090  LOST

  FFmpeg exits 0 and writes a file holding only the first clip. So:

    * `compareMergeInputs` has to refuse the mkv and avi pairs BEFORE anything
      runs — and those two agree on every stream property (h264, 320x240,
      yuv420p, aac 44100 stereo). The container is the only thing that differs,
      which is why it is compared, and the mkv case below is the test that
      pins it.
    * `mergeVideos` has to refuse a finished file that came out short, because
      the comparison can only check properties somebody thought of.

  Left to the conversion e2e, which runs the real core: that a compatible pair
  really joins, and that the mkv pair really is the loss recorded above.
*/

const execCalls: string[][] = [];
const writtenFiles: { name: string; text: string }[] = [];
const deletedFiles: string[] = [];
let unmountCount = 0;

const PROBE_OUTPUT = "merge-probe.json";

/** Probe JSON keyed by the File that was mounted for it. */
const probeJsonByFileName = new Map<string, string>();
/** What ffprobe says the joined file in MEMFS is, once it has been written. */
let outputProbeJson: string | null = null;

let lastProbedPath: string | null = null;
let mountedFileName: string | null = null;
let execResult: (args: string[]) => number = () => 0;

const fakeFFmpeg = {
  exec: vi.fn(async (args: string[]) => {
    execCalls.push(args);
    return execResult(args);
  }),
  ffprobe: vi.fn(async (args: string[]) => {
    lastProbedPath = args[args.indexOf("-o") - 1];
    return -1; // ffprobe returns -1 on every input in this build.
  }),
  writeFile: vi.fn(async (name: string, data: Uint8Array) => {
    writtenFiles.push({ name, text: new TextDecoder().decode(data) });
    return "OK";
  }),
  readFile: vi.fn(async (path: string) => {
    if (path !== PROBE_OUTPUT) return new Uint8Array([0x00, 0x01, 0x02]);
    if (lastProbedPath?.startsWith("/mnt-input/")) {
      const json = probeJsonByFileName.get(mountedFileName ?? "");
      if (json === undefined) throw new Error("ErrnoError: FS error");
      return json;
    }
    if (outputProbeJson === null) throw new Error("ErrnoError: FS error");
    return outputProbeJson;
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
  mountInputFile: vi.fn(async (_ff: unknown, file: File, name: string) => {
    mountedFileName = file.name;
    return `/mnt-input/${name}`;
  }),
  unmountInputFile: vi.fn(async () => {
    unmountCount += 1;
  }),
  fileToUint8Array: vi.fn(async (file: File) => new Uint8Array(file.size)),
  STREAM_COPY_MAX_INPUT_BYTES: 1536 * 1024 * 1024,
}));

/* ── The fixtures, field for field as ffprobe reported them (probe log p5) ── */

interface ProbeShape {
  duration: number;
  format: string;
  videoCodec?: string | null;
  width?: number;
  height?: number;
  pixFmt?: string;
  /** The VIDEO stream's ffprobe `time_base`. See TIMEBASES below. */
  timeBase?: string;
  frameRate?: string;
  audioCodec?: string | null;
  sampleRate?: number;
  channels?: number;
}

function probeJson(shape: ProbeShape): string {
  const streams: Record<string, unknown>[] = [];
  if (shape.videoCodec !== null) {
    streams.push({
      codec_type: "video",
      codec_name: shape.videoCodec ?? "h264",
      width: shape.width ?? 320,
      height: shape.height ?? 240,
      pix_fmt: shape.pixFmt ?? "yuv420p",
      time_base: shape.timeBase ?? ISOBMFF_TIMEBASE,
      r_frame_rate: shape.frameRate ?? "24/1",
    });
  }
  if (shape.audioCodec !== null) {
    streams.push({
      codec_type: "audio",
      codec_name: shape.audioCodec ?? "aac",
      sample_rate: String(shape.sampleRate ?? 44100),
      channels: shape.channels ?? 2,
    });
  }
  return JSON.stringify({
    streams,
    format: { format_name: shape.format, duration: shape.duration.toFixed(6) },
  });
}

const ISOBMFF = "mov,mp4,m4a,3gp,3g2,mj2";
const MATROSKA = "matroska,webm";

/*
  ── TIMEBASES, and why they are on the fixtures ──
  The video stream's `time_base` is the unit its timestamps are counted in, and
  it is the property that separates a join that works from one that re-times a
  track. The repo's two joinable fixtures share one: `sample-video.mp4` and
  `sample-video.mov` both carry a video mdhd timescale of 57600 (read straight
  out of the boxes of the checked-in files), which is exactly why that
  cross-container pair is the one that joins. The other two are the contract's
  measured values — `.mkv` counts in 1/1000 (Matroska's 1 ms timestamp scale)
  and `.avi` in 1/48.
*/
const ISOBMFF_TIMEBASE = "1/57600";
const MATROSKA_TIMEBASE = "1/1000";

/** The repo's own fixtures, as measured. */
const SAMPLE_MP4: ProbeShape = { duration: 2.09, format: ISOBMFF };
const SAMPLE_MOV: ProbeShape = { duration: 2.09, format: ISOBMFF };
const SAMPLE_MKV: ProbeShape = {
  duration: 2.09,
  format: MATROSKA,
  timeBase: MATROSKA_TIMEBASE,
};
const SAMPLE_AVI: ProbeShape = { duration: 2.089796, format: "avi", timeBase: "1/48" };
const SAMPLE_WEBM: ProbeShape = {
  duration: 1.886312,
  format: MATROSKA,
  timeBase: MATROSKA_TIMEBASE,
  videoCodec: "vp8",
  frameRate: "293/12",
  audioCodec: "opus",
  sampleRate: 48000,
};

/*
  An ordinary MP4 that is NOT joinable to `sample-video.mp4`: same container,
  same h264 320x240 yuv420p, same 24/1, same AAC 44100 stereo, and a video
  track that counts in 1/90000 instead of 1/57600. Measured against the shipped
  core, that pair concats to EXIT 0 and a 6.391 s file where 4.180 s went in —
  all 96 video frames stretched across 6.39 s against 4.18 s of audio, so the
  picture ends 2.2 s after its own sound. 90000 is what an MP4 remuxed out of
  MPEG-TS carries (`-i x.ts -c copy out.mp4`, no special flags), so this is an
  ordinary user file, not a constructed one.
*/
const SAMPLE_MP4_TS_TIMEBASE: ProbeShape = { duration: 2.09, format: ISOBMFF, timeBase: "1/90000" };

function clip(name: string, shape: ProbeShape, sizeBytes = 1024): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: sizeBytes });
  probeJsonByFileName.set(name, probeJson(shape));
  return file;
}

/** Straight to the parsed shape, for the pure comparison tests. */
function info(name: string, shape: ProbeShape): MergeInputInfo {
  return {
    fileName: name,
    durationSeconds: shape.duration,
    container: shape.format,
    timeBase: shape.videoCodec === null ? null : (shape.timeBase ?? ISOBMFF_TIMEBASE),
    videoCodec: shape.videoCodec === null ? null : (shape.videoCodec ?? "h264"),
    width: shape.videoCodec === null ? null : (shape.width ?? 320),
    height: shape.videoCodec === null ? null : (shape.height ?? 240),
    pixFmt: shape.videoCodec === null ? null : (shape.pixFmt ?? "yuv420p"),
    frameRate: shape.videoCodec === null ? null : (shape.frameRate ?? "24/1"),
    audioCodec: shape.audioCodec === null ? null : (shape.audioCodec ?? "aac"),
    sampleRate: shape.audioCodec === null ? null : (shape.sampleRate ?? 44100),
    channels: shape.audioCodec === null ? null : (shape.channels ?? 2),
  };
}

beforeEach(() => {
  execCalls.length = 0;
  writtenFiles.length = 0;
  deletedFiles.length = 0;
  unmountCount = 0;
  probeJsonByFileName.clear();
  outputProbeJson = null;
  lastProbedPath = null;
  mountedFileName = null;
  execResult = () => 0;
  vi.clearAllMocks();
});

describe("parseMergeProbe", () => {
  it("reads the fields the comparison refuses on", async () => {
    const { parseMergeProbe } = await import("@/lib/tools/video-merge");
    const parsed = parseMergeProbe(probeJson(SAMPLE_MP4), "sample-video.mp4");

    expect(parsed).toEqual({
      fileName: "sample-video.mp4",
      durationSeconds: 2.09,
      container: ISOBMFF,
      timeBase: ISOBMFF_TIMEBASE,
      videoCodec: "h264",
      width: 320,
      height: 240,
      pixFmt: "yuv420p",
      frameRate: "24/1",
      audioCodec: "aac",
      sampleRate: 44100,
      channels: 2,
    });
  });

  it("finds the video by codec_type, not by index", async () => {
    const { parseMergeProbe } = await import("@/lib/tools/video-merge");
    // A macOS-written HEVC .mov puts its AUDIO stream at index 0 (measured in
    // video-probe.ts), so streams[0] is not the video.
    const json = JSON.stringify({
      streams: [
        { codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 2 },
        { codec_type: "video", codec_name: "hevc", width: 320, height: 240, pix_fmt: "yuv420p" },
      ],
      format: { format_name: ISOBMFF, duration: "2.041910" },
    });

    expect(parseMergeProbe(json, "a.mov").videoCodec).toBe("hevc");
  });

  it("rejects ffprobe's empty failure body", async () => {
    const { parseMergeProbe } = await import("@/lib/tools/video-merge");
    // The literal body ffprobe writes for a file it could not read. It parses.
    expect(() => parseMergeProbe("{\n\n}\n", "notes.txt")).toThrow(/not a video/i);
    expect(() => parseMergeProbe("not json", "notes.txt")).toThrow(/not a video/i);
  });

  it("refuses a clip whose length it cannot read, because the output check needs it", async () => {
    const { parseMergeProbe } = await import("@/lib/tools/video-merge");
    const json = JSON.stringify({ streams: [], format: { format_name: ISOBMFF } });

    expect(() => parseMergeProbe(json, "live.mkv")).toThrow(/how long live\.mkv is/i);
  });
});

describe("compareMergeInputs — the pre-flight refusal", () => {
  it("passes two clips written from the same source", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    expect(
      compareMergeInputs([info("a.mp4", SAMPLE_MP4), info("b.mp4", SAMPLE_MP4)]),
    ).toEqual([]);
  });

  it("passes .mp4 beside .mov — measured EXIT 0, expected 4.180, got 4.180", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    // MP4 and MOV share one demuxer and one ffprobe format_name, and they
    // measurably join. Comparing by EXTENSION would wrongly refuse this.
    expect(
      compareMergeInputs([info("a.mp4", SAMPLE_MP4), info("b.mov", SAMPLE_MOV)]),
    ).toEqual([]);
  });

  it("refuses .mp4 beside .mkv, which agrees on every stream property and still loses the clip", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    /*
      THE TEST THIS FILE EXISTS FOR. Measured: EXIT 0, expected 4.180 s, got
      2.090 s — the second clip vanished. Same h264, same 320x240, same
      yuv420p, same aac 44100 stereo. Only the container differs.
    */
    const mismatches = compareMergeInputs([info("a.mp4", SAMPLE_MP4), info("b.mkv", SAMPLE_MKV)]);

    expect(mismatches).toEqual([
      { fileName: "b.mkv", property: "file format", expected: "MP4/MOV", found: "MKV/WebM" },
      // The container is what the user recognises, so it is named first — but
      // the timebase is the mechanism, and it is reported too rather than
      // being folded into the container row and lost.
      { fileName: "b.mkv", property: "video timebase", expected: "1/57600", found: "1/1000" },
    ]);
  });

  it("refuses .mp4 beside .avi — the other measured silent loss", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    const mismatches = compareMergeInputs([info("a.mp4", SAMPLE_MP4), info("b.avi", SAMPLE_AVI)]);

    expect(mismatches.map((m) => m.property)).toContain("file format");
    expect(mismatches[0].found).toBe("AVI");
  });

  it("refuses two MP4s that differ only in how their video counts time", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    /*
      CONTRACT PART 7 C1, and the case the container check cannot see: same
      `format_name`, same h264 320x240 yuv420p, same 24/1, same AAC 44100
      stereo. Measured on the shipped core, this pair concats to EXIT 0 and a
      6.391 s file where 4.180 s went in, with the picture ending 2.2 s after
      its own sound. Nothing in COMPARED except the timebase separates them.
    */
    const mismatches = compareMergeInputs([
      info("a.mp4", SAMPLE_MP4),
      info("from-a-stream.mp4", SAMPLE_MP4_TS_TIMEBASE),
    ]);

    expect(mismatches).toEqual([
      {
        fileName: "from-a-stream.mp4",
        property: "video timebase",
        expected: "1/57600",
        found: "1/90000",
      },
    ]);
  });

  it("still passes a pair that agrees on the timebase, so the refusal is not blanket", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    // The measured 1/12288 and 1/16000 cases both lose the picture, so the
    // fear behind NOT comparing this — that it would turn away joins that
    // work — has to be answered by a passing pair, not by an assertion.
    expect(
      compareMergeInputs([
        info("a.mp4", SAMPLE_MP4),
        info("b.mov", { ...SAMPLE_MOV, timeBase: "1/57600" }),
      ]),
    ).toEqual([]);
  });

  it("names every property that differs on a genuinely different clip", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    const mismatches = compareMergeInputs([info("a.mp4", SAMPLE_MP4), info("b.webm", SAMPLE_WEBM)]);
    const named = mismatches.map((m) => m.property);

    expect(named).toContain("file format");
    expect(named).toContain("video codec");
    expect(named).toContain("audio codec");
    expect(named).toContain("audio sample rate");
    expect(mismatches.every((m) => m.fileName === "b.webm")).toBe(true);
  });

  it.each([
    ["frame width", { width: 640 }],
    ["frame height", { height: 480 }],
    ["pixel format", { pixFmt: "yuv422p" }],
    ["audio channels", { channels: 1 }],
  ] as const)("refuses on %s", async (property, override) => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    const mismatches = compareMergeInputs([
      info("a.mp4", SAMPLE_MP4),
      info("b.mp4", { ...SAMPLE_MP4, ...override }),
    ]);

    expect(mismatches.map((m) => m.property)).toContain(property);
  });

  it("says 'audio track' once rather than repeating it as four audio differences", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    // The measured M5 pair: 320x240 h264+aac beside 640x480 h264 with NO audio.
    const mismatches = compareMergeInputs([
      info("a.mp4", SAMPLE_MP4),
      info("big.mp4", { ...SAMPLE_MP4, width: 640, height: 480, audioCodec: null }),
    ]);
    const named = mismatches.map((m) => m.property);

    expect(named).toContain("audio track");
    expect(named).not.toContain("audio codec");
    expect(named).not.toContain("audio sample rate");
  });

  it("does NOT refuse on frame rate, which nothing measured says loses a clip", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    expect(
      compareMergeInputs([
        info("a.mp4", SAMPLE_MP4),
        info("b.mp4", { ...SAMPLE_MP4, frameRate: "30000/1001" }),
      ]),
    ).toEqual([]);
  });

  it("has nothing to compare against a single clip", async () => {
    const { compareMergeInputs } = await import("@/lib/tools/video-merge");
    expect(compareMergeInputs([info("a.mp4", SAMPLE_MP4)])).toEqual([]);
    expect(compareMergeInputs([])).toEqual([]);
  });
});

describe("describeMismatches", () => {
  it("names the file and the property, never 'incompatible files'", async () => {
    const { compareMergeInputs, describeMismatches } = await import("@/lib/tools/video-merge");
    const mismatches = compareMergeInputs([info("a.mp4", SAMPLE_MP4), info("b.mkv", SAMPLE_MKV)]);
    const message = describeMismatches(mismatches, "a.mp4");

    expect(message).toContain("b.mkv");
    expect(message).toContain("file format");
    expect(message).toContain("MKV/WebM");
    expect(message).toContain("MP4/MOV");
    expect(message).not.toMatch(/incompatible/i);
  });

  it("counts the differences it did not spell out", async () => {
    const { compareMergeInputs, describeMismatches } = await import("@/lib/tools/video-merge");
    const mismatches = compareMergeInputs([info("a.mp4", SAMPLE_MP4), info("b.webm", SAMPLE_WEBM)]);

    expect(describeMismatches(mismatches, "a.mp4")).toMatch(/\d+ other differences/);
  });
});

describe("the concat manifest and its argv", () => {
  it("writes one quoted line per input, in join order", async () => {
    const { concatListText } = await import("@/lib/tools/video-merge");
    expect(concatListText(["in0.mp4", "in1.mp4"])).toBe("file 'in0.mp4'\nfile 'in1.mp4'\n");
  });

  it("refuses a name that could break out of the manifest's quoting", async () => {
    const { concatListText } = await import("@/lib/tools/video-merge");
    // Never reachable from `memfsInputName`, which is the point — the guard
    // asserts the property instead of trusting the comment.
    expect(() => concatListText(["it's mine.mp4"])).toThrow(/unsafe name/i);
    expect(() => concatListText(["a\nfile 'b.mp4'"])).toThrow(/unsafe name/i);
  });

  it("names inputs from their index, never from what the user called them", async () => {
    const { memfsInputName } = await import("@/lib/tools/video-merge");
    const nasty = new File([new Uint8Array([1])], "it's a 'clip'.mp4", { type: "video/mp4" });

    expect(memfsInputName(0, nasty)).toBe("in0.mp4");
    expect(memfsInputName(3, new File([new Uint8Array([1])], "x.mkv"))).toBe("in3.mkv");
  });

  it("is exactly the argv that was measured, with nothing added", async () => {
    const { concatArgs } = await import("@/lib/tools/video-merge");
    expect(concatArgs("concat-list.txt", "merged.mp4")).toEqual([
      "-f", "concat",
      "-safe", "0",
      "-i", "concat-list.txt",
      "-c", "copy",
      "merged.mp4",
    ]);
  });
});

describe("isStreamCopyArgs — where the 'nothing was re-encoded' claim comes from", () => {
  it("is true for the concat argv", async () => {
    const { concatArgs, isStreamCopyArgs } = await import("@/lib/tools/video-merge");
    expect(isStreamCopyArgs(concatArgs("l.txt", "o.mp4"))).toBe(true);
  });

  it("is false the moment an encoder is selected", async () => {
    const { isStreamCopyArgs } = await import("@/lib/tools/video-merge");
    expect(isStreamCopyArgs(["-i", "l.txt", "-c:v", "libx264", "-c:a", "copy", "o.mp4"])).toBe(false);
    expect(isStreamCopyArgs(["-i", "l.txt", "o.mp4"])).toBe(false);
  });
});

describe("mergeVideos", () => {
  it("joins a compatible set and reports it as a stream copy", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    outputProbeJson = JSON.stringify({ format: { duration: "4.180000" } });

    const result = await mergeVideos(files);

    expect(execCalls).toEqual([
      ["-f", "concat", "-safe", "0", "-i", "concat-list.txt", "-c", "copy", "merged.mp4"],
    ]);
    expect(result.streamCopied).toBe(true);
    expect(result.fileName).toBe("a-joined.mp4");
    expect(result.totalSeconds).toBeCloseTo(4.18, 5);
    expect(result.outputSeconds).toBe(4.18);
    expect(result.inputs.map((i) => i.fileName)).toEqual(["a.mp4", "b.mp4"]);
  });

  it("writes the inputs under generated names and lists those, not the user's filenames", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [clip("it's a 'clip'.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    outputProbeJson = JSON.stringify({ format: { duration: "4.180000" } });

    await mergeVideos(files);

    expect(writtenFiles.map((w) => w.name)).toEqual(["in0.mp4", "in1.mp4", "concat-list.txt"]);
    const list = writtenFiles.find((w) => w.name === "concat-list.txt");
    expect(list?.text).toBe("file 'in0.mp4'\nfile 'in1.mp4'\n");
    expect(list?.text).not.toContain("clip");
  });

  it("refuses a mismatched set BEFORE running anything", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    // The measured pair: identical streams, different container, and FFmpeg
    // would have exited 0 with the second clip missing.
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mkv", SAMPLE_MKV)];

    await expect(mergeVideos(files)).rejects.toThrow(/b\.mkv[\s\S]*file format/i);
    expect(execCalls).toHaveLength(0);
    expect(writtenFiles).toHaveLength(0);
  });

  it("throws when the joined file came out short, even though FFmpeg exited 0", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    /*
      A replay of the measurement, with the pre-flight passing: exit 0, and a
      file holding only the first clip. Nothing but this check stands between
      that and a download the user believes is complete.
    */
    outputProbeJson = JSON.stringify({ format: { duration: "2.090000" } });

    await expect(mergeVideos(files)).rejects.toThrow(/dropped content/i);
    await expect(mergeVideos(files)).rejects.toThrow(/2\.09 s/);
  });

  it("accepts a shortfall inside the rounding tolerance", async () => {
    const { mergeVideos, DURATION_TOLERANCE_SECONDS } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    outputProbeJson = JSON.stringify({
      format: { duration: String(4.18 - DURATION_TOLERANCE_SECONDS / 2) },
    });

    await expect(mergeVideos(files)).resolves.toBeTruthy();
  });

  it("throws when the joined file cannot be read back at all", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    outputProbeJson = null; // ffprobe wrote nothing for the output.

    await expect(mergeVideos(files)).rejects.toThrow(/no way to check/i);
  });

  it("deletes every temp file when the output check refuses the join", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    outputProbeJson = JSON.stringify({ format: { duration: "2.090000" } });

    await expect(mergeVideos(files)).rejects.toThrow();

    // The inputs are WRITTEN into MEMFS here, not mounted — each is a JS array
    // on the worker heap, so a failed join that left them behind would take
    // the next job's memory with it.
    expect(deletedFiles).toContain("in0.mp4");
    expect(deletedFiles).toContain("in1.mp4");
    expect(deletedFiles).toContain("concat-list.txt");
    expect(deletedFiles).toContain("merged.mp4");
    expect(deletedFiles).toContain("merge-probe.json");
  });

  it("unmounts after every probe, including when the set is refused", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mkv", SAMPLE_MKV)];

    await expect(mergeVideos(files)).rejects.toThrow();
    expect(unmountCount).toBe(2);
  });

  it("refuses fewer than two clips", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    await expect(mergeVideos([clip("a.mp4", SAMPLE_MP4)])).rejects.toThrow(/at least two/i);
  });

  it("checks each clip against the stream-copy cap and the set against the total", async () => {
    const { mergeVideos, describeSizeRefusal } = await import("@/lib/tools/video-merge");
    const gb = 1024 * 1024 * 1024;
    const files = [clip("a.mp4", SAMPLE_MP4, gb), clip("b.mp4", SAMPLE_MP4, gb)];

    await expect(mergeVideos(files)).rejects.toThrow(/in total/i);
    expect(validateFFmpegInput).toHaveBeenCalledWith(files[0], "stream-copy");
    expect(execCalls).toHaveLength(0);
    // The engine throws the page's own sentence, not a second wording of it —
    // that shared string is what lets the page refuse before the click.
    await expect(mergeVideos(files)).rejects.toThrow(describeSizeRefusal(files) as string);
  });

  it("says so when the clips do not share a frame rate, without refusing them", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [
      clip("a.mp4", SAMPLE_MP4),
      clip("b.mp4", { ...SAMPLE_MP4, frameRate: "30000/1001" }),
    ];
    outputProbeJson = JSON.stringify({ format: { duration: "4.180000" } });

    const result = await mergeVideos(files);

    expect(result.warnings?.some((w) => /frame rate/i.test(w))).toBe(true);
    expect(result.warnings?.[0]).toContain("24/1");
  });

  it("throws when the joined file runs LONGER than the sum of its parts", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    /*
      The other half of the measurement, and the half this file used to get
      wrong: 5.234 s written where 4.132 s went in (the hevc row), 6.391 s
      where 4.180 s went in (the 1/90000 timebase row). Copying clips across
      cannot add time, so an over-long file is a re-timed track — measured, a
      picture stretched to 6.39 s against 4.18 s of audio. It used to be a
      warning that said "nothing is missing... a player may pause for a
      moment" beside a live download button. It is a refusal.
    */
    outputProbeJson = JSON.stringify({ format: { duration: "5.234000" } });

    await expect(mergeVideos(files)).rejects.toThrow(/rewrote the clips' timing/i);
    await expect(mergeVideos(files)).rejects.toThrow(/5\.23 s/);
    await expect(mergeVideos(files)).rejects.not.toThrow(/nothing is missing/i);
  });

  it("accepts an overrun inside the rounding tolerance", async () => {
    const { mergeVideos, DURATION_TOLERANCE_SECONDS } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    // Two-sided does not mean twitchy: every measured good join — 2, 4, 8, 16
    // and 32 identical clips, and an audio-less pair — lands on delta 0.000,
    // so the tolerance is there for three-decimal rounding at each seam.
    outputProbeJson = JSON.stringify({
      format: { duration: String(4.18 + DURATION_TOLERANCE_SECONDS / 2) },
    });

    await expect(mergeVideos(files)).resolves.toBeTruthy();
  });

  it("hands over no download and no warning when the file came out long", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    outputProbeJson = JSON.stringify({ format: { duration: "6.391000" } });

    // The whole defect was that this resolved: the page rendered the warning,
    // printed "6.39 S OF PICTURE AND SOUND, COPIED ACROSS BYTE FOR BYTE" and
    // lit the download for a file whose sound ran out at 4.18 s.
    await expect(mergeVideos(files)).rejects.toThrow();
    // And the temps go, on this path as on the short one.
    expect(deletedFiles).toContain("merged.mp4");
  });

  it("reports monotonic progress across probing and joining", async () => {
    const { mergeVideos } = await import("@/lib/tools/video-merge");
    const files = [clip("a.mp4", SAMPLE_MP4), clip("b.mp4", SAMPLE_MP4)];
    outputProbeJson = JSON.stringify({ format: { duration: "4.180000" } });
    const seen: number[] = [];

    await mergeVideos(files, { onProgress: (p) => seen.push(p) });

    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[seen.length - 1]).toBe(100);
  });
});
