import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  WCAG 2.1.1 Keyboard (Level A) — crop-pdf.

  crop-pdf draws its frame with the same pointer-only library crop-image uses.
  cropperjs 1.6.2 carries no `keydown` listener, no `tabindex`, no `role` and no
  `aria-*` anywhere in `dist/cropper.js` (positive control:
  `mousedown|pointerdown` -> 3), so before the CROP FRAME fields the only
  frame-adjacent controls a keyboard user could reach were ASPECT and "Reset
  crop frame" — neither of which chooses WHICH part of the page to keep.

  What these tests pin:

  1. The four fields exist, are real number inputs with accessible names, and
     are inert until cropperjs can act on them (`setData` does nothing while
     `ready` is false, cropper.js:2581).
  2. They speak POINTS, the unit the PAGE 1 / CROP / IN MM readouts beside them
     already use — and they agree with those readouts to the point.
  3. The points -> canvas-pixel conversion uses the RIGHT AXIS for each field.
     The fixture below is deliberately non-proportional (a 1200 x 400 canvas
     over a 600 x 400 pt page: 2 px per point across, 1 px per point down)
     because a real render is proportional to within a truncated pixel, and
     under a proportional fixture an x/y axis swap is invisible.
  4. A typed number invalidates a finished run exactly as a drag does. The
     footer swaps the primary out for a Download the moment a result exists, so
     a frame change that did NOT drop it would leave the only downloadable file
     built from a rectangle the fields no longer describe — the measured defect
     `runGenerationRef` exists to close, reachable from the keyboard.

  The fake reproduces the contract those claims rest on: zeros until the first
  `crop` event, `setData` inert until ready, and `setData` dispatching `crop`
  with what it took (setData -> setCropBoxData -> renderCropBox -> output,
  cropper.js:2615 / 2722 / 1483-1489).
*/

const hoisted = vi.hoisted(() => {
  interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  class FakeCropper {
    static last: FakeCropper | null = null;
    static patches: Partial<Box>[] = [];
    ready = false;
    data: Box = { x: 0, y: 0, width: 0, height: 0 };
    options: { crop?: (event: { detail: Box }) => void };

    constructor(_el: HTMLImageElement, options: { crop?: (event: { detail: Box }) => void }) {
      this.options = options;
      FakeCropper.last = this;
    }

    getData() {
      return { ...this.data, rotate: 0, scaleX: 1, scaleY: 1 };
    }

    setData(patch: Partial<Box>) {
      FakeCropper.patches.push(patch);
      if (!this.ready) return;
      this.emitCrop({ ...this.data, ...patch });
    }

    /** Stand-in for cropperjs reaching `ready`, and for every pointer drag. */
    emitCrop(box: Box) {
      this.ready = true;
      this.data = box;
      this.options.crop?.({ detail: { ...box } });
    }

    setAspectRatio() {}
    reset() {}
    destroy() {}
  }
  return { FakeCropper };
});

vi.mock("cropperjs", () => ({ default: hoisted.FakeCropper }));
vi.mock("cropperjs/dist/cropper.css", () => ({}));

const cropPdfPages = vi.fn();
const loadPdfjsDocument = vi.fn();
const renderPageFromDoc = vi.fn();

vi.mock("@/lib/tools/pdf-engine", () => ({
  cropPdfPages: (...args: unknown[]) => cropPdfPages(...args),
  loadPdfjsDocument: (...args: unknown[]) => loadPdfjsDocument(...args),
  renderPageFromDoc: (...args: unknown[]) => renderPageFromDoc(...args),
}));

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import { CropPdfUI } from "@/components/tools/CropPdfUI";

/** 2 canvas px per point across, 1 down — so the two axes are tellable apart. */
const PAGE = { width: 600, height: 400 };
const CANVAS = { width: 1200, height: 400 };
/** In canvas pixels: 50 x 40 pt at (50, 40) ... see the assertions below. */
const READY_BOX = { x: 100, y: 40, width: 600, height: 200 };

const FIELDS = ["x", "y", "width", "height"] as const;

function field(name: (typeof FIELDS)[number]): HTMLInputElement {
  return screen.getByLabelText(
    `Crop ${name} in points from the page's top-left corner`,
  ) as HTMLInputElement;
}

function makeFile(): File {
  const file = new File([new Uint8Array([1, 2, 3])], "doc.pdf", { type: "application/pdf" });
  // jsdom's File does not always carry arrayBuffer(); the component awaits it.
  Object.defineProperty(file, "arrayBuffer", {
    value: () => Promise.resolve(new ArrayBuffer(3)),
  });
  return file;
}

function primary(): HTMLButtonElement {
  return screen.getByRole("button", { name: /^Crop( \d+ pages?)?$/ }) as HTMLButtonElement;
}

