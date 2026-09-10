import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MAX_PIXELATE_BLOCK, MIN_PIXELATE_BLOCK } from "@/lib/tools/image-edit-core";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

/*
  pixelate-image has one control the user can be lied to about in a way that
  matters, and one claim that could cause real harm:

    1. THE REGION. It is drawn on a canvas that is scaled to fit the stage, and
       it is reported and sent in the image's OWN pixels. `image-crop.ts:4-20`
       records what happens when those two spaces are confused — cropperjs
       measured the selection against the on-screen canvas, reported it in
       natural pixels, and cut a region nobody had chosen. The test below
       deliberately shows a 1200×800 image in a 600×400 box so a component that
       forgot the conversion produces exactly half of every number.

    2. THE BLOCK SIZE that gets used, after the engine's clamp — not the number
       the slider happened to hold.

    3. "PIXELATION IS NOT REDACTION". A user who reads this page as a promise of
       safety and posts a pixelated passport number is the failure mode. The
       copy assertions are paired: a negative search for the claims we must not
       make, and a positive search for the sentence that must be there, because
       a negative alone passes just as happily on an empty render.

  Copy strings are duplicated rather than imported, so the test notices the
  constant changing.
*/

const BRUTE_FORCE_SENTENCE =
  /every candidate can be re-rendered at the same block size and matched against these blocks/i;
const OUTLINE_FOOTNOTE = "THE DASHED OUTLINE MARKS THE REGION AND IS NOT DRAWN INTO THE DOWNLOAD";
const WHOLE_IMAGE_FOOTNOTE =
  "DRAG ON THE PREVIEW TO PIXELATE ONE REGION — WITH NONE SET, THE WHOLE IMAGE IS PIXELATED";

/** The source is shown at half size, so screen pixels and image pixels differ. */
const SOURCE_W = 1200;
const SOURCE_H = 800;
const BOX_W = 600;
const BOX_H = 400;

const editImage = vi.fn();
const drawEdit = vi.fn();

vi.mock("@/lib/workers/image-client", () => ({
  editImage: (...args: unknown[]) => editImage(...args),
}));

// Only `drawEdit` is replaced: the clamps, `editOutputSize` and
// `needsOpaqueFill` stay real, so a change to any of them shows up here.
vi.mock("@/lib/tools/image-edit-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/image-edit-core")>();
  return { ...actual, drawEdit: (...args: unknown[]) => drawEdit(...args) };
});

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import { PixelateImageUI } from "@/components/tools/PixelateImageUI";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "receipt.png", { type: "image/png" });
}

function pixelateResult(): ProcessedResult {
  return {
    blob: new Blob([new Uint8Array(64)], { type: "image/png" }),
    fileName: "receipt-pixelated.png",
    originalSize: 3,
    newSize: 64,
  };
}

/**
 * A 2D context stand-in. jsdom has none, and the component (correctly) draws
 * nothing without one — so without this the preview effect, `fillBackground`
 * and the real `imageHasTransparency` probe would all be skipped and the
 * alpha-derived copy could never be exercised. Unknown members answer with a
 * no-op function, which is every 2D call this file does not care about.
 */
const strokes: number[][] = [];

function fakeContext(alpha: number) {
  const target: Record<string, unknown> = {
    canvas: { width: SOURCE_W, height: SOURCE_H },
    getImageData: () => ({ data: new Uint8ClampedArray([9, 9, 9, alpha]) }),
    // The dashed selection outline is the one draw the COMPONENT makes itself
    // (`drawEdit` is mocked), and the only place it can be caught putting a
    // natural-pixel rectangle onto a canvas that is not in natural pixels.
    strokeRect: (...args: number[]) => strokes.push(args),
  };
  return new Proxy(target, {
    get: (t, prop: string) => (prop in t ? t[prop] : () => undefined),
    set: (t, prop: string, value) => {
      t[prop] = value;
      return true;
    },
  });
}

function stubContext(alpha: number) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => fakeContext(alpha)) as unknown as HTMLCanvasElement["getContext"],
  );
}

class StubImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = SOURCE_W;
  naturalHeight = SOURCE_H;
  width = SOURCE_W;
  height = SOURCE_H;
  set src(_value: string) {
    // Asynchronous, like a real decode: the component may only write state
    // from the load callback, never from the effect body.
    queueMicrotask(() => this.onload?.());
  }
}

async function loadFile() {
  render(<PixelateImageUI acceptFormats=".jpg,.jpeg,.png,.webp,.bmp,.gif,.avif" />);
  fireEvent.click(screen.getByText("drop"));
  // The rail cannot state the source size until the decode lands.
  await waitFor(() => expect(screen.getByText(`${SOURCE_W}×${SOURCE_H}`)).toBeInTheDocument());
}

