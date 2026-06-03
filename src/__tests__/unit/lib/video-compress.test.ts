import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks for vi.mock factories ---
const {
  mockPlayAndExtractFrames,
  mockCreateVideo,
  mockWaitForReady,
  mockDecodeAudio,
  mockAssertWebCodecsSupported,
  mockPickH264Config,
} = vi.hoisted(() => ({
  mockPlayAndExtractFrames: vi.fn().mockResolvedValue(undefined),
  mockCreateVideo: vi.fn(),
  mockWaitForReady: vi.fn().mockResolvedValue(undefined),
  mockDecodeAudio: vi.fn().mockResolvedValue(null),
  mockAssertWebCodecsSupported: vi.fn(),
  mockPickH264Config: vi.fn((base: Record<string, unknown>) =>
    Promise.resolve({ codec: "avc1.640034", hardwareAcceleration: "prefer-hardware", ...base }),
  ),
}));

// Minimal AudioBuffer-like for the audio-encoding path
const fakeAudioBuffer = {
  length: 2048,
  numberOfChannels: 2,
  sampleRate: 48000,
  getChannelData: () => new Float32Array(2048),
} as unknown as AudioBuffer;

const {
  mockAddVideoChunk,
  mockAddAudioChunk,
  mockFinalize,
  mockMuxerBuffer,
} = vi.hoisted(() => {
  const buf = new ArrayBuffer(50);
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

// Mock URL
const mockRevokeObjectURL = vi.fn();
vi.stubGlobal("URL", {
  ...globalThis.URL,
  createObjectURL: vi.fn().mockReturnValue("blob:mock-url"),
  revokeObjectURL: mockRevokeObjectURL,
});

import { compressVideo } from "@/lib/tools/video-compress";
import type { CompressionPreset } from "@/lib/tools/video-compress";

describe("compressVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecodeAudio.mockResolvedValue(null);
    mockPickH264Config.mockImplementation((base: Record<string, unknown>) =>
      Promise.resolve({ codec: "avc1.640034", hardwareAcceleration: "prefer-hardware", ...base }),
    );
    mockPlayAndExtractFrames.mockImplementation(
      async (video: unknown, startTime: number, _endTime: unknown, onFrame: (vid: unknown, ts: number) => Promise<void>, onProgress?: (pct: number) => void) => {
        for (let i = 0; i < 3; i++) {
          const timestampUs = (startTime + i * (1 / 30)) * 1_000_000;
          await onFrame(video, timestampUs);
        }
        if (onProgress) onProgress(100);
      }
    );
    mockCreateVideo.mockReturnValue({
      videoWidth: 1920,
      videoHeight: 1080,
      duration: 60,
    });
  });

  describe("all presets produce output", () => {
    const presets: CompressionPreset[] = ["whatsapp", "email", "web"];

    for (const preset of presets) {
      it(`produces output for preset: ${preset}`, async () => {
        const file = new File(["video"], "input.mp4", { type: "video/mp4" });
        const result = await compressVideo(file, preset);

        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.blob.type).toBe("video/mp4");
        expect(result.fileName).toBe("input-compressed.mp4");
        expect(result.originalSize).toBe(file.size);
      });
    }
  });

  it("output filename has -compressed suffix", async () => {
    const file = new File(["video"], "my-video.mp4", { type: "video/mp4" });
    const result = await compressVideo(file, "web");

    expect(result.fileName).toBe("my-video-compressed.mp4");
  });

  it("strips extension correctly for multi-dot filenames", async () => {
    const file = new File(["video"], "my.cool.video.mov", { type: "video/quicktime" });
    const result = await compressVideo(file, "web");

    expect(result.fileName).toBe("my.cool.video-compressed.mp4");
  });

  describe("scaling logic", () => {
    it("scales down when videoHeight exceeds whatsapp maxHeight (720)", async () => {
      mockCreateVideo.mockReturnValue({
        videoWidth: 1920,
        videoHeight: 1080,
        duration: 10,
      });
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "whatsapp");

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      expect(configCall.height).toBeLessThanOrEqual(720 + 1); // +1 for even rounding
    });

    it("scales down when videoHeight exceeds email maxHeight (480)", async () => {
      mockCreateVideo.mockReturnValue({
        videoWidth: 1920,
        videoHeight: 1080,
        duration: 10,
      });
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "email");

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      expect(configCall.height).toBeLessThanOrEqual(480 + 1);
    });

    it("does not scale if videoHeight is within maxHeight for web (1080)", async () => {
      mockCreateVideo.mockReturnValue({
        videoWidth: 1920,
        videoHeight: 1080,
        duration: 10,
      });
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "web");

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      expect(configCall.height).toBe(1080);
    });

    it("does not scale small videos for whatsapp", async () => {
      mockCreateVideo.mockReturnValue({
        videoWidth: 640,
        videoHeight: 480,
        duration: 10,
      });
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "whatsapp");

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      expect(configCall.width).toBe(640);
      expect(configCall.height).toBe(480);
    });

    it("maintains aspect ratio when scaling", async () => {
      mockCreateVideo.mockReturnValue({
        videoWidth: 1920,
        videoHeight: 1080,
        duration: 10,
      });
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "whatsapp"); // maxHeight: 720

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      // 1920 * (720/1080) = 1280, both even
      expect(configCall.width).toBe(1280);
      expect(configCall.height).toBe(720);
    });
  });

  describe("even dimensions", () => {
    it("ensures even width and height after scaling", async () => {
      mockCreateVideo.mockReturnValue({
        videoWidth: 1917,
        videoHeight: 1079,
        duration: 10,
      });
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "web");

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      expect(configCall.width % 2).toBe(0);
      expect(configCall.height % 2).toBe(0);
    });

    it("ensures even dimensions for already-small odd-dimension videos", async () => {
      mockCreateVideo.mockReturnValue({
        videoWidth: 641,
        videoHeight: 481,
        duration: 10,
      });
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "web");

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      expect(configCall.width % 2).toBe(0);
      expect(configCall.height % 2).toBe(0);
    });
  });

  describe("preset bitrates", () => {
    it("uses 1Mbps bitrate for whatsapp", async () => {
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "whatsapp");

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      expect(configCall.bitrate).toBe(1_000_000);
    });

    it("uses 500kbps bitrate for email", async () => {
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "email");

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      expect(configCall.bitrate).toBe(500_000);
    });

    it("uses 2Mbps bitrate for web", async () => {
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "web");

      const configCall = mockVideoEncoderConfigure.mock.calls[0][0];
      expect(configCall.bitrate).toBe(2_000_000);
    });
  });

  it("revokes object URL in finally block", async () => {
    const file = new File(["video"], "input.mp4", { type: "video/mp4" });
    await compressVideo(file, "web");

    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("revokes object URL even when an error occurs", async () => {
    mockWaitForReady.mockRejectedValueOnce(new Error("Load failed"));
    const file = new File(["video"], "input.mp4", { type: "video/mp4" });

    await expect(compressVideo(file, "web")).rejects.toThrow("Load failed");
    expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("calls progress callback with 100 at the end", async () => {
    const onProgress = vi.fn();
    const file = new File(["video"], "input.mp4", { type: "video/mp4" });
    await compressVideo(file, "web", onProgress);

    expect(onProgress).toHaveBeenCalledWith(100);
  });

  it("flushes and closes the video encoder", async () => {
    const file = new File(["video"], "input.mp4", { type: "video/mp4" });
    await compressVideo(file, "web");

    expect(mockVideoEncoderFlush).toHaveBeenCalled();
    expect(mockVideoEncoderClose).toHaveBeenCalled();
  });

  it("finalizes the muxer", async () => {
    const file = new File(["video"], "input.mp4", { type: "video/mp4" });
    await compressVideo(file, "web");

    expect(mockFinalize).toHaveBeenCalled();
  });

  it("configures H.264 codec", async () => {
    const file = new File(["video"], "input.mp4", { type: "video/mp4" });
    await compressVideo(file, "web");

    expect(mockVideoEncoderConfigure).toHaveBeenCalledWith(
      expect.objectContaining({
        codec: "avc1.640034",
        framerate: 30,
        hardwareAcceleration: "prefer-hardware",
      }),
    );
  });

  it("calls playAndExtractFrames with full duration", async () => {
    mockCreateVideo.mockReturnValue({
      videoWidth: 1280,
      videoHeight: 720,
      duration: 45,
    });
    const file = new File(["video"], "input.mp4", { type: "video/mp4" });
    await compressVideo(file, "web");

    expect(mockPlayAndExtractFrames).toHaveBeenCalledWith(
      expect.anything(),
      0,
      45,
      expect.any(Function),
      expect.any(Function),
    );
  });

  describe("frame encoding loop", () => {
    it("calls VideoEncoder.encode for each frame", async () => {
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "web");

      expect(mockVideoEncoderEncode).toHaveBeenCalledTimes(3);
    });

    it("creates a VideoFrame for each frame and closes it after encoding", async () => {
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "web");

      expect(mockVideoFrameConstructor).toHaveBeenCalledTimes(3);
      expect(mockFrameClose).toHaveBeenCalledTimes(3);
    });

    it("marks the first frame as a keyframe", async () => {
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "web");

      // First frame (frameCount 0, 0 % 60 === 0) should be a keyframe
      expect(mockVideoEncoderEncode).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        { keyFrame: true },
      );
      // Subsequent frames should not be keyframes
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

  describe("with audio", () => {
    beforeEach(() => {
      mockDecodeAudio.mockResolvedValue(fakeAudioBuffer);
    });

    it("reports progress at 85 and 95 during audio encoding", async () => {
      const onProgress = vi.fn();
      const file = new File(["video"], "input.mp4", { type: "video/mp4" });
      await compressVideo(file, "web", onProgress);

      expect(onProgress).toHaveBeenCalledWith(85);
      expect(onProgress).toHaveBeenCalledWith(95);
      expect(onProgress).toHaveBeenCalledWith(100);
    });
  });
});
