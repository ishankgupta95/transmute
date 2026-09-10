import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ProcessedResult } from "@/hooks/useFileProcessor";
import type { ImageEditJobOptions } from "@/lib/workers/image-protocol";

/*
  THE ARITHMETIC IS THE PRODUCT, so it is what these tests are about.

  A split whose tiles do not add up to the source is not a cosmetic defect:
  reassembled, it is a picture with a seam or a missing strip, and a grid of
  plausible-looking thumbnails says nothing about it. This repo has shipped
  that class of bug before — a letterbox calculation that reported
  219 + 563 + 219 = 1001 px inside a 1000 px frame, because two halves were
  rounded independently.

  So the surface prints the addition, term by term, and the tests below read
  that printed addition back and check it against the source's own dimensions.
  `image-edit-core` is deliberately NOT mocked here: the real division is the
  thing under test, and a mocked plan would turn these into assertions about
  the test's own arithmetic.

  The second theme is the tile COUNT. It comes from the files that came back,
  never from the R × C that was asked for — the two differ whenever the engine
  clamps the grid, and a header reading "4 TILES" over three files is the tool
  describing its request instead of its output.
*/

const editImageToMany = vi.fn();
const downloadFilesAsZip = vi.fn();
const triggerDownload = vi.fn();

vi.mock("@/lib/workers/image-client", () => ({
  editImageToMany: (...args: unknown[]) => editImageToMany(...args),
}));

vi.mock("@/lib/utils/download", () => ({
  downloadFilesAsZip: (...args: unknown[]) => downloadFilesAsZip(...args),
  triggerDownload: (...args: unknown[]) => triggerDownload(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile(dropName)])}>drop</button>
  ),
}));

// The dropped file's NAME, because that is the whole of what the flatten
// warning can be derived from before anything is decoded.
let dropName = "poster.png";

// jsdom decodes nothing, so the source's pixel size has to be stated as a
// premise; without it there is no plan and nothing to check the sums against.
let dimensions: { w: number; h: number } | null = { w: 1000, h: 1000 };
vi.mock("@/hooks/useImageDimensions", () => ({
  useImageDimensions: () => dimensions,
}));

import { ImageSplitterUI, axisSum, gridFromPlan, rangeLabel } from "@/components/tools/ImageSplitterUI";

function makeFile(name = "poster.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function tile(label: string, newSize = 2048): ProcessedResult {
  return {
    blob: new Blob([new Uint8Array(newSize)], { type: "image/png" }),
    fileName: `poster-${label}.png`,
    originalSize: 3,
    newSize,
  };
}

/** N tiles named the way `editImageToMany` names them, row-major. */
function tiles(rows: number, cols: number): ProcessedResult[] {
  const out: ProcessedResult[] = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) out.push(tile(`r${r}c${c}`));
  }
  return out;
}

function lastJob(): ImageEditJobOptions {
  return editImageToMany.mock.calls[editImageToMany.mock.calls.length - 1][1] as ImageEditJobOptions;
}

const objectUrls = { created: [] as string[], revoked: [] as string[] };
Object.assign(URL, {
  createObjectURL: (blob: Blob) => {
    const url = `blob:tile-${objectUrls.created.length}-${blob.size}`;
    objectUrls.created.push(url);
    return url;
  },
  revokeObjectURL: (url: string) => objectUrls.revoked.push(url),
});

function drop() {
  render(<ImageSplitterUI acceptFormats=".jpg,.png,.webp" />);
  fireEvent.click(screen.getByText("drop"));
}

const setAxis = (label: "Rows" | "Columns", value: number) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });

/** The printed addition, as one string. */
const sums = () => screen.getByText(/^ACROSS:/).textContent ?? "";

/** Read the terms of one printed axis back out of it. */
function terms(axis: "ACROSS" | "DOWN"): { parts: number[]; total: number } {
  const m = new RegExp(`${axis}: ([0-9 +]+) = (\\d+)`).exec(sums());
  if (!m) throw new Error(`no ${axis} sum in ${JSON.stringify(sums())}`);
  return { parts: m[1].split(" + ").map(Number), total: Number(m[2]) };
}

beforeEach(() => {
  editImageToMany.mockReset();
  downloadFilesAsZip.mockReset();
  triggerDownload.mockReset();
  editImageToMany.mockResolvedValue(tiles(2, 2));
  dimensions = { w: 1000, h: 1000 };
  dropName = "poster.png";
  objectUrls.created = [];
  objectUrls.revoked = [];
});

