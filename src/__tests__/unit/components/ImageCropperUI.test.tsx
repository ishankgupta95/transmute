import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  crop-image shipped PNG-only from Wave 0, with copy that said so plainly. The
  shared OutputFormatPicker closes that deferral, and everything worth guarding
  here is the WIRING between the picker and the encoder — the picker's own
  rendering is pinned by OutputFormatPicker.test.tsx.

  Three claims this file exists to keep honest:

  1. The picker's choice actually reaches `cropImage`. A format toggle that
     changes a chip and nothing else is the worst version of this feature.
  2. The alpha warning is shown for a reason the tool can name. It is a "may",
     so it is gated on the two things that put transparency into a crop — a
     rotated frame, and a source container that can carry alpha — not on the
     format alone, which would warn about every JPG crop of every JPEG.
  3. The readout names the file that was WRITTEN. `format` is "jpeg" and the
     extension is "jpg"; reading the state instead of the filename would print
     "JPEG" beside a `.jpg` download.
*/

const hoisted = vi.hoisted(() => {
  class FakeCropper {
    static last: FakeCropper | null = null;
    static rotations: number[] = [];
    canvas = { width: 100, height: 80 } as unknown as HTMLCanvasElement;
    constructor() {
      FakeCropper.last = this;
    }
    getCroppedCanvas() {
      return this.canvas;
    }
    setAspectRatio() {}
    rotate(delta: number) {
      FakeCropper.rotations.push(delta);
    }
    destroy() {}
  }
  return { FakeCropper };
});

vi.mock("cropperjs", () => ({ default: hoisted.FakeCropper }));
vi.mock("cropperjs/dist/cropper.css", () => ({}));

const cropImage = vi.fn();
vi.mock("@/lib/tools/image-crop", () => ({
  cropImage: (...args: unknown[]) => cropImage(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <>
      {/* An alpha-capable container and one that cannot carry alpha — the two
          sides of the warning predicate. */}
      <button onClick={() => onFiles([makeFile("logo.png")])}>drop png</button>
      <button onClick={() => onFiles([makeFile("photo.jpg")])}>drop jpg</button>
    </>
  ),
}));

import { ImageCropperUI } from "@/components/tools/ImageCropperUI";

function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function formatChip(label: string): HTMLButtonElement {
  return screen.getByRole("button", { name: label }) as HTMLButtonElement;
}

/** Mount, drop a file, and wait for the cropper to be constructed against it. */
async function load(which: "png" | "jpg" = "png") {
  render(<ImageCropperUI acceptFormats=".jpg,.jpeg,.png,.webp" />);
  fireEvent.click(screen.getByText(`drop ${which}`));
  await screen.findByAltText("Crop preview");
  await waitFor(() => expect(hoisted.FakeCropper.last).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.FakeCropper.last = null;
  hoisted.FakeCropper.rotations = [];
  // jsdom implements neither, and both hooks in this component allocate one.
  URL.createObjectURL = vi.fn(() => "blob:crop");
  URL.revokeObjectURL = vi.fn();
  cropImage.mockResolvedValue({
    blob: new Blob([new Uint8Array(64)]),
    fileName: "logo-cropped.png",
    originalSize: 3,
    newSize: 64,
    format: "png",
  });
});

describe("ImageCropperUI — the format picker reaches the encoder", () => {
  it("opens on PNG, the format this tool wrote before the picker existed", async () => {
    await load();

    expect(formatChip("PNG")).toHaveAttribute("aria-pressed", "true");
    expect(formatChip("JPG")).toHaveAttribute("aria-pressed", "false");
    expect(formatChip("WEBP")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    await waitFor(() => expect(cropImage).toHaveBeenCalled());
    expect(cropImage.mock.calls[0][2]).toEqual({ format: "png", quality: 0.92 });
  });

  it("sends the chosen format and quality, not the defaults", async () => {
    await load();

    fireEvent.click(formatChip("JPG"));
    // The slider only exists for lossy formats, so it is reachable only now.
    fireEvent.change(screen.getByLabelText("Quality"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));

    await waitFor(() => expect(cropImage).toHaveBeenCalled());
    expect(cropImage.mock.calls[0][2]).toEqual({ format: "jpeg", quality: 0.5 });
  });

  it("keeps the format choice when a second image is dropped", async () => {
    await load();
    fireEvent.click(formatChip("WEBP"));
    fireEvent.change(screen.getByLabelText("Rotation"), { target: { value: "45" } });

    // Rotation and aspect belong to the crop frame and reset with it; the
    // saved-file format is a preference about the download and must survive.
    fireEvent.click(screen.getByRole("button", { name: "CANCEL" }));
    fireEvent.click(screen.getByText("drop jpg"));
    await screen.findByAltText("Crop preview");

    expect(formatChip("WEBP")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Rotation")).toHaveValue("0");
    expect(formatChip("Free")).toHaveAttribute("aria-pressed", "true");
  });

  it("warns about the JPG flatten only where transparency could come from", async () => {
    const warning = /no alpha channel/i;

    // A JPEG source, unrotated: nothing in this crop can be transparent.
    await load("jpg");
    fireEvent.click(formatChip("JPG"));
    expect(screen.queryByText(warning)).toBeNull();

    // Rotate and the frame's corners stop being covered by the image.
    fireEvent.change(screen.getByLabelText("Rotation"), { target: { value: "30" } });
    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it("warns for an alpha-capable source even at zero rotation", async () => {
    await load("png");
    fireEvent.click(formatChip("JPG"));

    expect(screen.getByLabelText("Rotation")).toHaveValue("0");
    expect(screen.getByText(/no alpha channel/i)).toBeInTheDocument();
  });
});

describe("ImageCropperUI — the readout describes the run", () => {
  it("names the extension that was written, not the format that was asked for", async () => {
    cropImage.mockResolvedValue({
      blob: new Blob([new Uint8Array(64)]),
      fileName: "logo-cropped.jpg",
      originalSize: 3,
      newSize: 64,
      format: "jpeg",
    });

    await load();
    fireEvent.click(formatChip("JPG"));
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));

    // "JPG", the extension on the download — never "JPEG", which is what the
    // picker's own value is called.
    await waitFor(() => expect(screen.getByText("CROPPED · JPG")).toBeInTheDocument());
    expect(screen.queryByText(/JPEG/)).toBeNull();
    expect(screen.getByRole("button", { name: "Download logo-cropped.jpg" })).toBeInTheDocument();
  });

  it("shows the flatten notice the run reported, and nothing when it reported none", async () => {
    const notice = "Transparent areas were filled with white — JPG carries no alpha channel.";
    cropImage.mockResolvedValue({
      blob: new Blob([new Uint8Array(64)]),
      fileName: "logo-cropped.jpg",
      originalSize: 3,
      newSize: 64,
      format: "jpeg",
      warnings: [notice],
    });

    await load();
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    await waitFor(() => expect(screen.getByText(notice)).toBeInTheDocument());
  });

  it("says nothing about a flatten when the run reported none", async () => {
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Download / })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/filled with white/i)).toBeNull();
  });
});
