import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  WCAG 2.1.1 Keyboard (Level A) — crop-image.

  cropperjs 1.6.2 is a pointer-only library. Verified against the installed
  copy: `grep -c keydown node_modules/cropperjs/dist/cropper.js` -> 0, tabindex
  -> 0, `aria-` -> 0, `role=` -> 0, against a positive control of
  `mousedown|pointerdown` -> 3. Nothing in the frame it draws can be focused,
  moved or resized without a mouse, so before the CROP BOX fields the ONLY
  region-adjacent controls a keyboard user could reach were ASPECT (which
  recentres a fresh 80% box) and Rotation. Choosing WHICH region to keep — the
  entire tool — was unreachable.

  What these tests pin, and each of them fails if the fix is removed:

  1. The four fields exist, are real number inputs, and carry accessible names.
  2. They are DEAD until cropperjs is ready. `setData` returns without doing
     anything while `ready` is false (cropper.js:2581), so a field that looked
     live before then would swallow a typed number in silence.
  3. Typing sends exactly ONE key to `setData`. Handing the whole rectangle back
     re-writes three numbers nobody touched and walks the frame by the display
     rounding on every keystroke.
  4. The fields and the drag are ONE rectangle: a frame moved by the pointer
     shows up in the fields, and a number the frame cannot honour comes back
     clamped, rather than the field and the frame drifting apart.

  The fake below reproduces the parts of the real contract those claims rest
  on: zeros until the first `crop` event, `setData` inert until ready, `setData`
  clamping to the image and then dispatching `crop` with what it actually took
  (setData -> setCropBoxData -> renderCropBox -> output, cropper.js:2615 / 2722
  / 1462-1466 / 1483-1489).
*/

const hoisted = vi.hoisted(() => {
  interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  /** The image cropperjs is standing over, in its own pixels. */
  const NATURAL = { width: 1200, height: 800 };

  class FakeCropper {
    static last: FakeCropper | null = null;
    /** Every patch handed to `setData`, in order. */
    static patches: Partial<Box>[] = [];
    /** False until the cloned image has decoded — `getData()` lies until then. */
    ready = false;
    data: Box = { x: 0, y: 0, width: 0, height: 0 };
    options: { crop?: (event: { detail: Box }) => void };
    canvas = { width: 100, height: 80 } as unknown as HTMLCanvasElement;

    constructor(_el: HTMLImageElement, options: { crop?: (event: { detail: Box }) => void }) {
      this.options = options;
      FakeCropper.last = this;
    }

    getData() {
      return { ...this.data, rotate: 0, scaleX: 1, scaleY: 1 };
    }

    setData(patch: Partial<Box>) {
      FakeCropper.patches.push(patch);
      // cropper.js:2581 — the whole method is inside `if (this.ready ...)`.
      if (!this.ready) return;
      const next = { ...this.data, ...patch };
      // renderCropBox clamps before it paints and before it reports.
      next.x = Math.min(Math.max(0, next.x), NATURAL.width);
      next.y = Math.min(Math.max(0, next.y), NATURAL.height);
      next.width = Math.min(next.width, NATURAL.width - next.x);
      next.height = Math.min(next.height, NATURAL.height - next.y);
      this.emitCrop(next);
    }

    /** Stand-in for cropperjs reaching `ready` and for every pointer drag. */
    emitCrop(box: Box) {
      this.ready = true;
      this.data = box;
      this.options.crop?.({ detail: { ...box } });
    }

    getCroppedCanvas() {
      return this.canvas;
    }
    setAspectRatio() {}
    rotate() {}
    destroy() {}
  }
  return { FakeCropper, NATURAL };
});

vi.mock("cropperjs", () => ({ default: hoisted.FakeCropper }));
vi.mock("cropperjs/dist/cropper.css", () => ({}));

