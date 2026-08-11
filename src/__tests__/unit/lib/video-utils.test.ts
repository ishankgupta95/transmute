import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock AudioContext for detectAudio
const mockDecodeAudioData = vi.fn();
const mockAudioClose = vi.fn().mockResolvedValue(undefined);

const MockAudioContext = vi.fn(function () {
  return { decodeAudioData: mockDecodeAudioData, close: mockAudioClose };
});
vi.stubGlobal("AudioContext", MockAudioContext);

import {
  createVideo,
  waitForReady,
  detectAudio,
  playAndExtractFrames,
} from "@/lib/tools/video-utils";

describe("createVideo", () => {
  it("creates an HTMLVideoElement", () => {
    const video = createVideo("blob:http://example.com/video");
    expect(video).toBeInstanceOf(HTMLVideoElement);
  });

  it("sets muted to true", () => {
    const video = createVideo("blob:http://example.com/video");
    expect(video.muted).toBe(true);
  });

  it("sets playsInline to true", () => {
    const video = createVideo("blob:http://example.com/video");
    expect(video.playsInline).toBe(true);
  });

  it("sets preload to auto", () => {
    const video = createVideo("blob:http://example.com/video");
    expect(video.preload).toBe("auto");
  });

  it("sets the src", () => {
    const src = "blob:http://example.com/video";
    const video = createVideo(src);
    expect(video.src).toContain(src);
  });
});

describe("waitForReady", () => {
  it("resolves immediately if readyState >= 3", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { value: 4, writable: true });

    await expect(waitForReady(video)).resolves.toBeUndefined();
  });

  it("resolves when canplay fires", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { value: 0, writable: true });

    const promise = waitForReady(video);

    // Simulate the canplay event
    video.oncanplay?.(new Event("canplay") as unknown as Event);

    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects when error fires", async () => {
    const video = document.createElement("video");
    Object.defineProperty(video, "readyState", { value: 0, writable: true });

    const promise = waitForReady(video);

    // Simulate the error event
    video.onerror?.(new Event("error") as unknown as Event);

    await expect(promise).rejects.toThrow("Failed to load video");
  });
});

describe("detectAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when audio can be decoded", async () => {
    mockDecodeAudioData.mockResolvedValueOnce({} as AudioBuffer);
    const file = new File(["audio-video"], "video.mp4", { type: "video/mp4" });

    const result = await detectAudio(file);

    expect(result).toBe(true);
  });

  it("returns false when decoding fails", async () => {
    mockDecodeAudioData.mockRejectedValueOnce(new Error("No audio track"));
    const file = new File(["video-only"], "video.mp4", { type: "video/mp4" });

    const result = await detectAudio(file);

    expect(result).toBe(false);
  });

  it("creates an AudioContext", async () => {
    mockDecodeAudioData.mockResolvedValueOnce({} as AudioBuffer);
    const file = new File(["data"], "video.mp4", { type: "video/mp4" });

    await detectAudio(file);

    expect(MockAudioContext).toHaveBeenCalled();
  });

  it("reads arrayBuffer from the file", async () => {
    mockDecodeAudioData.mockResolvedValueOnce({} as AudioBuffer);
    const file = new File(["data"], "video.mp4", { type: "video/mp4" });
    const spy = vi.spyOn(file, "arrayBuffer");

    await detectAudio(file);

    expect(spy).toHaveBeenCalled();
  });

  it("closes the AudioContext on success", async () => {
    mockDecodeAudioData.mockResolvedValueOnce({} as AudioBuffer);
    const file = new File(["data"], "video.mp4", { type: "video/mp4" });

    await detectAudio(file);

    expect(mockAudioClose).toHaveBeenCalled();
  });
});

describe("playAndExtractFrames — cancellation", () => {
  /**
   * A real element (the function appends it to the DOM) with the two APIs
   * jsdom lacks stubbed out, so frames only advance when a test drives them.
   */
  function stubVideo() {
    const video = document.createElement("video");
    const frameCallbacks: (() => void)[] = [];
    Object.assign(video, {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      requestVideoFrameCallback: vi.fn((cb: () => void) => {
        frameCallbacks.push(cb);
        return 1;
      }),
    });
    return { video, frameCallbacks };
  }

  it("never starts when the signal is already aborted", async () => {
    const { video } = stubVideo();
    const onFrame = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(
      playAndExtractFrames(video, 0, 5, onFrame, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(onFrame).not.toHaveBeenCalled();
    // Bailing before the append must not leave the hidden element behind.
    expect(video.isConnected).toBe(false);
  });

  it("rejects when aborted mid-walk and detaches the element", async () => {
    const { video } = stubVideo();
    const controller = new AbortController();

    // No frame callback is ever driven, so the only way out is the abort —
    // which is exactly the state a user cancels from.
    const walk = playAndExtractFrames(video, 0, 5, vi.fn(), {
      signal: controller.signal,
    });
    await Promise.resolve();
    expect(video.isConnected).toBe(true);

    controller.abort();

    await expect(walk).rejects.toMatchObject({ name: "AbortError" });
    expect(video.isConnected).toBe(false);
    expect(video.pause).toHaveBeenCalled();
  });

  it("rejects when aborted during the initial seek", async () => {
    const { video } = stubVideo();
    const controller = new AbortController();

    // `seeked` never fires here, so without its own abort listener the seek
    // would wait forever and a cancel would appear to do nothing.
    const walk = playAndExtractFrames(video, 2, 5, vi.fn(), {
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(walk).rejects.toMatchObject({ name: "AbortError" });
    expect(video.isConnected).toBe(false);
  });

  it("stops invoking onFrame once aborted", async () => {
    const { video, frameCallbacks } = stubVideo();
    const controller = new AbortController();
    const onFrame = vi.fn();

    const walk = playAndExtractFrames(video, 0, 5, onFrame, {
      signal: controller.signal,
    });
    await Promise.resolve();

    controller.abort();
    // A frame that was already queued must be a no-op after the abort.
    frameCallbacks.forEach((cb) => cb());

    await expect(walk).rejects.toMatchObject({ name: "AbortError" });
    expect(onFrame).not.toHaveBeenCalled();
  });
});
