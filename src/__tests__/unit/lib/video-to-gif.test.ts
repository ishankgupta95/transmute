import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks for vi.mock factories ---
const {
  mockCreateVideo,
  mockWaitForReady,
  mockPlayAndExtractFrames,
} = vi.hoisted(() => ({
  mockCreateVideo: vi.fn(),
  mockWaitForReady: vi.fn().mockResolvedValue(undefined),
  mockPlayAndExtractFrames: vi.fn().mockResolvedValue(undefined),
}));

const {
  mockGifWriteFrame,
  mockGifFinish,
  mockQuantize,
  mockApplyPalette,
  mockGIFEncoder,
} = vi.hoisted(() => {
  const mockGifWriteFrame = vi.fn();
  const mockGifFinish = vi.fn();
  const mockGifBytes = vi.fn().mockReturnValue(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39]));
  const mockQuantize = vi.fn().mockReturnValue([[0, 0, 0], [255, 255, 255]]);
  const mockApplyPalette = vi.fn().mockReturnValue(new Uint8Array([0, 1, 0, 1]));
  const mockGIFEncoder = vi.fn().mockReturnValue({
    writeFrame: mockGifWriteFrame,
    finish: mockGifFinish,
    bytes: mockGifBytes,
  });
  return { mockGifWriteFrame, mockGifFinish, mockGifBytes, mockQuantize, mockApplyPalette, mockGIFEncoder };
});

vi.mock("@/lib/tools/video-utils", () => ({
  createVideo: mockCreateVideo,
  waitForReady: mockWaitForReady,
  playAndExtractFrames: mockPlayAndExtractFrames,
}));

vi.mock("gifenc", () => ({
  GIFEncoder: mockGIFEncoder,
  quantize: mockQuantize,
  applyPalette: mockApplyPalette,
}));

// Mock canvas
const mockGetImageData = vi.fn().mockReturnValue({
  data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
});
const mockDrawImage = vi.fn();
const mockGetContext = vi.fn().mockReturnValue({
  drawImage: mockDrawImage,
  getImageData: mockGetImageData,
});

const mockCanvas = {
  width: 0,
  height: 0,
  getContext: mockGetContext,
};

const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
  if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
  return originalCreateElement(tag);
});

// Mock URL
const mockRevokeObjectURL = vi.fn();
vi.stubGlobal("URL", {
  ...globalThis.URL,
  createObjectURL: vi.fn().mockReturnValue("blob:mock-video-url"),
  revokeObjectURL: mockRevokeObjectURL,
});

import { videoToGif } from "@/lib/tools/video-to-gif";

