import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abortError } from "@/lib/utils/abort";

/*
  What is under test is the DECISION, not the codec work: which argv this
  module builds for a given probed codec, and whether `streamCopied` reports
  what actually ran rather than what was asked for. The core is mocked; the
  measurements that justify each row of `COPY_CONTAINERS` are in the module
  header, taken against the real one.
*/
const {
  mockExec,
  mockReadFile,
  mockWriteFile,
  mockDeleteFile,
  mockMountInputFile,
  mockUnmountInputFile,
  mockValidateFFmpegInput,
} = vi.hoisted(() => ({
  mockExec: vi.fn().mockResolvedValue(0),
  mockReadFile: vi.fn().mockResolvedValue(new Uint8Array([0x00, 0x01])),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
  mockMountInputFile: vi.fn(),
  mockUnmountInputFile: vi.fn().mockResolvedValue(undefined),
  mockValidateFFmpegInput: vi.fn(),
}));

vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  validateFFmpegInput: mockValidateFFmpegInput,
  runFFmpegTask: vi.fn((task: (f: unknown) => Promise<unknown>) =>
    task({
      exec: mockExec,
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      deleteFile: mockDeleteFile,
    }),
  ),
  mountInputFile: mockMountInputFile.mockImplementation(
    (_ffmpeg: unknown, _file: File, name: string) => Promise.resolve(`/mnt-input/${name}`),
  ),
  unmountInputFile: mockUnmountInputFile,
}));

const { mockProbeMedia } = vi.hoisted(() => ({ mockProbeMedia: vi.fn() }));

vi.mock("@/lib/tools/video-probe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tools/video-probe")>()),
  probeMedia: mockProbeMedia,
}));

import { extractAudio, copyContainerFor, COPY_CONTAINERS } from "@/lib/tools/extract-audio";

/** A probe answer with one audio stream of the given codec. */
function probeWith(codec: string | null) {
  return {
    container: "mov,mp4,m4a,3gp,3g2,mj2",
    durationSeconds: 2,
    sizeBytes: 100,
    video: { codec: "h264", width: 640, height: 360, frameRate: 25, rotationDegreesClockwise: 0 },
    audio: codec === null ? null : { codec, channels: 2 },
  };
}

const video = () => new File(["v"], "holiday.mp4", { type: "video/mp4" });

/** Every argv this run handed to FFmpeg. */
const argvs = (): string[][] => mockExec.mock.calls.map((c) => c[0] as string[]);

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockResolvedValue(0);
  mockReadFile.mockResolvedValue(new Uint8Array([0x00, 0x01]));
  mockDeleteFile.mockResolvedValue(undefined);
  mockMountInputFile.mockImplementation((_f: unknown, _file: File, name: string) =>
    Promise.resolve(`/mnt-input/${name}`),
  );
  mockProbeMedia.mockResolvedValue(probeWith("aac"));
});

