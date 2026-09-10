import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

/*
  A border is pure addition — nothing is cropped and nothing is scaled — and
  that addition is the one thing a user cannot check by eye before the file
  comes back. So the arithmetic is written out on the page, and it is the first
  thing pinned here: `800 × 600 → 840 × 640`, with the per-edge widths beside
  it. If the sum on screen and the sum in the download ever disagree, this
  page is lying about the only number it exists to produce.

  The second block is the link toggle. While the edges are linked, every field
  is the same field; unlinking has to keep the frame the user was looking at
  and then let all four move apart.

  Copy strings are duplicated rather than imported — a test that reads the
  constant it checks cannot notice the constant changing.
*/

const PNG_NOTE =
  "PNG OUTPUT IS A LOSSLESS RE-ENCODE OF THE DECODED PIXELS — NO NEW COMPRESSION ARTEFACTS ARE ADDED, BUT THE ORIGINAL'S EXIF DOES NOT COME THROUGH.";
const JPEG_NOTE =
  "JPEG OUTPUT RE-ENCODES EVERY PIXEL — THE DOWNLOAD IS ONE COMPRESSION GENERATION FURTHER ON THAN THE FILE YOU DROPPED.";

const BAD_HEX_NOTE =
  "That is not a six-digit hex colour, so the border would not be the colour you asked for. Write it as #rrggbb.";

const editImage = vi.fn();

vi.mock("@/lib/workers/image-client", () => ({
  editImage: (...args: unknown[]) => editImage(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([dropped])}>drop</button>
  ),
}));

// jsdom decodes nothing, so the source size the arithmetic is built on comes
// from here — which is also what lets a test drive an exact 800 × 600.
vi.mock("@/hooks/useImageDimensions", () => ({
  useImageDimensions: () => dims,
}));

import { AddBorderUI } from "@/components/tools/AddBorderUI";

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

let dropped: File = makeFile("photo.png", "image/png");
let dims: { w: number; h: number } | null = { w: 800, h: 600 };

function bordered(fileName: string): ProcessedResult {
  return {
    blob: new Blob([new Uint8Array(64)], { type: "image/png" }),
    fileName,
    originalSize: 3,
    newSize: 64,
  };
}

function drop(): void {
  render(<AddBorderUI acceptFormats=".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif" />);
  fireEvent.click(screen.getByText("drop"));
}

/** Type a width into one of the edge fields, the way a person would. */
function setEdge(label: string, value: number): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
}

