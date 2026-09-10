import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MediaProbe } from "@/lib/tools/video-probe";

/*
  ─────────────────────────────────────────────────────────────────────────────
  What these tests are for
  ─────────────────────────────────────────────────────────────────────────────
  jsdom has no wasm core, so nothing here proves FFmpeg does anything. What it
  CAN prove is the part that is genuinely ours and would otherwise ship
  unguarded: the decision about whether a file can be rewrapped untouched, and
  the exact argv that decision turns into.

  Both matter for one reason. `streamCopied` is what the UI's "nothing was
  re-encoded" claim is derived from, and every wrong cell in the matrix below is
  either that claim told as a lie, or a slow lossy re-encode nobody asked for.
  The matrix itself came from running the shipped core against one real file per
  codec — the exit codes are quoted in video-remux.ts.
*/

const execCalls: string[][] = [];
let execResult: (args: string[]) => number = () => 0;

const fakeFFmpeg = {
  exec: vi.fn(async (args: string[]) => {
    execCalls.push(args);
    return execResult(args);
  }),
  readFile: vi.fn(async () => new Uint8Array([0x00, 0x01, 0x02])),
  deleteFile: vi.fn(async () => "OK"),
};

const validateFFmpegInput = vi.fn();

vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  runFFmpegTask: vi.fn(async (task: (ff: unknown) => Promise<unknown>) => task(fakeFFmpeg)),
  validateFFmpegInput: (...args: unknown[]) => validateFFmpegInput(...args),
  mountInputFile: vi.fn(async (_ff: unknown, _file: File, name: string) => `/mnt-input/${name}`),
  unmountInputFile: vi.fn(async () => {}),
}));

const probeMedia = vi.fn();

vi.mock("@/lib/tools/video-probe", async (importOriginal) => ({
  // Only the wasm-backed call is faked; the parsing helpers are the real ones,
  // and `inputExtensionFor` decides output filenames, so faking it would make
  // the filename assertions meaningless.
  ...(await importOriginal<typeof import("@/lib/tools/video-probe")>()),
  probeMedia: (...args: unknown[]) => probeMedia(...args),
}));

const ISOBMFF = "mov,mp4,m4a,3gp,3g2,mj2";
const MATROSKA = "matroska,webm";

function probeOf(opts: {
  container?: string;
  video?: { codec: string; width?: number; height?: number; frameRate?: number; rotation?: number } | null;
  audio?: { codec: string; channels?: number } | null;
  duration?: number | null;
}): MediaProbe {
  const v = opts.video === undefined ? { codec: "h264" } : opts.video;
  const a = opts.audio === undefined ? { codec: "aac" } : opts.audio;
  return {
    container: opts.container ?? ISOBMFF,
    durationSeconds: opts.duration === undefined ? 10 : opts.duration,
    sizeBytes: 1_000_000,
    video: v
      ? {
          codec: v.codec,
          width: v.width ?? 1280,
          height: v.height ?? 720,
          frameRate: v.frameRate ?? 30,
          rotationDegreesClockwise: v.rotation ?? 0,
        }
      : null,
    audio: a ? { codec: a.codec, channels: a.channels ?? 2 } : null,
  };
}

const videoFile = (name = "clip.mov") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "video/quicktime" });

beforeEach(() => {
  execCalls.length = 0;
  execResult = () => 0;
  vi.clearAllMocks();
  fakeFFmpeg.readFile.mockResolvedValue(new Uint8Array([0x00, 0x01, 0x02]));
});

