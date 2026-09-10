import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  What is under test is the DECISION and the READING, not the DSP: which argv
  this module hands FFmpeg, and what it believes about a run afterwards. The
  core is mocked; every measurement the module acts on was taken against the
  real one (headless Chromium, the shipped `public/ffmpeg-core.wasm`,
  2026-09-05) and is recorded in the module header.

  THE LOG FIXTURE BELOW IS NOT INVENTED. `PASS1_LOG` is the complete 40-line
  stderr of

    -i in.wav -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -

  on `sample-audio.wav` (44 100 Hz stereo, 2 s), captured line-by-line through
  the same `on("log")` event the shipped loader uses. Three properties of it are
  load-bearing and none of them would survive a hand-written fixture:
    · the JSON object is split across THIRTEEN separate log lines;
    · every value is a STRING, not a number;
    · line [20] is a second `Stream #0:0: … Audio:` line reading 192000 Hz —
      loudnorm's own output link, and the decoy that makes a naive sample-rate
      read pin `-ar 192000` onto the file.
*/
const PASS1_LOG: string[] = [
  "ffmpeg version 5.1.4 Copyright (c) 2000-2023 the FFmpeg developers",
  "  built with emcc (Emscripten gcc/clang-like replacement + linker emulating GNU ld) 3.1.40 (5c27e79dd0a9c4e27ef2326841698cdd4f6b5784)",
  "  configuration: --target-os=none --arch=x86_32 --enable-cross-compile --disable-asm",
  "  libavutil      57. 28.100 / 57. 28.100",
  "  libavcodec     59. 37.100 / 59. 37.100",
  "  libavformat    59. 27.100 / 59. 27.100",
  "  libavdevice    59.  7.100 / 59.  7.100",
  "  libavfilter     8. 44.100 /  8. 44.100",
  "  libswscale      6.  7.100 /  6.  7.100",
  "  libswresample   4.  7.100 /  4.  7.100",
  "  libpostproc    56.  6.100 / 56.  6.100",
  "Guessed Channel Layout for Input Stream #0.0 : stereo",
  "Input #0, wav, from 'in.wav':",
  "  Duration: 00:00:02.00, bitrate: 1411 kb/s",
  "  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s",
  "Stream mapping:",
  "  Stream #0:0 -> #0:0 (pcm_s16le (native) -> pcm_s16le (native))",
  "Output #0, null, to 'pipe:':",
  "  Metadata:",
  "    encoder         : Lavf59.27.100",
  "  Stream #0:0: Audio: pcm_s16le, 192000 Hz, stereo, s16, 6144 kb/s",
  "    Metadata:",
  "      encoder         : Lavc59.37.100 pcm_s16le",
  "size=N/A time=00:00:00.00 bitrate=N/A speed=N/A    ",
  "size=N/A time=00:00:02.00 bitrate=N/A speed=60.4x    ",
  "video:0kB audio:1500kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: unknown",
  "[Parsed_loudnorm_0 @ 0xe30af0] ",
  "{",
  '\t"input_i" : "-9.56",',
  '\t"input_tp" : "-8.72",',
  '\t"input_lra" : "0.00",',
  '\t"input_thresh" : "-19.56",',
  '\t"output_i" : "-15.96",',
  '\t"output_tp" : "-15.17",',
  '\t"output_lra" : "0.00",',
  '\t"output_thresh" : "-25.96",',
  '\t"normalization_type" : "linear",',
  '\t"target_offset" : "-0.04"',
  "}",
  "Aborted()",
];

/*
  THE SAME LOG WITH A 96 kHz INPUT LINE. Only line [14] differs — the INPUT
  stream — and that is the point: the fixture that used to test the MP3 rate
  ceiling set the sniff to 96 000 while leaving this log saying 44 100, a file
  that cannot exist. It passed only because the sniff outranked the log, which
  is the ordering the HE-AAC measurement showed to be wrong. A coherent fixture
  is what lets the ordering be fixed.
*/
const PASS1_LOG_96K: string[] = PASS1_LOG.map((line) =>
  line.includes("Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz")
    ? line.replace("44100 Hz", "96000 Hz")
    : line,
);

/*
  PASS 2's OWN JSON, which is the only thing that can say whether `linear=true`
  was honoured. Captured from a run whose filtergraph carried the full
  `measured_*` set plus `linear=true` — and which loudnorm nevertheless ran
  DYNAMICALLY, because the linear offset would have breached the target's
  true-peak ceiling. There is no warning line anywhere in the run; this object
  is the whole of the evidence.
*/
const PASS2_DYNAMIC_LOG: string[] = [
  "  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s",
  "Output #0, wav, to 'normalized.wav':",
  "  Stream #0:0: Audio: pcm_s16le, 44100 Hz, stereo, s16, 1411 kb/s",
  "size=     344kB time=00:00:02.00 bitrate=1411.5kbits/s speed= 30x",
  "[Parsed_loudnorm_0 @ 0xe71450] ",
  "{",
  '\t"input_i" : "-28.17",',
  '\t"input_tp" : "-0.45",',
  '\t"input_lra" : "2.70",',
  '\t"input_thresh" : "-38.17",',
  '\t"output_i" : "-17.13",',
  '\t"output_tp" : "-1.50",',
  '\t"output_lra" : "0.20",',
  '\t"output_thresh" : "-27.13",',
  '\t"normalization_type" : "dynamic",',
  '\t"target_offset" : "1.13"',
  "}",
];

/** The same, for a run loudnorm did honour. */
const PASS2_LINEAR_LOG: string[] = PASS2_DYNAMIC_LOG.map((line) =>
  line.includes('"normalization_type"') ? '\t"normalization_type" : "linear",' : line,
);

/*
  Captured the same way, from a digitally silent 2 s stereo source. This is the
  measured trigger for the single-pass fallback: `-inf` is not a number that can
  be fed back as `measured_I`, and the run has to notice.
*/
const SILENT_PASS1_LOG: string[] = [
  "  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s",
  "Output #0, null, to 'pipe:':",
  "[Parsed_loudnorm_0 @ 0xe31740] ",
  "{",
  '\t"input_i" : "-inf",',
  '\t"input_tp" : "-inf",',
  '\t"input_lra" : "0.00",',
  '\t"input_thresh" : "-70.00",',
  '\t"output_i" : "-inf",',
  '\t"output_tp" : "-inf",',
  '\t"output_lra" : "0.00",',
  '\t"output_thresh" : "-70.00",',
  '\t"normalization_type" : "linear",',
  '\t"target_offset" : "inf"',
  "}",
  "Aborted()",
];