function previewCanvas(): HTMLCanvasElement {
  const canvas = screen.getByLabelText(/Pixelation preview/) as HTMLCanvasElement;
  // The stage scales the canvas down to fit. This is the whole point of the
  // region tests: on screen it is 600×400, in its own pixels it is 1200×800.
  canvas.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: BOX_W,
      bottom: BOX_H,
      width: BOX_W,
      height: BOX_H,
      toJSON: () => ({}),
    }) as DOMRect;
  return canvas;
}

function dragOnPreview(from: [number, number], to: [number, number]) {
  const canvas = previewCanvas();
  fireEvent.pointerDown(canvas, { clientX: from[0], clientY: from[1], pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: to[0], clientY: to[1], pointerId: 1 });
}

function regionField(name: "x" | "y" | "width" | "height"): HTMLInputElement {
  return screen.getByLabelText(`Region ${name} in image pixels`) as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  strokes.length = 0;
  vi.stubGlobal("Image", StubImage);
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
  stubContext(255);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PixelateImageUI — the region is measured in the image's own pixels", () => {
  it("converts a drag on the scaled preview into natural pixels", async () => {
    await loadFile();

    // 100,50 → 250,150 on a canvas drawn at half size is 200,100 → 500,300 in
    // the image. A component that skipped the conversion would report 150×100.
    dragOnPreview([100, 50], [250, 150]);

    expect(regionField("x")).toHaveValue(200);
    expect(regionField("y")).toHaveValue(100);
    expect(regionField("width")).toHaveValue(300);
    expect(regionField("height")).toHaveValue(200);
    expect(screen.getByText("300 × 200")).toBeInTheDocument();
    expect(screen.getByText(OUTLINE_FOOTNOTE)).toBeInTheDocument();
  });

  it("hands the engine the same rectangle the rail is showing", async () => {
    editImage.mockResolvedValue(pixelateResult());
    await loadFile();
    dragOnPreview([100, 50], [250, 150]);

    fireEvent.click(screen.getByRole("button", { name: "Pixelate" }));

    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(editImage.mock.calls[0][1]).toEqual({
      edit: { kind: "pixelate", region: { x: 200, y: 100, width: 300, height: 200 }, blockSize: 16 },
      format: "png",
      quality: 0.9,
    });
  });

  it("redraws the preview from the region it will send, not a stale one", async () => {
    editImage.mockResolvedValue(pixelateResult());
    await loadFile();
    dragOnPreview([100, 50], [250, 150]);
    await waitFor(() => expect(drawEdit).toHaveBeenCalled());

    // The preview and the download come out of the same `drawEdit`, so the
    // options behind the last redraw must be the options behind the run.
    const drawn = drawEdit.mock.calls[drawEdit.mock.calls.length - 1][2];
    expect(drawn).toEqual({
      kind: "pixelate",
      region: { x: 200, y: 100, width: 300, height: 200 },
      blockSize: 16,
    });

    fireEvent.click(screen.getByRole("button", { name: "Pixelate" }));
    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect((editImage.mock.calls[0][1] as { edit: unknown }).edit).toEqual(drawn);
  });

  it("clamps a typed region to the image instead of trusting the number", async () => {
    await loadFile();
    dragOnPreview([100, 50], [250, 150]);

    fireEvent.change(regionField("width"), { target: { value: "9999" } });

    // x is 200, so the widest the region can be is 1000.
    expect(regionField("width")).toHaveValue(SOURCE_W - 200);
    expect(screen.getByText(`${SOURCE_W - 200} × 200`)).toBeInTheDocument();
  });

  it("reads a tap with no drag as going back to the whole image", async () => {
    await loadFile();
    dragOnPreview([100, 50], [250, 150]);
    expect(regionField("x")).toHaveValue(200);

    dragOnPreview([300, 200], [301, 200]);

    expect(regionField("x")).toHaveValue(null);
    expect(screen.getByText("WHOLE IMAGE")).toBeInTheDocument();
    expect(screen.getByText(WHOLE_IMAGE_FOOTNOTE)).toBeInTheDocument();
  });

  it("sends a null region when the whole image is pixelated", async () => {
    editImage.mockResolvedValue(pixelateResult());
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "Pixelate" }));

    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect((editImage.mock.calls[0][1] as { edit: { region: unknown } }).edit.region).toBeNull();
  });
});