describe("planRemux — the copy-vs-re-encode matrix", () => {
  /*
    Every cell below was decided by running `ffmpeg -i <src> -c copy out.<ext>`
    against the shipped core, and — for the MP4/MOV rows — by loading the
    resulting file into a real <video> element in Chromium, WebKit and Firefox.
    A codec is copied into MP4/MOV only when it played in all three.
  */
  it.each([
    // codec,   target, expected, why
    ["h264", "mp4", "copy", "played in every engine tested"],
    ["h264", "mov", "copy", "played in every engine tested"],
    ["h264", "mkv", "copy", "matroska takes it as-is"],
    ["hevc", "mkv", "copy", "matroska takes it as-is and promises no playback"],
    ["vp8", "mkv", "copy", "measured EXIT=0 into matroska"],
    ["vp9", "mkv", "copy", "matroska is the keep-the-streams target"],
    ["av1", "mkv", "copy", "matroska is the keep-the-streams target"],
    ["mpeg4", "mkv", "copy", "measured EXIT=0 into matroska"],
    ["theora", "mkv", "copy", "measured EXIT=0 into matroska"],
    ["wmv2", "mkv", "copy", "measured EXIT=0 into matroska"],
    ["flv1", "mkv", "copy", "measured EXIT=0 into matroska"],
    ["mjpeg", "mkv", "copy", "measured EXIT=0 into matroska"],
    // These MUX into MP4 (EXIT=0) but do not PLAY, which is the trap.
    ["hevc", "mp4", "transcode", "muxes fine, did not decode in Chromium"],
    ["hevc", "mov", "transcode", "muxes fine, did not decode in Chromium"],
    ["mpeg4", "mp4", "transcode", "muxes fine, failed in Chromium and Firefox"],
    ["mjpeg", "mp4", "transcode", "muxes fine, would not even demux in Chromium"],
    // These do not even mux into MP4.
    ["vp8", "mp4", "transcode", "EXIT=1 could not find tag for codec vp8"],
    ["vp8", "mov", "transcode", "EXIT=1 not yet implemented in FFmpeg"],
    ["theora", "mp4", "transcode", "EXIT=1 could not find tag for codec theora"],
    ["wmv2", "mp4", "transcode", "EXIT=1 could not find tag for codec wmv2"],
    ["flv1", "mp4", "transcode", "EXIT=1 could not find tag for codec flv1"],
    ["vp9", "mp4", "transcode", "no encoder and not measured as muxable"],
    ["av1", "mp4", "transcode", "not measured as muxable"],
  ] as const)("%s into %s -> %s (%s)", async (codec, target, expected, _why) => {
    const { planRemux } = await import("@/lib/tools/video-remux");
    const plan = planRemux(probeOf({ video: { codec } }), target);

    expect(plan.kind).toBe(expected);
  });

  it("never calls an H.265 rewrap into MP4 a copy, even though the muxer allows it", async () => {
    // The iPhone case. `-i hevc.mov -c copy out.mp4` returns EXIT=0 and writes
    // 205,599 bytes, so a tool that trusted the exit code would report success
    // on a file the user still cannot play. This is the whole reason the branch
    // exists.
    const { planRemux } = await import("@/lib/tools/video-remux");
    const plan = planRemux(probeOf({ video: { codec: "hevc" } }), "mp4");

    expect(plan.kind).toBe("transcode");
    expect(plan.reason).toMatch(/H\.265/);
    // It must not pretend the copy would have failed — it would have worked,
    // and saying otherwise is its own lie.
    expect(plan.reason).toMatch(/without re-encoding/i);
  });

  it.each([
    ["aac", "copy"],
    ["mp3", "copy"],
    ["opus", "transcode"],
    ["vorbis", "transcode"],
    ["flac", "transcode"],
    ["alac", "transcode"],
    ["ac3", "transcode"],
    ["pcm_s16le", "transcode"],
  ] as const)("%s audio into MP4 -> %s", async (codec, expected) => {
    const { planRemux } = await import("@/lib/tools/video-remux");
    const plan = planRemux(probeOf({ audio: { codec } }), "mp4");

    expect(plan.kind).toBe(expected);
  });

  it("copies any audio into Matroska", async () => {
    const { planRemux } = await import("@/lib/tools/video-remux");
    for (const codec of ["opus", "flac", "pcm_s16le", "vorbis", "wmav2"]) {
      expect(planRemux(probeOf({ audio: { codec } }), "mkv").kind).toBe("copy");
    }
  });

  it("says the video is untouched when only the audio needs re-encoding", async () => {
    const { planRemux } = await import("@/lib/tools/video-remux");
    const plan = planRemux(probeOf({ video: { codec: "h264" }, audio: { codec: "flac" } }), "mp4");

    expect(plan.kind).toBe("transcode");
    expect(plan.reason).toMatch(/picture is copied/i);
    expect(plan.reason).toMatch(/FLAC/);
  });

  it("treats a missing stream as nothing to re-encode", async () => {
    const { planRemux } = await import("@/lib/tools/video-remux");

    expect(planRemux(probeOf({ audio: null }), "mp4").kind).toBe("copy");
    expect(planRemux(probeOf({ video: null }), "mp4").kind).toBe("copy");
  });
});