describe("videoToGif", () => {
  const defaultOptions = { startTime: 0, endTime: 5, fps: 10, width: 320 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvas.width = 0;
    mockCanvas.height = 0;

    mockCreateVideo.mockReturnValue({
      videoWidth: 640,
      videoHeight: 480,
    });

    mockGetImageData.mockReturnValue({
      data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
    });

    // Default: invoke frame callback 3 times with spaced-apart currentTime
    mockPlayAndExtractFrames.mockImplementation(
      async (_video: unknown, _start: number, _end: number, frameCb: (vid: unknown, ts: number) => Promise<void>, _ctx?: unknown) => {
        const mockVid = { currentTime: 0 };
        // Frame at t=0
        mockVid.currentTime = 0;
        await frameCb(mockVid, 0);
        // Frame at t=0.1 (100ms apart, fps=10 means frameInterval=0.1)
        mockVid.currentTime = 0.1;
        await frameCb(mockVid, 100000);
        // Frame at t=0.2
        mockVid.currentTime = 0.2;
        await frameCb(mockVid, 200000);
      },
    );
  });

  it("creates video from object URL and calls waitForReady", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, defaultOptions);

    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(mockCreateVideo).toHaveBeenCalledWith("blob:mock-video-url");
    expect(mockWaitForReady).toHaveBeenCalled();
  });

  it("calls playAndExtractFrames with correct startTime and endTime", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    const opts = { startTime: 2, endTime: 8, fps: 10, width: 320 };
    await videoToGif(file, opts);

    expect(mockPlayAndExtractFrames).toHaveBeenCalledWith(
      expect.anything(), // video element
      2,                 // startTime
      8,                 // endTime
      expect.any(Function), // frame callback
      { signal: undefined, onProgress: undefined }, // no context passed
    );
  });

  it("forwards progress callback and signal to playAndExtractFrames", async () => {
    const onProgress = vi.fn();
    const signal = new AbortController().signal;
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, defaultOptions, { onProgress, signal });

    expect(mockPlayAndExtractFrames).toHaveBeenCalledWith(
      expect.anything(),
      0,
      5,
      expect.any(Function),
      { signal, onProgress },
    );
  });

  it("frame callback draws to canvas and gets imageData", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, defaultOptions);

    expect(mockDrawImage).toHaveBeenCalled();
    expect(mockGetImageData).toHaveBeenCalledWith(0, 0, 320, expect.any(Number));
  });

  it("frame callback calls quantize and applyPalette", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, defaultOptions);

    expect(mockQuantize).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      256,
      { format: "rgb444" },
    );
    expect(mockApplyPalette).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.anything(), // palette
      "rgb444",
    );
  });

  it("writeFrame called with correct delay based on fps", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    const opts = { startTime: 0, endTime: 5, fps: 20, width: 320 };
    await videoToGif(file, opts);

    // delay = Math.round(1000 / 20) = 50
    expect(mockGifWriteFrame).toHaveBeenCalledWith(
      expect.anything(),
      320,
      expect.any(Number),
      expect.objectContaining({ delay: 50, dispose: 2 }),
    );
  });

  it("first frame includes {first: true, repeat: 0}", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, defaultOptions);

    const firstCall = mockGifWriteFrame.mock.calls[0];
    expect(firstCall[3]).toEqual(expect.objectContaining({
      first: true,
      repeat: 0,
      delay: 100, // 1000/10
      dispose: 2,
    }));
  });

  it("subsequent frames do NOT have first/repeat properties", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, defaultOptions);

    // Should have 3 frames
    expect(mockGifWriteFrame).toHaveBeenCalledTimes(3);

    const secondCall = mockGifWriteFrame.mock.calls[1];
    expect(secondCall[3]).not.toHaveProperty("first");
    expect(secondCall[3]).not.toHaveProperty("repeat");
    expect(secondCall[3]).toEqual(expect.objectContaining({ delay: 100, dispose: 2 }));
  });

  it("gif.finish() called after frame extraction", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, defaultOptions);

    expect(mockGifFinish).toHaveBeenCalledTimes(1);
  });

  it("URL cleaned up via revokeObjectURL", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, defaultOptions);

    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-video-url");
  });

  it("output has .gif extension and image/gif type", async () => {
    const file = new File(["video"], "my-video.mp4", { type: "video/mp4" });
    const result = await videoToGif(file, defaultOptions);

    expect(result.fileName).toBe("my-video.gif");
    expect(result.blob.type).toBe("image/gif");
  });

  it("handles multi-dot filenames", async () => {
    const file = new File(["video"], "my.cool.video.mov", { type: "video/quicktime" });
    const result = await videoToGif(file, defaultOptions);

    expect(result.fileName).toBe("my.cool.video.gif");
  });

  it("returns correct originalSize and newSize", async () => {
    const file = new File(["video-content-here"], "test.mp4", { type: "video/mp4" });
    const result = await videoToGif(file, defaultOptions);

    expect(result.originalSize).toBe(file.size);
    expect(result.newSize).toBe(result.blob.size);
  });

  describe("FPS sampling / frame gating", () => {
    it("skips frames that are too close together", async () => {
      // fps=10 means frameInterval=0.1s, threshold=0.08s
      mockPlayAndExtractFrames.mockImplementation(
        async (_video: unknown, _start: number, _end: number, frameCb: (vid: unknown, ts: number) => Promise<void>) => {
          const mockVid = { currentTime: 0 };
          // Frame 1 at t=0
          mockVid.currentTime = 0;
          await frameCb(mockVid, 0);
          // Frame 2 at t=0.05 — should be skipped (0.05 < 0.08)
          mockVid.currentTime = 0.05;
          await frameCb(mockVid, 50000);
          // Frame 3 at t=0.1 — should be captured
          mockVid.currentTime = 0.1;
          await frameCb(mockVid, 100000);
          // Frame 4 at t=0.12 — should be skipped (0.02 < 0.08)
          mockVid.currentTime = 0.12;
          await frameCb(mockVid, 120000);
          // Frame 5 at t=0.2 — should be captured
          mockVid.currentTime = 0.2;
          await frameCb(mockVid, 200000);
        },
      );

      const file = new File(["video"], "test.mp4", { type: "video/mp4" });
      await videoToGif(file, defaultOptions);

      // Only 3 frames should have been written (t=0, t=0.1, t=0.2)
      expect(mockGifWriteFrame).toHaveBeenCalledTimes(3);
    });
  });

  describe("canvas dimensions", () => {
    it("sets canvas width from options and computes height from aspect ratio", async () => {
      // Video is 640x480, width option is 320 -> scale=0.5, height=240
      mockCreateVideo.mockReturnValue({
        videoWidth: 640,
        videoHeight: 480,
      });

      const file = new File(["video"], "test.mp4", { type: "video/mp4" });
      await videoToGif(file, { ...defaultOptions, width: 320 });

      expect(mockCanvas.width).toBe(320);
      expect(mockCanvas.height).toBe(240);
    });

    it("computes height correctly for non-standard aspect ratio", async () => {
      // Video is 1920x1080, width option is 480 -> scale=0.25, height=270
      mockCreateVideo.mockReturnValue({
        videoWidth: 1920,
        videoHeight: 1080,
      });

      const file = new File(["video"], "test.mp4", { type: "video/mp4" });
      await videoToGif(file, { ...defaultOptions, width: 480 });

      expect(mockCanvas.width).toBe(480);
      expect(mockCanvas.height).toBe(270);
    });

    it("rounds height to nearest integer", async () => {
      // Video is 640x479, width=320 -> scale=0.5, height=239.5 -> rounds to 240
      mockCreateVideo.mockReturnValue({
        videoWidth: 640,
        videoHeight: 479,
      });

      const file = new File(["video"], "test.mp4", { type: "video/mp4" });
      await videoToGif(file, { ...defaultOptions, width: 320 });

      expect(mockCanvas.width).toBe(320);
      expect(mockCanvas.height).toBe(Math.round(479 * 0.5));
    });
  });

  it("creates canvas with willReadFrequently context option", async () => {
    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, defaultOptions);

    expect(mockGetContext).toHaveBeenCalledWith("2d", { willReadFrequently: true });
  });

  it("writeFrame receives correct width and height", async () => {
    mockCreateVideo.mockReturnValue({
      videoWidth: 640,
      videoHeight: 480,
    });

    const file = new File(["video"], "test.mp4", { type: "video/mp4" });
    await videoToGif(file, { ...defaultOptions, width: 320 });

    // height = 480 * (320/640) = 240
    for (const call of mockGifWriteFrame.mock.calls) {
      expect(call[1]).toBe(320);  // width
      expect(call[2]).toBe(240);  // height
    }
  });
});