describe("extractAudio — the stream-copy arm", () => {
  it("copies an AAC track into .m4a and says so", async () => {
    const result = await extractAudio(video(), { format: "original" });

    expect(argvs()[0]).toEqual([
      "-i", "/mnt-input/input.mp4",
      "-map", "0:a:0",
      "-vn",
      "-c:a", "copy",
      "copied.m4a",
    ]);
    expect(result.streamCopied).toBe(true);
    expect(result.sourceCodec).toBe("aac");
    expect(result.fileName).toBe("holiday.m4a");
    expect(result.blob.type).toBe("audio/mp4");
    expect(result.warnings).toBeUndefined();
  });

  it("copies an Opus track into .opus, not into the MP4 family that cannot hold it", async () => {
    // Measured: `-c:a copy` from a WebM into .m4a is EXIT=1,
    // "Could not find tag for codec opus in stream #0".
    mockProbeMedia.mockResolvedValue(probeWith("opus"));
    const file = new File(["v"], "call.webm", { type: "video/webm" });

    const result = await extractAudio(file, { format: "original" });

    expect(argvs()[0]).toContain("copied.opus");
    expect(result.fileName).toBe("call.opus");
    expect(result.blob.type).toBe("audio/ogg");
    expect(result.streamCopied).toBe(true);
  });

  it("takes the FIRST audio stream, which is the one the probe described", async () => {
    /*
      Without `-map 0:a:0` FFmpeg picks the "best" audio stream by its own
      heuristic. On a two-track file that can be a DIFFERENT stream than the one
      `sourceCodec` names — and therefore a different codec than the container
      chosen for it, which is how a copy ends up in a container that cannot hold
      it (see the header's `lie.wav`).
    */
    await extractAudio(video(), { format: "original" });

    for (const args of argvs()) {
      const at = args.indexOf("-map");
      expect(at).toBeGreaterThanOrEqual(0);
      expect(args[at + 1]).toBe("0:a:0");
    }
  });

  it("re-encodes, and warns, when no measured container can hold the codec", async () => {
    mockProbeMedia.mockResolvedValue(probeWith("dts"));

    const result = await extractAudio(video(), { format: "original", bitrate: 256 });

    expect(result.streamCopied).toBe(false);
    expect(result.fileName).toBe("holiday.mp3");
    expect(result.warnings?.[0]).toMatch(/audio is DTS/);
    expect(result.warnings?.[0]).toMatch(/re-encoded to MP3 at 256 kbps/);
    // The copy was never even attempted: one exec, and it is the encode.
    expect(argvs()).toHaveLength(1);
    expect(argvs()[0]).toContain("-b:a");
    expect(argvs()[0]).not.toContain("copy");
  });

  it("falls back to MP3, and warns, when FFmpeg refuses the copy it attempted", async () => {
    mockExec.mockResolvedValueOnce(1); // the copy
    mockExec.mockResolvedValueOnce(0); // the re-encode

    const result = await extractAudio(video(), { format: "original" });

    expect(argvs()).toHaveLength(2);
    expect(argvs()[0]).toContain("copy");
    expect(argvs()[1]).toContain("-b:a");
    expect(result.streamCopied).toBe(false);
    expect(result.fileName).toBe("holiday.mp3");
    expect(result.warnings?.[0]).toMatch(/AAC track could not be copied out unchanged/);
  });

  it("still deletes the output when exec THREW rather than returning a code", async () => {
    /*
      A wasm trap rejects the exec instead of returning non-zero, and it can
      reject AFTER the muxer has already created the file. The output name is
      therefore recorded before the run, not after it — record it after and a
      trapped job leaves a stale `copied.m4a` behind for the next one to read.
    */
    mockExec.mockRejectedValueOnce(new Error("RuntimeError: memory access out of bounds"));

    await expect(extractAudio(video(), { format: "original" })).rejects.toThrow(/RuntimeError/);

    expect(mockDeleteFile).toHaveBeenCalledWith("copied.m4a");
    expect(mockUnmountInputFile).toHaveBeenCalledTimes(1);
  });

  it("cleans up BOTH outputs when the copy failed and the re-encode took over", async () => {
    // The failed copy can still have created its file; leaving it behind lets
    // a later job read a stale output.
    mockExec.mockResolvedValueOnce(1);

    await extractAudio(video(), { format: "original" });

    expect(mockDeleteFile.mock.calls.map((c) => c[0])).toEqual(["copied.m4a", "output.mp3"]);
    expect(mockUnmountInputFile).toHaveBeenCalledTimes(1);
  });
});