/*
  A real `silenceremove` run's log, both ends trimmed off the 5.500 s gap
  fixture. ffprobe said the output was 3.50 s; the last `time=` line says 03.49,
  which is the ~0.05 s the module documents and refuses to over-report.
*/
const SILENCE_LOG: string[] = [
  "Input #0, wav, from 'gap.wav':",
  "  Duration: 00:00:05.50, bitrate: 1411 kb/s",
  "  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s",
  "Output #0, wav, to 'desilenced.wav':",
  "  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, stereo, s16, 1411 kb/s",
  "size=       0kB time=00:00:00.00 bitrate=N/A speed=N/A    ",
  "size=     603kB time=00:00:03.49 bitrate=1411.4kbits/s speed= 556x",
  "video:0kB audio:603kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: 0.006871%",
  "Aborted()",
];

const { mockExec, mockReadFile, mockDeleteFile, mockMountInputFile, mockUnmountInputFile } =
  vi.hoisted(() => ({
    mockExec: vi.fn(),
    mockReadFile: vi.fn(),
    mockDeleteFile: vi.fn(),
    mockMountInputFile: vi.fn(),
    mockUnmountInputFile: vi.fn(),
  }));

/*
  The queue of log batches the fake core "prints", one batch per `exec`. This is
  what stands in for the scoped `onLog` sink added to ffmpeg-loader.ts: the mock
  below hands each batch to whatever callback the module passed in `ctx.onLog`,
  which is exactly the plumbing the real loader provides.
*/
let logBatches: string[][] = [];
let lastCtx: { onLog?: (line: string) => void; onProgress?: (p: number) => void } = {};

vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  runFFmpegTask: vi.fn(
    (
      task: (f: unknown) => Promise<unknown>,
      ctx: { onLog?: (line: string) => void; onProgress?: (p: number) => void } = {},
    ) => {
      lastCtx = ctx;
      return task({
        exec: mockExec,
        readFile: mockReadFile,
        deleteFile: mockDeleteFile,
      });
    },
  ),
  mountInputFile: mockMountInputFile,
  unmountInputFile: mockUnmountInputFile,
}));

const { mockSniffSampleRate } = vi.hoisted(() => ({ mockSniffSampleRate: vi.fn() }));

vi.mock("@/lib/tools/audio-decode", () => ({
  sniffSampleRate: mockSniffSampleRate,
  decodeAudioFile: vi.fn(),
}));

/*
  THE WEB AUDIO HALF NEEDS THREE SEAMS AND NOTHING ELSE. `changeAudioVolume` and
  `reverseAudio` are the real functions in every case below; only the decode, the
  worker-pool encoders and jsdom's missing `OfflineAudioContext` are stood in
  for. The encoders record the buffer they are handed, which is the only place
  the delivered channel count and rate can be observed — the whole subject of
  these cases.
*/
vi.mock("@/lib/workers/audio-client", () => ({
  encodeWav: vi.fn(async () => new Blob(["wav-data"], { type: "audio/wav" })),
  encodeMp3: vi.fn(async () => new Blob(["mp3-data"], { type: "audio/mpeg" })),
}));

vi.mock("@/lib/tools/audio-encode-mp3", () => ({
  /*
    Faithful to `resampleForMp3` (audio-encode-mp3.ts:23-33) rather than a
    pass-through: it returns the buffer untouched at or below the ceiling and
    otherwise re-renders it at 48 kHz with at most two channels. The delivered
    rate is exactly what these cases are about, so a pass-through would hide the
    behaviour under test.
  */
  resampleForMp3: vi.fn(async (buffer: AudioBuffer) => {
    if (buffer.sampleRate <= 48000) return buffer;
    const channels = Math.min(buffer.numberOfChannels, 2);
    const length = Math.ceil(buffer.duration * 48000);
    const data: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) data.push(new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate: 48000,
      duration: length / 48000,
      getChannelData: (ch: number) => data[ch],
    } as unknown as AudioBuffer;
  }),
}));

function MockOfflineAudioContext(channels: number, length: number, sampleRate: number) {
  return {
    createBuffer: (ch: number, len: number, rate: number) => {
      const data: Float32Array[] = [];
      for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
      return {
        numberOfChannels: ch,
        length: len,
        sampleRate: rate,
        duration: len / rate,
        getChannelData: (i: number) => data[i],
      };
    },
    numberOfChannels: channels,
    length,
    sampleRate,
  };
}
vi.stubGlobal("OfflineAudioContext", MockOfflineAudioContext);

import {
  NORMALIZE_TARGETS,
  changeAudioVolume,
  foldToStereo,
  gainFromDb,
  loudnormPass1Args,
  loudnormPass2Args,
  mp3SafeSampleRate,
  normalizeAudio,
  outputSampleRateFor,
  parseInputDurationSeconds,
  parseLoudnormStats,
  parseNormalizationType,
  parseOutputDurationSeconds,
  parseOutputSampleRate,
  parseSourceSampleRate,
  peakOfChannels,
  removeSilence,
  reverseAudio,
  silenceRemoveFilter,
} from "@/lib/tools/audio-effects";
import { MAX_MP3_SAMPLE_RATE } from "@/lib/tools/audio-pcm";
import { decodeAudioFile } from "@/lib/tools/audio-decode";
import { encodeMp3, encodeWav } from "@/lib/workers/audio-client";

const audio = () => new File(["a"], "episode-12.mp3", { type: "audio/mpeg" });

/** A decoded buffer with the samples the case actually cares about. */
function decoded(channelData: Float32Array[], sampleRate: number): AudioBuffer {
  const length = channelData[0]?.length ?? 0;
  return {
    numberOfChannels: channelData.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (ch: number) => channelData[ch],
  } as unknown as AudioBuffer;
}

/** What the encoder was handed: the shape it will actually write. */
function encoded(mock: typeof encodeMp3 | typeof encodeWav): {
  sampleRate: number;
  channels: number;
  data: Float32Array[];
} {
  const buffer = vi.mocked(mock).mock.calls[0][0];
  const data: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) data.push(buffer.getChannelData(ch));
  return { sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, data };
}

/** Every argv this run handed to FFmpeg. */
const argvs = (): string[][] => mockExec.mock.calls.map((c) => c[0] as string[]);

/** The value that follows `flag` in an argv, or undefined. */
const valueAfter = (argv: string[], flag: string): string | undefined => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

beforeEach(() => {
  vi.clearAllMocks();
  logBatches = [];
  lastCtx = {};
  mockSniffSampleRate.mockReturnValue(null);
  mockMountInputFile.mockImplementation((_f: unknown, _file: File, name: string) =>
    Promise.resolve(`/mnt-input/${name}`),
  );
  mockUnmountInputFile.mockResolvedValue(undefined);
  mockDeleteFile.mockResolvedValue(undefined);
  mockReadFile.mockResolvedValue(new Uint8Array([0x00, 0x01, 0x02]));
  mockExec.mockImplementation(async () => {
    for (const line of logBatches.shift() ?? []) lastCtx.onLog?.(line);
    return 0;
  });
});