describe("planRemux — the time estimate", () => {
  /*
    The anchors are in video-remux.ts: 720p30 for 10 s took 7,680 ms measured,
    and 320x240 for 2 s took 327 ms. An estimate is only worth showing if it is
    in that neighbourhood, and only worth showing AT ALL if we have the numbers
    to compute it.
  */
  it("lands near the measured 7.7 s for the 720p30 10 s anchor", async () => {
    const { planRemux } = await import("@/lib/tools/video-remux");
    const plan = planRemux(
      probeOf({ video: { codec: "hevc", width: 1280, height: 720, frameRate: 30 }, duration: 10 }),
      "mp4",
    );

    expect(plan.kind).toBe("transcode");
    if (plan.kind !== "transcode") return;
    expect(plan.estimateSeconds).toBeGreaterThanOrEqual(7);
    expect(plan.estimateSeconds).toBeLessThanOrEqual(10);
  });

  it("scales with pixel count, not just duration", async () => {
    const { planRemux } = await import("@/lib/tools/video-remux");
    const small = planRemux(
      probeOf({ video: { codec: "hevc", width: 640, height: 360, frameRate: 30 }, duration: 60 }),
      "mp4",
    );
    const large = planRemux(
      probeOf({ video: { codec: "hevc", width: 1920, height: 1080, frameRate: 30 }, duration: 60 }),
      "mp4",
    );

    if (small.kind !== "transcode" || large.kind !== "transcode") throw new Error("expected transcodes");
    // 1080p is 9x the pixels of 360p; the estimate has to move with that or it
    // is not an estimate, it is a guess dressed up as one.
    expect(large.estimateSeconds! / small.estimateSeconds!).toBeGreaterThan(5);
  });

  it("returns null rather than inventing a number when the probe is thin", async () => {
    const { planRemux } = await import("@/lib/tools/video-remux");

    const noDuration = planRemux(probeOf({ video: { codec: "hevc" }, duration: null }), "mp4");
    const noSize = planRemux(
      probeOf({ video: { codec: "hevc", width: 0, height: 0 }, duration: 30 }),
      "mp4",
    );

    if (noDuration.kind !== "transcode" || noSize.kind !== "transcode") throw new Error("expected transcodes");
    expect(noDuration.estimateSeconds).toBeNull();
    expect(noSize.estimateSeconds).toBeNull();
  });

  it("estimates an audio-only re-encode as the cheap job it is", async () => {
    const { planRemux } = await import("@/lib/tools/video-remux");
    const plan = planRemux(
      probeOf({ video: { codec: "h264" }, audio: { codec: "flac" }, duration: 600 }),
      "mp4",
    );

    if (plan.kind !== "transcode") throw new Error("expected a transcode");
    // 10 minutes of audio re-encoded at ~25x realtime, not 10 minutes of video
    // re-encoded at 1.3x.
    expect(plan.estimateSeconds).toBeLessThan(60);
  });
});

