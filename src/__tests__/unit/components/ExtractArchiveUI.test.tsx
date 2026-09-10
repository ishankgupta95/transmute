import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ArchiveEntry, ArchiveListing, ExtractResult } from "@/lib/tools/archive-extract";

/*
  ── WHAT THIS FILE GUARDS ────────────────────────────────────────────────

  Two things the engine cannot be asked to prove, and one plural.

  1. THE PAGE HAS TO SAY THAT CHECKSUMS ARE NOT VERIFIED. Measured in
     `archive-extract.test.ts`: a stored ZIP with fifty bytes overwritten
     inside one member extracts with no failure at all, the full declared
     length, and no engine error — while `unzip -t` on the same file reports a
     bad CRC and exits 2. The counts this page prints are therefore a record
     of what was WRITTEN, not a clean bill of health, and the only honest
     thing to do with a limitation an engine cannot fix is disclose it. A
     test over the library can prove the corruption is invisible; only a test
     over the component can prove the page admits it.

  2. THE SELECTION HAS TO FREEZE DURING A RUN. `handleExtract` snapshots
     `selected` when the button is pressed, so unticking mid-run changes the
     panel and not the download: "SELECTED 0" over a ZIP of everything. The
     component computed `extracting` for exactly this and then never used it
     — the checkboxes stayed live — which ESLint reported as an unused
     variable and which is really a copy defect: a comment describing a freeze
     that was not there.

  3. "FILEs". The default plural is `${one}s`, and the completion footnote is
     literal capitals with no `uppercase` class to cover for it, so
     `plural(3, "FILE")` renders "WROTE 3 FILEs". Cheap to reintroduce, so
     cheap to pin.

  Copy strings are duplicated rather than imported, per the house pattern: a
  test that reads the constant it is checking cannot notice the constant
  changing.
*/

const readArchive = vi.fn();
const extractFromArchive = vi.fn();
const downloadFilesAsZip = vi.fn((..._args: unknown[]) => Promise.resolve());

vi.mock("@/lib/tools/archive-extract", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tools/archive-extract")>(
      "@/lib/tools/archive-extract",
    );
  return {
    ...actual,
    readArchive: (...args: unknown[]) => readArchive(...args),
    extractFromArchive: (...args: unknown[]) => extractFromArchive(...args),
  };
});

vi.mock("@/lib/utils/download", () => ({
  downloadFilesAsZip: (...args: unknown[]) => downloadFilesAsZip(...args),
  downloadBlob: vi.fn(),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop archive</button>
  ),
}));

import { ExtractArchiveUI } from "@/components/tools/ExtractArchiveUI";

function makeFile(name = "bundle.zip"): File {
  const file = new File([new Uint8Array(2048)], name, { type: "application/zip" });
  // jsdom's File has arrayBuffer(), but not on every version this repo pins.
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(2048)),
  });
  return file;
}

function entry(index: number, path: string): ArchiveEntry {
  return {
    index,
    path,
    safePath: path,
    unsafeReason: null,
    kind: "file",
    size: 100,
    encrypted: false,
    modifiedAt: null,
    linkTarget: null,
    nested: false,
  };
}

function listingOf(...paths: string[]): ArchiveListing {
  return {
    entries: paths.map((p, i) => entry(i, p)),
    container: "zip",
    engine: "libarchive 3.7.7",
    sizeSource: "archive",
    viaGzipStream: false,
    incompleteReason: null,
  } as ArchiveListing;
}

function resultOf(count: number, bytes: number): ExtractResult {
  return {
    files: Array.from({ length: count }, (_, i) => ({
      index: i,
      name: `f${i}.txt`,
      path: `f${i}.txt`,
      blob: new Blob([new Uint8Array(10)]),
      bytes: Math.round(bytes / count),
    })),
    failures: [],
    bytes,
  };
}

/** Drop the mocked archive and wait for the listing to render. */
async function dropAndList(listing: ArchiveListing) {
  readArchive.mockResolvedValue(listing);
  render(<ExtractArchiveUI />);
  fireEvent.click(screen.getByText("drop archive"));
  await waitFor(() => expect(screen.getByLabelText(`Select ${listing.entries[0].path}`)).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  downloadFilesAsZip.mockResolvedValue(undefined);
});

