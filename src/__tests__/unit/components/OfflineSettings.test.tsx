import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  THE COPY GATE for /offline-access.

  This page asks a visitor to spend up to 32,344,478 bytes of their storage and
  their connection, so its honesty rules are stricter than a tool page's:

    - the SIZE IS IN THE BUTTON. Consent to an unnamed download is not consent,
      and this is the last surface before the fetch;
    - STORED / NOT STORED is DERIVED from `cachedBundleIds()` on every refresh
      and never inferred from "the add resolved". The load-bearing case below
      makes `addBundle` succeed while the Cache API keeps saying the bundle is
      absent, and requires the row to keep saying NOT STORED — because a real
      eviction between the write and the read produces exactly that, and the
      row that lies is the one that fails offline;
    - the FFmpeg audio fallback gets a THIRD value, not a green badge:
      audio-decode.ts:411 reaches the core only after the browser's own decoder
      rejects a file, so for twelve tools the answer is per file, per browser;
    - the shape (126 need nothing / 13 for a twentieth of the bytes / 32 for
      FFmpeg) is stated BEFORE the buttons, because it is the only thing that
      makes the choice an informed one.

  ENGINE_BUNDLES, the formatter and the counts are deliberately NOT mocked —
  they are pinned to the artifacts on disk by offline.test.ts, so asserting
  against the real values keeps this file pinned to them too. Only the four
  functions that touch the Cache API are replaced.
*/

const cachedBundleIds = vi.fn();
const addBundle = vi.fn();
const removeBundle = vi.fn();
const clearAllOffline = vi.fn();
const storageEstimate = vi.fn();
const supportsOffline = vi.fn();

vi.mock("@/lib/pwa/offline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pwa/offline")>();
  return {
    ...actual,
    cachedBundleIds: () => cachedBundleIds(),
    addBundle: (...args: unknown[]) => addBundle(...args),
    removeBundle: (...args: unknown[]) => removeBundle(...args),
    clearAllOffline: () => clearAllOffline(),
    storageEstimate: () => storageEstimate(),
    supportsOffline: () => supportsOffline(),
  };
});

import { OfflineSettings } from "@/components/pwa/OfflineSettings";
import { ENGINE_BUNDLES, formatEngineBytes, type EngineBundle } from "@/lib/pwa/offline";

const FFMPEG = ENGINE_BUNDLES.find((b) => b.id === "ffmpeg") as EngineBundle;
const OXIPNG = ENGINE_BUNDLES.find((b) => b.id === "oxipng") as EngineBundle;

/** The `<li>` for one engine, found by its label. */
function row(label: string): HTMLElement {
  const heading = screen.getByText(label);
  const li = heading.closest("li");
  if (!li) throw new Error(`no row for ${label}`);
  return li;
}

beforeEach(() => {
  cachedBundleIds.mockResolvedValue(new Set());
  addBundle.mockResolvedValue(undefined);
  removeBundle.mockResolvedValue(undefined);
  clearAllOffline.mockResolvedValue(undefined);
  storageEstimate.mockResolvedValue(null);
  supportsOffline.mockReturnValue(true);
  Object.defineProperty(navigator, "serviceWorker", {
    value: { controller: {} },
    configurable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("what the page says before anything is committed", () => {
  it("puts the exact size in the button that would spend it", async () => {
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());

    const button = within(row(FFMPEG.label)).getByRole("button");
    expect(button).toHaveTextContent(/KEEP OFFLINE/);
    expect(button).toHaveTextContent(formatEngineBytes(FFMPEG.bytes));
    // And the unrounded count is in the row, the way /privacy quotes byte
    // counts — 30.8 MB is a rounding; 32,344,478 is the fact.
    expect(row(FFMPEG.label)).toHaveTextContent("32,344,478");
  });

  it("names the URLs it would fetch, so the claim is checkable in the network panel", async () => {
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());
    for (const url of FFMPEG.urls) expect(row(FFMPEG.label)).toHaveTextContent(url);
  });

  it("leads with the shape of the choice, not with a list of switches", async () => {
    render(<OfflineSettings />);
    // Server-renderable: these are static facts and need no browser.
    expect(screen.getByText(/NEED NO ENGINE/)).toBeInTheDocument();
    expect(screen.getByText("133 tools")).toBeInTheDocument();
    expect(screen.getByText("14 tools")).toBeInTheDocument();
    expect(screen.getByText("32 tools")).toBeInTheDocument();
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());
  });

  it("gives the FFmpeg audio fallback a third value rather than a badge", async () => {
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());
    const caveat = screen.getByText(/FFmpeg is decided per file/i);
    expect(caveat).toBeInTheDocument();
    const note = caveat.closest("div") as HTMLElement;
    expect(note).toHaveTextContent(/12 audio tools/);
    expect(note).toHaveTextContent(/neither .works offline. nor/i);
    // The wrong version of this page would have said one of the two.
    expect(note.textContent ?? "").not.toMatch(/always works offline/i);
  });
});