describe("the argv each entry point builds", () => {
  it("remuxes with a plain stream copy", async () => {
    const { remuxVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({}));

    const result = await remuxVideo(videoFile("holiday.mov"), "mp4", { allowTranscode: false });

    expect(execCalls).toEqual([["-i", "/mnt-input/input.mov", "-c", "copy", "output.mp4"]]);
    expect(result.streamCopied).toBe(true);
    expect(result.fileName).toBe("holiday.mp4");
  });

  it("transcodes to libx264 at 8-bit, re-encoding the audio only when it has to", async () => {
    const { remuxVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ video: { codec: "hevc" }, audio: { codec: "aac" } }));

    const result = await remuxVideo(videoFile("iphone.mov"), "mp4", { allowTranscode: true });

    expect(execCalls).toEqual([
      [
        "-i", "/mnt-input/input.mov",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        // Not decoration: iPhone HEVC is often 10-bit, and a High 10 H.264 is
        // refused by browsers for the same reason the H.265 was.
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "output.mp4",
      ],
    ]);
    expect(result.streamCopied).toBe(false);
  });

  it("re-encodes audio to AAC when the source audio cannot travel", async () => {
    const { remuxVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ video: { codec: "vp8" }, audio: { codec: "opus" } }));

    await remuxVideo(videoFile("screen.webm"), "mp4", { allowTranscode: true });

    expect(execCalls[0]).toContain("-c:a");
    expect(execCalls[0]).toContain("aac");
    expect(execCalls[0]).not.toContain("copy");
  });

  it("mutes with -an and a stream copy", async () => {
    const { muteVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({}));

    const result = await muteVideo(videoFile("talk.mp4"));

    expect(execCalls).toEqual([["-i", "/mnt-input/input.mp4", "-an", "-c", "copy", "output.mp4"]]);
    expect(result.streamCopied).toBe(true);
    expect(result.fileName).toBe("talk-muted.mp4");
  });

  it("rotates by writing the display flag, not by re-encoding", async () => {
    const { rotateVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({}));

    const result = await rotateVideo(videoFile("upright.mp4"), 90);

    // A quarter turn CLOCKWISE is `rotate=270`: measured twice, through
    // FFmpeg's own autorotate and through Chromium's <video> element, a
    // top-left block tagged rotate=90 lands BOTTOM-left. Writing the user's
    // number straight through would turn every video the wrong way.
    expect(execCalls).toEqual([
      ["-i", "/mnt-input/input.mp4", "-c", "copy", "-metadata:s:v:0", "rotate=270", "output.mp4"],
    ]);
    expect(result.fileName).toBe("upright-rotated.mp4");
    expect(result.streamCopied).toBe(true);
  });

  it.each([
    [90, "rotate=270"],
    [180, "rotate=180"],
    [270, "rotate=90"],
  ] as const)("turns %s degrees clockwise into %s", async (degrees, expected) => {
    const { rotateVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({}));

    await rotateVideo(videoFile("clip.mp4"), degrees);

    expect(execCalls[0]).toContain(expected);
  });

  it("adds to a rotation the file already carries instead of replacing it", async () => {
    // `-metadata:s:v:0 rotate=N` is ABSOLUTE — writing 180 onto a file tagged
    // 90 leaves it at 180, measured — and a plain `-c copy` carries the old tag
    // through. So "rotate 90" on an already-rotated iPhone clip would have been
    // a no-op the user could see no result from.
    const { rotateVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ video: { codec: "h264", rotation: 90 } }));

    const result = await rotateVideo(videoFile("portrait.mp4"), 90);

    expect(execCalls[0]).toContain("rotate=180");
    expect(result.warnings?.join(" ")).toMatch(/already carried a 90-degree rotation/);
  });

  it("clears the flag when the turns add back up to upright", async () => {
    const { rotateVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ video: { codec: "h264", rotation: 270 } }));

    await rotateVideo(videoFile("sideways.mp4"), 90);

    // rotate=0 removes the display matrix entirely, measured.
    expect(execCalls[0]).toContain("rotate=0");
  });
});

describe("never emit an encoder that hangs this build", () => {
  /*
    `libx265` is compiled into the shipped core and DEADLOCKS in it: it prints
    "x265 [info]: Thread pool created using 1 threads" and then produces nothing
    for 80 s+ on a single 320x240 frame. `exec`'s own timeout does not fire
    (single-threaded wasm blocks the worker's event loop), so a page reload is
    the only way out. `libvpx-vp9` traps. Neither may ever reach an argv.
  */
  const banned = ["libx265", "libvpx-vp9", "libaom-av1", "libfdk_aac", "-display_rotation"];

  it("no argv from any entry point contains a banned encoder or flag", async () => {
    const { remuxVideo, muteVideo, rotateVideo } = await import("@/lib/tools/video-remux");

    const probes = [
      probeOf({ video: { codec: "hevc" } }),
      probeOf({ video: { codec: "vp9" }, audio: { codec: "opus" } }),
      probeOf({ video: { codec: "av1" }, audio: { codec: "flac" } }),
      probeOf({ video: { codec: "h264" }, audio: { codec: "aac" } }),
    ];

    for (const probe of probes) {
      for (const target of ["mp4", "mov", "mkv"] as const) {
        probeMedia.mockResolvedValue(probe);
        await remuxVideo(videoFile(), target, { allowTranscode: true });
      }
      probeMedia.mockResolvedValue(probe);
      await muteVideo(videoFile());
      probeMedia.mockResolvedValue(probe);
      await rotateVideo(videoFile("x.mp4"), 180);
    }

    expect(execCalls.length).toBeGreaterThan(10);
    const flat = execCalls.flat();
    for (const bad of banned) expect(flat).not.toContain(bad);
    // The only video encoder this build can be trusted with.
    expect(flat.filter((a) => a.startsWith("lib"))).toEqual(
      Array(flat.filter((a) => a === "libx264").length).fill("libx264"),
    );
  });
});

