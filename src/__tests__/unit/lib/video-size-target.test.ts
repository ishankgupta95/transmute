import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  THE SIZE-TARGET ARM of the WebCodecs compressor.

  Separate from video-compress.test.ts for one concrete reason: that file
  hoists a fixed 50-byte muxer buffer, and the single most important claim here
  — "`met` is the finished file WEIGHED, not the solver's opinion of itself" —
  can only be tested by making the output larger and smaller than the ceiling
  on demand. `muxerState.bytes` is that knob.
*/

const {
  mockPlayAndExtractFrames,
  mockCreateVideo,
  mockWaitForReady,
  mockResolveDuration,
  mockDecodeAudio,
  mockAssertWebCodecsSupported,
  mockPickH264Config,
  muxerState,
} = vi.hoisted(() => ({
  mockPlayAndExtractFrames: vi.fn().mockResolvedValue(undefined),
  mockCreateVideo: vi.fn(),
  mockWaitForReady: vi.fn().mockResolvedValue(undefined),
  mockResolveDuration: vi.fn((video: { duration: number }) => Promise.resolve(video.duration)),
  mockDecodeAudio: vi.fn().mockResolvedValue(null),
  mockAssertWebCodecsSupported: vi.fn(),
  mockPickH264Config: vi.fn((base: Record<string, unknown>) =>
    Promise.resolve({ codec: "avc1.640034", hardwareAcceleration: "prefer-hardware", ...base }),
  ),
  /** How many bytes the muxer hands back. The knob this file exists for. */
  muxerState: { bytes: 50 },
}));

const fakeAudioBuffer = {
  length: 2048,
  numberOfChannels: 2,
  sampleRate: 48000,
  getChannelData: () => new Float32Array(2048),
} as unknown as AudioBuffer;

vi.mock("@/lib/tools/video-utils", () => ({
  createVideo: mockCreateVideo,
  waitForReady: mockWaitForReady,
  resolveDuration: mockResolveDuration,
  decodeAudio: mockDecodeAudio,
  assertWebCodecsSupported: mockAssertWebCodecsSupported,
  pickH264Config: mockPickH264Config,
  playAndExtractFrames: mockPlayAndExtractFrames,
}));

vi.mock("mp4-muxer", () => ({
  Muxer: vi.fn(function () {
    return {
      addVideoChunk: vi.fn(),
      addAudioChunk: vi.fn(),
      finalize: vi.fn(),
      // Read at finalize time, so a test can size the output before the run.
      get target() {
        return { buffer: new ArrayBuffer(muxerState.bytes) };
      },
    };
  }),
  ArrayBufferTarget: vi.fn(function () { return {}; }),
}));

const mockVideoEncoderConfigure = vi.fn();
function MockVideoEncoder() {
  return {
    encode: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    configure: mockVideoEncoderConfigure,
    encodeQueueSize: 0,
    ondequeue: null,
  };
}
vi.stubGlobal("VideoEncoder", MockVideoEncoder);
vi.stubGlobal("VideoFrame", function MockVideoFrame() { return { close: vi.fn() }; });

const mockAudioEncoderConfigure = vi.fn();
const mockAudioEncoderIsConfigSupported = vi.fn();
function MockAudioEncoder() {
  return {
    encode: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    configure: mockAudioEncoderConfigure,
  };
}
MockAudioEncoder.isConfigSupported = mockAudioEncoderIsConfigSupported;
vi.stubGlobal("AudioEncoder", MockAudioEncoder);
vi.stubGlobal("AudioData", function MockAudioData() { return { close: vi.fn() }; });
vi.stubGlobal("URL", {
  ...globalThis.URL,
  createObjectURL: vi.fn().mockReturnValue("blob:mock-url"),
  revokeObjectURL: vi.fn(),
});

import {
  compressVideo,
  planSizeTarget,
  SIZE_TARGET_MIN_VIDEO_BITRATE,
} from "@/lib/tools/video-compress";

