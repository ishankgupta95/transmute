import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

/*
  The whole point of this page is one counter-intuitive fact: the decoder has
  ALREADY applied the file's EXIF Orientation, so the turn composes on top of
  the picture as displayed. Two things follow, and both are pinned here.

    1. The page has to SAY it. A user with a phone photo needs to know why the
       preview is already upright.
    2. The page must NOT claim a lossless turn, "the raw image" or "the
       original orientation" — a canvas rotate decodes, redraws and re-encodes,
       and the only lossless JPEG turn is an EXIF-tag rewrite, which is a
       different tool.

  The third block is the arithmetic: a quarter turn swaps the sides and a half
  turn does not, and that is stated before the run, so it has to be right
  before the run.

  Copy strings are duplicated rather than imported — a test that reads the
  constant it checks cannot notice the constant changing.
*/

const EXIF_NOTE =
  "The turn is applied to the picture as the canvas shows it. A phone photo's own orientation tag was already read and applied when the file was decoded, so the preview and the download agree.";

const PNG_NOTE =
  "PNG OUTPUT IS A LOSSLESS RE-ENCODE OF THE DECODED PIXELS — NO NEW COMPRESSION ARTEFACTS ARE ADDED, BUT THE ORIGINAL'S EXIF DOES NOT COME THROUGH.";

const JPEG_NOTE =
  "JPEG OUTPUT RE-ENCODES EVERY PIXEL — THE DOWNLOAD IS ONE COMPRESSION GENERATION FURTHER ON THAN THE FILE YOU DROPPED.";

/** Phrases a canvas rotate cannot support, in any casing, anywhere on the page. */
const FORBIDDEN: readonly RegExp[] = [
  /lossless rotation/i,
  /lossless turn/i,
  /the original orientation/i,
  /the raw image/i,
];

const editImage = vi.fn();

vi.mock("@/lib/workers/image-client", () => ({
  editImage: (...args: unknown[]) => editImage(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([dropped])}>drop</button>
  ),
}));

// jsdom decodes nothing, so the size the header and the arithmetic read comes
// from here. That is also what lets one test drive 800 × 600 deliberately.
vi.mock("@/hooks/useImageDimensions", () => ({
  useImageDimensions: () => dims,
}));

import { RotateImageUI } from "@/components/tools/RotateImageUI";

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

let dropped: File = makeFile("photo.png", "image/png");
let dims: { w: number; h: number } | null = { w: 800, h: 600 };

function rotated(fileName: string): ProcessedResult {
  return {
    blob: new Blob([new Uint8Array(64)], { type: "image/png" }),
    fileName,
    originalSize: 3,
    newSize: 64,
  };
}

function drop(): void {
  render(<RotateImageUI acceptFormats=".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif" />);
  fireEvent.click(screen.getByText("drop"));
}

beforeEach(() => {
  vi.clearAllMocks();
  dropped = makeFile("photo.png", "image/png");
  dims = { w: 800, h: 600 };
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("RotateImageUI — the EXIF rule is stated, and overclaiming is not", () => {
  it("explains that the turn composes on the picture as decoded", () => {
    drop();

    expect(screen.getByText(EXIF_NOTE)).toBeInTheDocument();
  });

  it("never claims a lossless turn or an untouched original", () => {
    drop();

    for (const phrase of FORBIDDEN) {
      expect(document.body.textContent ?? "", String(phrase)).not.toMatch(phrase);
    }
  });

  it("says what the chosen encoder will actually do", () => {
    drop();

    // A PNG source starts on PNG, which is a lossless re-encode of the pixels
    // — and the page still refuses to call the ROTATION lossless.
    expect(screen.getByText(PNG_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(JPEG_NOTE)).toBeNull();
  });
});

describe("RotateImageUI — the dimension arithmetic is stated before the run", () => {
  it("swaps the sides for a quarter turn", () => {
    drop();

    expect(screen.getByText("600 × 800")).toBeInTheDocument();
  });

  it("leaves the sides alone for a half turn", () => {
    drop();

    fireEvent.click(screen.getByRole("button", { name: "180°" }));

    expect(screen.getByText("800 × 600")).toBeInTheDocument();
    expect(screen.queryByText("600 × 800")).toBeNull();
  });

  it("swaps them again for the other quarter turn", () => {
    drop();

    fireEvent.click(screen.getByRole("button", { name: "180°" }));
    fireEvent.click(screen.getByRole("button", { name: "90° left" }));

    expect(screen.getByText("600 × 800")).toBeInTheDocument();
  });

  it("prints the size the file will have when the turn crosses the canvas ceiling", () => {
    /*
      A browser canvas cannot hold an edge longer than 8192 px, so the edit
      core scales the WHOLE turned frame to fit and says it did. The page used
      to transpose the sides itself and print the un-clamped swap: a
      9504 × 6336 frame (a 61 MP full-frame camera, the file image-edit-core
      names) turned 90° read "6336 × 9504" while the download was 5461 × 8192,
      with the engine's own warning three elements away naming the real size.
    */
    dims = { w: 9504, h: 6336 };
    drop();

    expect(screen.getByText("5461 × 8192")).toBeInTheDocument();
    expect(screen.getByText("5461×8192")).toBeInTheDocument();
    expect(screen.queryByText(/6336 × 9504/)).toBeNull();
    expect(
      screen.getByText(
        "A BROWSER CANVAS CANNOT HOLD AN EDGE LONGER THAN 8192 PIXELS, SO THE TURNED PICTURE IS REDUCED WHOLE TO 5461 × 8192 RATHER THAN SQUASHED",
      ),
    ).toBeInTheDocument();
  });

  it("says nothing about a ceiling that is not in play", () => {
    // 800 × 600 turned is 600 × 800, nowhere near 8192 — a standing caveat
    // would be a caveat about someone else's file.
    drop();

    expect(screen.queryByText(/CANNOT HOLD AN EDGE LONGER THAN/)).toBeNull();
  });

  it("says nothing about dimensions it has not measured", () => {
    dims = null;
    drop();

    expect(screen.queryByText("600 × 800")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("RotateImageUI — the run carries the settings the page is showing", () => {
  it("asks the engine for the turn the chips have selected", async () => {
    editImage.mockResolvedValue(rotated("photo-rotated.png"));
    drop();

    fireEvent.click(screen.getByRole("button", { name: "180°" }));
    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));

    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(editImage).toHaveBeenCalledWith(dropped, {
      edit: { kind: "rotate", degrees: 180 },
      format: "png",
      quality: 0.9,
    });
    expect(
      await screen.findByRole("button", { name: "Download photo-rotated.png" }),
    ).toBeInTheDocument();
  });

  it("drops the finished blob the moment the turn changes", async () => {
    editImage.mockResolvedValue(rotated("photo-rotated.png"));
    drop();

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    await screen.findByRole("button", { name: "Download photo-rotated.png" });

    fireEvent.click(screen.getByRole("button", { name: "180°" }));

    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByRole("button", { name: "Rotate" })).toBeInTheDocument();
  });

  it("shows the engine's message when the run fails", async () => {
    editImage.mockRejectedValue(new Error("Could not decode this image"));
    drop();

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));

    expect(await screen.findByText("Could not decode this image")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
  });
});

describe("RotateImageUI — the output starts on the source's own format", () => {
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