describe("allowTranscode: false", () => {
  it("throws instead of re-encoding a file that needs it", async () => {
    const { remuxVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ video: { codec: "hevc" } }));

    await expect(
      remuxVideo(videoFile("iphone.mov"), "mp4", { allowTranscode: false }),
    ).rejects.toThrow(/H\.265/);

    // And it must not have quietly done the copy that "works" and produces an
    // unplayable file.
    expect(execCalls).toEqual([]);
  });

  it("throws instead of copying an incompatible stream", async () => {
    const { remuxVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ video: { codec: "vp8" } }));

    await expect(
      remuxVideo(videoFile("screen.webm"), "mp4", { allowTranscode: false }),
    ).rejects.toThrow();
    expect(execCalls).toEqual([]);
  });
});

describe("streamCopied is never optimistic", () => {
  it("reports false when the copy was refused and a transcode ran instead", async () => {
    // The plan is a prediction. If the muxer disagrees, the tool re-encodes —
    // and the "nothing was re-encoded" claim has to follow the run, not the
    // prediction. An incompatible copy is a clean exit 1 that leaves the engine
    // healthy (measured), which is what makes this fallback safe at all.
    const { remuxVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ video: { codec: "h264" } }));
    execResult = (args) => (args.includes("copy") && !args.includes("-c:v") ? 1 : 0);

    const result = await remuxVideo(videoFile("odd.mov"), "mp4", { allowTranscode: true });

    expect(result.streamCopied).toBe(false);
    expect(execCalls).toHaveLength(2);
    expect(execCalls[1]).toContain("libx264");
    expect(result.warnings?.join(" ")).toMatch(/refused/i);
  });

  it("throws rather than silently transcoding when the copy is refused and transcoding is off", async () => {
    const { remuxVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ video: { codec: "h264" } }));
    execResult = () => 1;

    await expect(
      remuxVideo(videoFile("odd.mov"), "mp4", { allowTranscode: false }),
    ).rejects.toThrow(/re-encoding/i);
    expect(execCalls).toHaveLength(1);
  });
});

describe("refusals and warnings that keep the copy honest", () => {
  it("refuses to rotate a container that silently drops the flag", async () => {
    // `-metadata:s:v:0 rotate=90` into Matroska returns EXIT=0 and writes a
    // file with NO rotation — measured, along with three other spellings that
    // also did nothing. Succeeding here would hand the user an unrotated file
    // and call it done.
    const { rotateVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ container: MATROSKA }));

    await expect(rotateVideo(videoFile("show.mkv"), 90)).rejects.toThrow(/does not store one/i);
    expect(execCalls).toEqual([]);
  });

  it.each([0, 45, 360, -90, 91] as const)("refuses a %s degree rotation", async (degrees) => {
    const { rotateVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({}));

    await expect(
      rotateVideo(videoFile("clip.mp4"), degrees as 90),
    ).rejects.toThrow(/90, 180 or 270/);
    expect(execCalls).toEqual([]);
  });

  it("refuses to rotate a file with no video track", async () => {
    const { rotateVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ video: null }));

    await expect(rotateVideo(videoFile("song.mp4"), 90)).rejects.toThrow(/no video track/i);
  });

  it("says so when there was no audio to remove", async () => {
    const { muteVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ audio: null }));

    const result = await muteVideo(videoFile("silent.mp4"));

    expect(result.warnings?.join(" ")).toMatch(/no audio track/i);
  });

  it("adds no warning when it actually removed something", async () => {
    const { muteVideo } = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({ audio: { codec: "aac" } }));

    expect((await muteVideo(videoFile("talk.mp4"))).warnings).toBeUndefined();
  });
});

