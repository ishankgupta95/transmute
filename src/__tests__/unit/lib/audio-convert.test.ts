import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  `convertAudio` is a dispatcher, so what these tests pin is WHICH ENGINE each
  format reaches and WITH WHAT ARGUMENTS — not the encoders themselves, which
  have their own suites (audio-encode-mp3/wav, audio-pcm) and, for FLAC, a
  measurement against the real core recorded in the module header.

  Both engines are mocked, and both mocks record every call, so a format that
  silently changed lanes fails here rather than at the download.
*/
const {
  mockExec,
  mockReadFile,
  mockWriteFile,
  mockDeleteFile,
  mockMountInputFile,
  mockUnmountInputFile,
  mockRunFFmpegTask,
} = vi.hoisted(() => ({
  mockExec: vi.fn().mockResolvedValue(0),
  mockReadFile: vi.fn().mockResolvedValue(new Uint8Array([0x66, 0x4c, 0x61, 0x43])),
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockDeleteFile: vi.fn().mockResolvedValue(undefined),
  mockMountInputFile: vi.fn(),
  mockUnmountInputFile: vi.fn().mockResolvedValue(undefined),
  mockRunFFmpegTask: vi.fn(),
}));

vi.mock("@/lib/tools/ffmpeg-loader", () => ({
  runFFmpegTask: mockRunFFmpegTask.mockImplementation((task: (f: unknown) => Promise<unknown>) =>
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

const { mockDecodeAudioFile, mockEncodeMp3, mockEncodeWav, mockResampleForMp3 } = vi.hoisted(
  () => ({
    mockDecodeAudioFile: vi.fn(),
    mockEncodeMp3: vi.fn(),
    mockEncodeWav: vi.fn(),
    mockResampleForMp3: vi.fn(),
  }),
);

vi.mock("@/lib/tools/audio-decode", () => ({ decodeAudioFile: mockDecodeAudioFile }));
vi.mock("@/lib/workers/audio-client", () => ({
  encodeMp3: mockEncodeMp3,
  encodeWav: mockEncodeWav,
}));
/*
  `resampleForMp3` still lives in audio-encode-mp3.ts because audio-trim and
  audio-merge import it from there, so audio-convert reaches back for it. The
  partial mock keeps `convertToMp3`'s delegation (asserted at the bottom) real.
*/
vi.mock("@/lib/tools/audio-encode-mp3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tools/audio-encode-mp3")>()),
  resampleForMp3: mockResampleForMp3,
}));

import {
  convertAudio,
  assertSafeFFmpegAudioArgs,
  isLosslessAudioFormat,
  audioOutputExtension,
  OPUS_SAFE_COMPRESSION_LEVEL,
  AUDIO_FORMAT_SPECS,
} from "@/lib/tools/audio-convert";

const fakeBuffer = { sampleRate: 44100, numberOfChannels: 2 } as unknown as AudioBuffer;

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockResolvedValue(0);
  mockReadFile.mockResolvedValue(new Uint8Array([0x66, 0x4c, 0x61, 0x43]));
  mockDeleteFile.mockResolvedValue(undefined);
  mockMountInputFile.mockImplementation((_f: unknown, _file: File, name: string) =>
    Promise.resolve(`/mnt-input/${name}`),
  );
  mockRunFFmpegTask.mockImplementation((task: (f: unknown) => Promise<unknown>) =>
    task({
      exec: mockExec,
      readFile: mockReadFile,
      writeFile: mockWriteFile,
      deleteFile: mockDeleteFile,
    }),
  );
  mockDecodeAudioFile.mockResolvedValue(fakeBuffer);
  mockResampleForMp3.mockResolvedValue(fakeBuffer);
  mockEncodeMp3.mockResolvedValue(new Blob(["mp3"], { type: "audio/mpeg" }));
  mockEncodeWav.mockResolvedValue(new Blob(["wav"], { type: "audio/wav" }));
});

