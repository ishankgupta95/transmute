import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/*
  WHAT THIS FILE CAN AND CANNOT GUARD.

  jsdom has no video decoder and no canvas rasteriser: `HTMLVideoElement` never
  presents a frame, `getContext("2d")` returns null and `toBlob` is not
  implemented. So everything below either (a) tests a pure function, or (b)
  drives `extractVideoFrames` / `captureVideoThumbnail` over a FAKE frame walk
  and a FAKE canvas, which pins the orchestration — the plan, the ceiling, the
  filenames, the warnings, the ZIP — without pretending to have decoded
  anything.

  Left to the E2E conversion suite in a real browser, because nothing here can
  see them:
    · that a real <video> presents frames at all under `playAndExtractFrames`
    · that `drawImage` puts the right picture on the canvas
    · that a real seek lands where `planThumbnailWindow` expects
    · whether a given browser can encode WebP from a canvas (the fallback
      BRANCH is tested below with a stub; which browsers take it is not)
*/

const { mockCreateVideo, mockWaitForReady, mockResolveDuration, mockPlayAndExtractFrames } =
  vi.hoisted(() => ({
    mockCreateVideo: vi.fn(),
    mockWaitForReady: vi.fn().mockResolvedValue(undefined),
    mockResolveDuration: vi.fn(),
    mockPlayAndExtractFrames: vi.fn(),
  }));

vi.mock("@/lib/tools/video-utils", () => ({
  createVideo: mockCreateVideo,
  waitForReady: mockWaitForReady,
  resolveDuration: mockResolveDuration,
  playAndExtractFrames: mockPlayAndExtractFrames,
}));

import {
  captureVideoThumbnail,
  DEFAULT_MAX_FRAMES,
  extractVideoFrames,
  frameCapNotice,
  frameFileName,
  framesZipName,
  formatFrameTimestamp,
  planFrameTimes,
  planThumbnailWindow,
  scaleThumbnail,
  thumbnailFileName,
  zipFrames,
  type ExtractFramesOptions,
  type ExtractFramesResult,
} from "@/lib/tools/video-frames";

/* ── The fake canvas ───────────────────────────────────────────────────── */

/** Types the stub canvas will actually write. Narrow it to test the fallback. */
let encodableTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const drawnFrames: unknown[] = [];
/**
 * Every 2D call the engine makes, in order. `clearRect` before each `drawImage`
 * is load-bearing (one canvas serves the whole run and `drawImage` composites
 * source-over), and the ORDER is the whole assertion — a clear that ran after
 * the draw would be worse than none.
 */
const canvasOps: string[] = [];

const realGetContext = HTMLCanvasElement.prototype.getContext;
const realToBlob = HTMLCanvasElement.prototype.toBlob;

function installFakeCanvas() {
  encodableTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  drawnFrames.length = 0;
  canvasOps.length = 0;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: (...args: number[]) => canvasOps.push(`clearRect(${args.join(",")})`),
    drawImage: (source: unknown) => {
      drawnFrames.push(source);
      canvasOps.push("drawImage");
    },
  })) as unknown as typeof realGetContext;
  /*
    The spec's fallback, reproduced: a canvas asked for a type it cannot write
    encodes PNG instead, and the Blob it hands back reports `image/png`. That
    is the exact signal `encodeFrame` reads to keep the file extension honest.
  */
  HTMLCanvasElement.prototype.toBlob = function (
    callback: BlobCallback,
    type?: string,
  ) {
    const written = type && encodableTypes.has(type) ? type : "image/png";
    callback(new Blob([new Uint8Array([1, 2, 3, 4])], { type: written }));
  } as typeof realToBlob;
}

/**
 * A stand-in for `playAndExtractFrames` that presents frames at a fixed rate
 * across the window it is handed, with the same contract the real one has:
 * `onFrame` gets microseconds SINCE `startTime`, and a throw from it ends the
 * walk by rejecting.
 */
