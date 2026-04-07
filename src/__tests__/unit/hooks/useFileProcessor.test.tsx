import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock analytics before importing the hook
vi.mock("@/lib/utils/analytics", () => ({
  trackEvent: vi.fn(),
}));

import { useFileProcessor, type ProcessedResult } from "@/hooks/useFileProcessor";
import { trackEvent } from "@/lib/utils/analytics";

const mockTrackEvent = vi.mocked(trackEvent);

function createMockFile(name: string, size: number): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type: "application/octet-stream" });
}

function createMockResult(overrides?: Partial<ProcessedResult>): ProcessedResult {
  return {
    blob: new Blob(["output"], { type: "application/octet-stream" }),
    fileName: "output.png",
    originalSize: 1024,
    newSize: 512,
    ...overrides,
  };
}

describe("useFileProcessor", () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
  });

  it("starts with idle status and null result/error", () => {
    const processFn = vi.fn();
    const { result } = renderHook(() => useFileProcessor(processFn));

    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("transitions to processing then done on successful process", async () => {
    const mockResult = createMockResult();
    const processFn = vi.fn().mockResolvedValue(mockResult);
    const { result } = renderHook(() => useFileProcessor(processFn));

    const file = createMockFile("input.png", 1024);

    await act(async () => {
      await result.current.process(file, {});
    });

    expect(result.current.status).toBe("done");
    expect(result.current.result).toEqual(mockResult);
    expect(result.current.error).toBeNull();
  });

  it("transitions to error state when process function throws", async () => {
    const processFn = vi.fn().mockRejectedValue(new Error("Conversion failed"));
    const { result } = renderHook(() => useFileProcessor(processFn));

    const file = createMockFile("input.png", 1024);

    await act(async () => {
      await result.current.process(file, {});
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Conversion failed");
    expect(result.current.result).toBeNull();
  });

  it("sets generic error message when thrown value is not an Error", async () => {
    const processFn = vi.fn().mockRejectedValue("string error");
    const { result } = renderHook(() => useFileProcessor(processFn));

    const file = createMockFile("input.png", 1024);

    await act(async () => {
      await result.current.process(file, {});
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Processing failed");
  });

  it("reset() returns to idle state with null result and error", async () => {
    const mockResult = createMockResult();
    const processFn = vi.fn().mockResolvedValue(mockResult);
    const { result } = renderHook(() => useFileProcessor(processFn));

    const file = createMockFile("input.png", 1024);

    await act(async () => {
      await result.current.process(file, {});
    });
    expect(result.current.status).toBe("done");

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("reset() clears error state", async () => {
    const processFn = vi.fn().mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useFileProcessor(processFn));

    await act(async () => {
      await result.current.process(createMockFile("x.png", 100), {});
    });
    expect(result.current.status).toBe("error");

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("tracks analytics event on successful processing", async () => {
    const mockResult = createMockResult({ newSize: 2048, fileName: "out.jpg" });
    const processFn = vi.fn().mockResolvedValue(mockResult);
    const { result } = renderHook(() => useFileProcessor(processFn));

    const file = createMockFile("photo.jpg", 4096);

    await act(async () => {
      await result.current.process(file, {});
    });

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith({
      action: "file_processed",
      category: "conversion",
      label: "jpg",
      value: Math.round(2048 / 1024),
    });
  });

  it("passes correct file extension to trackEvent", async () => {
    const mockResult = createMockResult({ newSize: 500 });
    const processFn = vi.fn().mockResolvedValue(mockResult);
    const { result } = renderHook(() => useFileProcessor(processFn));

    const file = createMockFile("document.pdf", 1000);

    await act(async () => {
      await result.current.process(file, {});
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "pdf",
      }),
    );
  });

  it("does not track analytics on processing error", async () => {
    const processFn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useFileProcessor(processFn));

    await act(async () => {
      await result.current.process(createMockFile("x.png", 100), {});
    });

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it("clears previous result when processing a new file", async () => {
    const mockResult1 = createMockResult({ fileName: "out1.png" });
    const mockResult2 = createMockResult({ fileName: "out2.png" });
    const processFn = vi
      .fn()
      .mockResolvedValueOnce(mockResult1)
      .mockResolvedValueOnce(mockResult2);
    const { result } = renderHook(() => useFileProcessor(processFn));

    await act(async () => {
      await result.current.process(createMockFile("a.png", 100), {});
    });
    expect(result.current.result?.fileName).toBe("out1.png");

    await act(async () => {
      await result.current.process(createMockFile("b.png", 200), {});
    });
    expect(result.current.result?.fileName).toBe("out2.png");
  });

  it("passes options to the process function", async () => {
    const processFn = vi.fn().mockResolvedValue(createMockResult());
    const { result } = renderHook(() =>
      useFileProcessor<{ quality: number }>(processFn),
    );

    const file = createMockFile("input.png", 1024);
    const options = { quality: 80 };

    await act(async () => {
      await result.current.process(file, options);
    });

    expect(processFn).toHaveBeenCalledWith(file, options);
  });
});