describe("parseLoudnormStats — reading pass 1 out of the log", () => {
  it("parses the real captured log, whose values are strings across 13 lines", () => {
    expect(parseLoudnormStats(PASS1_LOG)).toEqual({
      input_i: -9.56,
      input_tp: -8.72,
      input_lra: 0,
      input_thresh: -19.56,
      target_offset: -0.04,
    });
  });

  it("survives the trailing Aborted() that ends EVERY -f null - run", () => {
    // Measured: exit 0, JSON present, instance healthy for 15+ later jobs. It
    // is noise, not a trap, and the parser must not be thrown by it.
    expect(PASS1_LOG[PASS1_LOG.length - 1]).toBe("Aborted()");
    const withoutIt = PASS1_LOG.slice(0, -1);
    expect(parseLoudnormStats(withoutIt)).toEqual(parseLoudnormStats(PASS1_LOG));
  });

  it("refuses the -inf a silent source really produces", () => {
    // The measured fallback trigger: `measured_I=-inf` is not something pass 2
    // can be given, so the run has to drop to single-pass instead.
    expect(parseLoudnormStats(SILENT_PASS1_LOG)).toBeNull();
  });

  it("refuses a spelled-out Infinity too, not just the NaN that -inf becomes", () => {
    /*
      `Number("-inf")` is NaN, so the shipped core's silent-file output is
      caught by the NaN half alone — which left the `Number.isFinite` half
      unguarded. JSON cannot carry a bare Infinity, but it CAN carry the string,
      and `Number("-Infinity")` really is -Infinity. A build that spelled it out
      would otherwise pass `measured_I=-Infinity` into the filtergraph.
    */
    const spelled = [
      "{",
      '\t"input_i" : "-Infinity",',
      '\t"input_tp" : "-1.0",',
      '\t"input_lra" : "0.00",',
      '\t"input_thresh" : "-70.00",',
      '\t"target_offset" : "0.00"',
      "}",
    ];
    expect(Number("-Infinity")).toBe(Number.NEGATIVE_INFINITY);
    expect(parseLoudnormStats(spelled)).toBeNull();
  });

  it("returns null when there is no object at all", () => {
    expect(parseLoudnormStats(["ffmpeg version 5.1.4", "Aborted()"])).toBeNull();
  });

  it("returns null on a truncated object rather than throwing", () => {
    expect(parseLoudnormStats(["{", '\t"target_offset" : "-0.0', "}"])).toBeNull();
  });

  it("takes the LAST object when a caller collected across both passes", () => {
    const stats = parseLoudnormStats([...PASS1_LOG, ...SILENT_PASS1_LOG]);
    expect(stats).toBeNull();
  });
});

describe("parseNormalizationType — the mode loudnorm actually used", () => {
  /*
    `linear=true` in the filtergraph proves linear was REQUESTED. Loudnorm
    abandons it whenever the linear offset would push the true peak past the
    target ceiling — measured against the shipped core, that is most unmastered
    speech and music — and it says nothing at all when it does: dumping every
    log line of a fallback run found only an empty `[Parsed_loudnorm_0]` banner,
    and `strings` over the wasm carries no fallback message. Pass 2's own JSON
    is the entire evidence, which is why `loudnormPass2Args` asks for it.
  */
  it("reads DYNAMIC out of a pass-2 run that was asked for linear", () => {
    expect(PASS2_DYNAMIC_LOG.join(" ")).toContain("dynamic");
    expect(parseNormalizationType(PASS2_DYNAMIC_LOG)).toBe("dynamic");
  });

  it("reads LINEAR out of a run that got what it asked for", () => {
    expect(parseNormalizationType(PASS2_LINEAR_LOG)).toBe("linear");
  });

  it("returns null when loudnorm printed no object, so nobody can guess a mode", () => {
    expect(parseNormalizationType(["ffmpeg version 5.1.4", "Aborted()"])).toBeNull();
  });

  it("returns null on a value this module has never seen", () => {
    expect(
      parseNormalizationType(["{", '\t"normalization_type" : "something-new",', "}"]),
    ).toBeNull();
  });
});

describe("parseOutputSampleRate — what was WRITTEN, not what was read", () => {
  /*
    The exact complement of `parseSourceSampleRate`: that one stops AT the
    `Output #` bound, this one starts there. `removeSilence` passes no `-ar`, so
    on the MP3 arm FFmpeg picks a rate of its own — measured, 96 kHz and
    88.2 kHz sources both came back at 48 kHz — and the only way to say so is to
    read the line it printed.
  */
  const RESAMPLED_LOG = [
    "Input #0, wav, from 'in.wav':",
    "  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 96000 Hz, stereo, s16",
    "Output #0, mp3, to 'desilenced.mp3':",
    "  Stream #0:0: Audio: mp3, 48000 Hz, stereo, fltp, 192 kb/s",
  ];

  it("reads the OUTPUT stream's rate past the input line of the same shape", () => {
    expect(parseSourceSampleRate(RESAMPLED_LOG)).toBe(96000);
    expect(parseOutputSampleRate(RESAMPLED_LOG)).toBe(48000);
  });

  it("returns null when the log never reached an Output # section", () => {
    expect(parseOutputSampleRate(RESAMPLED_LOG.slice(0, 2))).toBeNull();
  });
});

describe("parseSourceSampleRate — the 192 kHz decoy", () => {
  it("reads the INPUT's 44100, not loudnorm's 192000 output link", () => {
    /*
      Both lines say `Stream #0:0: … Audio:`. The second one is the filter's own
      192 kHz output, and reading it would pin `-ar 192000` onto the file —
      turning the fix into the exact bug it exists to prevent.
    */
    expect(PASS1_LOG.some((l) => l.includes("192000 Hz"))).toBe(true);
    expect(parseSourceSampleRate(PASS1_LOG)).toBe(44100);
  });

  it("stops at Output #, so an unreadable input never borrows the filter's rate", () => {
    /*
      The first test above passes even without the `Output #` bound, because the
      input line comes first and the scan returns on its first hit. This is the
      case that makes the bound load-bearing: a container whose input stream
      line FFmpeg did not print (or printed in a shape this regex misses) leaves
      only loudnorm's own 192 kHz output link in the log — and answering 192000
      there would pin the trap onto the file while looking like a successful
      read. Answering null is what sends it to the 44 100 fallback instead.
    */
    const noInputLine = PASS1_LOG.filter((l) => !l.includes("44100 Hz"));
    expect(noInputLine.some((l) => l.includes("192000 Hz"))).toBe(true);
    expect(parseSourceSampleRate(noInputLine)).toBeNull();
  });

  it("returns null when the log carries no audio stream line", () => {
    expect(parseSourceSampleRate(["ffmpeg version 5.1.4", "Aborted()"])).toBeNull();
  });

  it("rejects a rate outside the sane band", () => {
    expect(parseSourceSampleRate(["  Stream #0:0: Audio: pcm_s16le, 4 Hz, mono"])).toBeNull();
  });
});