function fakeWalkAt(fps: number) {
  return async (
    video: unknown,
    startTime: number,
    endTime: number,
    onFrame: (v: unknown, timestampUs: number) => Promise<void> | void,
    { onProgress }: { onProgress?: (pct: number) => void } = {},
  ) => {
    const period = 1 / fps;
    const span = endTime - startTime;
    for (let t = startTime; t < endTime; t += period) {
      await onFrame(video, Math.round((t - startTime) * 1_000_000));
      onProgress?.(Math.round(((t - startTime) / span) * 100));
    }
  };
}

const file = () => new File(["video-bytes"], "holiday.mp4", { type: "video/mp4" });

const EXTRACT_DEFAULTS: ExtractFramesOptions = {
  mode: "every-n-seconds",
  intervalSeconds: 1,
  format: "png",
  maxFrames: DEFAULT_MAX_FRAMES,
};

async function zipEntryNames(blob: Blob): Promise<string[]> {
  const JSZip = (await import("jszip")).default;
  const read = await JSZip.loadAsync(blob);
  return Object.keys(read.files).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
  installFakeCanvas();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:frames-test");
  globalThis.URL.revokeObjectURL = vi.fn();
  mockCreateVideo.mockReturnValue({ videoWidth: 1280, videoHeight: 720 });
  mockResolveDuration.mockResolvedValue(10);
  mockPlayAndExtractFrames.mockImplementation(fakeWalkAt(30));
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = realGetContext;
  HTMLCanvasElement.prototype.toBlob = realToBlob;
});

/* ── Planning ──────────────────────────────────────────────────────────── */

describe("planFrameTimes", () => {
  it("walks 0, i, 2i … and stops before the end of the clip", () => {
    const plan = planFrameTimes(10, { ...EXTRACT_DEFAULTS, intervalSeconds: 1 });
    // Ten frames, 0 s through 9 s. There is no frame AT 10 s.
    expect(plan.times).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.requestedFrames).toBe(10);
    expect(plan.capped).toBe(false);
  });

  it("counts a partial trailing interval as a frame", () => {
    const plan = planFrameTimes(10.4, { ...EXTRACT_DEFAULTS, intervalSeconds: 3 });
    expect(plan.times).toEqual([0, 3, 6, 9]);
  });

  it("samples the middle of each slice in count mode, so the first frame is not the leader", () => {
    const plan = planFrameTimes(10, {
      ...EXTRACT_DEFAULTS,
      mode: "count",
      frameCount: 4,
    });
    expect(plan.times).toEqual([1.25, 3.75, 6.25, 8.75]);
    expect(plan.requestedFrames).toBe(4);
  });

  it("rejects an interval of zero rather than planning an infinite run", () => {
    expect(() => planFrameTimes(10, { ...EXTRACT_DEFAULTS, intervalSeconds: 0 })).toThrow(
      /longer than zero/i,
    );
  });

  it("rejects a frame count below one", () => {
    expect(() =>
      planFrameTimes(10, { ...EXTRACT_DEFAULTS, mode: "count", frameCount: 0 }),
    ).toThrow(/at least one frame/i);
  });

  it("refuses to plan against a duration it could not read", () => {
    expect(() => planFrameTimes(Infinity, EXTRACT_DEFAULTS)).toThrow(/how long this clip is/i);
    expect(() => planFrameTimes(0, EXTRACT_DEFAULTS)).toThrow(/how long this clip is/i);
  });
});