describe("the readout helpers", () => {
  it("shows the addition rather than only its answer", () => {
    expect(axisSum([333, 334, 333])).toBe("333 + 334 + 333 = 1000");
    expect(axisSum([500])).toBe("500 = 500");
  });

  it("collapses a uniform axis to one number and a ragged one to its range", () => {
    expect(rangeLabel([250, 250, 250, 250])).toBe("250");
    expect(rangeLabel([333, 334, 333])).toBe("333–334");
    expect(rangeLabel([])).toBe("—");
  });

  it("reads the grid back out of the labels the plan emitted", () => {
    // Not recomputed from the request: `editOutputPlan` clamps each axis to
    // the source's pixel count, so the plan is the only thing that knows.
    expect(gridFromPlan([{ label: "r1c1" }, { label: "r1c2" }, { label: "r2c1" }, { label: "r2c2" }]))
      .toEqual({ rows: 2, cols: 2 });
    expect(gridFromPlan([{ label: "square-1080" }])).toEqual({ rows: 0, cols: 0 });
  });
});

describe("ImageSplitterUI — the tiles add up to the picture", () => {
  it("prints the addition for a grid that does not divide evenly", () => {
    // 1000 across 3 columns is 333 + 334 + 333, not three 333s and a lost
    // pixel, and not three 334s and an overhang.
    drop();
    setAxis("Columns", 3);
    expect(sums()).toBe("ACROSS: 333 + 334 + 333 = 1000 PX · DOWN: 500 + 500 = 1000 PX");
  });

  it("sums to the source's own dimensions at every grid it will accept", () => {
    /*
      The property the case above is one example of, walked over the awkward
      sizes: a prime width, an odd height, a picture smaller than the grid.
      Each assertion compares the printed total against the number the header
      is showing, which is the comparison a reader would make.
    */
    for (const [w, h] of [
      [1000, 1000],
      [1001, 997],
      [1920, 1080],
      [37, 91],
    ]) {
      dimensions = { w, h };
      const view = render(<ImageSplitterUI acceptFormats=".png" />);
      fireEvent.click(screen.getAllByText("drop")[0]);

      for (const [rows, cols] of [
        [2, 3],
        [3, 7],
        [10, 10],
      ]) {
        setAxis("Rows", rows);
        setAxis("Columns", cols);

        const across = terms("ACROSS");
        const down = terms("DOWN");
        expect(across.parts.reduce((a, b) => a + b, 0)).toBe(across.total);
        expect(down.parts.reduce((a, b) => a + b, 0)).toBe(down.total);
        expect(across.total, `${w}×${h} at ${rows}×${cols} across`).toBe(w);
        expect(down.total, `${w}×${h} at ${rows}×${cols} down`).toBe(h);
      }
      view.unmount();
    }
  });

  it("says when the picture has too few pixels for the grid that was asked for", () => {
    /*
      `splitGrid` clamps each axis to the source's pixel count — a 4 px tall
      strip cannot be ten rows. Swallowing that would leave the tile count as
      the only trace of a request that was not honoured.
    */
    dimensions = { w: 4, h: 4 };
    drop();
    setAxis("Rows", 10);

    expect(
      screen.getByText(
        "THIS PICTURE HAS TOO FEW PIXELS FOR 10 × 2 — IT IS BEING CUT INTO 4 × 2 INSTEAD, ONE TILE PER PIXEL AT MOST",
      ),
    ).toBeInTheDocument();
    expect(sums()).toBe("ACROSS: 2 + 2 = 4 PX · DOWN: 1 + 1 + 1 + 1 = 4 PX");
  });
});