const cropImage = vi.fn();
vi.mock("@/lib/tools/image-crop", () => ({
  cropImage: (...args: unknown[]) => cropImage(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import { ImageCropperUI } from "@/components/tools/ImageCropperUI";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
}

/** The four fields, by the accessible name a screen-reader user hears. */
const FIELDS = ["x", "y", "width", "height"] as const;

function field(name: (typeof FIELDS)[number]): HTMLInputElement {
  return screen.getByLabelText(`Crop ${name} in image pixels`) as HTMLInputElement;
}

/** Mount, drop a file, and wait for the cropper to be constructed against it. */
async function load() {
  render(<ImageCropperUI acceptFormats=".jpg,.jpeg,.png,.webp" />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByAltText("Crop preview");
  await waitFor(() => expect(hoisted.FakeCropper.last).not.toBeNull());
}

/** Mount and take cropperjs all the way to a painted frame. */
async function loadReady(box = { x: 100, y: 50, width: 400, height: 300 }) {
  await load();
  act(() => hoisted.FakeCropper.last!.emitCrop(box));
  await waitFor(() => expect(field("width")).toBeEnabled());
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.FakeCropper.last = null;
  hoisted.FakeCropper.patches = [];
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

describe("ImageCropperUI — the crop box is reachable without a mouse", () => {
  it("gives the region four labelled number fields", async () => {
    await loadReady();

    for (const name of FIELDS) {
      const input = field(name);
      expect(input.tagName).toBe("INPUT");
      expect(input).toHaveAttribute("type", "number");
      // Operable: in the tab order, not inert.
      expect(input).toBeEnabled();
      expect(input).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("keeps the fields inert until cropperjs can act on them", async () => {
    await load();

    // The <img> is on screen and the Cropper is constructed, but no `crop`
    // event has fired: `setData` would be a silent no-op right now.
    for (const name of FIELDS) {
      expect(field(name)).toBeDisabled();
      expect(field(name)).toHaveValue(null);
    }

    act(() => hoisted.FakeCropper.last!.emitCrop({ x: 0, y: 0, width: 960, height: 640 }));
    await waitFor(() => expect(field("width")).toBeEnabled());
    expect(field("width")).toHaveValue(960);
  });

  it("sends only the field that was typed", async () => {
    await loadReady({ x: 100, y: 50, width: 400, height: 300 });
    hoisted.FakeCropper.patches = [];

    fireEvent.change(field("width"), { target: { value: "300" } });

    expect(hoisted.FakeCropper.patches).toEqual([{ width: 300 }]);
    expect(field("width")).toHaveValue(300);
    // The three numbers nobody touched are still the ones the frame had.
    expect(field("x")).toHaveValue(100);
    expect(field("y")).toHaveValue(50);
    expect(field("height")).toHaveValue(300);
  });

  it("moves the frame from each of the four fields", async () => {
    await loadReady({ x: 0, y: 0, width: 400, height: 300 });

    fireEvent.change(field("x"), { target: { value: "25" } });
    fireEvent.change(field("y"), { target: { value: "40" } });
    fireEvent.change(field("width"), { target: { value: "128" } });
    fireEvent.change(field("height"), { target: { value: "96" } });

    // What cropperjs itself is holding — not just what the inputs display.
    expect(hoisted.FakeCropper.last!.getData()).toMatchObject({
      x: 25,
      y: 40,
      width: 128,
      height: 96,
    });
  });

  it("shows the frame a drag produced, so the fields and the pointer agree", async () => {
    await loadReady({ x: 0, y: 0, width: 400, height: 300 });

    // Exactly what a pointer drag does: cropperjs reports the new rectangle.
    act(() => hoisted.FakeCropper.last!.emitCrop({ x: 12, y: 34, width: 200, height: 150 }));

    await waitFor(() => expect(field("x")).toHaveValue(12));
    expect(field("y")).toHaveValue(34);
    expect(field("width")).toHaveValue(200);
    expect(field("height")).toHaveValue(150);
  });

  it("shows the number the frame took, not the number that was typed", async () => {
    await loadReady({ x: 200, y: 0, width: 400, height: 300 });

    // 5000 px wide is impossible on a 1200 px image with the box at x=200.
    fireEvent.change(field("width"), { target: { value: "5000" } });

    await waitFor(() => expect(field("width")).toHaveValue(hoisted.NATURAL.width - 200));
    expect(hoisted.FakeCropper.last!.getData().width).toBe(hoisted.NATURAL.width - 200);
  });

  it("drops the previous image's rectangle when a new file is dropped", async () => {
    await loadReady({ x: 10, y: 20, width: 400, height: 300 });
    expect(field("x")).toHaveValue(10);

    fireEvent.click(screen.getByRole("button", { name: "CANCEL" }));
    fireEvent.click(screen.getByText("drop"));
    await screen.findByAltText("Crop preview");

    // A fresh cropper is still building; showing the old numbers would invite a
    // keystroke that goes nowhere.
    expect(field("x")).toBeDisabled();
    expect(field("x")).toHaveValue(null);
  });
});