describe("planFrameTimes — the maxFrames ceiling", () => {
  /*
    The headline guarantee of /video-to-images. A run that asks for more than
    the ceiling must come back SHORT AND SAYING SO, never short and quiet.
  */
  it("stops the plan at the ceiling and records what was really asked for", () => {
    const plan = planFrameTimes(3600, {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 1,
      maxFrames: 300,
    });
    expect(plan.requestedFrames).toBe(3600);
    expect(plan.times).toHaveLength(300);
    expect(plan.capped).toBe(true);
    expect(plan.times[plan.times.length - 1]).toBe(299);
  });

  it("does not claim a cap when the request lands exactly on the ceiling", () => {
    const plan = planFrameTimes(300, {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 1,
      maxFrames: 300,
    });
    expect(plan.times).toHaveLength(300);
    expect(plan.capped).toBe(false);
  });

  it("caps count mode too", () => {
    const plan = planFrameTimes(600, {
      ...EXTRACT_DEFAULTS,
      mode: "count",
      frameCount: 1000,
      maxFrames: 300,
    });
    expect(plan.requestedFrames).toBe(1000);
    expect(plan.times).toHaveLength(300);
    expect(plan.capped).toBe(true);
  });

  it("stops the walk one step past the last frame instead of decoding the whole clip", () => {
    const plan = planFrameTimes(3600, {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 1,
      maxFrames: 300,
    });
    expect(plan.walkEndSeconds).toBe(300);
  });
});

describe("planThumbnailWindow", () => {
  it("opens a window at the requested moment", () => {
    expect(planThumbnailWindow(30, 12)).toEqual({ startSeconds: 12, endSeconds: 13 });
  });

  it("holds the playhead back from the very end, where the walk would present nothing", () => {
    // Asking for the last instant of a 30 s clip: the walk resolves as soon as
    // currentTime >= endTime, checked before any frame is handed over.
    const window = planThumbnailWindow(30, 30);
    expect(window.startSeconds).toBe(29.75);
    expect(window.endSeconds).toBe(30);
  });

  it("clamps a negative request to the start", () => {
    expect(planThumbnailWindow(30, -5).startSeconds).toBe(0);
  });

  it("refuses a duration it could not read", () => {
    expect(() => planThumbnailWindow(Infinity, 1)).toThrow(/how long this clip is/i);
  });
});

