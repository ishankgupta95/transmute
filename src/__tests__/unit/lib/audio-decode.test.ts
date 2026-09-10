import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDecodeAudioData = vi.fn();
const mockClose = vi.fn().mockResolvedValue(undefined);

const MockAudioContext = vi.fn(function () {
  return { decodeAudioData: mockDecodeAudioData, close: mockClose };
});
vi.stubGlobal("AudioContext", MockAudioContext);

import { decodeAudioFile, getInt16Samples } from "@/lib/tools/audio-decode";

function createMockAudioBuffer(channelData: Float32Array[]): AudioBuffer {
  return {
    numberOfChannels: channelData.length,
    length: channelData[0]?.length ?? 0,
    sampleRate: 44100,
    duration: (channelData[0]?.length ?? 0) / 44100,
    getChannelData: (ch: number) => channelData[ch],
  } as unknown as AudioBuffer;
}

describe("decodeAudioFile", () => {
  const mockAudioBuffer = createMockAudioBuffer([new Float32Array([0, 0.5, -0.5])]);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecodeAudioData.mockResolvedValue(mockAudioBuffer);
    mockClose.mockResolvedValue(undefined);
  });

  it("reads arrayBuffer from the file", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    const spy = vi.spyOn(file, "arrayBuffer");

    await decodeAudioFile(file);

    expect(spy).toHaveBeenCalled();
  });

  it("creates an AudioContext", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    await decodeAudioFile(file);

    expect(MockAudioContext).toHaveBeenCalledTimes(1);
  });

  it("decodes audio data and returns the AudioBuffer", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    const result = await decodeAudioFile(file);

    expect(mockDecodeAudioData).toHaveBeenCalled();
    expect(result).toBe(mockAudioBuffer);
  });

  it("always closes the AudioContext on success", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    await decodeAudioFile(file);

    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("closes the AudioContext even when decodeAudioData throws", async () => {
    mockDecodeAudioData.mockRejectedValueOnce(new Error("Unsupported format"));
    const file = new File(["bad-data"], "noise.xyz", { type: "audio/unknown" });

    await expect(decodeAudioFile(file)).rejects.toThrow("Unsupported format");
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("passes the file arrayBuffer to decodeAudioData", async () => {
    const file = new File(["audio-data"], "song.mp3", { type: "audio/mpeg" });
    await decodeAudioFile(file);

    const callArg = mockDecodeAudioData.mock.calls[0][0];
    expect(callArg).toBeInstanceOf(ArrayBuffer);
  });
});

describe("getInt16Samples", () => {
  it("converts silence (0.0) to 0", () => {
    const buffer = createMockAudioBuffer([new Float32Array([0.0])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(0);
  });

  it("converts positive max (1.0) to 32767", () => {
    const buffer = createMockAudioBuffer([new Float32Array([1.0])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(32767);
  });

  it("converts negative max (-1.0) to -32768", () => {
    const buffer = createMockAudioBuffer([new Float32Array([-1.0])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(-32768);
  });

  it("clamps values above 1.0", () => {
    const buffer = createMockAudioBuffer([new Float32Array([1.5])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(32767);
  });

  it("clamps values below -1.0", () => {
    const buffer = createMockAudioBuffer([new Float32Array([-1.5])]);
    const result = getInt16Samples(buffer, 0);

    expect(result[0]).toBe(-32768);
  });

  it("converts mid-range positive values correctly", () => {
    const buffer = createMockAudioBuffer([new Float32Array([0.5])]);
    const result = getInt16Samples(buffer, 0);

    // 0.5 * 0x7FFF = 0.5 * 32767 = 16383.5 → truncated to 16383
    expect(result[0]).toBe(Math.floor(0.5 * 0x7fff));
  });

  it("converts mid-range negative values correctly", () => {
    const buffer = createMockAudioBuffer([new Float32Array([-0.5])]);
    const result = getInt16Samples(buffer, 0);

    // -0.5 * 0x8000 = -0.5 * 32768 = -16384
    expect(result[0]).toBe(-16384);
  });

  it("handles multiple samples", () => {
    const buffer = createMockAudioBuffer([new Float32Array([0.0, 1.0, -1.0, 0.25])]);
    const result = getInt16Samples(buffer, 0);

    expect(result.length).toBe(4);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(32767);
    expect(result[2]).toBe(-32768);
    expect(result[3]).toBe(Math.floor(0.25 * 0x7fff));
  });

  it("reads correct channel data", () => {
    const ch0 = new Float32Array([0.5]);
    const ch1 = new Float32Array([-0.5]);
    const buffer = createMockAudioBuffer([ch0, ch1]);

    const result0 = getInt16Samples(buffer, 0);
    const result1 = getInt16Samples(buffer, 1);

    expect(result0[0]).toBe(Math.floor(0.5 * 0x7fff));
    expect(result1[0]).toBe(-16384);
  });

  it("returns Int16Array", () => {
    const buffer = createMockAudioBuffer([new Float32Array([0.0, 0.5])]);
    const result = getInt16Samples(buffer, 0);

    expect(result).toBeInstanceOf(Int16Array);
  });

  it("handles empty channel data", () => {
    const buffer = createMockAudioBuffer([new Float32Array([])]);
    const result = getInt16Samples(buffer, 0);

    expect(result.length).toBe(0);
  });
});

/*
  sniffSampleRate runs against the REAL checked-in fixtures — the point of the
  sniffer is to read genuine container headers, so mocked bytes would test
  nothing. (jsdom can't decode audio, but reading rates is pure byte-walking.)
*/
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sniffSampleRate } from "@/lib/tools/audio-decode";

// vitest runs from the repo root; import.meta.url is rewritten under jsdom.
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(process.cwd(), "src/__tests__/fixtures/samples", name)));

describe("sniffSampleRate", () => {
  it("reads the fmt chunk of a 44.1 kHz WAV", () => {
    expect(sniffSampleRate(fixture("sample-audio.wav"))).toBe(44100);
  });

  it("reads a 96 kHz mono WAV — the rate the old device-rate decode destroyed", () => {
    expect(sniffSampleRate(fixture("sample-audio-96k-mono.wav"))).toBe(96000);
  });

  it("reads the first MPEG frame header of an MP3", () => {
    expect(sniffSampleRate(fixture("sample-audio.mp3"))).toBe(44100);
  });

  it("reads the mdhd timescale of an M4A", () => {
    expect(sniffSampleRate(fixture("sample-audio.m4a"))).toBe(44100);
  });

  /*
    Raw ADTS. `sample-audio.aac` is a `-c:a copy` of `sample-audio.m4a`'s AAC:
    identical audio, no container. Before the ADTS sniffer existed this fell
    through to sniffMp3, which false-synced on the AAC payload at byte 615
    (`ff fc 45 9d` → MPEG1 layer II, rate index 1) and returned 48000 — and
    `decodeAudioData` then RESAMPLED the file to it, so /m4a-to-wav wrote a
    48 kHz WAV from the .aac and a 44.1 kHz WAV from the byte-identical .m4a.
    `.aac` reaches this from aac-to-mp3, m4a-to-wav, m4a-to-mp3, audio-trimmer
    and merge-audio.
  */
  it("reads the sampling_frequency_index of a raw ADTS .aac", () => {
    expect(sniffSampleRate(fixture("sample-audio.aac"))).toBe(44100);
  });

  it("gives the same rate for the .aac and the .m4a holding the same AAC", () => {
    expect(sniffSampleRate(fixture("sample-audio.aac"))).toBe(
      sniffSampleRate(fixture("sample-audio.m4a")),
    );
  });

  it("declines an ADTS header whose frame length points at nothing", () => {
    // Valid syncword, layer 00, rate index 4 — but the length field is a lie,
    // so there is no second frame where it says the first one ends. Guessing
    // here is how the MP3 scanner got this file wrong in the first place.
    const b = new Uint8Array(512).fill(0x11);
    b.set([0xff, 0xf1, 0x50, 0x80, 0x20, 0x00, 0xfc], 0); // frame_length 256
    expect(sniffSampleRate(b)).toBeNull();
  });

  it("does not trust a lone MPEG sync with no frame where it says the next one starts", () => {
    // The exact four bytes sniffMp3 false-synced on inside the .aac payload,
    // dropped into filler. Eleven sync bits are cheap to hit by chance; a
    // matching header one frame_length on is not.
    const b = new Uint8Array(4096).fill(0x11);
    b.set([0xff, 0xfc, 0x45, 0x9d], 20);
    expect(sniffSampleRate(b)).toBeNull();
  });

  it("still reports nothing for AAC payload bytes once the ADTS header is broken", () => {
    // Same fixture with byte 0 cleared, so the ADTS sniffer declines and the
    // MP3 scanner faces the real payload alone. It must come back unsure —
    // null falls through to a device-rate decode, 48000 silently resamples.
    const mangled = fixture("sample-audio.aac").slice();
    mangled[0] = 0x00;
    expect(sniffSampleRate(mangled)).toBeNull();
  });

  it("reads an ID3v2-prefixed MP3", () => {
    const mp3 = fixture("sample-audio.mp3");
    // Wrap the real MP3 in a 128-byte ID3v2 tag (synchsafe size = 118).
    const tag = new Uint8Array(128);
    tag.set([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 118]);
    const wrapped = new Uint8Array(tag.length + mp3.length);
    wrapped.set(tag);
    wrapped.set(mp3, tag.length);
    expect(sniffSampleRate(wrapped)).toBe(44100);
  });

  it("reads a FLAC STREAMINFO header", () => {
    // Minimal fLaC + STREAMINFO block with a 48 kHz rate field.
    const b = new Uint8Array(30);
    b.set([0x66, 0x4c, 0x61, 0x43]); // fLaC
    b[18] = 48000 >> 12;
    b[19] = (48000 >> 4) & 0xff;
    b[20] = (48000 & 0x0f) << 4;
    expect(sniffSampleRate(b)).toBe(48000);
  });

  it("reads a Vorbis identification header inside Ogg", () => {
    const b = new Uint8Array(64);
    b.set([0x4f, 0x67, 0x67, 0x53]); // OggS
    const id = [0x01, ...[...new TextEncoder().encode("vorbis")]];
    b.set(id, 28);
    new DataView(b.buffer).setUint32(28 + 12, 22050, true);
    expect(sniffSampleRate(b)).toBe(22050);
  });

  it("returns null for garbage, truncated and absurd-rate inputs", () => {
    expect(sniffSampleRate(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sniffSampleRate(new Uint8Array(64).fill(0xab))).toBeNull();
    expect(sniffSampleRate(fixture("sample-audio.wav").slice(0, 20))).toBeNull();
    // A WAV header claiming 1 Hz must be treated as unknown, not used.
    const bogus = fixture("sample-audio.wav").slice();
    new DataView(bogus.buffer, bogus.byteOffset).setUint32(24, 1, true);
    expect(sniffSampleRate(bogus)).toBeNull();
  });

  /*
    Multi-track ISO-BMFF. Synthesised rather than fixtured: the checked-in
    m4a has a single trak, so only a hand-built container can express "the
    video/metadata track is written first" — the case where returning the
    first mdhd in file order hands back the wrong timescale entirely.
  */
  const isoBox = (type: string, payload: Uint8Array): Uint8Array => {
    const out = new Uint8Array(8 + payload.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(payload, 8);
    return out;
  };
  const join = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };
  /** version-0 mdhd: version/flags(4) ctime(4) mtime(4) timescale(4) … */
  const mdhd = (timescale: number): Uint8Array => {
    const p = new Uint8Array(20);
    new DataView(p.buffer).setUint32(12, timescale);
    return isoBox("mdhd", p);
  };
  /** hdlr: version/flags(4) pre_defined(4) handlerType(4) reserved(12) name */
  const hdlr = (handler: string): Uint8Array => {
    const p = new Uint8Array(25);
    p.set(new TextEncoder().encode(handler), 8);
    return isoBox("hdlr", p);
  };
  // mdhd BEFORE hdlr, matching the real fixture's box order.
  const trak = (handler: string, timescale: number): Uint8Array =>
    isoBox("trak", isoBox("mdia", join(mdhd(timescale), hdlr(handler))));
  const mp4 = (...traks: Uint8Array[]): Uint8Array =>
    join(isoBox("ftyp", new TextEncoder().encode("M4A isom")), isoBox("moov", join(...traks)));

  it("skips a leading video track and reads the sound track's timescale", () => {
    // First-mdhd-wins returned 90000 here — inside the sanity band, so the
    // audio silently decoded at a 90 kHz rate it never had.
    expect(sniffSampleRate(mp4(trak("vide", 90000), trak("soun", 44100)))).toBe(44100);
  });

  it("skips a leading timed-metadata track too", () => {
    expect(sniffSampleRate(mp4(trak("meta", 600), trak("soun", 48000)))).toBe(48000);
  });

  it("still reads a single sound track, whatever the box order", () => {
    expect(sniffSampleRate(mp4(trak("soun", 22050)))).toBe(22050);
  });

  it("falls back to the first mdhd when no track declares a handler", () => {
    const noHdlr = isoBox("trak", isoBox("mdia", mdhd(32000)));
    expect(sniffSampleRate(mp4(noHdlr))).toBe(32000);
  });
});

/*
  FFmpeg-fallback routing. The engine itself is mocked — what's under test is
  WHEN the fallback fires (allowlisted container whose browser decode failed),
  and that its WAV output goes back through the normal decode path.
*/
const ffmpegMock = vi.hoisted(() => ({
  runFFmpegTask: vi.fn(),
  fileToUint8Array: vi.fn(async (f: File) => new Uint8Array(await f.arrayBuffer())),
}));
vi.mock("@/lib/tools/ffmpeg-loader", () => ffmpegMock);

function tinyWav(rate: number): Uint8Array {
  const buf = new Uint8Array(48);
  const dv = new DataView(buf.buffer);
  buf.set([0x52, 0x49, 0x46, 0x46]); // RIFF
  dv.setUint32(4, 40, true);
  buf.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  buf.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  buf.set([0x64, 0x61, 0x74, 0x61], 36); // data
  dv.setUint32(40, 4, true);
  return buf;
}

describe("decodeAudioFile — FFmpeg fallback", () => {
  const decodedBuffer = createMockAudioBuffer([new Float32Array([0.25])]);

  beforeEach(() => {
    vi.clearAllMocks();
    // Browser decoder: accepts WAV bytes, rejects everything else — the
    // Firefox-can't-do-AAC situation.
    mockDecodeAudioData.mockImplementation(async (ab: ArrayBuffer) => {
      const head = new Uint8Array(ab.slice(0, 4));
      if (String.fromCharCode(...head) === "RIFF") return decodedBuffer;
      throw new Error("Unable to decode audio data");
    });
    mockClose.mockResolvedValue(undefined);
  });

  it("routes an undecodable m4a through FFmpeg and decodes its WAV output", async () => {
    ffmpegMock.runFFmpegTask.mockResolvedValue(tinyWav(22050));
    const file = new File(["fake-aac-bytes"], "song.m4a", { type: "audio/mp4" });

    const result = await decodeAudioFile(file);

    expect(ffmpegMock.runFFmpegTask).toHaveBeenCalledTimes(1);
    expect(result).toBe(decodedBuffer);
  });

  it("hands the fallback the abort signal — and deliberately not the progress reporter", async () => {
    /*
      The fallback pulls a 31 MB core and runs it to completion, so it has to
      be interruptible. `onProgress` is withheld on purpose: this is the decode
      half of a job whose encode owns the bar, and letting the decode drive it
      0→100 would make the encode look like it restarted from zero.
    */
    ffmpegMock.runFFmpegTask.mockResolvedValue(tinyWav(22050));
    const { signal } = new AbortController();
    const onProgress = vi.fn();
    const file = new File(["fake-aac-bytes"], "song.m4a", { type: "audio/mp4" });

    await decodeAudioFile(file, { signal, onProgress });

    expect(ffmpegMock.runFFmpegTask).toHaveBeenCalledWith(expect.any(Function), { signal });
  });

  it("never starts the fallback once the caller has cancelled", async () => {
    ffmpegMock.runFFmpegTask.mockResolvedValue(tinyWav(22050));
    const controller = new AbortController();
    controller.abort();
    const file = new File(["fake-aac-bytes"], "song.m4a", { type: "audio/mp4" });

    await expect(
      decodeAudioFile(file, { signal: controller.signal }),
    ).rejects.toThrow(/aborted/i);
    expect(ffmpegMock.runFFmpegTask).not.toHaveBeenCalled();
  });

  it("routes a .wma through FFmpeg — for WMA that is the only path there is", async () => {
    /*
      Every other entry in the allowlist is a browser gap that some engine
      fills. WMA is filled by none of them: measured 2026-09-04 on a real
      35 744-byte wmav2-in-ASF file, `decodeAudioData` rejected it in Chromium
      ("Unable to decode audio data"), WebKit ("Decoding failed") and Firefox
      ("...unknown content type"). Drop `"wma"` from FFMPEG_FALLBACK_EXTS and
      /wma-to-mp3 becomes a page that cannot open its own format.
    */
    ffmpegMock.runFFmpegTask.mockResolvedValue(tinyWav(44100));
    const file = new File(["fake-asf-bytes"], "track.wma", { type: "audio/x-ms-wma" });

    const result = await decodeAudioFile(file);

    expect(ffmpegMock.runFFmpegTask).toHaveBeenCalledTimes(1);
    expect(result).toBe(decodedBuffer);
  });

  it("does NOT reach for FFmpeg on unknown extensions", async () => {
    const file = new File(["junk"], "noise.xyz", { type: "audio/unknown" });

    await expect(decodeAudioFile(file)).rejects.toThrow("Unable to decode audio data");
    expect(ffmpegMock.runFFmpegTask).not.toHaveBeenCalled();
  });

  it("surfaces the browser's error when the fallback also fails", async () => {
    ffmpegMock.runFFmpegTask.mockRejectedValue(new Error("FFmpeg could not decode this audio file"));
    const file = new File(["truly-corrupt"], "broken.m4a", { type: "audio/mp4" });

    await expect(decodeAudioFile(file)).rejects.toThrow("Unable to decode audio data");
    expect(ffmpegMock.runFFmpegTask).toHaveBeenCalledTimes(1);
  });
});

/*
  MEMFS hygiene. The fallback copies the ENTIRE source in with `writeFile`
  (it is the one call site in this cluster that copies rather than mounts), so
  a decode that throws before the deletes pins a full copy of the user's file
  on the worker heap for the life of the tab. On /wma-to-mp3 — FFmpeg-only, and
  no browser decodes WMA — a DRM'd or truncated file fails EVERY time, and the
  leaks accumulate one per attempt under their own `input.<ext>` name.

  These drive the real task callback against a stand-in MEMFS, so what is
  asserted is what is left behind rather than which lines were reached.
*/
describe("decodeAudioFile — the FFmpeg fallback's MEMFS cleanup", () => {
  /** Names still present when the task returns are leaked. */
  function fakeEngine(exitCode: number) {
    const fs = new Set<string>();
    const ffmpeg = {
      writeFile: vi.fn(async (name: string) => {
        fs.add(name);
      }),
      exec: vi.fn(async () => {
        if (exitCode === 0) fs.add("decoded.wav");
        return exitCode;
      }),
      readFile: vi.fn(async () => tinyWav(44100)),
      deleteFile: vi.fn(async (name: string) => {
        // MEMFS rejects an unlink of a file that was never written, which is
        // exactly the state the output is in after a failed exec.
        if (!fs.delete(name)) throw new Error(`FS error: no such file, '${name}'`);
        return true;
      }),
    };
    return { fs, ffmpeg };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockDecodeAudioData.mockImplementation(async (ab: ArrayBuffer) => {
      const head = new Uint8Array(ab.slice(0, 4));
      if (String.fromCharCode(...head) === "RIFF") return createMockAudioBuffer([new Float32Array([0.25])]);
      throw new Error("Unable to decode audio data");
    });
    mockClose.mockResolvedValue(undefined);
  });

  it("removes the source from MEMFS when the decode exits non-zero", async () => {
    const engine = fakeEngine(1);
    ffmpegMock.runFFmpegTask.mockImplementation(
      async (task: (f: typeof engine.ffmpeg) => Promise<unknown>) => task(engine.ffmpeg),
    );
    const file = new File(["drm-protected-bytes"], "library.wma", { type: "audio/x-ms-wma" });

    await expect(decodeAudioFile(file)).rejects.toThrow();

    expect(engine.ffmpeg.writeFile).toHaveBeenCalledWith("input.wma", expect.anything());
    expect([...engine.fs]).toEqual([]);
  });

  it("does not accumulate a leak per failed attempt", async () => {
    const engine = fakeEngine(1);
    ffmpegMock.runFFmpegTask.mockImplementation(
      async (task: (f: typeof engine.ffmpeg) => Promise<unknown>) => task(engine.ffmpeg),
    );

    for (const name of ["library.wma", "second.m4a", "third.flac"]) {
      await expect(decodeAudioFile(new File(["bad"], name))).rejects.toThrow();
    }

    expect([...engine.fs]).toEqual([]);
  });

  it("still removes both files on the success path", async () => {
    const engine = fakeEngine(0);
    ffmpegMock.runFFmpegTask.mockImplementation(
      async (task: (f: typeof engine.ffmpeg) => Promise<unknown>) => task(engine.ffmpeg),
    );
    const file = new File(["fake-aac-bytes"], "song.m4a", { type: "audio/mp4" });

    await expect(decodeAudioFile(file)).resolves.toBeTruthy();

    expect(engine.ffmpeg.deleteFile).toHaveBeenCalledWith("input.m4a");
    expect(engine.ffmpeg.deleteFile).toHaveBeenCalledWith("decoded.wav");
    expect([...engine.fs]).toEqual([]);
  });
});