describe("duration parsing — FFmpeg's own centiseconds", () => {
  it("reads the source duration from the Duration: header", () => {
    expect(parseInputDurationSeconds(SILENCE_LOG)).toBeCloseTo(5.5, 3);
  });

  it("reads the written duration from the LAST time= line", () => {
    // ffprobe said 3.50 on this very output; 3.49 is the resolution FFmpeg
    // reports at, which is why nothing rounds this to more than a tenth.
    expect(parseOutputDurationSeconds(SILENCE_LOG)).toBeCloseTo(3.49, 3);
  });

  it("floors a negative time= at zero instead of reporting negative audio", () => {
    expect(parseOutputDurationSeconds(["size=0kB time=-00:00:00.01 bitrate=N/A"])).toBe(0);
  });

  it("returns null when nothing was reported", () => {
    expect(parseInputDurationSeconds(["Aborted()"])).toBeNull();
    expect(parseOutputDurationSeconds(["Aborted()"])).toBeNull();
  });
});

describe("loudnorm argv builders", () => {
  const podcast = NORMALIZE_TARGETS.podcast;

  it("pass 1 measures and writes nothing", () => {
    expect(loudnormPass1Args("/mnt-input/input.wav", podcast)).toEqual([
      "-i", "/mnt-input/input.wav",
      "-map", "0:a:0",
      "-vn",
      "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json",
      "-f", "null", "-",
    ]);
  });

  it("PASS 2 CARRIES -ar AT THE SOURCE RATE — the whole point of this module", () => {
    /*
      MEASURED, 44 100 Hz stereo 2 s WAV, shipped core:
        without -ar : pcm_s16le 192000 Hz, 1 536 102 B
        with -ar    : pcm_s16le  44100 Hz,   352 878 B
      Deleting the two `-ar` entries from `loudnormPass2Args` makes this
      assertion fail, which is the point of writing it this way.
    */
    const argv = loudnormPass2Args(
      "/mnt-input/input.wav",
      "normalized.wav",
      podcast,
      { input_i: -9.56, input_tp: -8.72, input_lra: 0, input_thresh: -19.56, target_offset: -0.04 },
      44100,
      ["-c:a", "pcm_s16le"],
    );

    expect(argv).toContain("-ar");
    expect(valueAfter(argv, "-ar")).toBe("44100");
    // And as an OUTPUT option: before the codec, after the filter. The
    // in-filtergraph `aresample` form was measured to EXIT 1.
    expect(argv.indexOf("-ar")).toBeGreaterThan(argv.indexOf("-af"));
    expect(argv.indexOf("-ar")).toBeLessThan(argv.indexOf("-c:a"));
  });

  it("feeds every measured field back, and asks for the linear correction", () => {
    const argv = loudnormPass2Args(
      "/in.wav",
      "out.wav",
      podcast,
      { input_i: -9.56, input_tp: -8.72, input_lra: 0, input_thresh: -19.56, target_offset: -0.04 },
      44100,
      ["-c:a", "pcm_s16le"],
    );
    expect(valueAfter(argv, "-af")).toBe(
      "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-9.56:measured_LRA=0:measured_TP=-8.72:measured_thresh=-19.56:offset=-0.04:linear=true:print_format=json",
    );
  });

  it("PASS 2 ASKS FOR ITS OWN JSON — the only way linear=true is checkable", () => {
    /*
      `linear=true` is a request. Loudnorm refuses it silently whenever the
      linear offset would breach the target's true-peak ceiling, and prints no
      warning at any log level. `print_format=json` on pass 2 is what makes
      `normalization_type` reachable, and it was measured not to disturb the
      written file. Delete it and the module is back to asserting a mode it
      cannot see.
    */
    for (const stats of [
      { input_i: -9.56, input_tp: -8.72, input_lra: 0, input_thresh: -19.56, target_offset: -0.04 },
      null,
    ]) {
      const argv = loudnormPass2Args("/in.wav", "out.wav", podcast, stats, 44100, [
        "-c:a",
        "pcm_s16le",
      ]);
      expect(valueAfter(argv, "-af")).toContain("print_format=json");
    }
  });

  it("PASS 2 STRIPS METADATA — otherwise the page's tag claim is false", () => {
    /*
      MEASURED: with FFmpeg's default `-map_metadata 0`, an ID3 title, artist,
      album and comment all survived this argv in MP3, WAV and FLAC output,
      while the page's ADVANCED drawer said "Tags & cover art — NOT CARRIED
      OVER". `-vn` drops an attached PICTURE STREAM and nothing else; global
      tags need this flag. Adding it made the same run come back with none of
      the four.
    */
    const argv = loudnormPass2Args("/in.wav", "out.wav", podcast, null, 44100, [
      "-c:a",
      "pcm_s16le",
    ]);
    expect(valueAfter(argv, "-map_metadata")).toBe("-1");
    // An OUTPUT option, so it has to sit after the input and before the file.
    expect(argv.indexOf("-map_metadata")).toBeGreaterThan(argv.indexOf("-i"));
    expect(argv.indexOf("-map_metadata")).toBeLessThan(argv.length - 1);
  });

  it("with no stats it is the plain single-pass filter, and still carries -ar", () => {
    const argv = loudnormPass2Args("/in.wav", "out.wav", podcast, null, 48000, ["-c:a", "flac"]);
    expect(valueAfter(argv, "-af")).toBe("loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json");
    expect(argv.join(" ")).not.toContain("measured_I=");
    expect(valueAfter(argv, "-ar")).toBe("48000");
  });

  it("the three targets carry the numbers their publishers state", () => {
    expect(NORMALIZE_TARGETS.streaming).toMatchObject({ I: -14, TP: -1, LRA: 11 });
    expect(NORMALIZE_TARGETS.podcast).toMatchObject({ I: -16, TP: -1.5, LRA: 11 });
    expect(NORMALIZE_TARGETS.broadcast).toMatchObject({ I: -23, TP: -2, LRA: 7 });
  });
});