describe("PixelateImageUI — the block size on screen is the block size that runs", () => {
  it("offers only block sizes the engine will not clamp", async () => {
    await loadFile();

    const slider = screen.getByLabelText("Block size");
    expect(slider).toHaveAttribute("min", String(MIN_PIXELATE_BLOCK));
    expect(slider).toHaveAttribute("max", String(MAX_PIXELATE_BLOCK));
  });

  it("reports the chosen size in the header, the strip and the engine call", async () => {
    editImage.mockResolvedValue(pixelateResult());
    await loadFile();

    fireEvent.change(screen.getByLabelText("Block size"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Pixelate" }));

    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect((editImage.mock.calls[0][1] as { edit: { blockSize: number } }).edit.blockSize).toBe(40);
    expect(screen.getByText("40 PX BLOCKS")).toBeInTheDocument();
    expect(screen.getAllByText("40 px").length).toBeGreaterThan(0);
  });
});

describe("PixelateImageUI — a finished download never outlives its settings", () => {
  it("drops the download when the region moves under it", async () => {
    editImage.mockResolvedValue(pixelateResult());
    await loadFile();
    dragOnPreview([100, 50], [250, 150]);

    fireEvent.click(screen.getByRole("button", { name: "Pixelate" }));
    expect(
      await screen.findByRole("button", { name: "Download receipt-pixelated.png" }),
    ).toBeInTheDocument();

    fireEvent.change(regionField("x"), { target: { value: "10" } });

    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByRole("button", { name: "Pixelate" })).toBeInTheDocument();
  });
});

describe("PixelateImageUI — the copy refuses to imply redaction", () => {
  it("states the brute-force limit in the rail, not in a footnote nobody opens", async () => {
    await loadFile();

    expect(screen.getByText(BRUTE_FORCE_SENTENCE)).toBeInTheDocument();
    expect(screen.getByText(/should be cropped out or covered with a solid shape/i)).toBeInTheDocument();
  });

  it("makes none of the safety claims this tool cannot support", async () => {
    await loadFile();
    const surface = document.body.textContent ?? "";

    // Paired with the positive above: a negative search alone passes just as
    // happily on a page that rendered nothing.
    expect(surface).toMatch(BRUTE_FORCE_SENTENCE);
    for (const lie of [
      /cannot be recovered/i,
      /impossible to recover/i,
      /irreversible/i,
      /securely/i,
      /safe to share/i,
      /redaction-grade/i,
      /anonymis|anonymiz/i,
    ]) {
      expect(surface, `the surface claims ${lie}`).not.toMatch(lie);
    }
  });

  it("stays quiet about the white fill when the decoded source is opaque", async () => {
    stubContext(255);
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "JPG" }));

    expect(screen.queryByText(/JPG has no alpha channel/i)).toBeNull();
  });

  it("warns about the white fill when the decoded source really carries alpha", async () => {
    // Same .png file as the opaque case; only the pixels the probe reads
    // differ, so the warning cannot be coming from the extension.
    stubContext(128);
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "JPG" }));

    expect(screen.getByText(/JPG has no alpha channel/i)).toBeInTheDocument();
  });
});

/** A decode stub of an arbitrary size, for the sources the canvas ceiling shrinks. */
function sizedImage(width: number, height: number) {
  return class extends StubImage {
    naturalWidth = width;
    naturalHeight = height;
    width = width;
    height = height;
  };
}

async function loadSized(width: number, height: number) {
  vi.stubGlobal("Image", sizedImage(width, height));
  render(<PixelateImageUI acceptFormats=".jpg,.jpeg,.png,.webp,.bmp,.gif,.avif" />);
  fireEvent.click(screen.getByText("drop"));
  await waitFor(() => expect(screen.getByText(`${width}×${height}`)).toBeInTheDocument());
}

function runShortcut() {
  // The rail advertises "⌘↵ TO RUN" and `ToolActions` binds it on the WINDOW,
  // so a run can be started without touching the footer — including mid-drag,
  // which is what these tests are about.
  fireEvent.keyDown(window, { key: "Enter", metaKey: true });
}

