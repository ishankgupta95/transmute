import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `cropImage` no longer reconstructs the crop transform — cropperjs renders the
 * region and this module encodes it. What is worth pinning is therefore the
 * encoding contract: PNG output, the `-cropped` naming, and honest sizes.
 *
 * The tests this file used to carry asserted the *old* hand-rolled transform:
 * that a rotated source produced an intermediate bounding-box canvas and that
 * `drawImage` was called with `getData()`'s x/y against it. That behaviour was
 * the bug — those coordinates are measured against the rotated on-screen canvas
 * while being expressed in unrotated natural pixels, so the region cut was
 * offset from the one the user selected. Tests that describe a broken transform
 * are worse than no tests, so they are gone rather than re-pinned.
 */

const mockCanvasToBlob = vi.hoisted(() => vi.fn());

vi.mock("@/lib/tools/canvas-utils", () => ({
  canvasToBlob: mockCanvasToBlob,
}));

import { cropImage } from "@/lib/tools/image-crop";

function makeCanvas(width = 100, height = 80): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function makeFile(name: string, size = 4096): File {
  const file = new File(["source-bytes"], name, { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("cropImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvasToBlob.mockResolvedValue(
      new Blob([new Uint8Array(512)], { type: "image/png" }),
    );
  });

  it("encodes the canvas cropperjs rendered, untouched", async () => {
    const canvas = makeCanvas(640, 480);
    await cropImage(canvas, makeFile("photo.jpg"));

    // The exact canvas is handed through — no intermediate redraw that could
    // shift the region.
    expect(mockCanvasToBlob).toHaveBeenCalledWith(canvas, "image/png", 1);
  });

  it("outputs PNG and appends -cropped to the name", async () => {
    const result = await cropImage(makeCanvas(), makeFile("photo.jpg"));

    expect(result.fileName).toBe("photo-cropped.png");
    expect(result.blob.type).toBe("image/png");
  });

  it("handles multi-dot filenames", async () => {
    const result = await cropImage(makeCanvas(), makeFile("my.photo.final.jpg"));

    expect(result.fileName).toBe("my.photo.final-cropped.png");
  });

  it("reports the source size as originalSize and the blob size as newSize", async () => {
    const result = await cropImage(makeCanvas(), makeFile("photo.jpg", 4096));

    expect(result.originalSize).toBe(4096);
    expect(result.newSize).toBe(512);
  });

  it("rejects when the canvas cannot be encoded", async () => {
    mockCanvasToBlob.mockRejectedValueOnce(new Error("Canvas export failed"));

    await expect(cropImage(makeCanvas(), makeFile("photo.jpg"))).rejects.toThrow(
      "Canvas export failed",
    );
  });
});