describe("ImageSplitterUI — the count is what came back", () => {
  it("counts the files the engine returned, not the grid that was requested", async () => {
    /*
      The two numbers are not the same number. Deriving the count from
      `rows × cols` is the tool reporting its own request; every readout here
      has to come from the results.
    */
    editImageToMany.mockResolvedValue(tiles(1, 3));
    drop();
    fireEvent.click(screen.getByRole("button", { name: "Split" }));

    expect(await screen.findByText("3 TILES")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download 3 tiles (ZIP)" })).toBeInTheDocument();
  });

  it("refuses a 1 × 1 grid and says what it would have been", () => {
    drop();
    setAxis("Rows", 1);
    setAxis("Columns", 1);

    expect(screen.getByRole("button", { name: "Split" })).toBeDisabled();
    expect(
      screen.getByText("A 1 × 1 GRID IS THE PICTURE YOU ALREADY HAVE — RAISE THE ROWS OR THE COLUMNS"),
    ).toBeInTheDocument();
  });

  it("clamps a typed grid to what the engine will honour", () => {
    // The ceiling belongs to `image-edit-core`; typing past it must not leave
    // the field showing a number the engine is going to ignore.
    drop();
    setAxis("Rows", 99);
    setAxis("Columns", 40);

    expect(screen.getByLabelText("Rows")).toHaveValue(10);
    expect(screen.getByLabelText("Columns")).toHaveValue(10);
  });
});

describe("ImageSplitterUI — the download matches the deck", () => {
  it("zips every tile under a name derived from the source", async () => {
    drop();
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await screen.findByText("4 TILES");

    fireEvent.click(screen.getByRole("button", { name: "Download 4 tiles (ZIP)" }));

    expect(downloadFilesAsZip).toHaveBeenCalledTimes(1);
    const [files, name] = downloadFilesAsZip.mock.calls[0];
    expect((files as { name: string }[]).map((f) => f.name)).toEqual([
      "poster-r1c1.png",
      "poster-r1c2.png",
      "poster-r2c1.png",
      "poster-r2c2.png",
    ]);
    expect(name).toBe("poster-tiles.zip");
  });

  it("saves one tile on its own when its thumbnail is clicked", async () => {
    drop();
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await screen.findByText("4 TILES");

    fireEvent.click(screen.getByRole("button", { name: "Download poster-r2c1.png" }));

    expect(triggerDownload).toHaveBeenCalledWith(expect.any(Blob), "poster-r2c1.png");
    expect(downloadFilesAsZip).not.toHaveBeenCalled();
  });

  it("sends the grid and the format the rail is showing", async () => {
    drop();
    setAxis("Rows", 3);
    setAxis("Columns", 4);
    fireEvent.click(screen.getByRole("button", { name: "WEBP" }));
    fireEvent.click(screen.getByRole("button", { name: "Split" }));

    await waitFor(() => expect(editImageToMany).toHaveBeenCalledTimes(1));
    expect(lastJob()).toMatchObject({
      edit: { kind: "split", rows: 3, cols: 4 },
      format: "webp",
    });
  });

  it("drops the deck the moment the grid changes", async () => {
    // A ZIP built for a 2 × 2 must never sit under a rail that says 3 × 3.
    drop();
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await screen.findByText("4 TILES");

    setAxis("Columns", 3);

    expect(screen.queryByRole("button", { name: /^Download / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
  });

  it("revokes every preview URL it allocated for a deck it has replaced", async () => {
    drop();
    // Everything allocated from here on belongs to the deck; the source
    // preview's URL was allocated on the drop and belongs to `useObjectUrl`.
    const beforeSplit = objectUrls.created.length;
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await screen.findByText("4 TILES");

    const deckUrls = objectUrls.created.slice(beforeSplit);
    expect(deckUrls).toHaveLength(4);

    // Fake timers only for the teardown: the revoke is deferred by a second,
    // for `useObjectUrl`'s reason — a synchronous revoke aborts an <img> that
    // is still loading the URL the deck has swapped away from.
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByText("CHANGE THE GRID"));
      vi.advanceTimersByTime(1500);
    } finally {
      vi.useRealTimers();
    }

    expect(objectUrls.revoked).toEqual(expect.arrayContaining(deckUrls));
  });
});

describe("ImageSplitterUI — the flatten a JPG grid would do is disclosed", () => {
  /*
    This page hands back up to a hundred files at once, so a silent flatten is
    a hundred flattened files. The picker owns the "is JPG selected" half of
    that sentence and cannot answer the other half — whether the SOURCE can
    carry transparency at all — so a caller that forgets `alphaWarning` renders
    no warning at any setting, which is what this page did.
  */
  const ALPHA = /JPG has no alpha channel, so every transparent pixel is filled with white/;

  it("says nothing while the grid is being written as PNG", () => {
    drop();

    expect(screen.queryByText(ALPHA)).toBeNull();
  });

  it("warns the moment JPG is chosen for a source that can carry alpha", () => {
    drop();

    fireEvent.click(screen.getByRole("button", { name: "JPG" }));

    expect(screen.getByText(ALPHA)).toBeInTheDocument();
    // The escape hatch is named from the picker's own format list.
    expect(screen.getByText(/PNG and WEBP keep the transparency/)).toBeInTheDocument();
  });

  it("stays quiet for a JPEG source, which had no transparency to lose", () => {
    dropName = "poster.jpg";
    drop();

    fireEvent.click(screen.getByRole("button", { name: "JPG" }));

    expect(screen.queryByText(ALPHA)).toBeNull();
  });
});