describe("ExtractArchiveUI — what the page admits about integrity", () => {
  it("tells the reader that member checksums are not verified", async () => {
    render(<ExtractArchiveUI />);

    const drawer = screen.getByText(/Member checksums are not verified/i);
    expect(drawer.textContent).toMatch(/corrupted without changing its length/i);
    // And names the check it cannot do itself, rather than leaving a dead end.
    expect(drawer.textContent).toMatch(/unzip -t/);
    expect(drawer.textContent).toMatch(/7z t/);
  });

  it("does not let the counts read as a verification", async () => {
    render(<ExtractArchiveUI />);
    const drawer = screen.getByText(/Member checksums are not verified/i);
    expect(drawer.textContent).toMatch(/record of what was written rather than a clean bill/i);
    // The one check it CAN make is still claimed, because it is real.
    expect(drawer.textContent).toMatch(/shorter than the size its own archive declares/i);
  });

  /*
    The gzip path fetches nothing: `readArchive` sniffs the container, peeks
    inside with `DecompressionStream`, and only reaches for libarchive when
    the payload looks like something libarchive could read. Measured in the
    library suite as zero `/libarchive.wasm` requests. The drawer used to say
    the 599 KB was fetched "the first time you open an archive", full stop.
  */
  it("does not claim the engine is fetched for every file", async () => {
    render(<ExtractArchiveUI />);
    const engineNote = screen.getByText(/599 KB fetched from this site/i);
    expect(engineNote.textContent).toMatch(/never needs it/i);
    expect(engineNote.textContent).toMatch(/the engine is not fetched at all/i);
    expect(engineNote.textContent).not.toMatch(/the first time you open an archive/i);
  });
});

describe("ExtractArchiveUI — the selection is frozen for the length of a run", () => {
  it("disables the entry checkboxes while an extraction is in flight", async () => {
    await dropAndList(listingOf("a.txt", "b.txt"));

    const first = screen.getByLabelText("Select a.txt") as HTMLInputElement;
    expect(first.disabled).toBe(false);

    // A run that does not resolve until we say so.
    let finish!: (r: ExtractResult) => void;
    extractFromArchive.mockReturnValue(
      new Promise<ExtractResult>((resolve) => {
        finish = resolve;
      }),
    );

    fireEvent.click(screen.getByText("Download 2 files"));

    await waitFor(() =>
      expect((screen.getByLabelText("Select a.txt") as HTMLInputElement).disabled).toBe(true),
    );
    expect((screen.getByLabelText("Select b.txt") as HTMLInputElement).disabled).toBe(true);

    finish(resultOf(2, 200));

    // And live again once the run is over, so the next selection can be made.
    await waitFor(() =>
      expect((screen.getByLabelText("Select a.txt") as HTMLInputElement).disabled).toBe(false),
    );
  });

  /*
    The symptom the freeze exists to stop, asserted directly. `handleExtract`
    took `[...selected]` at press time and nothing could change that; what an
    untick DID change was every number derived from `selected` — so the rail
    would read "Download 1 file" over a run bundling two, and the stat strip
    would agree with the rail and not with the download.
  */
  it("does not let a mid-run untick rewrite the panel out from under the run", async () => {
    await dropAndList(listingOf("a.txt", "b.txt"));

    let finish!: (r: ExtractResult) => void;
    extractFromArchive.mockReturnValue(
      new Promise<ExtractResult>((resolve) => {
        finish = resolve;
      }),
    );

    fireEvent.click(screen.getByText("Download 2 files"));
    await waitFor(() => expect(extractFromArchive).toHaveBeenCalledTimes(1));

    // The indices the run was actually given, frozen at press time.
    expect(extractFromArchive.mock.calls[0][2]).toEqual([0, 1]);

    /*
      jsdom's `fireEvent.click` toggles a DISABLED checkbox and fires React's
      onChange — measured; a browser does neither. So the disabled attribute
      cannot be what this test leans on, and that is the point: the freeze is
      a state guard in `toggle`, with the attribute as the affordance. The
      "None" button below is the case that was never disabled at all.
    */
    fireEvent.click(screen.getByLabelText("Select b.txt"));
    expect(screen.getByText("Download 2 files")).toBeTruthy();
    expect(screen.queryByText("Download 1 file")).toBeNull();

    // The sharpest version of the same bug: "SELECTED 0" over a ZIP of both.
    fireEvent.click(screen.getByText("None"));
    expect(screen.getByText("Download 2 files")).toBeTruthy();
    expect(screen.queryByText("Download selected files")).toBeNull();

    finish(resultOf(2, 200));
    await waitFor(() => expect(screen.getByText(/BUNDLED INTO ONE ZIP/)).toBeTruthy());

    // Live again once the run is over.
    fireEvent.click(screen.getByText("None"));
    await waitFor(() => expect(screen.getByText("Download selected files")).toBeTruthy());
  });
});

describe("ExtractArchiveUI — the completion footnote", () => {
  it("renders an all-caps plural rather than FILEs", async () => {
    await dropAndList(listingOf("a.txt", "b.txt", "c.txt"));
    extractFromArchive.mockResolvedValue(resultOf(3, 600));

    fireEvent.click(screen.getByText("Download 3 files"));

    const footnote = await screen.findByText(/WROTE 3/);
    expect(footnote.textContent).toMatch(/WROTE 3 FILES/);
    expect(footnote.textContent).not.toMatch(/FILEs/);
  });

  it("uses the singular when exactly one member was written", async () => {
    await dropAndList(listingOf("only.txt"));
    extractFromArchive.mockResolvedValue(resultOf(1, 100));

    fireEvent.click(screen.getByText("Download 1 file"));

    const footnote = await screen.findByText(/WROTE 1/);
    expect(footnote.textContent).toMatch(/WROTE 1 FILE ·/);
    expect(footnote.textContent).toMatch(/AS A SINGLE FILE/);
  });
});
