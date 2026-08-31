import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/utils/clipboard", () => ({
  copyText: vi.fn(),
}));

import { useCopied, COPY_FEEDBACK_MS } from "@/hooks/useCopied";
import { copyText } from "@/lib/utils/clipboard";

const mockCopyText = vi.mocked(copyText);

describe("useCopied", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCopyText.mockReset();
    mockCopyText.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with nothing copied", () => {
    const { result } = renderHook(() => useCopied());
    expect(result.current.copied).toBeNull();
  });

  it("confirms a copy and clears itself after the shared delay", async () => {
    const { result } = renderHook(() => useCopied());

    await act(async () => {
      await result.current.copy("hello");
    });
    expect(mockCopyText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS - 1);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBeNull();
  });

  it("never confirms a copy the clipboard refused", async () => {
    mockCopyText.mockResolvedValue(false);
    const { result } = renderHook(() => useCopied());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.copy("hello");
    });

    expect(ok).toBe(false);
    expect(result.current.copied).toBeNull();
  });

  it("tracks which row was copied when a key is passed", async () => {
    const { result } = renderHook(() => useCopied<number>());

    await act(async () => {
      await result.current.copy("#ff0000", 2);
    });
    expect(result.current.copied).toBe(2);

    await act(async () => {
      await result.current.copy("#00ff00", 5);
    });
    expect(result.current.copied).toBe(5);
  });

  // The hand-rolled versions stacked one bare setTimeout per click, so the
  // first one fired mid-confirmation and blanked the label early.
  it("restarts the timer on a re-copy instead of stacking timers", async () => {
    const { result } = renderHook(() => useCopied());

    await act(async () => {
      await result.current.copy("one");
    });
    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS - 100);
    });
    await act(async () => {
      await result.current.copy("two");
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });
    expect(result.current.copied).toBeNull();
  });

  it("drops the confirmation when clear() is called", async () => {
    const { result } = renderHook(() => useCopied());

    await act(async () => {
      await result.current.copy("hello");
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.copied).toBeNull();
  });

  // /workspace remounts tools by key; a pending timer used to fire against a
  // component that was already gone.
  it("clears its pending timer on unmount", async () => {
    const { result, unmount } = renderHook(() => useCopied());

    await act(async () => {
      await result.current.copy("hello");
    });
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
