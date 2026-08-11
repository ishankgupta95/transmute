import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock analytics before importing the hook
vi.mock("@/lib/utils/analytics", () => ({
  trackEvent: vi.fn(),
}));

import {
  useFileProcessor,
  type FileProcessorContext,
  type ProcessedResult,
} from "@/hooks/useFileProcessor";
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

  it("passes options and a processing context to the process function", async () => {
    const processFn = vi.fn().mockResolvedValue(createMockResult());
    const { result } = renderHook(() =>
      useFileProcessor<{ quality: number }>(processFn),
    );

    const file = createMockFile("input.png", 1024);
    const options = { quality: 80 };

    await act(async () => {
      await result.current.process(file, options);
    });

    expect(processFn).toHaveBeenCalledWith(file, options, {
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    });
  });

  describe("progress", () => {
    it("starts at 0 and reflects what the processor reports", async () => {
      let report: ((n: number) => void) | undefined;
      const processFn = vi.fn(
        (_f: File, _o: void, ctx: FileProcessorContext) =>
          new Promise<ProcessedResult>((resolve) => {
            report = (n) => {
              ctx.onProgress(n);
              if (n >= 100) resolve(createMockResult());
            };
          }),
      );
      const { result } = renderHook(() => useFileProcessor<void>(processFn));

      expect(result.current.progress).toBe(0);

      act(() => {
        void result.current.process(createMockFile("a.mp4", 100));
      });
      act(() => report!(42));
      expect(result.current.progress).toBe(42);

      await act(async () => {
        report!(100);
      });
      expect(result.current.progress).toBe(100);
    });

    it("clamps and rounds out-of-range reports", async () => {
      let report: ((n: number) => void) | undefined;
      const processFn = vi.fn(
        (_f: File, _o: void, ctx: FileProcessorContext) =>
          new Promise<ProcessedResult>(() => {
            report = ctx.onProgress;
          }),
      );
      const { result } = renderHook(() => useFileProcessor<void>(processFn));

      act(() => {
        void result.current.process(createMockFile("a.mp4", 100));
      });

      act(() => report!(-10));
      expect(result.current.progress).toBe(0);
      act(() => report!(140));
      expect(result.current.progress).toBe(100);
      act(() => report!(33.6));
      expect(result.current.progress).toBe(34);
    });
  });

  describe("cancel", () => {
    it("aborts the signal handed to the processor", async () => {
      let seen: AbortSignal | undefined;
      const processFn = vi.fn(
        (_f: File, _o: void, ctx: FileProcessorContext) =>
          new Promise<ProcessedResult>(() => {
            seen = ctx.signal;
          }),
      );
      const { result } = renderHook(() => useFileProcessor<void>(processFn));

      act(() => {
        void result.current.process(createMockFile("big.mp4", 100));
      });
      expect(seen!.aborted).toBe(false);

      act(() => result.current.cancel());
      expect(seen!.aborted).toBe(true);
    });

    it("returns to idle without an error — a cancel is not a failure", async () => {
      const processFn = vi.fn(
        (_f: File, _o: void, ctx: FileProcessorContext) =>
          new Promise<ProcessedResult>((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted.", "AbortError")),
            );
          }),
      );
      const { result } = renderHook(() => useFileProcessor<void>(processFn));

      act(() => {
        void result.current.process(createMockFile("big.mp4", 100));
      });
      expect(result.current.status).toBe("processing");

      await act(async () => {
        result.current.cancel();
      });

      expect(result.current.status).toBe("idle");
      expect(result.current.error).toBeNull();
      expect(result.current.progress).toBe(0);
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });

    it("drops a late result from a cancelled run", async () => {
      let finish: ((r: ProcessedResult) => void) | undefined;
      const processFn = vi.fn(
        () =>
          new Promise<ProcessedResult>((resolve) => {
            finish = resolve;
          }),
      );
      const { result } = renderHook(() => useFileProcessor<void>(processFn));

      act(() => {
        void result.current.process(createMockFile("big.mp4", 100));
      });
      act(() => result.current.cancel());

      // A processor that ignores its signal still resolves eventually; that
      // result must not resurrect a run the user already stopped.
      await act(async () => {
        finish!(createMockResult());
      });

      expect(result.current.status).toBe("idle");
      expect(result.current.result).toBeNull();
    });

    it("is a no-op when nothing is running", () => {
      const processFn = vi.fn();
      const { result } = renderHook(() => useFileProcessor<void>(processFn));

      act(() => result.current.cancel());

      expect(result.current.status).toBe("idle");
    });
  });

  it("ignores the result of a run superseded by a newer one", async () => {
    const resolvers: ((r: ProcessedResult) => void)[] = [];
    const processFn = vi.fn(
      () => new Promise<ProcessedResult>((resolve) => resolvers.push(resolve)),
    );
    const { result } = renderHook(() => useFileProcessor<void>(processFn));

    act(() => {
      void result.current.process(createMockFile("first.mp4", 100));
    });
    act(() => {
      void result.current.process(createMockFile("second.mp4", 100));
    });

    // The first run finishes last — the classic stale-write race.
    await act(async () => {
      resolvers[1](createMockResult({ fileName: "second.out" }));
      resolvers[0](createMockResult({ fileName: "first.out" }));
    });

    expect(result.current.result?.fileName).toBe("second.out");
  });

  it("aborts the in-flight run on unmount", () => {
    let seen: AbortSignal | undefined;
    const processFn = vi.fn(
      (_f: File, _o: void, ctx: FileProcessorContext) =>
        new Promise<ProcessedResult>(() => {
          seen = ctx.signal;
        }),
    );
    const { result, unmount } = renderHook(() => useFileProcessor<void>(processFn));

    act(() => {
      void result.current.process(createMockFile("big.mp4", 100));
    });
    expect(seen!.aborted).toBe(false);

    unmount();

    expect(seen!.aborted).toBe(true);
  });
});