describe("extractAudio — the re-encode arms", () => {
  it("NEVER stream-copies into WAV, whatever the source codec is", async () => {
    /*
      This is the sharpest edge in the module. Measured on a clean core:
        -i input.mp4 -map 0:a:0 -vn -c:a copy lie.wav   EXIT=0, 10 486 B
      FFmpeg writes the AAC bitstream into a RIFF/WAVE header and reports
      success; Chromium's decodeAudioData then ACCEPTS that file and reports
      0.139 s of audio from a 2.09 s source. Exit 0, plausible size, silent
      loss. WAV output is always an explicit pcm_s16le re-encode.
    */
    for (const codec of ["aac", "pcm_s16le", "mp3", "opus"]) {
      vi.clearAllMocks();
      mockExec.mockResolvedValue(0);
      mockReadFile.mockResolvedValue(new Uint8Array([0x00]));
      mockMountInputFile.mockImplementation((_f: unknown, _file: File, name: string) =>
        Promise.resolve(`/mnt-input/${name}`),
      );
      mockProbeMedia.mockResolvedValue(probeWith(codec));

      const result = await extractAudio(video(), { format: "wav" });

      for (const args of argvs()) expect(args).not.toContain("copy");
      expect(argvs()[0]).toEqual([
        "-i", "/mnt-input/input.mp4",
        "-map", "0:a:0",
        "-vn",
        "-c:a", "pcm_s16le",
        "output.wav",
      ]);
      expect(result.streamCopied).toBe(false);
      expect(result.fileName).toBe("holiday.wav");
      expect(result.blob.type).toBe("audio/wav");
    }
  });

  it("never copies for an explicit MP3 request either, even from an MP3 source", async () => {
    // `format: "mp3"` is a re-encode request. A user who wanted the untouched
    // stream has `"original"` for that, and it is the arm that says so.
    mockProbeMedia.mockResolvedValue(probeWith("mp3"));

    const result = await extractAudio(video(), { format: "mp3", bitrate: 128 });

    expect(argvs()[0]).not.toContain("copy");
    expect(argvs()[0]).toContain("128k");
    expect(result.streamCopied).toBe(false);
  });

  it("defaults the bitrate rather than writing `undefinedk` into the argv", async () => {
    mockProbeMedia.mockResolvedValue(probeWith("dts"));

    await extractAudio(video(), { format: "mp3" });

    expect(argvs()[0]).toContain("192k");
  });

  it("throws a readable error when the extraction itself fails", async () => {
    mockProbeMedia.mockResolvedValue(probeWith("dts"));
    mockExec.mockResolvedValueOnce(1);

    await expect(extractAudio(video(), { format: "mp3" })).rejects.toThrow(
      /Could not extract the audio from holiday\.mp4/,
    );
    expect(mockUnmountInputFile).toHaveBeenCalledTimes(1);
  });
});

