import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks for vi.mock factories ---
const {
  mockPlayAndExtractFrames,
  mockCreateVideo,
  mockWaitForReady,
  mockResolveDuration,
  mockDecodeAudio,
  mockAssertWebCodecsSupported,
  mockPickH264Config,
} = vi.hoisted(() => ({
  mockPlayAndExtractFrames: vi.fn().mockResolvedValue(undefined),
  mockCreateVideo: vi.fn(),
  mockWaitForReady: vi.fn().mockResolvedValue(undefined),
  // The real helper returns `video.duration` when the container declares
  // one, and only probes by seeking when it is Infinity.
  mockResolveDuration: vi.fn((video: { duration: number }) => Promise.resolve(video.duration)),
  mockDecodeAudio: vi.fn().mockResolvedValue(null),
  mockAssertWebCodecsSupported: vi.fn(),
  mockPickH264Config: vi.fn((base: Record<string, unknown>) =>
    Promise.resolve({ codec: "avc1.640034", ...base }),
  ),
}));

const {
  mockAddVideoChunk,
  mockAddAudioChunk,
  mockFinalize,
  mockMuxerBuffer,
} = vi.hoisted(() => {
  const buf = new ArrayBuffer(100);
  return {
    mockAddVideoChunk: vi.fn(),
    mockAddAudioChunk: vi.fn(),
    mockFinalize: vi.fn(),
    mockMuxerBuffer: buf,
  };
});

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
      addVideoChunk: mockAddVideoChunk,
      addAudioChunk: mockAddAudioChunk,
      finalize: mockFinalize,
      target: { buffer: mockMuxerBuffer },
    };
  }),
  ArrayBufferTarget: vi.fn(function () { return {}; }),
}));

// --- Mock WebCodecs globals ---
const mockVideoEncoderEncode = vi.fn();
const mockVideoEncoderFlush = vi.fn().mockResolvedValue(undefined);
const mockVideoEncoderClose = vi.fn();
const mockVideoEncoderConfigure = vi.fn();

function MockVideoEncoder() {
  return {
    encode: mockVideoEncoderEncode,
    flush: mockVideoEncoderFlush,
    close: mockVideoEncoderClose,
    configure: mockVideoEncoderConfigure,
    encodeQueueSize: 0,
    ondequeue: null,
  };
}
vi.stubGlobal("VideoEncoder", MockVideoEncoder);

const mockFrameClose = vi.fn();
const mockVideoFrameConstructor = vi.fn();
function MockVideoFrame(...args: unknown[]) {
  mockVideoFrameConstructor(...args);
  return { close: mockFrameClose };
}
vi.stubGlobal("VideoFrame", MockVideoFrame);

const mockAudioEncoderEncode = vi.fn();
const mockAudioEncoderFlush = vi.fn().mockResolvedValue(undefined);
const mockAudioEncoderClose = vi.fn();
const mockAudioEncoderConfigure = vi.fn();

function MockAudioEncoder() {
  return {
    encode: mockAudioEncoderEncode,
    flush: mockAudioEncoderFlush,
    close: mockAudioEncoderClose,
    configure: mockAudioEncoderConfigure,
  };
}
vi.stubGlobal("AudioEncoder", MockAudioEncoder);

const mockAudioDataClose = vi.fn();
function MockAudioData() { return { close: mockAudioDataClose }; }
vi.stubGlobal("AudioData", MockAudioData);

// Mock AudioContext for encodeAudio
const mockAudioDecodeData = vi.fn();
const mockAudioCtxClose = vi.fn().mockResolvedValue(undefined);

function MockAudioContext() {
  return { decodeAudioData: mockAudioDecodeData, close: mockAudioCtxClose };
}
vi.stubGlobal("AudioContext", MockAudioContext);

// Mock URL.createObjectURL / revokeObjectURL
const mockRevokeObjectURL = vi.fn();
vi.stubGlobal("URL", {
  ...globalThis.URL,
  createObjectURL: vi.fn().mockReturnValue("blob:mock-url"),
  revokeObjectURL: mockRevokeObjectURL,
});

import { webmToMp4 } from "@/lib/tools/webm-to-mp4";