describe("the 1.5 GB stream-copy cap is declared by every entry point", () => {
  /*
    `validateFFmpegInput(file, "stream-copy")` is what makes the registry's
    "1536 MB" claim true. A tool that skipped it would advertise a limit it did
    not enforce, which is the same class of lie as the copy claim.
  */
  it.each(["remuxVideo", "muteVideo", "rotateVideo"] as const)("%s calls it", async (entry) => {
    const mod = await import("@/lib/tools/video-remux");
    probeMedia.mockResolvedValue(probeOf({}));

    if (entry === "remuxVideo") await mod.remuxVideo(videoFile("a.mp4"), "mkv", { allowTranscode: false });
    if (entry === "muteVideo") await mod.muteVideo(videoFile("a.mp4"));
    if (entry === "rotateVideo") await mod.rotateVideo(videoFile("a.mp4"), 90);

    expect(validateFFmpegInput).toHaveBeenCalledWith(expect.any(File), "stream-copy");
  });
});

/*
  ─────────────────────────────────────────────────────────────────────────────
  The probe parser, which is where every ffprobe quirk lives
  ─────────────────────────────────────────────────────────────────────────────
*/
describe("parseProbeJson", () => {
  const file = () => {
    const f = new File(["x"], "clip.mp4", { type: "video/mp4" });
    Object.defineProperty(f, "size", { value: 4242 });
    return f;
  };

  it("rejects the body ffprobe writes when it could not read the file", async () => {
    // ffprobe returns -1 on EVERY input in this build — valid mp4, valid wav,
    // a text file and a missing file all returned -1 — so the exit code says
    // nothing and this body is the only failure signal there is. It parses as
    // valid JSON, which is exactly why it needs its own check.
    const { parseProbeJson } = await import("@/lib/tools/video-probe");

    expect(() => parseProbeJson("{\n\n}\n", file())).toThrow(/not a video or audio file/i);
    expect(() => parseProbeJson("", file())).toThrow(/not a video or audio file/i);
    expect(() => parseProbeJson('{"streams":[]}', file())).toThrow(/not a video or audio file/i);
  });

  it("finds streams by type, not by index", async () => {
    // A macOS-written HEVC .mov puts its AUDIO stream at index 0, measured. Any
    // parser that read streams[0] as the video would report an iPhone clip as
    // having no video at all.
    const { parseProbeJson } = await import("@/lib/tools/video-probe");
    const probe = parseProbeJson(
      JSON.stringify({
        streams: [
          { index: 0, codec_type: "audio", codec_name: "aac", channels: 2 },
          { index: 1, codec_type: "video", codec_name: "hevc", width: 320, height: 240, r_frame_rate: "24/1" },
        ],
        format: { format_name: ISOBMFF, duration: "2.041910" },
      }),
      file(),
    );

    expect(probe.video?.codec).toBe("hevc");
    expect(probe.audio?.codec).toBe("aac");
    expect(probe.video?.width).toBe(320);
    expect(probe.durationSeconds).toBeCloseTo(2.04191);
    expect(probe.sizeBytes).toBe(4242);
  });

  it("turns a rational frame rate into a number", async () => {
    const { parseProbeJson } = await import("@/lib/tools/video-probe");
    const of = (rate: string) =>
      parseProbeJson(
        JSON.stringify({
          streams: [{ codec_type: "video", codec_name: "h264", r_frame_rate: rate }],
          format: { format_name: ISOBMFF },
        }),
        file(),
      ).video?.frameRate;

    expect(of("24/1")).toBe(24);
    expect(of("30000/1001")).toBeCloseTo(29.97, 2);
    // `0/0` is what ffprobe writes for a stream it could not time.
    expect(of("0/0")).toBeNull();
  });

  it.each([
    // ffprobe normalises the angle into (-180, 180], so 270 comes back as -90.
    [90, 270],
    [-180, 180],
    [-90, 90],
    [180, 180],
  ])("reads a Display Matrix rotation of %s as %s degrees clockwise", async (raw, expected) => {
    const { parseProbeJson } = await import("@/lib/tools/video-probe");
    const probe = parseProbeJson(
      JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: "h264",
            side_data_list: [{ side_data_type: "Display Matrix", rotation: raw }],
          },
        ],
        format: { format_name: ISOBMFF },
      }),
      file(),
    );

    expect(probe.video?.rotationDegreesClockwise).toBe(expected);
  });

  it("reports no rotation when there is no display matrix", async () => {
    const { parseProbeJson } = await import("@/lib/tools/video-probe");
    const probe = parseProbeJson(
      JSON.stringify({
        streams: [{ codec_type: "video", codec_name: "h264" }],
        format: { format_name: ISOBMFF },
      }),
      file(),
    );

    expect(probe.video?.rotationDegreesClockwise).toBe(0);
  });
});