describe("convertAudio — engine dispatch", () => {
  it("sends MP3 through Web Audio and the worker pool, never FFmpeg", async () => {
    const file = new File(["x"], "song.flac", { type: "audio/flac" });

    const result = await convertAudio(file, { format: "mp3", bitrate: 256 });

    expect(mockEncodeMp3).toHaveBeenCalledTimes(1);
    expect(mockEncodeMp3.mock.calls[0][1]).toBe(256);
    expect(mockRunFFmpegTask).not.toHaveBeenCalled();
    expect(result.fileName).toBe("song.mp3");
  });

  it("sends WAV through Web Audio and the worker pool, never FFmpeg", async () => {
    const file = new File(["x"], "clip.m4a", { type: "audio/mp4" });

    const result = await convertAudio(file, { format: "wav" });

    expect(mockEncodeWav).toHaveBeenCalledTimes(1);
    expect(mockRunFFmpegTask).not.toHaveBeenCalled();
    expect(result.fileName).toBe("clip.wav");
  });

  it("sends FLAC through FFmpeg, because the worker pool has no FLAC encoder", async () => {
    const file = new File(["x"], "master.wav", { type: "audio/wav" });

    const result = await convertAudio(file, { format: "flac" });

    expect(mockRunFFmpegTask).toHaveBeenCalledTimes(1);
    expect(mockEncodeMp3).not.toHaveBeenCalled();
    expect(mockEncodeWav).not.toHaveBeenCalled();
    expect(result.fileName).toBe("master.flac");
    expect(result.blob.type).toBe("audio/flac");
  });

  it("resamples for MP3 and deliberately does not for WAV", async () => {
    // MP3 cannot carry rates above 48 kHz; WAV can, and resampling it would
    // throw away a 96 kHz master's whole reason for existing.
    const file = new File(["x"], "master.wav", { type: "audio/wav" });

    await convertAudio(file, { format: "mp3", bitrate: 192 });
    expect(mockResampleForMp3).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockDecodeAudioFile.mockResolvedValue(fakeBuffer);
    mockEncodeWav.mockResolvedValue(new Blob(["wav"]));
    await convertAudio(file, { format: "wav" });
    expect(mockResampleForMp3).not.toHaveBeenCalled();
  });

  it("defaults the MP3 bitrate rather than sending undefined to lamejs", async () => {
    const file = new File(["x"], "song.ogg", { type: "audio/ogg" });

    await convertAudio(file, { format: "mp3" });

    expect(mockEncodeMp3.mock.calls[0][1]).toBe(192);
  });
});