/** A File whose reported size is the one the solver will actually read. */
function sizedFile(bytes: number, name = "input.mp4"): File {
  const file = new File(["v"], name, { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

const MB = 1024 * 1024;
/** `targetSizeKb` for a ceiling quoted in MB, the unit the UI uses. */
const kbFor = (mb: number) => mb * 1024;

describe("planSizeTarget — solving a bitrate from a ceiling", () => {
  it("spends the whole ceiling across the clip's own length", () => {
    // 10 MB over 100 s = 838,860.8 bps of room; MUX_HEADROOM keeps 6% back for
    // the container, and with no audio track the video gets all the rest.
    const plan = planSizeTarget({
      targetBytes: 10 * MB,
      durationSeconds: 100,
      sourceBytes: 2_000_000_000,
      hasAudio: false,
    });

    expect(plan.videoBitrate).toBe(788_529);
    expect(plan.audioBitrate).toBeNull();
    expect(plan.atFloor).toBe(false);
    expect(plan.sourceCapped).toBe(false);
  });

  it("pays for the soundtrack out of the same ceiling", () => {
    // The identical clip WITH audio: the video budget must come down by
    // exactly what the audio track was given, or the sum overruns the ceiling.
    const silent = planSizeTarget({
      targetBytes: 10 * MB,
      durationSeconds: 100,
      sourceBytes: 2_000_000_000,
      hasAudio: false,
    });
    const withAudio = planSizeTarget({
      targetBytes: 10 * MB,
      durationSeconds: 100,
      sourceBytes: 2_000_000_000,
      hasAudio: true,
    });

    expect(withAudio.audioBitrate).toBe(128_000);
    expect(withAudio.videoBitrate).toBe(silent.videoBitrate - 128_000);
  });

  it("steps the audio down rather than letting it eat the whole budget", () => {
    // 2340 KB over 60 s leaves ~300 kbps in total; a quarter of that is
    // ~75 kbps, so 128 and 96 are both refused and 64 is the highest rung
    // that fits.
    const plan = planSizeTarget({
      targetBytes: 2340 * 1024,
      durationSeconds: 60,
      sourceBytes: 2_000_000_000,
      hasAudio: true,
    });

    expect(plan.audioBitrate).toBe(64_000);
  });

  it("falls to the lowest rung when even a quarter of the budget is tiny", () => {
    const plan = planSizeTarget({
      targetBytes: 2 * MB,
      durationSeconds: 600,
      sourceBytes: 2_000_000_000,
      hasAudio: true,
    });

    expect(plan.audioBitrate).toBe(32_000);
  });

  it("clamps to the floor and SAYS SO when the ceiling is out of reach", () => {
    // 10 MB across an hour is ~23 kbps. Encoding at that would be a slideshow
    // presented as a success; the floor wins and `atFloor` is the flag the UI
    // turns into "could not reach".
    const plan = planSizeTarget({
      targetBytes: 10 * MB,
      durationSeconds: 3600,
      sourceBytes: 500_000_000,
      hasAudio: false,
    });

    expect(plan.videoBitrate).toBe(SIZE_TARGET_MIN_VIDEO_BITRATE);
    expect(plan.atFloor).toBe(true);
    expect(plan.sourceCapped).toBe(false);
  });

  it("never inflates a clip that already spends less than the ceiling allows", () => {
    // A 1 MB, 10 s clip aimed at 25 MB. Solving for 25 MB would re-encode it
    // UP to fill the ceiling — the never-inflate cap holds it at 90% of what
    // the source itself spends, and reports why.
    const plan = planSizeTarget({
      targetBytes: 25 * MB,
      durationSeconds: 10,
      sourceBytes: 1_000_000,
      hasAudio: false,
    });

    expect(plan.videoBitrate).toBe(720_000);
    expect(plan.sourceCapped).toBe(true);
    expect(plan.atFloor).toBe(false);
  });

  it("caps the WHOLE plan, not the video track with the audio added on top", () => {
    /*
      THE CASE THE OLD TEST ABOVE COULD NOT SEE, because it passes
      `hasAudio: false` — the one arrangement in which capping the video
      bitrate alone happens to be the same thing as capping the plan.

      With a soundtrack, the cap used to bound `videoBitrate` at 90% of the
      source's TOTAL rate and then `compressVideo` muxed a freshly-chosen AAC
      track BESIDE it. Same 1 MB / 10 s clip: 720,000 + 128,000 = 848,000 bps
      planned against an 800,000 bps source — 6% over, from a solver whose
      whole job here is to stop the file growing.
    */
    const source = { targetBytes: 25 * MB, durationSeconds: 10, sourceBytes: 1_000_000 };
    const sourceRate = (source.sourceBytes * 8) / source.durationSeconds;

    const plan = planSizeTarget({ ...source, hasAudio: true });

    expect(plan.sourceCapped).toBe(true);
    expect(plan.videoBitrate + (plan.audioBitrate ?? 0)).toBeLessThanOrEqual(sourceRate);
    // The soundtrack is paid for out of the capped budget, so the video's
    // share comes down by exactly what the audio was given.
    expect(plan.audioBitrate).toBe(128_000);
    expect(plan.videoBitrate).toBe(720_000 - 128_000);
  });

  it("holds that cap across every shape of clip that is already under the ceiling", () => {
    /*
      The property, not one vector. `sourceCapped` means the plan was bound by
      what the source spends; whenever it is set, the planned TOTAL must be at
      or under the source's own rate. The single exception is the bitrate
      floor, which this tool will not encode below whatever the arithmetic
      says — and that exception is asserted, not assumed, so a regression that
      widened it would fail here.
    */
    const cases = [
      // F23's headline: a 4 MB, 60 s phone recording with a soundtrack.
      { targetBytes: 25 * MB, durationSeconds: 60, sourceBytes: 4 * MB },
      // F19's arithmetic repro: 15 MB over two minutes.
      { targetBytes: 25 * MB, durationSeconds: 120, sourceBytes: 15 * MB },
      { targetBytes: 25 * MB, durationSeconds: 10, sourceBytes: 1_000_000 },
      { targetBytes: 16 * MB, durationSeconds: 45, sourceBytes: 3 * MB },
      { targetBytes: 10 * MB, durationSeconds: 300, sourceBytes: 9 * MB },
    ];

    for (const c of cases) {
      const sourceRate = (c.sourceBytes * 8) / c.durationSeconds;
      for (const hasAudio of [true, false]) {
        const plan = planSizeTarget({ ...c, hasAudio });
        const planned = plan.videoBitrate + (plan.audioBitrate ?? 0);
        const where = JSON.stringify({ ...c, hasAudio });
        expect(plan.sourceCapped, where).toBe(true);
        expect(plan.atFloor, where).toBe(false);
        expect(planned, where).toBeLessThanOrEqual(sourceRate);
      }
    }
  });

  it("admits both reasons at once rather than hiding the cap behind the floor", () => {
    /*
      A 2 KB "clip" over 4000 s spends 4 bps. The cap says 3.6 bps; the floor
      says 120 kbps and wins. BOTH are true of that plan, and the old code
      made them mutually exclusive by clamping the cap itself UP to the floor
      first (`Math.max(FLOOR, sourceRate * 0.9)`) — which is exactly what
      neutered the cap, because after that clamp `min(solved, sourceCap)` can
      never bind below the floor.
    */
    const plan = planSizeTarget({
      targetBytes: 1 * MB,
      durationSeconds: 4000,
      sourceBytes: 2_000,
      hasAudio: true,
    });

    expect(plan.sourceCapped).toBe(true);
    expect(plan.atFloor).toBe(true);
    expect(plan.videoBitrate).toBe(SIZE_TARGET_MIN_VIDEO_BITRATE);
  });

  it("spends a starved bitrate on fewer pixels instead of destroying the frame", () => {
    // The height ladder. Same 100 s clip, six ceilings: the chosen height has
    // to fall as the bitrate does, or a met target buys an unwatchable file.
    const heightFor = (mb: number) =>
      planSizeTarget({
        targetBytes: mb * MB,
        durationSeconds: 100,
        sourceBytes: 2_000_000_000,
        hasAudio: false,
      }).maxHeight;

    expect(heightFor(100)).toBe(2160);
    expect(heightFor(30)).toBe(1080);
    expect(heightFor(12)).toBe(720);
    expect(heightFor(10)).toBe(480);
    expect(heightFor(3)).toBe(360);
    expect(heightFor(2)).toBe(240);
  });

  it("refuses a cleared or zeroed ceiling rather than encoding at the floor", () => {
    for (const targetBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        planSizeTarget({ targetBytes, durationSeconds: 60, sourceBytes: 1e9, hasAudio: false }),
      ).toThrow(/above 0 MB/);
    }
  });

  it("refuses a clip whose length it could not read", () => {
    for (const durationSeconds of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        planSizeTarget({ targetBytes: 10 * MB, durationSeconds, sourceBytes: 1e9, hasAudio: false }),
      ).toThrow(/how long this clip is/);
    }
  });
});

describe("compressVideo — the size-target arm end to end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    muxerState.bytes = 50;
    mockAudioEncoderIsConfigSupported.mockResolvedValue({ supported: true });
    mockResolveDuration.mockImplementation((video: { duration: number }) =>
      Promise.resolve(video.duration),
    );
    mockDecodeAudio.mockResolvedValue(null);
    mockPickH264Config.mockImplementation((base: Record<string, unknown>) =>
      Promise.resolve({ codec: "avc1.640034", hardwareAcceleration: "prefer-hardware", ...base }),
    );
    mockPlayAndExtractFrames.mockResolvedValue(undefined);
    mockCreateVideo.mockReturnValue({ videoWidth: 1920, videoHeight: 1080, duration: 100 });
  });

  it("encodes at the solved bitrate and the height that bitrate can carry", async () => {
    await compressVideo(sizedFile(2_000_000_000), { targetSizeKb: kbFor(10) });

    const config = mockVideoEncoderConfigure.mock.calls[0][0];
    // Not one of the three preset bitrates — solved from 10 MB over 100 s.
    expect(config.bitrate).toBe(788_529);
    expect(config.height).toBe(480);
    // 1920 × (480/1080) = 853.3 → 854 after the even-dimension rounding.
    expect(config.width).toBe(854);
  });

  it("hands the AAC encoder the bitrate the solver budgeted for it", async () => {
    mockDecodeAudio.mockResolvedValue(fakeAudioBuffer);
    mockCreateVideo.mockReturnValue({ videoWidth: 640, videoHeight: 480, duration: 60 });

    await compressVideo(sizedFile(2_000_000_000), { targetSizeKb: 2340 });

    expect(mockAudioEncoderIsConfigSupported).toHaveBeenCalledWith(
      expect.objectContaining({ bitrate: 64_000 }),
    );
    expect(mockAudioEncoderConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ bitrate: 64_000 }),
    );
  });

  it("reports the target as MET by weighing the finished file", async () => {
    muxerState.bytes = 400_000;

    const result = await compressVideo(sizedFile(2_000_000_000), { targetSizeKb: kbFor(10) });

    expect(result.newSize).toBe(400_000);
    expect(result.sizeTarget?.targetBytes).toBe(10 * MB);
    expect(result.sizeTarget?.met).toBe(true);
  });

  it("reports a MISS when the encoder overshoots, instead of claiming the target", async () => {
    /*
      The single most important test in this file. The solver said 788 kbps
      would fit 10 MB; the encoder produced 30 MB anyway — exactly what H.264
      rate control is allowed to do. `met` must follow the BYTES, not the plan,
      or the tool reports a size it did not achieve.
    */
    muxerState.bytes = 30 * MB;

    const result = await compressVideo(sizedFile(2_000_000_000), { targetSizeKb: kbFor(10) });

    expect(result.newSize).toBe(30 * MB);
    expect(result.sizeTarget?.met).toBe(false);
    // …and it still hands back the file it made, rather than nothing.
    expect(result.blob.size).toBe(30 * MB);
  });

  it("carries the plan's own reasons back with the result", async () => {
    mockCreateVideo.mockReturnValue({ videoWidth: 1920, videoHeight: 1080, duration: 3600 });

    const result = await compressVideo(sizedFile(500_000_000), { targetSizeKb: kbFor(10) });

    expect(result.sizeTarget?.atFloor).toBe(true);
    expect(result.sizeTarget?.videoBitrate).toBe(SIZE_TARGET_MIN_VIDEO_BITRATE);
    expect(result.sizeTarget?.maxHeight).toBe(240);
  });

  it("attaches NO size report to a preset run", async () => {
    // A `sizeTarget` on a preset run would be a ceiling the user never set,
    // and the UI would render a verdict about it.
    const result = await compressVideo(sizedFile(40_000_000), "whatsapp");

    expect(result.sizeTarget).toBeUndefined();
  });

  it("rejects a zero ceiling before encoding a single frame", async () => {
    await expect(
      compressVideo(sizedFile(40_000_000), { targetSizeKb: 0 }),
    ).rejects.toThrow(/above 0 MB/);
    expect(mockVideoEncoderConfigure).not.toHaveBeenCalled();
    expect(mockPlayAndExtractFrames).not.toHaveBeenCalled();
  });
});