describe("mp3SafeSampleRate — the second half of the -ar trap", () => {
  it("snaps a rate libmp3lame refuses to one it takes", () => {
    // MEASURED: `-ar 96000 -c:a libmp3lame` → EXIT 1,
    // "[libmp3lame] Specified sample rate 96000 is not supported".
    expect(mp3SafeSampleRate(96000)).toBe(48000);
    expect(mp3SafeSampleRate(88200)).toBe(48000);
  });

  it("rounds UP, so an odd rate keeps its bandwidth instead of losing it", () => {
    // 37 800 sits between 32 000 and 44 100 and is nearer to 32 000 — which is
    // exactly why "nearest" is the wrong rule: it would silently cut everything
    // above 16 kHz to save bytes nobody asked to save.
    expect(mp3SafeSampleRate(37800)).toBe(44100);
    expect(mp3SafeSampleRate(11026)).toBe(12000);
  });

  it("leaves the rates MP3 can already carry alone", () => {
    for (const rate of [8000, 22050, 32000, 44100, 48000]) {
      expect(mp3SafeSampleRate(rate)).toBe(rate);
    }
  });

  it("only MP3 is constrained — WAV and FLAC keep the source rate", () => {
    // MEASURED: `-ar 96000` exits 0 for both pcm_s16le and flac.
    expect(outputSampleRateFor("wav", 96000)).toBe(96000);
    expect(outputSampleRateFor("flac", 96000)).toBe(96000);
    expect(outputSampleRateFor("mp3", 96000)).toBe(48000);
  });
});

describe("silenceRemoveFilter", () => {
  it('"ends" reverses twice so the tail gets the head detector', () => {
    // MEASURED on the 5.500 s fixture: 3.50 s out, i.e. both outer stretches
    // gone and the 1.5 s middle gap kept.
    expect(silenceRemoveFilter({ mode: "ends", thresholdDb: -50, minGapSeconds: 0.5 })).toBe(
      "silenceremove=start_periods=1:start_threshold=-50dB:start_duration=0,areverse," +
        "silenceremove=start_periods=1:start_threshold=-50dB:start_duration=0,areverse",
    );
  });

  it('"all" removes every gap over the minimum', () => {
    // MEASURED on the same fixture: 2.04 s out.
    expect(silenceRemoveFilter({ mode: "all", thresholdDb: -50, minGapSeconds: 0.5 })).toBe(
      "silenceremove=stop_periods=-1:stop_duration=0.5:stop_threshold=-50dB",
    );
  });

  it("refuses a positive threshold, which would delete the whole file", () => {
    const filter = silenceRemoveFilter({ mode: "all", thresholdDb: 6, minGapSeconds: 0.5 });
    expect(filter).toContain("stop_threshold=0dB");
  });

  it("never pastes NaN into the filtergraph", () => {
    const filter = silenceRemoveFilter({
      mode: "all",
      thresholdDb: Number.NaN,
      minGapSeconds: Number.NaN,
    });
    expect(filter).not.toContain("NaN");
    expect(filter).toBe("silenceremove=stop_periods=-1:stop_duration=0.5:stop_threshold=-50dB");
  });
});

