import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/utils/analytics", () => ({
  trackEvent: vi.fn(),
}));

import { useBatchProcessor } from "@/hooks/useBatchProcessor";
import type {
  FileProcessorContext,
  ProcessedResult,
} from "@/hooks/useFileProcessor";
import { trackEvent } from "@/lib/utils/analytics";

const mockTrackEvent = vi.mocked(trackEvent);

function file(name: string, size = 16): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

function res(overrides?: Partial<ProcessedResult>): ProcessedResult {
  return {
    blob: new Blob(["out"]),
    fileName: "out.jpg",
    originalSize: 100,
    newSize: 50,
    ...overrides,
  };
}

describe("useBatchProcessor", () => {
  beforeEach(() => mockTrackEvent.mockClear());

  it("starts empty and idle", () => {
    const { result } = renderHook(() => useBatchProcessor(vi.fn()));
    expect(result.current.items).toEqual([]);
    expect(result.current.isProcessing).toBe(false);
  });

  it("fires every file concurrently (no per-file await loop)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const processFn = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return res();
    });
    const { result } = renderHook(() => useBatchProcessor(processFn));

    await act(async () => {
      await result.current.run([file("a.png"), file("b.png"), file("c.png")], {});
    });

    // All three were submitted at once — scheduling is the pool's job, not
    // the hook's. A sequential for-loop would cap this at 1.
    expect(maxInFlight).toBe(3);
    expect(result.current.items.every((i) => i.status === "done")).toBe(true);
    expect(result.current.isProcessing).toBe(false);
    expect(mockTrackEvent).toHaveBeenCalledTimes(3);
  });

  it("rows stay queued until their worker reports progress", async () => {
    const contexts: FileProcessorContext[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const processFn = vi.fn(async (_f: File, _o: unknown, ctx: FileProcessorContext) => {
      contexts.push(ctx);
      await gate;
      return res();
    });
    const { result } = renderHook(() => useBatchProcessor(processFn));

    let done!: Promise<unknown>;
    act(() => {
      done = result.current.run([file("a.png"), file("b.png")], {});
    });

    expect(result.current.items.map((i) => i.status)).toEqual(["queued", "queued"]);

    // Only the first file's worker starts.
    act(() => contexts[0].onProgress(10));
    expect(result.current.items[0].status).toBe("running");
    expect(result.current.items[0].progress).toBe(10);
    expect(result.current.items[1].status).toBe("queued");

    release();
    await act(async () => done);
    expect(result.current.items.map((i) => i.status)).toEqual(["done", "done"]);
  });

  it("one failing file marks its row failed and the rest complete", async () => {
    const processFn = vi.fn(async (f: File) => {
      if (f.name === "bad.png") throw new Error("decode failed");
      return res();
    });
    const { result } = renderHook(() => useBatchProcessor(processFn));

    await act(async () => {
      await result.current.run([file("a.png"), file("bad.png"), file("c.png")], {});
    });

    expect(result.current.items.map((i) => i.status)).toEqual([
      "done",
      "failed",
      "done",
    ]);
    expect(result.current.items[1].error).toBe("decode failed");
    expect(mockTrackEvent).toHaveBeenCalledTimes(2);
  });

  it("reset aborts the shared signal and clears the table", async () => {
    let seenSignal: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const processFn = vi.fn(async (_f: File, _o: unknown, ctx: FileProcessorContext) => {
      seenSignal = ctx.signal;
      await gate;
      return res();
    });
    const { result } = renderHook(() => useBatchProcessor(processFn));

    let done!: Promise<unknown>;
    act(() => {
      done = result.current.run([file("a.png")], {});
    });
    act(() => result.current.reset());

    expect(seenSignal?.aborted).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.isProcessing).toBe(false);

    // The stale run resolving later must not resurrect state.
    release();
    await act(async () => done);
    expect(result.current.items).toEqual([]);
  });

  it("a new run supersedes the old one — stale writes are dropped", async () => {
    const gates: (() => void)[] = [];
    const processFn = vi.fn(async () => {
      await new Promise<void>((r) => gates.push(r));
      return res();
    });
    const { result } = renderHook(() => useBatchProcessor(processFn));

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.run([file("old.png")], {});
    });
    let second!: Promise<unknown>;
    act(() => {
      second = result.current.run([file("new1.png"), file("new2.png")], {});
    });

    expect(result.current.items).toHaveLength(2);

    // Old run finishes late — its writes must not land on the new table.
    act(() => gates[0]());
    await act(async () => first);
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.every((i) => i.status === "queued")).toBe(true);

    act(() => gates.forEach((g) => g()));
    await act(async () => second);
    expect(result.current.items.every((i) => i.status === "done")).toBe(true);
  });

  /*
    A 200-file queue was the longest job on the site and had no stop button —
    the hook exposed only `reset`, which throws the finished blobs away too.
  */
  describe("cancel", () => {
    it("stops the run, keeps finished rows, and returns un-run rows to queued", async () => {
      let release: (() => void) | null = null;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const processFn = vi.fn(
        async (f: File, _o: unknown, ctx: FileProcessorContext) => {
          ctx.onProgress(10);
          if (f.name === "fast.png") return res({ fileName: "fast.jpg" });
          await gate;
          return res({ fileName: "slow.jpg" });
        },
      );

      const { result } = renderHook(() => useBatchProcessor(processFn));

      let pending: Promise<unknown> | undefined;
      await act(async () => {
        pending = result.current.run([file("fast.png"), file("slow.png")], {});
        // Let the fast file settle while the slow one is still gated.
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.items[0].status).toBe("done");
      expect(result.current.isProcessing).toBe(true);

      act(() => {
        result.current.cancel();
      });

      expect(result.current.isProcessing).toBe(false);
      // The file that finished keeps its blob — cancelling should not throw
      // away work the user already paid for.
      expect(result.current.items[0].status).toBe("done");
      expect(result.current.items[0].result).not.toBeNull();
      // Nothing is left spinning against an aborted pool.
      expect(result.current.items.some((i) => i.status === "running")).toBe(false);
      expect(result.current.items[1]).toEqual({
        status: "queued",
        progress: 0,
        result: null,
        error: null,
      });

      release!();
      await act(async () => {
        await pending;
      });
      // The cancelled run must not write state after the fact.
      expect(result.current.items[1].status).toBe("queued");
      expect(result.current.isProcessing).toBe(false);
    });

    it("aborts the signal handed to the processor", async () => {
      let seen: AbortSignal | null = null;
      const processFn = vi.fn(
        async (_f: File, _o: unknown, ctx: FileProcessorContext) => {
          seen = ctx.signal;
          await new Promise((r) => setTimeout(r, 20));
          return res();
        },
      );
      const { result } = renderHook(() => useBatchProcessor(processFn));

      let pending: Promise<unknown> | undefined;
      await act(async () => {
        pending = result.current.run([file("a.png")], {});
        await Promise.resolve();
      });

      act(() => {
        result.current.cancel();
      });
      expect(seen!.aborted).toBe(true);

      await act(async () => {
        await pending;
      });
    });

    it("is a no-op when nothing is running", () => {
      const { result } = renderHook(() => useBatchProcessor(vi.fn()));
      act(() => {
        result.current.cancel();
      });
      expect(result.current.items).toEqual([]);
      expect(result.current.isProcessing).toBe(false);
    });
  });
});