async function loadPreview() {
  render(<CropPdfUI />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByAltText(/drag the handles/i);
  // Construction happens in an effect hanging off the preview, so awaiting the
  // <img> alone would leave every test below racing it.
  await waitFor(() => expect(hoisted.FakeCropper.last).not.toBeNull());
}

/** Take cropperjs all the way to a painted frame. */
async function loadReady(box = READY_BOX) {
  await loadPreview();
  act(() => hoisted.FakeCropper.last!.emitCrop(box));
  await waitFor(() => expect(field("width")).toBeEnabled());
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.FakeCropper.last = null;
  hoisted.FakeCropper.patches = [];
  loadPdfjsDocument.mockResolvedValue({
    numPages: 3,
    getPage: vi.fn().mockResolvedValue({ getViewport: () => ({ ...PAGE }) }),
    destroy: vi.fn().mockResolvedValue(undefined),
  });
  renderPageFromDoc.mockResolvedValue({
    width: CANVAS.width,
    height: CANVAS.height,
    toDataURL: () => "data:image/jpeg;base64,AA",
  });
});

describe("CropPdfUI — the crop frame is reachable without a mouse", () => {
  it("gives the frame four labelled number fields", async () => {
    await loadReady();

    for (const name of FIELDS) {
      const input = field(name);
      expect(input.tagName).toBe("INPUT");
      expect(input).toHaveAttribute("type", "number");
      expect(input).toBeEnabled();
      expect(input).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("keeps the fields inert until cropperjs can act on them", async () => {
    await loadPreview();

    for (const name of FIELDS) {
      expect(field(name)).toBeDisabled();
      expect(field(name)).toHaveValue(null);
    }

    act(() => hoisted.FakeCropper.last!.emitCrop(READY_BOX));
    await waitFor(() => expect(field("width")).toBeEnabled());
  });

  it("reads in points, and says the same thing the CROP readout says", async () => {
    await loadReady();

    // 1200 canvas px over a 600 pt page is 2 px per point; 400 over 400 is 1.
    expect(field("x")).toHaveValue(READY_BOX.x / 2);
    expect(field("y")).toHaveValue(READY_BOX.y / 1);
    expect(field("width")).toHaveValue(READY_BOX.width / 2);
    expect(field("height")).toHaveValue(READY_BOX.height / 1);

    // The fields and the readouts are the same rectangle in the same unit.
    expect(screen.getAllByText("300 × 200 PT").length).toBeGreaterThan(0);
  });

  it("converts each field on its own axis before handing it to cropperjs", async () => {
    await loadReady();
    hoisted.FakeCropper.patches = [];

    // 100 pt across is 200 canvas px; 100 pt down is 100. A field wired to the
    // wrong axis lands on the other number.
    fireEvent.change(field("width"), { target: { value: "100" } });
    fireEvent.change(field("height"), { target: { value: "100" } });
    fireEvent.change(field("x"), { target: { value: "30" } });
    fireEvent.change(field("y"), { target: { value: "30" } });

    expect(hoisted.FakeCropper.patches).toEqual([
      { width: 200 },
      { height: 100 },
      { x: 60 },
      { y: 30 },
    ]);
    // And the fields read back what was typed, in points.
    expect(field("width")).toHaveValue(100);
    expect(field("height")).toHaveValue(100);
    expect(field("x")).toHaveValue(30);
    expect(field("y")).toHaveValue(30);
  });

  it("crops the region the fields were typed into", async () => {
    cropPdfPages.mockResolvedValue(new Uint8Array([37]));
    await loadReady();

    fireEvent.change(field("width"), { target: { value: "120" } });
    fireEvent.change(field("height"), { target: { value: "80" } });
    fireEvent.click(primary());

    await waitFor(() => expect(cropPdfPages).toHaveBeenCalledTimes(1));
    const rect = cropPdfPages.mock.calls[0][1] as Record<string, number>;
    expect(rect.width).toBeCloseTo(120, 6);
    expect(rect.height).toBeCloseTo(80, 6);
    // x is unchanged at 50 pt; y is the PDF frame's bottom-left origin, so the
    // 80 pt-tall frame 40 pt down a 400 pt page sits 280 pt up from the bottom.
    expect(rect.x).toBeCloseTo(50, 6);
    expect(rect.y).toBeCloseTo(PAGE.height - (40 + 80), 6);
  });

  it("drops a finished run when a field is typed into, exactly as a drag does", async () => {
    cropPdfPages.mockResolvedValue(new Uint8Array([37]));
    await loadReady();

    fireEvent.click(primary());
    const download = await screen.findByRole("button", { name: "Download doc-cropped.pdf" });
    expect(download).toBeInTheDocument();

    fireEvent.change(field("x"), { target: { value: "75" } });

    // The bytes describe a frame the fields no longer show, so they are gone.
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Download / })).toBeNull());
    expect(primary()).toBeEnabled();
  });
});