/** Break the link so the four per-edge fields are on screen. */
function unlink(): void {
  fireEvent.click(screen.getByRole("button", { name: "Set each edge separately" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  dropped = makeFile("photo.png", "image/png");
  dims = { w: 800, h: 600 };
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("AddBorderUI — the output size is arithmetic the page shows its working for", () => {
  it("adds the linked width to both sides of both axes", () => {
    drop();

    setEdge("All edges", 20);

    // 800 + 20 + 20 = 840, 600 + 20 + 20 = 640. Stated twice on purpose: the
    // rail readout and the canvas footnote must not be able to disagree.
    expect(screen.getByText("800 × 600 → 840 × 640")).toBeInTheDocument();
    expect(screen.getByText("800 × 600 → 840 × 640 — 20 PX ON EVERY EDGE")).toBeInTheDocument();
  });

  it("adds each edge to its own side once they are set apart", () => {
    drop();
    unlink();

    setEdge("Top", 10);
    setEdge("Right", 20);
    setEdge("Bottom", 30);
    setEdge("Left", 40);

    // Width takes left + right (40 + 20), height takes top + bottom (10 + 30).
    expect(screen.getByText("800 × 600 → 860 × 640")).toBeInTheDocument();
    expect(
      screen.getByText("800 × 600 → 860 × 640 — 10 TOP / 20 RIGHT / 30 BOTTOM / 40 LEFT"),
    ).toBeInTheDocument();
  });

  it("prints the size the file will have when the frame crosses the canvas ceiling", () => {
    /*
      A browser canvas cannot hold an edge longer than 8192 px, so the edit
      core scales the WHOLE frame to fit and says it did. The page used to
      re-add the edges itself and print the un-clamped sum: an 8000 × 6000
      photo with a 200 px border read "8400 × 6400" while the download was
      8192 × 6242, with the engine's own warning three elements away naming
      the smaller number. Both readouts are asserted, because both were wrong.
    */
    dims = { w: 8000, h: 6000 };
    drop();

    setEdge("All edges", 200);

    expect(screen.getByText("8000 × 6000 → 8192 × 6242")).toBeInTheDocument();
    expect(
      screen.getByText("8000 × 6000 → 8192 × 6242 — 200 PX ON EVERY EDGE"),
    ).toBeInTheDocument();
    expect(screen.getByText("8192×6242")).toBeInTheDocument();
    expect(screen.queryByText(/8400/)).toBeNull();
  });

  it("discloses the ceiling scale before the run, and stops claiming pure addition", () => {
    dims = { w: 8000, h: 6000 };
    drop();

    // The frame fits: nothing is scaled, and the ADVANCED row says so.
    setEdge("All edges", 20);
    expect(screen.queryByText(/CANNOT HOLD AN EDGE LONGER THAN/)).toBeNull();
    expect(screen.getByText("NOT CROPPED OR SCALED")).toBeInTheDocument();

    setEdge("All edges", 200);

    expect(
      screen.getByText(
        "A BROWSER CANVAS CANNOT HOLD AN EDGE LONGER THAN 8192 PIXELS, SO THE FRAMED PICTURE IS REDUCED WHOLE TO 8192 × 6242 RATHER THAN SQUASHED",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("NOT CROPPED — SCALED TO FIT THE CANVAS")).toBeInTheDocument();
    expect(screen.queryByText("NOT CROPPED OR SCALED")).toBeNull();
  });

  it("states no arithmetic for a source it has not measured", () => {
    dims = null;
    drop();

    expect(screen.queryByText(/→/)).toBeNull();
  });
});

describe("AddBorderUI — the link is what makes one number four", () => {
  it("moves all four edges while they are linked", () => {
    drop();

    setEdge("All edges", 12);
    unlink();

    for (const edge of ["Top", "Right", "Bottom", "Left"]) {
      expect(screen.getByLabelText(edge)).toHaveValue(12);
    }
  });

  it("keeps the frame that was on screen when the edges are re-linked", () => {
    drop();
    unlink();

    setEdge("Top", 10);
    setEdge("Bottom", 30);
    fireEvent.click(screen.getByRole("button", { name: "Use one width for all edges" }));

    // Re-linking picks the top field, because that is the number the linked
    // form is about to show.
    expect(screen.getByLabelText("All edges")).toHaveValue(10);
    expect(screen.getByText("800 × 600 → 820 × 620")).toBeInTheDocument();
  });
});

describe("AddBorderUI — the run carries the settings the page is showing", () => {
  it("sends the four edges and the colour the form is displaying", async () => {
    editImage.mockResolvedValue(bordered("photo-bordered.png"));
    drop();
    unlink();

    setEdge("Top", 10);
    setEdge("Right", 20);
    setEdge("Bottom", 30);
    setEdge("Left", 40);
    fireEvent.change(screen.getByLabelText("Border colour hex"), {
      target: { value: "#112233" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add border" }));

    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(editImage).toHaveBeenCalledWith(dropped, {
      edit: { kind: "border", top: 10, right: 20, bottom: 30, left: 40, colour: "#112233" },
      format: "png",
      quality: 0.9,
    });
    expect(
      await screen.findByRole("button", { name: "Download photo-bordered.png" }),
    ).toBeInTheDocument();
  });

  it("drops the finished blob the moment a width changes", async () => {
    editImage.mockResolvedValue(bordered("photo-bordered.png"));
    drop();

    fireEvent.click(screen.getByRole("button", { name: "Add border" }));
    await screen.findByRole("button", { name: "Download photo-bordered.png" });

    setEdge("All edges", 40);

    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByRole("button", { name: "Add border" })).toBeInTheDocument();
  });

  it("shows the engine's message when the run fails", async () => {
    editImage.mockRejectedValue(new Error("Could not decode this image"));
    drop();

    fireEvent.click(screen.getByRole("button", { name: "Add border" }));

    expect(await screen.findByText("Could not decode this image")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
  });
});

describe("AddBorderUI — a colour the engine cannot read is called out", () => {
  it("says so for anything that is not a six-digit hex", () => {
    drop();

    fireEvent.change(screen.getByLabelText("Border colour hex"), { target: { value: "red" } });

    expect(screen.getByText(BAD_HEX_NOTE)).toBeInTheDocument();
  });

  it("says nothing while the hex is well formed", () => {
    drop();

    fireEvent.change(screen.getByLabelText("Border colour hex"), {
      target: { value: "#00FF88" },
    });

    expect(screen.queryByText(BAD_HEX_NOTE)).toBeNull();
  });
});

describe("AddBorderUI — the output starts on the source's own format", () => {
  it("keeps a JPEG a JPEG rather than handing back a bigger PNG", () => {
    dropped = makeFile("holiday.jpg", "image/jpeg");
    drop();

    expect(screen.getByRole("button", { name: "JPG" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(JPEG_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(PNG_NOTE)).toBeNull();
  });

  it("falls to PNG for a source the picker cannot write back", () => {
    dropped = makeFile("scan.bmp", "image/bmp");
    drop();

    expect(screen.getByRole("button", { name: "PNG" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(PNG_NOTE)).toBeInTheDocument();
  });
});