describe("webmToMp4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveDuration.mockImplementation((video: { duration: number }) =>
      Promise.resolve(video.duration),
    );
    mockDecodeAudio.mockResolvedValue(null);
    mockPickH264Config.mockImplementation((base: Record<string, unknown>) =>
      Promise.resolve({ codec: "avc1.640034", ...base }),
    );
    mockPlayAndExtractFrames.mockImplementation(
      async (video: unknown, startTime: number, _endTime: unknown, onFrame: (vid: unknown, ts: number) => Promise<void>, { onProgress }: { onProgress?: (pct: number) => void } = {}) => {
        for (let i = 0; i < 3; i++) {
          const timestampUs = (startTime + i * (1 / 30)) * 1_000_000;
          await onFrame(video, timestampUs);
        }
        if (onProgress) onProgress(100);
      }
    );
    mockCreateVideo.mockReturnValue({
      videoWidth: 1280,
      videoHeight: 720,
      duration: 10,
    });
  });

  it("returns a result with .mp4 extension", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    const result = await webmToMp4(file);

    expect(result.fileName).toBe("recording.mp4");
  });

  it("produces an MP4 blob", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    const result = await webmToMp4(file);

    expect(result.blob.type).toBe("video/mp4");
  });

  it("returns correct ProcessedResult shape", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    const result = await webmToMp4(file);

    expect(result).toHaveProperty("blob");
    expect(result).toHaveProperty("fileName");
    expect(result).toHaveProperty("originalSize");
    expect(result).toHaveProperty("newSize");
    expect(result.originalSize).toBe(file.size);
  });

  it("creates a video element from object URL", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await webmToMp4(file);

    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(mockCreateVideo).toHaveBeenCalledWith("blob:mock-url");
  });

  it("waits for video to be ready", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await webmToMp4(file);

    expect(mockWaitForReady).toHaveBeenCalled();
  });

  it("decodes audio from the file once", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await webmToMp4(file);

    expect(mockDecodeAudio).toHaveBeenCalledWith(file);
  });

  it("calls playAndExtractFrames with full duration", async () => {
    mockCreateVideo.mockReturnValue({
      videoWidth: 640,
      videoHeight: 480,
      duration: 30,
    });
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await webmToMp4(file);

    expect(mockPlayAndExtractFrames).toHaveBeenCalledWith(
      expect.anything(),
      0,
      30,
      expect.any(Function),
      { signal: undefined, onProgress: expect.any(Function) },
    );
  });

  it("calls progress callback with 100 at the end", async () => {
    const onProgress = vi.fn();
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await webmToMp4(file, { onProgress });

    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it("flushes and closes the video encoder", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await webmToMp4(file);

    expect(mockVideoEncoderFlush).toHaveBeenCalled();
    expect(mockVideoEncoderClose).toHaveBeenCalled();
  });

  it("finalizes the muxer", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await webmToMp4(file);

    expect(mockFinalize).toHaveBeenCalled();
  });

  it("revokes object URL in finally block", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await webmToMp4(file);

    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("revokes object URL even when an error occurs", async () => {
    mockWaitForReady.mockRejectedValueOnce(new Error("Load failed"));
    const file = new File(["video"], "recording.webm", { type: "video/webm" });

    await expect(webmToMp4(file)).rejects.toThrow("Load failed");
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("caps dimensions to 1920 on the long side", async () => {
    mockCreateVideo.mockReturnValue({
      videoWidth: 3840,
      videoHeight: 2160,
      duration: 5,
    });
    const file = new File(["video"], "4k.webm", { type: "video/webm" });
    await webmToMp4(file);

    const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
    expect(configCall.width).toBeLessThanOrEqual(1920 + 1); // +1 for even rounding
    expect(configCall.height).toBeLessThanOrEqual(1920 + 1);
  });

  it("ensures even dimensions for H.264", async () => {
    mockCreateVideo.mockReturnValue({
      videoWidth: 641,
      videoHeight: 481,
      duration: 5,
    });
    const file = new File(["video"], "odd.webm", { type: "video/webm" });
    await webmToMp4(file);

    const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
    expect(configCall.width % 2).toBe(0);
    expect(configCall.height % 2).toBe(0);
  });

  it("strips extension correctly for multi-dot filenames", async () => {
    const file = new File(["video"], "my.video.file.webm", { type: "video/webm" });
    const result = await webmToMp4(file);

    expect(result.fileName).toBe("my.video.file.mp4");
  });

  describe("frame encoding loop", () => {
    it("calls VideoEncoder.encode for each frame", async () => {
      const file = new File(["video"], "recording.webm", { type: "video/webm" });
      await webmToMp4(file);

      expect(mockVideoEncoderEncode).toHaveBeenCalledTimes(3);
    });

    it("creates a VideoFrame for each frame and closes it after encoding", async () => {
      const file = new File(["video"], "recording.webm", { type: "video/webm" });
      await webmToMp4(file);

      expect(mockVideoFrameConstructor).toHaveBeenCalledTimes(3);
      expect(mockFrameClose).toHaveBeenCalledTimes(3);
    });

    it("marks the first frame as a keyframe", async () => {
      const file = new File(["video"], "recording.webm", { type: "video/webm" });
      await webmToMp4(file);

      expect(mockVideoEncoderEncode).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        { keyFrame: true },
      );
      expect(mockVideoEncoderEncode).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        { keyFrame: false },
      );
      expect(mockVideoEncoderEncode).toHaveBeenNthCalledWith(
        3,
        expect.anything(),
        { keyFrame: false },
      );
    });
  });

  it("configures video encoder with H.264 codec", async () => {
    const file = new File(["video"], "recording.webm", { type: "video/webm" });
    await webmToMp4(file);

    expect(mockVideoEncoderConfigure).toHaveBeenCalledWith(
      expect.objectContaining({
        codec: "avc1.640034",
        bitrate: 5_000_000,
        framerate: 30,
      }),
    );
  });
});