describe("stored / not stored is derived, never assumed", () => {
  it("says CHECKING until the Cache API has actually answered", () => {
    let resolve: (value: Set<string>) => void = () => {};
    cachedBundleIds.mockReturnValue(new Promise<Set<string>>((r) => (resolve = r)));
    render(<OfflineSettings />);
    // Not "NOT STORED": nothing has been read, and a wrong claim for one frame
    // is still a wrong claim.
    expect(within(row(OXIPNG.label)).getByText("CHECKING")).toBeInTheDocument();
    resolve(new Set());
  });

  it("reports what the cache says, not what the last write did", async () => {
    /*
      THE LOAD-BEARING CASE. `addBundle` resolves — as far as the page's own
      call is concerned the write succeeded — and the Cache API is then asked
      again and still says nothing is there. That is what a real eviction
      between the write and the read looks like, and the row must follow the
      cache.
    */
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());

    fireEvent.click(within(row(OXIPNG.label)).getByRole("button"));
    await waitFor(() => expect(addBundle).toHaveBeenCalled());
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalledTimes(2));

    expect(within(row(OXIPNG.label)).getByText("NOT STORED")).toBeInTheDocument();
  });

  it("flips to STORED and offers removal once the cache agrees", async () => {
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());

    cachedBundleIds.mockResolvedValue(new Set(["oxipng"]));
    fireEvent.click(within(row(OXIPNG.label)).getByRole("button"));

    await waitFor(() =>
      expect(within(row(OXIPNG.label)).getByText("STORED")).toBeInTheDocument(),
    );
    expect(within(row(OXIPNG.label)).getByRole("button")).toHaveTextContent("REMOVE");
    // Only the row that was asked for — nothing else was touched.
    expect(within(row(FFMPEG.label)).getByText("NOT STORED")).toBeInTheDocument();
  });

  it("re-reads after a removal instead of assuming it worked", async () => {
    cachedBundleIds.mockResolvedValue(new Set(["oxipng"]));
    render(<OfflineSettings />);
    await waitFor(() =>
      expect(within(row(OXIPNG.label)).getByText("STORED")).toBeInTheDocument(),
    );

    cachedBundleIds.mockResolvedValue(new Set());
    fireEvent.click(within(row(OXIPNG.label)).getByRole("button"));
    await waitFor(() => expect(removeBundle).toHaveBeenCalledWith("oxipng"));
    await waitFor(() =>
      expect(within(row(OXIPNG.label)).getByText("NOT STORED")).toBeInTheDocument(),
    );
  });
});

describe("the download itself", () => {
  it("shows real progress, from the bytes the fetch reported", async () => {
    let report: ((fraction: number) => void) | undefined;
    addBundle.mockImplementation(
      (_id: string, onProgress: (f: number) => void) =>
        new Promise<void>(() => {
          report = onProgress;
        }),
    );
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());

    fireEvent.click(within(row(FFMPEG.label)).getByRole("button"));
    await waitFor(() => expect(report).toBeDefined());

    report?.(0.42);
    await waitFor(() =>
      expect(within(row(FFMPEG.label)).getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "42",
      ),
    );
    expect(within(row(FFMPEG.label)).getByRole("button")).toHaveTextContent("CANCEL");
  });

  it("aborts through the signal it handed to addBundle", async () => {
    let seen: AbortSignal | undefined;
    addBundle.mockImplementation(
      (_id: string, _onProgress: unknown, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          seen = signal;
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());

    fireEvent.click(within(row(FFMPEG.label)).getByRole("button"));
    await waitFor(() => expect(seen).toBeDefined());
    fireEvent.click(within(row(FFMPEG.label)).getByRole("button", { name: "CANCEL" }));

    await waitFor(() =>
      // "Nothing was kept" is a claim about addBundle's cleanup, which
      // offline.test.ts proves separately for all four failure modes.
      expect(row(FFMPEG.label)).toHaveTextContent(/Cancelled\. Nothing was kept\./),
    );
    expect(seen?.aborted).toBe(true);
  });

  it("reports a failure in the row rather than swallowing it", async () => {
    addBundle.mockRejectedValue(new Error("/ffmpeg-core.wasm answered 404"));
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());

    fireEvent.click(within(row(FFMPEG.label)).getByRole("button"));
    await waitFor(() => expect(row(FFMPEG.label)).toHaveTextContent(/answered 404/));
    expect(within(row(FFMPEG.label)).getByText("NOT STORED")).toBeInTheDocument();
  });
});

describe("the escape hatch", () => {
  it("needs a second press before it destroys anything", async () => {
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: /REMOVE EVERYTHING STORED/i }));
    expect(clearAllOffline).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /YES — REMOVE EVERYTHING/i }));
    await waitFor(() => expect(clearAllOffline).toHaveBeenCalledTimes(1));
  });

  it("says what it does not clear, because the label says 'everything'", async () => {
    render(<OfflineSettings />);
    await waitFor(() => expect(cachedBundleIds).toHaveBeenCalled());
    // /privacy names two things this site stores. The button clears one of
    // them, so the page has to name the other rather than let "everything"
    // stand.
    expect(screen.getByText(/transmute-recent-outputs/)).toBeInTheDocument();
  });
});

describe("browsers that cannot do this", () => {
  it("says so plainly and disables the buttons", async () => {
    supportsOffline.mockReturnValue(false);
    render(<OfflineSettings />);
    await waitFor(() =>
      expect(screen.getByText(/cannot store an offline copy/i)).toBeInTheDocument(),
    );
    expect(within(row(FFMPEG.label)).getByRole("button")).toBeDisabled();
  });

  it("warns when nothing is in control to serve a stored copy back", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      value: { controller: null },
      configurable: true,
    });
    render(<OfflineSettings />);
    await waitFor(() =>
      expect(screen.getByText(/No service worker is in control/i)).toBeInTheDocument(),
    );
  });

  it("shows the browser's own storage figures, marked as the browser's", async () => {
    storageEstimate.mockResolvedValue({ usage: 40_000_000, quota: 2_000_000_000 });
    render(<OfflineSettings />);
    await waitFor(() =>
      expect(screen.getByText(/Your browser reports/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/deliberately rounded/i)).toBeInTheDocument();
  });
});