describe("normalizeAudio — what the run actually did", () => {
  it("runs both passes and pins -ar to the rate the log reported", async () => {
    logBatches = [PASS1_LOG, PASS2_LINEAR_LOG];

    const result = await normalizeAudio(audio(), { target: "podcast", format: "wav" });

    expect(argvs()).toHaveLength(2);
    expect(argvs()[0]).toEqual(loudnormPass1Args("/mnt-input/input.mp3", NORMALIZE_TARGETS.podcast));
    // 44100, read past the 192000 decoy in the very same log.
    expect(valueAfter(argvs()[1], "-ar")).toBe("44100");
    expect(result.sampleRate).toBe(44100);
    expect(result.twoPass).toBe(true);
    expect(result.measured).toMatchObject({ input_i: -9.56 });
    expect(result.normalizationType).toBe("linear");
    expect(result.warnings).toBeUndefined();
    expect(result.fileName).toBe("episode-12-normalized.wav");
  });

  it("REPORTS THE DYNAMIC FALLBACK loudnorm never announces, and warns", async () => {
    /*
      The run that used to be described as "one measured gain was applied":
      pass 1 parses, `linear=true` goes into the filtergraph, `twoPass` is true
      — and loudnorm rode a time-varying gain anyway, compressing the loudness
      range from 2.70 LU to 0.20 and landing at −17.13 LUFS against a −16
      target. Nothing in the argv can tell you that; only pass 2's own JSON can,
      and only because pass 2 now asks for it.
    */
    logBatches = [PASS1_LOG, PASS2_DYNAMIC_LOG];

    const result = await normalizeAudio(audio(), { target: "podcast", format: "wav" });

    expect(result.twoPass).toBe(true);
    expect(result.normalizationType).toBe("dynamic");
    expect(result.warnings?.join(" ")).toContain("did not apply one measured gain");
    // The target's own numbers, so the sentence is about the run that happened.
    expect(result.warnings?.join(" ")).toContain("-1.5 dBTP");
  });

  it("says NOTHING about the mode when pass 2 printed nothing readable", async () => {
    // The honest third state. A run whose JSON never arrived must not be
    // reported as linear — that is the assumption this whole change removes.
    logBatches = [PASS1_LOG, ["size=  344kB time=00:00:02.00 bitrate=1411.5kbits/s"]];

    const result = await normalizeAudio(audio(), { target: "podcast", format: "wav" });

    expect(result.twoPass).toBe(true);
    expect(result.normalizationType).toBeNull();
    expect(result.warnings).toBeUndefined();
  });

  it("keeps pass 2's numbers out of `measured`, which is about the INPUT", async () => {
    /*
      `parseLoudnormStats` takes the LAST object it finds, and pass 2 now prints
      one of its own. The two objects are deliberately different in this fixture
      — pass 1 says the source measured −9.56 LUFS, pass 2 reports the
      corrected file at −28.17 — so any reading that reaches pass 2's lines
      hands the page the wrong number under the label "Measured". The stats are
      taken from pass 1's own array, before pass 2 has run at all.
    */
    logBatches = [PASS1_LOG, PASS2_DYNAMIC_LOG];

    const result = await normalizeAudio(audio(), { target: "podcast", format: "wav" });

    expect(result.measured?.input_i).toBe(-9.56);
    expect(result.measured?.input_lra).toBe(0);
    // And the mode still comes from pass 2, which said the opposite of pass 1.
    expect(result.normalizationType).toBe("dynamic");
  });

  it("falls back to ONE pass when the analysis is unusable, and says so", async () => {
    logBatches = [SILENT_PASS1_LOG, []];

    const result = await normalizeAudio(audio(), { target: "podcast", format: "wav" });

    expect(result.twoPass).toBe(false);
    expect(result.measured).toBeNull();
    expect(argvs()[1].join(" ")).not.toContain("measured_I=");
    // Still pinned: the resample trap does not care which mode ran.
    expect(valueAfter(argvs()[1], "-ar")).toBe("44100");
    expect(result.warnings?.[0]).toContain("single pass");
  });

  it("falls back when pass 1 exits non-zero, without failing the job", async () => {
    mockExec.mockImplementationOnce(async () => 1).mockImplementationOnce(async () => 0);

    const result = await normalizeAudio(audio(), { target: "streaming", format: "wav" });

    expect(result.twoPass).toBe(false);
    // Nothing was read from that log, so the rate falls back to 44 100.
    expect(valueAfter(argvs()[1], "-ar")).toBe("44100");
  });

  it("moves a 96 kHz source to a rate MP3 can carry, and discloses it", async () => {
    // The log and the sniff AGREE here — the fixture is coherent, unlike the
    // version of this case that fed a 96 kHz sniff alongside a 44.1 kHz log and
    // passed only because the sniff outranked FFmpeg.
    mockSniffSampleRate.mockReturnValue(96000);
    logBatches = [PASS1_LOG_96K, PASS2_LINEAR_LOG];

    const result = await normalizeAudio(audio(), {
      target: "broadcast",
      format: "mp3",
      bitrate: 256,
    });

    expect(valueAfter(argvs()[1], "-ar")).toBe("48000");
    expect(valueAfter(argvs()[1], "-b:a")).toBe("256k");
    expect(result.sampleRate).toBe(48000);
    expect(result.warnings?.join(" ")).toContain("48.0 kHz");
    // And the rule is named correctly. `mp3SafeSampleRate` rounds UP — a
    // 37 800 Hz source is written at 44 100 while the NEAREST carriable rate is
    // 32 000 — so the sentence must not say "nearest".
    expect(result.warnings?.join(" ")).not.toContain("nearest one it can");
    expect(result.warnings?.join(" ")).toContain("rounded UP");
  });

  it("PREFERS FFMPEG'S OWN STREAM LINE OVER THE HEADER SNIFF when they disagree", async () => {
    /*
      MEASURED on a real HE-AAC ADTS file (`afconvert -f adts -d aach@44100`):
      `sniffSampleRate` returns 22050, because the SBR core rate is all ADTS
      carries, while FFmpeg — which has demuxed AND decoded by the time pass 1's
      log exists — prints `Audio: aac (HE-AAC), 44100 Hz`. Pinning the sniff
      wrote a half-rate file and threw away the whole reconstructed band above
      11 kHz, silently, under a panel saying the source rate was pinned. `-ar`
      is about the stream loudnorm is filtering, so FFmpeg's answer wins.
    */
    mockSniffSampleRate.mockReturnValue(22050);
    logBatches = [PASS1_LOG, PASS2_LINEAR_LOG];

    const result = await normalizeAudio(audio(), { target: "podcast", format: "wav" });

    expect(valueAfter(argvs()[1], "-ar")).toBe("44100");
    expect(result.sampleRate).toBe(44100);
  });

  it("still falls back to the sniff when the log carries no input stream line", async () => {
    // The moov-at-the-end MP4 the header comment cites: the log parse returns
    // null, so the order stops mattering and the sniff is what covers it.
    mockSniffSampleRate.mockReturnValue(32000);
    logBatches = [PASS1_LOG.filter((l) => !l.includes("44100 Hz")), PASS2_LINEAR_LOG];

    const result = await normalizeAudio(audio(), { target: "podcast", format: "wav" });

    expect(valueAfter(argvs()[1], "-ar")).toBe("32000");
    expect(result.sampleRate).toBe(32000);
  });

  it("throws when pass 2 fails, and still unmounts", async () => {
    mockExec.mockImplementationOnce(async () => 0).mockImplementationOnce(async () => 1);

    await expect(normalizeAudio(audio(), { target: "podcast", format: "wav" })).rejects.toThrow(
      /Could not normalise/,
    );
    expect(mockUnmountInputFile).toHaveBeenCalled();
  });

  it("reports progress across BOTH passes instead of filling the bar twice", async () => {
    logBatches = [PASS1_LOG, []];
    const seen: number[] = [];
    let call = 0;
    mockExec.mockImplementation(async () => {
      for (const line of logBatches.shift() ?? []) lastCtx.onLog?.(line);
      // Each exec reports 0-100 for itself; the module has to band them.
      lastCtx.onProgress?.(100);
      call++;
      return 0;
    });

    await normalizeAudio(audio(), { target: "podcast", format: "wav" }, { onProgress: (p) => seen.push(p) });

    expect(call).toBe(2);
    expect(seen).toEqual([40, 100]);
  });
});