describe("extractAudio — the probe", () => {
  it("refuses a video with no audio track BEFORE running an extraction", async () => {
    // This used to reach the user as "FFmpeg audio extraction failed" after a
    // full run. Measured: `-i noaudio.mp4 -vn -b:a 192k na.mp3` is EXIT=1 with
    // no output file at all.
    mockProbeMedia.mockResolvedValue(probeWith(null));

    await expect(extractAudio(video(), { format: "mp3" })).rejects.toThrow(
      /holiday\.mp4 has no audio track/,
    );
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("still runs the extraction when the probe itself could not read the file", async () => {
    /*
      The probe is advisory. A file ffprobe gives up on is not necessarily a
      file ffmpeg cannot demux, and before the probe existed this tool simply
      tried — so a probe failure has to drop back to exactly that.
    */
    mockProbeMedia.mockRejectedValue(new Error("not a video or audio file this tool can read"));

    const result = await extractAudio(video(), { format: "mp3" });

    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(result.sourceCodec).toBeNull();
    expect(result.fileName).toBe("holiday.mp3");
  });

  it("cannot stream-copy without a codec, and says that is why", async () => {
    mockProbeMedia.mockRejectedValue(new Error("unreadable"));

    const result = await extractAudio(video(), { format: "original" });

    expect(result.streamCopied).toBe(false);
    expect(result.warnings?.[0]).toMatch(/codec in this file could not be read/);
  });

  it("propagates a cancellation from the probe instead of swallowing it", async () => {
    // Every other probe failure is swallowed; an abort is the user's decision.
    mockProbeMedia.mockRejectedValue(abortError());

    await expect(extractAudio(video(), { format: "mp3" })).rejects.toThrow(/aborted/i);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("gives the probe the signal but withholds the progress reporter", async () => {
    // The extraction that follows owns the bar; ffprobe reports nothing and
    // would only make the run look like it restarted.
    const { signal } = new AbortController();
    const onProgress = vi.fn();

    await extractAudio(video(), { format: "mp3" }, { signal, onProgress });

    expect(mockProbeMedia).toHaveBeenCalledWith(expect.any(File), { signal });
  });
});

describe("extractAudio — the job shape", () => {
  it("validates as an audio-extract job, which carries no size cap", async () => {
    // "stream-copy" here would re-impose a 1.5 GB limit on a job that provably
    // does not need one (a 2500 MB source was verified to extract).
    const file = video();
    await extractAudio(file, { format: "mp3" });

    expect(mockValidateFFmpegInput).toHaveBeenCalledWith(file, "audio-extract");
  });

  it("mounts the source instead of copying its bytes into the FS", async () => {
    await extractAudio(video(), { format: "mp3" });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), expect.any(File), "input.mp4");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("gives a dot-less WebM a real demuxer hint", async () => {
    const file = new File(["v"], "recording", { type: "video/webm" });
    mockProbeMedia.mockResolvedValue(probeWith("opus"));

    await extractAudio(file, { format: "mp3" });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.webm");
  });
});

describe("the leaf rule that keeps /mp4-to-mp3's `NO SIZE CAP` honest", () => {
  /*
    `size-claims.test.ts` walks each UI's import closure for the four in-tab
    decode entry points, and /mp4-to-mp3 reaches this module. A static edge from
    here to `audio-convert.ts` therefore puts `decodeAudioFile` in the closure of
    a tool that mounts its input and never decodes in the tab — and the gate
    fails, correctly, on a claim that is actually true. It fired for real while
    this cluster was being written; `audio-format.ts` is the fix.
  */
  const read = (rel: string) =>
    readFileSync(join(process.cwd(), "src/lib/tools", rel), "utf8");

  it("extract-audio never imports the module that decodes in the tab", () => {
    const source = read("extract-audio.ts");
    expect(source).not.toMatch(/["']\.\/audio-convert["']/);
    expect(source).not.toMatch(/["']@\/lib\/tools\/audio-convert["']/);
  });

  it("the shared leaf imports nothing at all, so it cannot grow one", () => {
    const source = read("audio-format.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});

describe("COPY_CONTAINERS", () => {
  it("maps only codecs whose container was measured", () => {
    expect(copyContainerFor("aac")).toEqual({ ext: "m4a", mime: "audio/mp4" });
    expect(copyContainerFor("AAC")).toEqual({ ext: "m4a", mime: "audio/mp4" });
    expect(copyContainerFor("dts")).toBeNull();
    expect(copyContainerFor(null)).toBeNull();
  });

  it("never routes a lossy codec into a lossless container, or the reverse", () => {
    // A container mismatch is not a cosmetic problem here: it is the `lie.wav`
    // failure, which exits 0 and loses the audio.
    expect(COPY_CONTAINERS.aac.ext).toBe("m4a");
    expect(COPY_CONTAINERS.mp3.ext).toBe("mp3");
    expect(COPY_CONTAINERS.opus.ext).toBe("opus");
    expect(COPY_CONTAINERS.vorbis.ext).toBe("ogg");
    expect(COPY_CONTAINERS.flac.ext).toBe("flac");
    expect(COPY_CONTAINERS.pcm_s16le.ext).toBe("wav");
    expect(COPY_CONTAINERS.wmav2.ext).toBe("wma");
    // The one container that must never appear for a compressed codec.
    for (const [codec, target] of Object.entries(COPY_CONTAINERS)) {
      if (target.ext === "wav") expect(codec.startsWith("pcm_")).toBe(true);
    }
  });
});
