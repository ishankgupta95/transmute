import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

/*
  watermark-image is six controls over one engine call, so the things worth
  pinning are the three a user can be lied to about:

    1. the chips offer exactly the six positions the protocol accepts, and the
       settings the rail shows are the settings that RUN — a watermark applied
       at 35% when the slider says 50% is invisible until someone compares two
       exports;
    2. changing anything after a run drops the finished download, so Download
       can never hand back a mark the rail no longer describes;
    3. "a watermark is not DRM". This page is read by people deciding whether a
       watermark protects their work. It does not, and the copy has to say so
       plainly rather than let the absence of a claim do the work. The copy
       assertions are paired — a positive over the sentence that must be there,
       a negative over the claims we must never make — because a negative alone
       passes just as happily on a render that produced nothing.

  Copy strings are duplicated rather than imported, so the test notices the
  constant changing.
*/

const CROP_IT_OFF = /anyone can crop it off, clone it out or paint over it/i;
const PREVIEW_FOOTNOTE = "THE PREVIEW REDRAWS AS YOU TYPE — APPLY ENCODES THE FILE";

const SOURCE_W = 1600;
const SOURCE_H = 900;

const editImage = vi.fn();
const drawEdit = vi.fn();

vi.mock("@/lib/workers/image-client", () => ({
  editImage: (...args: unknown[]) => editImage(...args),
}));

// Only `drawEdit` is replaced: `editOutputSize` and `needsOpaqueFill` stay
// real, so the preview's canvas size and the white-fill decision are the
// engine's, not this test's.
vi.mock("@/lib/tools/image-edit-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools/image-edit-core")>();
  return { ...actual, drawEdit: (...args: unknown[]) => drawEdit(...args) };
});

vi.mock("@/components/tools/DropZone", () => ({
  DropZone: ({ onFiles }: { onFiles: (files: File[]) => void }) => (
    <button onClick={() => onFiles([makeFile()])}>drop</button>
  ),
}));

import { WatermarkImageUI } from "@/components/tools/WatermarkImageUI";

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "print.png", { type: "image/png" });
}

function watermarkResult(): ProcessedResult {
  return {
    blob: new Blob([new Uint8Array(96)], { type: "image/png" }),
    fileName: "print-watermarked.png",
    originalSize: 3,
    newSize: 96,
  };
}

/**
 * A 2D context stand-in. jsdom has none, and the component (correctly) draws
 * nothing without one — so without this the preview effect and the real
 * `imageHasTransparency` probe would both be skipped and the alpha-derived
 * copy could never be exercised. Unknown members answer with a no-op function,
 * which is every 2D call this file does not care about.
 */