describe("removeSilence — the durations it reports", () => {
  it("reads both durations off the log and reports the difference", async () => {
    logBatches = [SILENCE_LOG];

    const result = await removeSilence(audio(), {
      mode: "ends",
      thresholdDb: -50,
      minGapSeconds: 0.5,
      format: "wav",
    });

    expect(result.originalSeconds).toBeCloseTo(5.5, 2);
    expect(result.newSeconds).toBeCloseTo(3.49, 2);
    expect(result.removedSeconds).toBeCloseTo(2.01, 2);
    expect(result.fileName).toBe("episode-12-silence-removed.wav");
    // Both rates read back, both 44 100, so nothing to say about them.
    expect(result.sourceSampleRate).toBe(44100);
    expect(result.sampleRate).toBe(44100);
    expect(result.warnings).toBeUndefined();
  });

  it("STRIPS METADATA, because the page says tags are not carried over", () => {
    // Same measurement as the loudnorm arm: without this flag an ID3 title and
    // artist survived `silenceremove` intact while the drawer said they had not.
    return removeSilence(audio(), {
      mode: "ends",
      thresholdDb: -50,
      minGapSeconds: 0.5,
      format: "mp3",
    }).then(() => {
      expect(valueAfter(argvs()[0], "-map_metadata")).toBe("-1");
    });
  });

  it("SAYS SO when the MP3 encoder picked a rate the source did not have", async () => {
    /*
      MEASURED against the shipped core: a 96 kHz WAV through this exact argv
      comes back as a 48 kHz MP3, EXIT 0, in both silence modes — 88.2 kHz too —
      while the WAV and FLAC arms keep the source rate. No `-ar` is passed, which
      is a true statement about the argv and NOT the same statement as "nothing
      is resampled". The rate is read back off the run rather than assumed.
    */
    logBatches = [
      [
        "  Duration: 00:00:03.50, bitrate: 3072 kb/s",
        "  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 96000 Hz, stereo, s16",
        "Output #0, mp3, to 'desilenced.mp3':",
        "  Stream #0:0: Audio: mp3, 48000 Hz, stereo, fltp, 192 kb/s",
        "size=      25kB time=00:00:01.50 bitrate= 192.0kbits/s speed= 90x",
      ],
    ];

    const result = await removeSilence(audio(), {
      mode: "ends",
      thresholdDb: -50,
      minGapSeconds: 0.5,
      format: "mp3",
    });

    expect(result.sourceSampleRate).toBe(96000);
    expect(result.sampleRate).toBe(48000);
    expect(result.warnings?.join(" ")).toContain("Written at 48.0 kHz, not the source's 96.0 kHz");
  });

  it("stays quiet about the rate when the log did not report both", async () => {
    // A log this parser cannot follow must produce no rate claim at all, not a
    // guess and not a warning about a change nobody observed.
    logBatches = [
      [
        "  Duration: 00:00:05.50, bitrate: 1411 kb/s",
        "size=     603kB time=00:00:03.49 bitrate=1411.4kbits/s speed= 556x",
      ],
    ];

    const result = await removeSilence(audio(), {
      mode: "ends",
      thresholdDb: -50,
      minGapSeconds: 0.5,
      format: "mp3",
    });

    expect(result.sourceSampleRate).toBeNull();
    expect(result.sampleRate).toBeNull();
    expect(result.warnings).toBeUndefined();
  });

  it("does NOT pin -ar: silenceremove was measured to preserve the source rate", () => {
    // Guard against someone "fixing" this the way loudnorm had to be fixed.
    // Documented measurement: 44 100 Hz in, 44 100 Hz out.
    return removeSilence(audio(), {
      mode: "all",
      thresholdDb: -40,
      minGapSeconds: 1,
      format: "wav",
    }).then(() => {
      expect(argvs()[0]).not.toContain("-ar");
      expect(valueAfter(argvs()[0], "-af")).toBe(
        "silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-40dB",
      );
    });
  });

  it("says so when nothing was removed rather than claiming a saving", async () => {
    logBatches = [
      [
        "  Duration: 00:00:05.50, bitrate: 1411 kb/s",
        "size=     950kB time=00:00:05.50 bitrate=1411.4kbits/s speed= 556x",
      ],
    ];

    const result = await removeSilence(audio(), {
      mode: "ends",
      thresholdDb: -60,
      minGapSeconds: 0.5,
      format: "wav",
    });

    expect(result.removedSeconds).toBe(0);
    expect(result.warnings?.[0]).toContain("Nothing was removed");
  });

  it("never reports a negative removal", async () => {
    // MP3 encoder padding really does make the output slightly LONGER than the
    // source when nothing is cut (measured: 2.09 s out of a 2.04 s input).
    logBatches = [
      [
        "  Duration: 00:00:02.04, bitrate: 192 kb/s",
        "size=      50kB time=00:00:02.09 bitrate= 196.9kbits/s speed= 112x",
      ],
    ];

    const result = await removeSilence(audio(), {
      mode: "ends",
      thresholdDb: -50,
      minGapSeconds: 0.5,
      format: "mp3",
    });

    expect(result.removedSeconds).toBe(0);
  });
});

describe("the Web Audio half — the sample maths, without a decoder", () => {
  it("0 dB is exactly the identity, not almost", () => {
    expect(gainFromDb(0)).toBe(1);
  });

  it("converts decibels the way the encoders will hear them", () => {
    expect(gainFromDb(6)).toBeCloseTo(1.9953, 4);
    expect(gainFromDb(-6)).toBeCloseTo(0.5012, 4);
    expect(gainFromDb(20)).toBeCloseTo(10, 6);
  });

  it("refuses a non-number rather than scaling every sample by NaN", () => {
    expect(gainFromDb(Number.NaN)).toBe(1);
  });

  it("finds the loudest sample across every channel, sign-blind", () => {
    expect(
      peakOfChannels([new Float32Array([0.1, -0.9]), new Float32Array([0.4, 0.2])]),
    ).toBeCloseTo(0.9, 6);
    expect(peakOfChannels([new Float32Array(0)])).toBe(0);
  });

});

describe("foldToStereo — the encoder's fold, done where the page can see it", () => {
  /*
    A DELIBERATE DUPLICATE of `toStereoFloats` (audio-pcm.ts), so the arithmetic
    is pinned here against the arithmetic that file documents: extra channels
    summed into BOTH L and R at Math.SQRT1_2, and the whole pair divided by its
    own peak only when that peak exceeds unity.
  */
  it("passes mono and stereo through without touching them", () => {
    const l = new Float32Array([0.5, -0.25]);
    const r = new Float32Array([0.1, 0.2]);
    expect(foldToStereo([l])).toMatchObject({ channels: [l], scale: 1 });
    expect(foldToStereo([l, r])).toMatchObject({ channels: [l, r], scale: 1 });
    expect(foldToStereo([l, r]).foldPeak).toBeCloseTo(0.5, 6);
  });

  it("sums the extra channels at −3 dB into both sides", () => {
    const fold = foldToStereo([
      new Float32Array([0.1]),
      new Float32Array([0.2]),
      new Float32Array([0.4]),
    ]);
    expect(fold.channels).toHaveLength(2);
    expect(fold.channels[0][0]).toBeCloseTo(0.1 + 0.4 * Math.SQRT1_2, 5);
    expect(fold.channels[1][0]).toBeCloseTo(0.2 + 0.4 * Math.SQRT1_2, 5);
    expect(fold.scale).toBe(1);
  });

  it("SCALES THE WHOLE MIX when the sum crosses unity — at any gain", () => {
    /*
      The case the old code could not see: six channels at 0.5 are every one of
      them a long way under full scale, and their fold reaches 2.03. Nothing
      here is a clip — it is a uniform divide applied to the delivered file, and
      it happens on a run that asked for no gain change at all.
    */
    const six = Array.from({ length: 6 }, () => new Float32Array([0.5]));
    const fold = foldToStereo(six);

    // 0.5 + four extras at 0.5 x SQRT1_2 = 1.9142 — nearly 6 dB of level the
    // encoder has to take back out of a mix whose loudest sample was 0.5.
    const expectedPeak = 0.5 + 4 * 0.5 * Math.SQRT1_2;
    expect(expectedPeak).toBeCloseTo(1.9142, 4);
    expect(fold.foldPeak).toBeCloseTo(expectedPeak, 5);
    expect(fold.scale).toBeCloseTo(1 / expectedPeak, 6);
    expect(fold.channels[0][0]).toBeCloseTo(1, 5);
  });
});

