import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

/*
  REGRESSION GUARDS for two measured defects in crop-pdf.

  F4 — the Crop primary used to be gated on `preview` alone, which is set in
  the same commit that first renders the <img>. cropperjs is constructed one
  passive effect later and only becomes usable when the CLONED image finishes
  decoding, and until then `getData()` returns a hard-coded {0,0,0,0} with no
  throw and no signal (cropper.js:2533-2561, v1.6.2). `toPdfRect` mapped that
  to a zero-width rect, `cropPdfPages` skipped every page on `intersectRect`
  returning null, and the footer presented the untouched document as
  "Done in N ms" with a `<name>-cropped.pdf` to save. Measured window between
  button-enable and frame-painted in headless Chromium: 10-15 ms on an A4,
  52-62 ms on a large first page, ~40 ms at 6x CPU throttle; a click placed on
  the first enabled frame reproduced the no-op file 4/4.

  F1 (crop-pdf's shape of it) — the `crop` handler's invalidation was
  `setStatus((s) => (s === "done" ? "idle" : s))`, which is inert while a run
  is in flight because the status is "processing" and never "done". The engine
  runs in a worker, so the frame stays draggable for the whole run: move it
  mid-run and every readout describes the new rectangle while the download
  that lands carries the one captured at click time.

  The fake Cropper below reproduces exactly the readiness contract of the real
  one: `getData()` returns zeros until a `crop` event has been dispatched, and
  the real cropperjs only dispatches that from `build()` -> `crop()` -> after
  `this.ready = true` and `this.cropped = true` (cropper.js:3199-3203,
  2240-2249), which is what makes `cropBox` a sound readiness signal.
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
    /** Zeros until the first `crop` event, exactly like the real one. */
    data: Box = { x: 0, y: 0, width: 0, height: 0 };
    options: { crop?: (e: { detail: Box }) => void };
    constructor(_el: HTMLImageElement, options: { crop?: (e: { detail: Box }) => void }) {
      this.options = options;
      FakeCropper.last = this;
    }
    getData() {
      return this.data;
    }
    setAspectRatio() {}
    reset() {}
    destroy() {}
    /** Stand-in for cropperjs reaching `ready` and painting the frame. */
    emitCrop(box: Box) {
      this.data = box;
      this.options.crop?.({ detail: box });
    }
    /** Force the degenerate return without a `crop` event, to test the bail-out. */
    goStale() {
      this.data = { x: 0, y: 0, width: 0, height: 0 };
    }
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

const A4 = { width: 595.28, height: 841.89 };
/** The frame cropperjs would report once ready — in natural-image pixels. */
const READY_BOX = { x: 50, y: 60, width: 800, height: 1000 };

const deferred = () => {
  let resolve!: (v: Uint8Array) => void;
  const promise = new Promise<Uint8Array>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

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

/** Drop a file and wait for the preview <img> — the exact moment F4 opened. */
async function loadPreview() {
  render(<CropPdfUI />);
  fireEvent.click(screen.getByText("drop"));
  await screen.findByAltText(/drag the handles/i);
  // The <img> mounting and the Cropper being CONSTRUCTED are two different
  // moments: construction happens in an effect hanging off the image's load,
  // so awaiting the alt text alone leaves every test below racing it. Under a
  // 181-file parallel run that race started losing — the file passes 4/4 in
  // isolation and failed in the full suite. Waiting for the precondition the
  // tests actually depend on removes the race, rather than widening the window
  // it happens in, which a longer timeout would only do.
  await waitFor(() => expect(hoisted.FakeCropper.last).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.FakeCropper.last = null;
  loadPdfjsDocument.mockResolvedValue({
    numPages: 5,
    getPage: vi.fn().mockResolvedValue({ getViewport: () => ({ ...A4 }) }),
    destroy: vi.fn().mockResolvedValue(undefined),
  });
  renderPageFromDoc.mockResolvedValue({
    width: 1000,
    height: 1414,
    toDataURL: () => "data:image/jpeg;base64,AA",
  });
});

describe("CropPdfUI — a crop is only ever offered for a real, current frame", () => {
  it("keeps the primary disabled until cropperjs has painted a frame", async () => {
    await loadPreview();

    // The <img> is on screen and the Cropper has been constructed, but no
    // `crop` event has fired: getData() is still {0,0,0,0}.
    expect(hoisted.FakeCropper.last).not.toBeNull();
    expect(hoisted.FakeCropper.last!.getData()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(primary()).toBeDisabled();

    // Clicking anyway must not start a run.
    fireEvent.click(primary());
    expect(cropPdfPages).not.toHaveBeenCalled();

    // Once the frame exists the button opens.
    act(() => hoisted.FakeCropper.last!.emitCrop(READY_BOX));
    await waitFor(() => expect(primary()).toBeEnabled());
  });

  it("refuses a degenerate rect instead of selling a no-op file as a crop", async () => {
    await loadPreview();
    act(() => hoisted.FakeCropper.last!.emitCrop(READY_BOX));
    await waitFor(() => expect(primary()).toBeEnabled());

    // The cropper goes back to reporting zeros without a `crop` event — the
    // shape the readiness gate alone cannot see.
    hoisted.FakeCropper.last!.goStale();
    fireEvent.click(primary());

    await waitFor(() =>
      expect(screen.getByText(/crop frame is not ready yet/i)).toBeInTheDocument(),
    );
    // Nothing ran, and nothing is downloadable.
    expect(cropPdfPages).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
  });

  it("drops an in-flight run when the frame is moved", async () => {
    const run = deferred();
    cropPdfPages.mockReturnValueOnce(run.promise);
    await loadPreview();
    act(() => hoisted.FakeCropper.last!.emitCrop(READY_BOX));
    await waitFor(() => expect(primary()).toBeEnabled());

    fireEvent.click(primary());
    await waitFor(() => expect(cropPdfPages).toHaveBeenCalledTimes(1));

    // Mid-run drag: this is the whole defect.
    act(() => hoisted.FakeCropper.last!.emitCrop({ x: 10, y: 20, width: 400, height: 500 }));
    run.resolve(new Uint8Array([37]));

    await waitFor(() => expect(primary()).toBeEnabled());
    // The bytes were built from the OLD frame; the screen shows the new one.
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
  });

  it("still publishes the download when nothing touched the frame", async () => {
    const run = deferred();
    cropPdfPages.mockReturnValueOnce(run.promise);
    await loadPreview();
    act(() => hoisted.FakeCropper.last!.emitCrop(READY_BOX));
    await waitFor(() => expect(primary()).toBeEnabled());

    fireEvent.click(primary());
    await waitFor(() => expect(cropPdfPages).toHaveBeenCalledTimes(1));
    // The rect the engine was handed is the one on screen, in visual points:
    // the 1000 x 1414 canvas maps to a 595.28 x 841.89 page, so the 800 x 1000
    // pixel box is 476.2 x 595.1 pt with its origin flipped to the bottom-left.
    const rect = cropPdfPages.mock.calls[0][1] as Record<string, number>;
    expect(rect.width).toBeCloseTo(800 / (1000 / 595.28), 3);
    expect(rect.height).toBeCloseTo(1000 / (1414 / 841.89), 3);

    run.resolve(new Uint8Array([37]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download doc-cropped.pdf" })).toBeInTheDocument(),
    );
  });
});
