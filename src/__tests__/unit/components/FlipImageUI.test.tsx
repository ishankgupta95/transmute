import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

/*
  Same EXIF rule as `rotate-image`: the decoder has already applied the file's
  Orientation tag, so the mirror composes on top of the picture as displayed.
  The page has to say that, and it must never call a canvas flip lossless or
  claim to have touched "the raw image".

  The other thing pinned here is the preview. `scaleX(-1)` / `scaleY(-1)` leave
  the bounding box where it was, so this page — unlike `rotate-image` — CAN
  show the transform truthfully before the run. That preview is only honest
  while there is no result: the returned file is already mirrored, and leaving
  the transform on would show the flip twice.

  Copy strings are duplicated rather than imported — a test that reads the
  constant it checks cannot notice the constant changing.
*/

const EXIF_NOTE =
  "The mirror is applied to the picture as the canvas shows it. A phone photo's own orientation tag was already read and applied when the file was decoded, so the preview and the download agree.";

const HORIZONTAL_NOTE =
  "Left and right swap — the mirror-selfie fix, and what turns a right-facing subject into a left-facing one.";
const VERTICAL_NOTE =
  "Top and bottom swap — the picture is reflected in its own horizon, not turned upside down.";

const PNG_NOTE =
  "PNG OUTPUT IS A LOSSLESS RE-ENCODE OF THE DECODED PIXELS — NO NEW COMPRESSION ARTEFACTS ARE ADDED, BUT THE ORIGINAL'S EXIF DOES NOT COME THROUGH.";
const JPEG_NOTE =
  "JPEG OUTPUT RE-ENCODES EVERY PIXEL — THE DOWNLOAD IS ONE COMPRESSION GENERATION FURTHER ON THAN THE FILE YOU DROPPED.";

const SOURCE_ALT = "Source image, previewed with the flip applied";
const RESULT_ALT = "Flipped image";

/** Phrases a canvas flip cannot support, in any casing, anywhere on the page. */
const FORBIDDEN: readonly RegExp[] = [
  /lossless flip/i,
  /lossless mirror/i,
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

// jsdom decodes nothing, so the size the header reads comes from here.
vi.mock("@/hooks/useImageDimensions", () => ({
  useImageDimensions: () => dims,
}));

import { FlipImageUI } from "@/components/tools/FlipImageUI";

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

let dropped: File = makeFile("photo.png", "image/png");
let dims: { w: number; h: number } | null = { w: 800, h: 600 };

function flipped(fileName: string): ProcessedResult {
  return {
    blob: new Blob([new Uint8Array(64)], { type: "image/png" }),
    fileName,
    originalSize: 3,
    newSize: 64,
  };
}

function drop(): void {
  render(<FlipImageUI acceptFormats=".jpg,.jpeg,.png,.webp,.avif,.bmp,.gif" />);
  fireEvent.click(screen.getByText("drop"));
}

beforeEach(() => {
  vi.clearAllMocks();
  dropped = makeFile("photo.png", "image/png");
  dims = { w: 800, h: 600 };
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

describe("FlipImageUI — the EXIF rule is stated, and overclaiming is not", () => {
  it("explains that the mirror composes on the picture as decoded", () => {
    drop();

    expect(screen.getByText(EXIF_NOTE)).toBeInTheDocument();
  });

  it("never claims a lossless flip or an untouched original", () => {
    drop();

    for (const phrase of FORBIDDEN) {
      expect(document.body.textContent ?? "", String(phrase)).not.toMatch(phrase);
    }
  });

  it("describes the axis that is actually selected", () => {
    drop();

    expect(screen.getByText(HORIZONTAL_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(VERTICAL_NOTE)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Vertical" }));

    expect(screen.getByText(VERTICAL_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(HORIZONTAL_NOTE)).toBeNull();
  });
});

describe("FlipImageUI — the preview mirrors the axis, and stops once it is real", () => {
  it("mirrors across the axis the chips have selected", () => {
    drop();

    expect(screen.getByAltText(SOURCE_ALT)).toHaveStyle({ transform: "scaleX(-1)" });

    fireEvent.click(screen.getByRole("button", { name: "Vertical" }));

    expect(screen.getByAltText(SOURCE_ALT)).toHaveStyle({ transform: "scaleY(-1)" });
  });

  it("stops transforming once the picture on screen is the flipped one", async () => {
    editImage.mockResolvedValue(flipped("photo-flipped.png"));
    drop();

    fireEvent.click(screen.getByRole("button", { name: "Flip" }));

    const result = await screen.findByAltText(RESULT_ALT);
    // Not "not scaleX(-1)": no transform at all, or the flip is shown twice.
    expect(result.style.transform).toBe("");
    expect(screen.queryByAltText(SOURCE_ALT)).toBeNull();
  });
});

describe("FlipImageUI — the run carries the settings the page is showing", () => {
  it("asks the engine for the axis the chips have selected", async () => {
    editImage.mockResolvedValue(flipped("photo-flipped.png"));
    drop();

    fireEvent.click(screen.getByRole("button", { name: "Vertical" }));
    fireEvent.click(screen.getByRole("button", { name: "Flip" }));

    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(editImage).toHaveBeenCalledWith(dropped, {
      edit: { kind: "flip", axis: "vertical" },
      format: "png",
      quality: 0.9,
    });
    expect(
      await screen.findByRole("button", { name: "Download photo-flipped.png" }),
    ).toBeInTheDocument();
  });

  it("drops the finished blob the moment the axis changes", async () => {
    editImage.mockResolvedValue(flipped("photo-flipped.png"));
    drop();

    fireEvent.click(screen.getByRole("button", { name: "Flip" }));
    await screen.findByRole("button", { name: "Download photo-flipped.png" });

    fireEvent.click(screen.getByRole("button", { name: "Vertical" }));

    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByRole("button", { name: "Flip" })).toBeInTheDocument();
  });

  it("shows the engine's message when the run fails", async () => {
    editImage.mockRejectedValue(new Error("Could not decode this image"));
    drop();

    fireEvent.click(screen.getByRole("button", { name: "Flip" }));

    expect(await screen.findByText("Could not decode this image")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
  });
});

describe("FlipImageUI — the output starts on the source's own format", () => {
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