describe("changeAudioVolume — the run, not the arithmetic around it", () => {
  it("multiplies every sample and leaves the caller's decoded buffer alone", async () => {
    const left = new Float32Array([0.4, -0.2]);
    const right = new Float32Array([0.1, 0.3]);
    vi.mocked(decodeAudioFile).mockResolvedValue(decoded([left, right], 44100));

    const result = await changeAudioVolume(audio(), { gainDb: 6, format: "wav" });

    const out = encoded(encodeWav);
    expect(out.data[0][0]).toBeCloseTo(0.4 * gainFromDb(6), 5);
    expect(out.data[1][1]).toBeCloseTo(0.3 * gainFromDb(6), 5);
    // The decoded buffer belongs to the caller — a waveform redraw or a second
    // run at another gain still holds it. `.slice()` is what keeps it intact.
    expect(left[0]).toBeCloseTo(0.4, 6);
    expect(result.peakBefore).toBeCloseTo(0.4, 6);
    expect(result.peakAfter).toBeCloseTo(0.4 * gainFromDb(6), 5);
    expect(result.clipped).toBe(false);
    expect(result.warnings).toBeUndefined();
  });

  it("reports a boost past full scale rather than quietly limiting it", async () => {
    vi.mocked(decodeAudioFile).mockResolvedValue(
      decoded([new Float32Array([0.8, -0.8])], 44100),
    );

    const result = await changeAudioVolume(audio(), { gainDb: 6, format: "wav" });

    expect(result.peakAfter).toBeCloseTo(0.8 * gainFromDb(6), 5);
    expect(result.peakAfter).toBeGreaterThan(1);
    expect(result.clipped).toBe(true);
    expect(result.warnings?.join(" ")).toContain("above the 0 dBFS ceiling");
  });

  it("FOLDS A 5.1 SOURCE ITSELF ON THE MP3 ARM, AND SAYS WHAT THAT COST", async () => {
    /*
      The defect this whole path exists to close. Six channels at 0.5 fold to
      2.03, so the encoder divided the WHOLE mix down — on a run requesting
      0 dB — while the page measured its peak on the six pre-fold channels,
      reported "Clipping: No", raised nothing, and printed "Channels & rate
      UNCHANGED" over a stereo download. Every one of those is now derived from
      the samples the encoder is actually handed.
    */
    const six = Array.from({ length: 6 }, () => new Float32Array([0.5, -0.5]));
    vi.mocked(decodeAudioFile).mockResolvedValue(decoded(six, 44100));

    const result = await changeAudioVolume(audio(), { gainDb: 0, format: "mp3" });

    expect(encoded(encodeMp3).channels).toBe(2);
    expect(result.sourceChannels).toBe(6);
    expect(result.channels).toBe(2);
    expect(result.foldedToStereo).toBe(true);
    expect(result.foldScale).toBeLessThan(1);
    // The delivered peak, which is what the file actually holds.
    expect(result.peakAfter).toBeCloseTo(1, 4);
    // And the level the fold reached, which is why it had to be pulled back.
    expect(result.peakProduced).toBeCloseTo(0.5 + 4 * 0.5 * Math.SQRT1_2, 4);
    expect(result.clipped).toBe(true);
    expect(result.warnings?.join(" ")).toContain("folded into stereo");
    expect(result.warnings?.join(" ")).toContain("scaled down by");
  });

  it("says the channels moved even when the fold did NOT have to be scaled", async () => {
    // Six quiet channels fold to 0.51, under unity, so no level change — but
    // four channels still stopped existing, and "UNCHANGED" is still false.
    const six = Array.from({ length: 6 }, () => new Float32Array([0.125, -0.125]));
    vi.mocked(decodeAudioFile).mockResolvedValue(decoded(six, 44100));

    const result = await changeAudioVolume(audio(), { gainDb: 0, format: "mp3" });

    expect(result.foldedToStereo).toBe(true);
    expect(result.foldScale).toBe(1);
    expect(result.clipped).toBe(false);
    expect(result.warnings?.join(" ")).toContain("folded into stereo");
    expect(result.warnings?.join(" ")).not.toContain("scaled down by");
  });

  it("reports the 48 kHz ceiling a 96 kHz MP3 export runs into", async () => {
    vi.mocked(decodeAudioFile).mockResolvedValue(
      decoded([new Float32Array([0.3]), new Float32Array([0.3])], 96000),
    );

    const result = await changeAudioVolume(audio(), { gainDb: -3, format: "mp3" });

    expect(result.sourceSampleRate).toBe(96000);
    expect(result.sampleRate).toBe(MAX_MP3_SAMPLE_RATE);
    expect(result.warnings?.join(" ")).toContain("Written at 48.0 kHz, not the source's 96.0 kHz");
  });

  it("keeps every channel and the source rate on the WAV arm, and says so", async () => {
    const six = Array.from({ length: 6 }, () => new Float32Array([0.5, -0.5]));
    vi.mocked(decodeAudioFile).mockResolvedValue(decoded(six, 96000));

    const result = await changeAudioVolume(audio(), { gainDb: -3, format: "wav" });

    expect(encoded(encodeWav)).toMatchObject({ channels: 6, sampleRate: 96000 });
    expect(result.channels).toBe(6);
    expect(result.sampleRate).toBe(96000);
    expect(result.foldedToStereo).toBe(false);
    expect(result.warnings).toBeUndefined();
  });
});

describe("reverseAudio — the samples, backwards", () => {
  it("hands the encoder the source samples in the opposite order", async () => {
    const left = new Float32Array([1, 2, 3, 4]);
    const right = new Float32Array([5, 6, 7, 8]);
    vi.mocked(decodeAudioFile).mockResolvedValue(decoded([left, right], 44100));

    const result = await reverseAudio(audio(), { format: "wav" });

    const out = encoded(encodeWav);
    expect(Array.from(out.data[0])).toEqual([4, 3, 2, 1]);
    expect(Array.from(out.data[1])).toEqual([8, 7, 6, 5]);
    expect(out.sampleRate).toBe(44100);
    expect(result.fileName).toBe("episode-12-reversed.wav");
    expect(result.warnings).toBeUndefined();
  });

  it("carries channel count and rate through untouched on WAV — the claim, tested", async () => {
    const six = Array.from({ length: 6 }, () => new Float32Array([0.2, -0.2]));
    vi.mocked(decodeAudioFile).mockResolvedValue(decoded(six, 96000));

    const result = await reverseAudio(audio(), { format: "wav" });

    expect(result).toMatchObject({
      channels: 6,
      sampleRate: 96000,
      sourceChannels: 6,
      sourceSampleRate: 96000,
      foldedToStereo: false,
    });
    expect(result.warnings).toBeUndefined();
  });

  it("STOPS CLAIMING UNCHANGED on the MP3 arm, where both really do move", async () => {
    // The page said "Channels & rate — UNCHANGED" and returned no `warnings`
    // field at all over exactly this run.
    const six = Array.from({ length: 6 }, () => new Float32Array([0.2, -0.2]));
    vi.mocked(decodeAudioFile).mockResolvedValue(decoded(six, 96000));

    const result = await reverseAudio(audio(), { format: "mp3" });

    expect(result.channels).toBe(2);
    expect(result.sampleRate).toBe(MAX_MP3_SAMPLE_RATE);
    expect(result.foldedToStereo).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings?.join(" ")).toContain("folded into stereo");
    expect(result.warnings?.join(" ")).toContain("Written at 48.0 kHz");
  });
});