describe("PixelateImageUI — a drag that outlives a run", () => {
  it("drops a finished download when the drag keeps moving under it", async () => {
    editImage.mockResolvedValue(pixelateResult());
    await loadFile();
    const canvas = previewCanvas();

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 250, clientY: 150, pointerId: 1 });
    // Still holding the pointer down: run it from the keyboard.
    runShortcut();
    expect(
      await screen.findByRole("button", { name: "Download receipt-pixelated.png" }),
    ).toBeInTheDocument();

    // Still holding: drag somewhere else entirely and let go.
    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 350, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 500, clientY: 350, pointerId: 1 });

    // The rail now describes a different rectangle, so the blob built from the
    // first one must not still be behind a Download button.
    expect(regionField("width")).toHaveValue(800);
    expect(regionField("height")).toHaveValue(600);
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByRole("button", { name: "Pixelate" })).toBeInTheDocument();
  });

  it("refuses a result that lands after the region moved", async () => {
    // The same defect arriving from behind: the run is started mid-drag and
    // resolves AFTER the release. Dropping the blob on the move cannot help —
    // there is no blob yet — so the completion has to know it was superseded.
    let finish: (result: ProcessedResult) => void = () => undefined;
    editImage.mockReturnValue(
      new Promise<ProcessedResult>((resolve) => {
        finish = resolve;
      }),
    );
    await loadFile();
    const canvas = previewCanvas();

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 250, clientY: 150, pointerId: 1 });
    runShortcut();
    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(editImage.mock.calls[0][1].edit.region).toEqual({
      x: 200,
      y: 100,
      width: 300,
      height: 200,
    });

    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 350, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 500, clientY: 350, pointerId: 1 });
    finish(pixelateResult());
    await waitFor(() => expect(screen.getByRole("button", { name: "Pixelate" })).toBeEnabled());

    expect(regionField("width")).toHaveValue(800);
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    // …and the bar is not left spinning: a superseded run still owns the flag
    // it set, because no newer run took it over.
    expect(screen.queryByText("PIXELATING")).toBeNull();
  });

  it("stops tracking a gesture the canvas never gets a pointerup for", async () => {
    await loadFile();
    const canvas = previewCanvas();

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 50, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 250, clientY: 150, pointerId: 1 });
    expect(regionField("width")).toHaveValue(300);

    // A pointercancel — a system gesture taking over, or scrolling on touch.
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    // A plain hover afterwards, no button held.
    fireEvent.pointerMove(canvas, { clientX: 500, clientY: 350, pointerId: 1 });

    expect(regionField("x")).toHaveValue(200);
    expect(regionField("width")).toHaveValue(300);
    expect(regionField("height")).toHaveValue(200);
  });
});

describe("PixelateImageUI — the outline sits on the blocks, not beside them", () => {
  it("strokes the selection in the bitmap's pixels once the ceiling has shrunk it", async () => {
    // 12000×3000 plans to 8192×2048, so natural coordinates are NOT canvas
    // coordinates any more. The reviewer's case: a region in the right-hand
    // third, whose outline was previously stroked at x=9000 on an 8192-wide
    // bitmap — off the canvas entirely.
    await loadSized(12000, 3000);
    for (const [field, value] of [
      ["x", "9000"],
      ["y", "400"],
      ["width", "1200"],
      ["height", "600"],
    ] as const) {
      fireEvent.change(regionField(field), { target: { value } });
    }
    expect(regionField("x")).toHaveValue(9000);
    expect(regionField("height")).toHaveValue(600);

    const canvas = screen.getByLabelText(/Pixelation preview/) as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([8192, 2048]);

    const outline = strokes[strokes.length - 1];
    expect(outline, "the selection outline was never stroked").toBeDefined();
    const [x, y, w, h] = outline;
    // floor(9000·8192/12000)=6144, ceil(10200·8192/12000)=6964 → 820 wide;
    // floor(400·2048/3000)=273, ceil(1000·2048/3000)=683 → 410 tall. Both far
    // edges round OUTWARD, so the outline never sits inside the blocks.
    expect([x, y, w, h]).toEqual([6144, 273, 820, 410]);
    expect(x + w).toBeLessThanOrEqual(canvas.width);
    expect(y + h).toBeLessThanOrEqual(canvas.height);
  });

  it("still measures the DRAG in natural pixels, ceiling or no ceiling", async () => {
    // The counterpart to the outline: the region STATE stays in the image's
    // own pixels. The bitmap is 8192 wide and the natural image 12000, but the
    // preview box shows the whole picture either way, so a fraction of the box
    // is that same fraction of the natural width — no ceiling scale belongs in
    // `pointToNatural`, only in what gets painted onto the bitmap.
    editImage.mockResolvedValue(pixelateResult());
    await loadSized(12000, 3000);
    dragOnPreview([100, 50], [250, 150]);

    // 100/600 and 250/600 of 12000; 50/400 and 150/400 of 3000.
    expect(regionField("x")).toHaveValue(2000);
    expect(regionField("y")).toHaveValue(375);
    expect(regionField("width")).toHaveValue(3000);
    expect(regionField("height")).toHaveValue(750);

    fireEvent.click(screen.getByRole("button", { name: "Pixelate" }));
    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(editImage.mock.calls[0][1].edit.region).toEqual({
      x: 2000,
      y: 375,
      width: 3000,
      height: 750,
    });
  });

  it("strokes the natural rectangle unchanged when nothing was shrunk", async () => {
    await loadFile();
    dragOnPreview([100, 50], [250, 150]);

    const outline = strokes[strokes.length - 1];
    expect(outline).toEqual([200, 100, 300, 200]);
  });
});