describe("convertAudio — the FFmpeg arm's argv", () => {
  it("pins the extraction to the first audio stream and drops video", async () => {
    /*
      `-map 0:a:0` and not FFmpeg's default selection: the default picks the
      "best" audio stream, which need not be the first, so a file with two
      tracks would convert a different one than every other statement in this
      cluster describes. `-vn` drops an embedded cover image, which the FLAC
      muxer would otherwise have to be asked to carry.
    */
    const file = new File(["x"], "master.wav", { type: "audio/wav" });

    await convertAudio(file, { format: "flac" });

    const args = mockExec.mock.calls[0][0] as string[];
    expect(args).toEqual([
      "-i", "/mnt-input/input.wav",
      "-map", "0:a:0",
      "-vn",
      "-c:a", "flac",
      "output.flac",
    ]);
  });

  it("mounts the source instead of copying its bytes into the FS", async () => {
    // A 700 MB WAV must never become an ArrayBuffer on either thread.
    const file = new File(["x"], "master.wav", { type: "audio/wav" });

    await convertAudio(file, { format: "flac" });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.wav");
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("labels a dot-less source .dat, not the .mp4 the video probe would guess", async () => {
    // These sources are audio files. Telling FFmpeg an untitled Ogg is an MP4
    // is a worse hint than giving it none.
    const file = new File(["x"], "recording", { type: "audio/wav" });

    await convertAudio(file, { format: "flac" });

    expect(mockMountInputFile).toHaveBeenCalledWith(expect.anything(), file, "input.dat");
    expect(await mockMountInputFile.mock.results[0].value).toBe("/mnt-input/input.dat");
  });

  it("throws a readable error when FFmpeg returns non-zero", async () => {
    mockExec.mockResolvedValueOnce(1);
    const file = new File(["x"], "master.wav", { type: "audio/wav" });

    await expect(convertAudio(file, { format: "flac" })).rejects.toThrow(
      /Could not convert master\.wav to FLAC/,
    );
  });

  it("releases the mounted source and the output even when FFmpeg fails", async () => {
    // A mount left behind makes the NEXT job's mount fail on a busy mount point.
    mockExec.mockResolvedValueOnce(1);
    const file = new File(["x"], "master.wav", { type: "audio/wav" });

    await expect(convertAudio(file, { format: "flac" })).rejects.toThrow();

    expect(mockUnmountInputFile).toHaveBeenCalledTimes(1);
    expect(mockDeleteFile).toHaveBeenCalledWith("output.flac");
  });
});

describe("the Opus guard", () => {
  /*
    Stereo `libopus` traps in this build, and a trap does not fail one job — it
    poisons the FFmpeg instance until it is terminated. Measurements are in the
    module header; these tests are the enforcement.
  */
  it("passes an argv with no Opus in it", () => {
    expect(() =>
      assertSafeFFmpegAudioArgs(["-i", "in.wav", "-c:a", "flac", "out.flac"]),
    ).not.toThrow();
  });

  it("refuses libopus with no compression level at all (the default is 10)", () => {
    expect(() => assertSafeFFmpegAudioArgs(["-i", "in.wav", "-c:a", "libopus", "o.opus"])).toThrow(
      /default \(10\)/,
    );
  });

  it("refuses the first level measured to trap", () => {
    expect(() =>
      assertSafeFFmpegAudioArgs(["-c:a", "libopus", "-compression_level", "5", "o.opus"]),
    ).toThrow(/crashes on stereo Opus above level 4/);
  });

  it("allows the highest level measured to complete, and everything below it", () => {
    for (const level of ["0", "1", "4"]) {
      expect(() =>
        assertSafeFFmpegAudioArgs(["-c:a", "libopus", "-compression_level", level, "o.opus"]),
      ).not.toThrow();
    }
    expect(OPUS_SAFE_COMPRESSION_LEVEL).toBe(4);
  });

  it("refuses a level that is not a number, rather than reading NaN as safe", () => {
    expect(() =>
      assertSafeFFmpegAudioArgs(["-c:a", "libopus", "-compression_level", "high", "o.opus"]),
    ).toThrow();
  });

  it("ships no format that emits Opus at all", () => {
    // The safe level is safe on a cold core and not on a warm one (header), so
    // the encoder stays out of the matrix entirely; Opus is an INPUT here.
    const codecs = Object.values(AUDIO_FORMAT_SPECS).map((s) => s.codec);
    expect(codecs).not.toContain("libopus");
  });
});

describe("format facts the copy layer reads", () => {
  it("calls MP3 lossy and WAV/FLAC lossless", () => {
    // A page that prints "no quality loss" keys off this and nothing else.
    expect(isLosslessAudioFormat("mp3")).toBe(false);
    expect(isLosslessAudioFormat("wav")).toBe(true);
    expect(isLosslessAudioFormat("flac")).toBe(true);
  });

  it("names each output extension", () => {
    expect(audioOutputExtension("mp3")).toBe("mp3");
    expect(audioOutputExtension("wav")).toBe("wav");
    expect(audioOutputExtension("flac")).toBe("flac");
  });
});

describe("the wrappers the MP3/WAV pages still import", () => {
  it("convertToMp3 delegates to convertAudio with its bitrate intact", async () => {
    const { convertToMp3 } = await import("@/lib/tools/audio-encode-mp3");
    const file = new File(["x"], "song.wav", { type: "audio/wav" });

    const result = await convertToMp3(file, { bitrate: 320 });

    expect(mockEncodeMp3.mock.calls[0][1]).toBe(320);
    expect(result.fileName).toBe("song.mp3");
    expect(result.originalSize).toBe(file.size);
  });

  it("convertToWav delegates to convertAudio", async () => {
    const { convertToWav } = await import("@/lib/tools/audio-encode-wav");
    const file = new File(["x"], "song.mp3", { type: "audio/mpeg" });

    const result = await convertToWav(file);

    expect(mockEncodeWav).toHaveBeenCalledTimes(1);
    expect(result.fileName).toBe("song.wav");
  });
});
