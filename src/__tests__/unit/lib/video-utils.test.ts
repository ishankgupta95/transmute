import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock AudioContext for detectAudio
const mockDecodeAudioData = vi.fn();
const mockAudioClose = vi.fn().mockResolvedValue(undefined);

const MockAudioContext = vi.fn(function () {
  return { decodeAudioData: mockDecodeAudioData, close: mockAudioClose };
});
vi.stubGlobal("AudioContext", MockAudioContext);

import { createVideo, waitForReady, detectAudio } from "@/lib/tools/video-utils";

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