describe("scaleThumbnail", () => {
  it("keeps the source size when no width is asked for", () => {
    expect(scaleThumbnail(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("scales down and keeps the aspect ratio", () => {
    expect(scaleThumbnail(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
  });

  it("never upscales — a 640-wide source asked for 1280 stays 640", () => {
    expect(scaleThumbnail(640, 360, 1280)).toEqual({ width: 640, height: 360 });
  });
});

/* ── Naming ────────────────────────────────────────────────────────────── */

describe("formatFrameTimestamp", () => {
  it("pads minutes and seconds to a fixed width", () => {
    expect(formatFrameTimestamp(0)).toBe("00m00.000s");
    expect(formatFrameTimestamp(3.5)).toBe("00m03.500s");
    expect(formatFrameTimestamp(65.25)).toBe("01m05.250s");
    expect(formatFrameTimestamp(3599.999)).toBe("59m59.999s");
  });

  it("treats an unreadable time as zero rather than printing NaN into a filename", () => {
    expect(formatFrameTimestamp(Number.NaN)).toBe("00m00.000s");
    expect(formatFrameTimestamp(-4)).toBe("00m00.000s");
  });
});

describe("frameFileName", () => {
  it("carries a zero-padded index AND the frame's timestamp", () => {
    expect(frameFileName(7, 3.5, 300, "png")).toBe("frame-007-00m03.500s.png");
  });

  it("pads wide enough that a 300-file ZIP sorts in capture order", () => {
    // Plain string sort is what an unzipper and a file browser both do.
    // Unpadded, `frame-10` and `frame-100` sort BEFORE `frame-2` and the strip
    // comes out shuffled; padded, the byte order and the capture order agree.
    const names = [2, 10, 100, 300].map((i) => frameFileName(i, i, 300, "png"));
    expect([...names].sort()).toEqual(names);
  });

  it("widens the padding when the run needs a fourth digit", () => {
    expect(frameFileName(7, 0, 1200, "png")).toBe("frame-0007-00m00.000s.png");
  });

  it("writes .jpg for JPEG, matching the PDF image tools", () => {
    expect(frameFileName(1, 0, 4, "jpeg")).toBe("frame-001-00m00.000s.jpg");
    expect(frameFileName(1, 0, 4, "webp")).toBe("frame-001-00m00.000s.webp");
  });
});

describe("framesZipName / thumbnailFileName", () => {
  it("names the archive after the source", () => {
    expect(framesZipName("holiday.mp4")).toBe("holiday-frames.zip");
    expect(framesZipName("my.cool.clip.mov")).toBe("my.cool.clip-frames.zip");
  });

  it("names a thumbnail after the source and the moment it came from", () => {
    expect(thumbnailFileName("holiday.mp4", 3.5, "jpeg")).toBe("holiday-frame-00m03.500s.jpg");
  });
});

describe("frameCapNotice", () => {
  const result = (over: Partial<ExtractFramesResult>): ExtractFramesResult => ({
    blob: new Blob(),
    fileName: "holiday-frames.zip",
    originalSize: 10,
    newSize: 10,
    frames: [],
    requestedFrames: 10,
    capped: false,
    durationSeconds: 10,
    ...over,
  });

  it("says nothing when nothing was capped", () => {
    expect(frameCapNotice(result({}), 300)).toBeNull();
  });

  it("names the request, the ceiling and how far the ZIP actually reaches", () => {
    const notice = frameCapNotice(
      result({
        capped: true,
        requestedFrames: 3600,
        durationSeconds: 3600,
        frames: [
          { index: 1, timeSeconds: 0, blob: new Blob(), fileName: "a" },
          { index: 2, timeSeconds: 299, blob: new Blob(), fileName: "b" },
        ],
      }),
      300,
    );
    expect(notice).toContain("3600");
    expect(notice).toContain("300");
    expect(notice).toContain("04m59.000s");
  });
});

/* ── The ZIP ───────────────────────────────────────────────────────────── */

describe("zipFrames", () => {
  it("puts every frame in the archive under its own name", async () => {
    const blob = await zipFrames([
      { fileName: "frame-001-00m00.000s.png", blob: new Blob([new Uint8Array([1])]) },
      { fileName: "frame-002-00m01.000s.png", blob: new Blob([new Uint8Array([2, 3])]) },
    ]);
    expect(blob.size).toBeGreaterThan(0);
    expect(await zipEntryNames(blob)).toEqual([
      "frame-001-00m00.000s.png",
      "frame-002-00m01.000s.png",
    ]);
  });
});

/* ── extractVideoFrames, over a fake walk ──────────────────────────────── */

describe("extractVideoFrames", () => {
  it("returns one frame per planned moment, zipped and named", async () => {
    mockResolveDuration.mockResolvedValue(5);
    const result = await extractVideoFrames(file(), {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 1,
    });

    expect(result.frames).toHaveLength(5);
    expect(result.requestedFrames).toBe(5);
    expect(result.capped).toBe(false);
    expect(result.durationSeconds).toBe(5);
    expect(result.fileName).toBe("holiday-frames.zip");
    expect(result.originalSize).toBe(file().size);
    expect(result.newSize).toBe(result.blob.size);
    expect(await zipEntryNames(result.blob)).toEqual(
      result.frames.map((f) => f.fileName).sort(),
    );
  });

  it("records each frame's REAL timestamp, not the moment the plan asked for", async () => {
    // 23.976 fps (NTSC): no frame is presented AT 1.000 s, so the plan point
    // at 1 s is served by the frame just after it — and the name follows the
    // frame, not the plan.
    mockPlayAndExtractFrames.mockImplementation(fakeWalkAt(24000 / 1001));
    mockResolveDuration.mockResolvedValue(3);
    const result = await extractVideoFrames(file(), {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 1,
    });
    const second = result.frames[1];
    expect(second.timeSeconds).toBeGreaterThan(1);
    expect(second.fileName).toBe(
      `frame-002-${formatFrameTimestamp(second.timeSeconds)}.png`,
    );
  });

  it("STOPS AT maxFrames and reports the cap rather than truncating quietly", async () => {
    mockResolveDuration.mockResolvedValue(60);
    const result = await extractVideoFrames(file(), {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 0.5,
      maxFrames: 3,
    });

    expect(result.requestedFrames).toBe(120);
    expect(result.frames).toHaveLength(3);
    expect(result.capped).toBe(true);
    expect(await zipEntryNames(result.blob)).toHaveLength(3);
    // And the sentence the page prints is derived from the same result.
    expect(frameCapNotice(result, 3)).toContain("120");
  });

  it("stops decoding as soon as the plan is satisfied", async () => {
    mockResolveDuration.mockResolvedValue(600);
    const walk = vi.fn(fakeWalkAt(30));
    mockPlayAndExtractFrames.mockImplementation(walk);
    await extractVideoFrames(file(), {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 1,
      maxFrames: 2,
    });
    // The walk window ends one interval past the last planned frame, not at
    // the end of a ten-minute video.
    expect(walk.mock.calls[0][2]).toBe(2);
  });

  it("says so when the source has no distinct frame as often as the interval asks", async () => {
    // A 1 fps timelapse asked for a frame every 0.25 s: three of every four
    // planned moments fall inside a picture already saved.
    mockPlayAndExtractFrames.mockImplementation(fakeWalkAt(1));
    mockResolveDuration.mockResolvedValue(4);
    const result = await extractVideoFrames(file(), {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 0.25,
    });

    expect(result.requestedFrames).toBe(16);
    expect(result.frames).toHaveLength(4);
    expect(result.warnings?.join(" ")).toMatch(/already been saved/i);
    expect(result.warnings?.join(" ")).toContain("4 frames were saved instead of 16");
  });

  it("says so when the pictures run out before the plan does — and blames neither the clip nor the walk falsely", async () => {
    // The walk gives up after two frames. Ten were planned.
    //
    // The wording matters as much as the count. The commonest real instance of
    // this is a 2.09 s clip sampled every 1 s: the plan's last moment is 2.000 s,
    // the clip DOES carry a picture there, and two frames come back anyway
    // because `playAndExtractFrames` resolves on the element's `ended` event.
    // So a sentence that says the CLIP stopped presenting frames is a plausible
    // diagnosis of the wrong thing, and this asserts we do not print it.
    mockPlayAndExtractFrames.mockImplementation(
      async (
        video: unknown,
        _start: number,
        _end: number,
        onFrame: (v: unknown, ts: number) => Promise<void> | void,
      ) => {
        await onFrame(video, 0);
        await onFrame(video, 1_000_000);
      },
    );
    const result = await extractVideoFrames(file(), {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 1,
    });

    expect(result.frames).toHaveLength(2);
    const said = result.warnings?.join(" ") ?? "";
    expect(said).toMatch(/last 8 of the 10 planned frames are missing/i);
    /*
      THE MECHANISM, RE-DERIVED FROM THE CONTAINER RATHER THAN ARGUED.

      This assertion used to pin "playback reached the end of the clip", on the
      reasoning that the clip really does carry a picture at the last planned
      moment and only the walk stops early. Reading `sample-video.mp4`'s boxes
      shows that is false: its video mdhd is 115200/57600 = exactly 2.000 s and
      its `stts` is `48 x 2400`, so the 48th frame starts at 47/24 = 1.9583 s
      and the pictures are finished at 2.000 s — while the 2.090 s the element
      reports as `duration` is the AUDIO mdhd, 92160/44100. There is no picture
      at the 2.000 s moment.

      So the sentence must say the pictures ran out, and must NOT say the clip
      malfunctioned ("stopped presenting frames"), because a video track ending
      a few tens of milliseconds before the audio beside it is the ordinary
      case, not a fault.
    */
    expect(said).toMatch(/ran out of pictures/i);
    expect(said).not.toMatch(/clip stopped presenting frames/i);
  });

  it("refuses to hand back an empty archive when nothing was captured", async () => {
    mockPlayAndExtractFrames.mockImplementation(async () => {});
    await expect(extractVideoFrames(file(), EXTRACT_DEFAULTS)).rejects.toThrow(
      /No frames were captured/i,
    );
  });

  it("names the files after what the canvas ACTUALLY wrote, not what was asked for", async () => {
    // A browser with no canvas WebP encoder: the spec says it writes PNG and
    // reports image/png. Shipping PNG bytes named .webp would be the lie.
    encodableTypes = new Set(["image/png", "image/jpeg"]);
    mockResolveDuration.mockResolvedValue(2);
    const result = await extractVideoFrames(file(), {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 1,
      format: "webp",
    });

    expect(result.frames.every((f) => f.fileName.endsWith(".png"))).toBe(true);
    expect(result.warnings?.join(" ")).toMatch(/can't encode WEBP/i);
  });

  it("releases the source object URL even when the run fails", async () => {
    mockPlayAndExtractFrames.mockImplementation(async () => {
      throw new Error("Video playback error");
    });
    await expect(extractVideoFrames(file(), EXTRACT_DEFAULTS)).rejects.toThrow(
      /Video playback error/,
    );
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:frames-test");
  });

  it("bands every walk tick into the first 90% and lets only the ZIP report 100", async () => {
    /*
      The fixture has to be able to fail. A 3 s clip at 1 s only ever lets the
      walk report ~66 before `FrameWalkDone` ends it, so a `<= 90` bound over
      that plan is satisfied by the early stop rather than by the banding, and
      deleting `* 0.9` leaves it green. This plan runs the walk to ~95 raw, and
      the assertion is the MAPPING rather than a bound: every value the caller
      saw is the value the walk emitted, banded. Deleting the scaling fails it;
      so does dropping the `onProgress` forwarding altogether.
    */
    mockResolveDuration.mockResolvedValue(10);
    const raw: number[] = [];
    mockPlayAndExtractFrames.mockImplementation(
      async (
        video: unknown,
        startTime: number,
        endTime: number,
        onFrame: (v: unknown, timestampUs: number) => Promise<void> | void,
        { onProgress }: { onProgress?: (pct: number) => void } = {},
      ) => {
        const period = 1 / 30;
        const span = endTime - startTime;
        for (let t = startTime; t < endTime; t += period) {
          await onFrame(video, Math.round((t - startTime) * 1_000_000));
          const pct = Math.round(((t - startTime) / span) * 100);
          raw.push(pct);
          onProgress?.(pct);
        }
      },
    );

    const seen: number[] = [];
    await extractVideoFrames(
      file(),
      { ...EXTRACT_DEFAULTS, intervalSeconds: 0.5 },
      { onProgress: (p) => seen.push(p) },
    );

    // Liveness: the walk really does report past 90 here, so a band that was
    // not applied would be visible.
    expect(Math.max(...raw)).toBeGreaterThan(90);
    expect(seen.slice(0, -1)).toEqual(raw.map((pct) => Math.round(pct * 0.9)));
    expect(Math.max(...seen.slice(0, -1))).toBeLessThanOrEqual(90);
    // The last tenth belongs to the ZIP, which reports nothing of its own.
    expect(seen[seen.length - 1]).toBe(100);
  });

  it("clears the canvas before every frame, so an alpha source cannot ghost", async () => {
    /*
      One canvas serves the whole run and `drawImage` composites source-over, so
      without a clear the transparent regions of frame N keep frame N-1's
      pixels — silent wrong bytes in the PNG and WebP this page defaults to.
      jsdom cannot decode a video, so what is pinned here is the CALL ORDER:
      clear, then draw, once per saved frame.
    */
    mockResolveDuration.mockResolvedValue(3);
    const result = await extractVideoFrames(file(), {
      ...EXTRACT_DEFAULTS,
      intervalSeconds: 1,
    });

    expect(result.frames).toHaveLength(3);
    expect(canvasOps).toEqual([
      "clearRect(0,0,1280,720)",
      "drawImage",
      "clearRect(0,0,1280,720)",
      "drawImage",
      "clearRect(0,0,1280,720)",
      "drawImage",
    ]);
  });
});

/* ── captureVideoThumbnail, over a fake walk ───────────────────────────── */

describe("captureVideoThumbnail", () => {
  it("reports the frame's real time and the real output size", async () => {
    mockCreateVideo.mockReturnValue({ videoWidth: 1920, videoHeight: 1080 });
    mockResolveDuration.mockResolvedValue(30);
    // 12.5 fps, so the first frame after a seek to 12 s lands at 12 s exactly
    // in this fake; the assertion below is about the ARITHMETIC being anchored
    // to the walk's own offset rather than to the number the user typed.
    mockPlayAndExtractFrames.mockImplementation(
      async (
        video: unknown,
        startTime: number,
        _end: number,
        onFrame: (v: unknown, ts: number) => Promise<void> | void,
      ) => {
        // The seek landed 80 ms past the request, as a real one does.
        void startTime;
        await onFrame(video, 80_000);
      },
    );

    const result = await captureVideoThumbnail(file(), {
      timeSeconds: 12,
      format: "jpeg",
      width: 640,
    });

    expect(result.timeSeconds).toBeCloseTo(12.08, 5);
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
    expect(result.fileName).toBe("holiday-frame-00m12.080s.jpg");
    expect(result.newSize).toBe(result.blob.size);
  });

  it("reports the clamped time when the request was past the usable end", async () => {
    mockResolveDuration.mockResolvedValue(30);
    mockPlayAndExtractFrames.mockImplementation(
      async (
        video: unknown,
        _start: number,
        _end: number,
        onFrame: (v: unknown, ts: number) => Promise<void> | void,
      ) => {
        await onFrame(video, 0);
      },
    );
    const result = await captureVideoThumbnail(file(), { timeSeconds: 60, format: "png" });
    // Held back from the very end so the walk has a window to present into,
    // and the number reported is where the frame really came from.
    expect(result.timeSeconds).toBe(29.75);
    expect(result.fileName).toBe("holiday-frame-00m29.750s.png");
  });

  it("keeps the source size rather than upscaling to the requested width", async () => {
    mockCreateVideo.mockReturnValue({ videoWidth: 640, videoHeight: 360 });
    mockResolveDuration.mockResolvedValue(10);
    mockPlayAndExtractFrames.mockImplementation(
      async (
        video: unknown,
        _start: number,
        _end: number,
        onFrame: (v: unknown, ts: number) => Promise<void> | void,
      ) => {
        await onFrame(video, 0);
      },
    );
    const result = await captureVideoThumbnail(file(), {
      timeSeconds: 1,
      format: "png",
      width: 1920,
    });
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
  });

  it("fails loudly when no frame was presented", async () => {
    mockResolveDuration.mockResolvedValue(10);
    mockPlayAndExtractFrames.mockImplementation(async () => {});
    await expect(
      captureVideoThumbnail(file(), { timeSeconds: 5, format: "png" }),
    ).rejects.toThrow(/No frame was presented/i);
  });

  it("names the file after what the canvas actually wrote", async () => {
    encodableTypes = new Set(["image/png"]);
    mockResolveDuration.mockResolvedValue(10);
    mockPlayAndExtractFrames.mockImplementation(
      async (
        video: unknown,
        _start: number,
        _end: number,
        onFrame: (v: unknown, ts: number) => Promise<void> | void,
      ) => {
        await onFrame(video, 0);
      },
    );
    const result = await captureVideoThumbnail(file(), { timeSeconds: 2, format: "jpeg" });
    expect(result.fileName.endsWith(".png")).toBe(true);
    expect(result.warnings?.join(" ")).toMatch(/can't encode JPEG/i);
  });
});