function fakeContext(alpha: number) {
  const target: Record<string, unknown> = {
    canvas: { width: SOURCE_W, height: SOURCE_H },
    getImageData: () => ({ data: new Uint8ClampedArray([9, 9, 9, alpha]) }),
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
  render(<WatermarkImageUI acceptFormats=".jpg,.jpeg,.png,.webp,.bmp,.gif,.avif" />);
  fireEvent.click(screen.getByText("drop"));
  // The rail cannot state the source size until the decode lands.
  await waitFor(() => expect(screen.getByText(`${SOURCE_W}×${SOURCE_H}`)).toBeInTheDocument());
}

function sentOptions() {
  return editImage.mock.calls[0][1] as {
    edit: Record<string, unknown>;
    format: string;
    quality: number;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("Image", StubImage);
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
  stubContext(255);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WatermarkImageUI — the mark on screen is the mark that runs", () => {
  it("offers exactly the six positions the protocol accepts", async () => {
    await loadFile();

    const group = screen.getByRole("group", { name: "Watermark position" });
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "Bottom right",
      "Bottom left",
      "Top right",
      "Top left",
      "Centre",
      "Tiled",
    ]);
    // Bottom right is the default and the header says so before anything runs.
    expect(screen.getByRole("button", { name: "Bottom right" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("BOTTOM RIGHT")).toBeInTheDocument();
  });

  it("sends every setting the rail is showing", async () => {
    editImage.mockResolvedValue(watermarkResult());
    await loadFile();

    fireEvent.change(screen.getByLabelText("Watermark text"), {
      target: { value: "© Ada Lovelace" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tiled" }));
    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Rotation"), { target: { value: "-45" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "0.12" } });
    fireEvent.change(screen.getByLabelText("Watermark colour"), { target: { value: "#ff0000" } });

    fireEvent.click(screen.getByRole("button", { name: "Apply watermark" }));

    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(sentOptions()).toEqual({
      edit: {
        kind: "watermark",
        text: "© Ada Lovelace",
        scale: 0.12,
        opacity: 0.5,
        colour: "#ff0000",
        position: "tile",
        rotationDeg: -45,
      },
      format: "png",
      quality: 0.9,
    });
  });

  it("shows the size and opacity it is about to use, as percentages", async () => {
    await loadFile();

    fireEvent.change(screen.getByLabelText("Opacity"), { target: { value: "0.5" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "0.12" } });

    // The strip and the slider readouts are the same two numbers.
    expect(screen.getAllByText("50%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12%").length).toBeGreaterThan(0);
    expect(screen.getByText(PREVIEW_FOOTNOTE)).toBeInTheDocument();
  });

  it("redraws the preview from the options it will send", async () => {
    editImage.mockResolvedValue(watermarkResult());
    await loadFile();

    fireEvent.change(screen.getByLabelText("Watermark text"), { target: { value: "DRAFT" } });
    await waitFor(() => expect(drawEdit).toHaveBeenCalled());

    const drawn = drawEdit.mock.calls[drawEdit.mock.calls.length - 1][2];
    expect(drawn).toMatchObject({ kind: "watermark", text: "DRAFT" });

    fireEvent.click(screen.getByRole("button", { name: "Apply watermark" }));
    await waitFor(() => expect(editImage).toHaveBeenCalledTimes(1));
    expect(sentOptions().edit).toEqual(drawn);
  });

  it("refuses to run an empty watermark", async () => {
    await loadFile();

    fireEvent.change(screen.getByLabelText("Watermark text"), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "Apply watermark" })).toBeDisabled();
  });
});

describe("WatermarkImageUI — a finished download never outlives its settings", () => {
  it("drops the download when the position changes under it", async () => {
    editImage.mockResolvedValue(watermarkResult());
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "Apply watermark" }));
    expect(
      await screen.findByRole("button", { name: "Download print-watermarked.png" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Centre" }));

    // The rail now says Centre; the file behind Download was built bottom-right.
    expect(screen.queryByRole("button", { name: /^Download / })).toBeNull();
    expect(screen.getByRole("button", { name: "Apply watermark" })).toBeInTheDocument();
  });
});

describe("WatermarkImageUI — the copy refuses to imply protection", () => {
  it("says outright that the mark can be removed", async () => {
    await loadFile();

    expect(screen.getByText(CROP_IT_OFF)).toBeInTheDocument();
    expect(screen.getByText(/treat it as a visible credit/i)).toBeInTheDocument();
  });

  it("makes none of the protection claims a drawn watermark cannot support", async () => {
    await loadFile();
    const surface = document.body.textContent ?? "";

    // Paired with the positive above: a negative search alone passes just as
    // happily on a page that rendered nothing.
    expect(surface).toMatch(CROP_IT_OFF);
    for (const lie of [
      /prevents? (copying|theft|reuse|downloading)/i,
      /copy protection/i,
      /cannot be removed/i,
      /tamper.?proof/i,
      /proves? ownership/i,
      /copyright protection/i,
    ]) {
      expect(surface, `the surface claims ${lie}`).not.toMatch(lie);
    }
  });

  it("stays quiet about the white fill when the decoded source is opaque", async () => {
    stubContext(255);
    await loadFile();

    // The ADVANCED row is about the FORMAT: JPG always fills, alpha or not.
    expect(screen.getByText("PRESERVED")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "JPG" }));
    expect(screen.getByText("WHITE FILL")).toBeInTheDocument();

    // The warning is about the SOURCE, and this one has nothing to lose.
    expect(screen.queryByText(/JPG has no alpha channel/i)).toBeNull();
  });

  it("warns about the white fill when the decoded source really carries alpha", async () => {
    // Same .png file as the opaque case; only the pixels the probe reads
    // differ, so the warning cannot be coming from the extension.
    stubContext(128);
    await loadFile();

    fireEvent.click(screen.getByRole("button", { name: "JPG" }));

    expect(screen.getByText(/JPG has no alpha channel/i)).toBeInTheDocument();
    expect(screen.getByText("WHITE FILL")).toBeInTheDocument();
  });
});
