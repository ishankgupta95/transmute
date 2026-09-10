import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `cropImage` no longer reconstructs the crop transform — cropperjs renders the
 * region and this module encodes it. What is worth pinning is therefore the
 * encoding contract: the format the picker asked for, the `-cropped` naming,
 * honest sizes, and the opaque fill the lossy arm needs.
 *
 * The tests this file used to carry asserted the *old* hand-rolled transform:
 * that a rotated source produced an intermediate bounding-box canvas and that
 * `drawImage` was called with `getData()`'s x/y against it. That behaviour was
 * the bug — those coordinates are measured against the rotated on-screen canvas
 * while being expressed in unrotated natural pixels, so the region cut was
 * offset from the one the user selected. Tests that describe a broken transform
 * are worse than no tests, so they are gone rather than re-pinned.
 *
 * They also pinned PNG-only output, which was true until the shared
 * `OutputFormatPicker` landed. PNG is still the default the UI starts on; it is
 * no longer the only thing this module can write.
 */

const mockCanvasToBlob = vi.hoisted(() => vi.fn());

// PARTIAL mock, deliberately: `fillBackground` and `mimeSupportsAlpha` stay
// real, because the black-corner test below is only worth anything if it
// exercises the actual fill. Only `canvasToBlob` is replaced — jsdom's
// HTMLCanvasElement has no `toBlob` at all.
vi.mock("@/lib/tools/canvas-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tools/canvas-utils")>()),
  canvasToBlob: mockCanvasToBlob,
}));

import { cropImage } from "@/lib/tools/image-crop";

/* ────────────────────────────────────────────────────────────────────────
   A 2D context, because jsdom does not have one.

   `getContext("2d")` returns null under jsdom, so the whole JPEG arm — the
   fill, the composite, the pixels that reach the encoder — is invisible to a
   test that only spies on call arguments. This is the smallest context that
   can answer the one question that matters: WHAT PIXELS DOES THE ENCODER GET.

   It stores straight (non-premultiplied) RGBA and implements source-over for
   `fillRect` and `drawImage` only, which is exactly the pair `flattenOntoWhite`
   and the transparency probe use. Nothing here models a browser's resampling;
   `drawImage` scales by nearest neighbour, which is enough to carry a fully
   transparent region through a downsample.
   ──────────────────────────────────────────────────────────────────────── */

interface Store {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

const stores = new WeakMap<HTMLCanvasElement, Store>();

function storeFor(canvas: HTMLCanvasElement): Store {
  const existing = stores.get(canvas);
  // Assigning width or height resets a real canvas to fully transparent black,
  // and `flattenOntoWhite` assigns both before asking for the context.
  if (existing && existing.w === canvas.width && existing.h === canvas.height) return existing;
  const fresh: Store = {
    w: canvas.width,
    h: canvas.height,
    data: new Uint8ClampedArray(canvas.width * canvas.height * 4),
  };
  stores.set(canvas, fresh);
  return fresh;
}

function parseHex(colour: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!m) throw new Error(`fake ctx: unsupported fillStyle ${colour}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Straight-alpha source-over of one pixel onto the destination store. */
function over(dst: Store, i: number, sr: number, sg: number, sb: number, sa: number): void {
  const da = dst.data[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA === 0) {
    dst.data[i] = dst.data[i + 1] = dst.data[i + 2] = dst.data[i + 3] = 0;
    return;
  }
  dst.data[i] = (sr * sa + dst.data[i] * da * (1 - sa)) / outA;
  dst.data[i + 1] = (sg * sa + dst.data[i + 1] * da * (1 - sa)) / outA;
  dst.data[i + 2] = (sb * sa + dst.data[i + 2] * da * (1 - sa)) / outA;
  dst.data[i + 3] = outA * 255;
}

function makeContext(canvas: HTMLCanvasElement) {
  return {
    canvas,
    fillStyle: "#000000",
    imageSmoothingEnabled: true,
    fillRect(x: number, y: number, w: number, h: number) {
      const dst = storeFor(canvas);
      const [r, g, b] = parseHex(String(this.fillStyle));
      for (let py = y; py < y + h; py++) {
        for (let px = x; px < x + w; px++) {
          if (px < 0 || py < 0 || px >= dst.w || py >= dst.h) continue;
          over(dst, (py * dst.w + px) * 4, r, g, b, 1);
        }
      }
    },
    drawImage(source: HTMLCanvasElement, dx: number, dy: number, dw?: number, dh?: number) {
      const src = storeFor(source);
      const dst = storeFor(canvas);
      const outW = dw ?? src.w;
      const outH = dh ?? src.h;
      for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
          const px = dx + x;
          const py = dy + y;
          if (px < 0 || py < 0 || px >= dst.w || py >= dst.h) continue;
          const sx = Math.min(src.w - 1, Math.floor((x * src.w) / outW));
          const sy = Math.min(src.h - 1, Math.floor((y * src.h) / outH));
          const s = (sy * src.w + sx) * 4;
          over(dst, (py * dst.w + px) * 4, src.data[s], src.data[s + 1], src.data[s + 2], src.data[s + 3] / 255);
        }
      }
    },
    getImageData(x: number, y: number, w: number, h: number) {
      const src = storeFor(canvas);
      const data = new Uint8ClampedArray(w * h * 4);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const from = ((y + py) * src.w + (x + px)) * 4;
          data.set(src.data.subarray(from, from + 4), (py * w + px) * 4);
        }
      }
      return { data };
    },
  };
}

// Cast through `unknown`: this stands in for the full overloaded `getContext`,
// and only the "2d" overload is ever reached from here.
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  return makeContext(this);
} as unknown as HTMLCanvasElement["getContext"];

/** The RGBA at one pixel of a canvas, as the fake context stored it. */
function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): number[] {
  const s = storeFor(canvas);
  const i = (y * s.w + x) * 4;
  return [s.data[i], s.data[i + 1], s.data[i + 2], s.data[i + 3]];
}

/**
 * A canvas shaped like something `getCroppedCanvas()` hands back. `corner`
 * decides whether the top-left quadrant is left fully transparent — the shape a
 * rotated crop box leaves where the image no longer covers the selection.
 */
function makeCanvas(
  width = 100,
  height = 80,
  corner: "opaque" | "transparent" = "opaque",
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const s = storeFor(canvas);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const uncovered = corner === "transparent" && x < width / 2 && y < height / 2;
      // Mid-grey picture everywhere the image covers; a genuine 0,0,0,0 hole
      // where it does not. RGB zero under alpha zero is the browser's own
      // representation, and it is what makes the JPEG arm produce black.
      s.data[i] = s.data[i + 1] = s.data[i + 2] = uncovered ? 0 : 128;
      s.data[i + 3] = uncovered ? 0 : 255;
    }
  }
  return canvas;
}

function makeFile(name: string, size = 4096): File {
  const file = new File(["source-bytes"], name, { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** A blob whose first 12 bytes are a real RIFF/WEBP container header. */
function webpBlob(): Blob {
  const head = new Uint8Array(64);
  head.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  head.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return new Blob([head], { type: "image/webp" });
}

const PNG = { format: "png", quality: 1 } as const;
const JPEG = { format: "jpeg", quality: 0.8 } as const;
const WEBP = { format: "webp", quality: 0.8 } as const;

describe("cropImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanvasToBlob.mockResolvedValue(new Blob([new Uint8Array(512)], { type: "image/png" }));
  });

  it("encodes the canvas cropperjs rendered, untouched, when the format carries alpha", async () => {
    const canvas = makeCanvas(640, 480);
    await cropImage(canvas, makeFile("photo.jpg"), PNG);

    // The exact canvas is handed through — no intermediate redraw that could
    // shift the region.
    expect(mockCanvasToBlob).toHaveBeenCalledWith(canvas, "image/png", 1);
  });

  it("names the file for the format that was encoded", async () => {
    expect((await cropImage(makeCanvas(), makeFile("photo.jpg"), PNG)).fileName).toBe(
      "photo-cropped.png",
    );
    expect((await cropImage(makeCanvas(), makeFile("photo.png"), JPEG)).fileName).toBe(
      "photo-cropped.jpg",
    );

    mockCanvasToBlob.mockResolvedValue(webpBlob());
    expect((await cropImage(makeCanvas(), makeFile("photo.png"), WEBP)).fileName).toBe(
      "photo-cropped.webp",
    );
  });

  it("reports the format it encoded on the result", async () => {
    const result = await cropImage(makeCanvas(), makeFile("photo.png"), JPEG);
    expect(result.format).toBe("jpeg");
  });

  it("handles multi-dot filenames", async () => {
    const result = await cropImage(makeCanvas(), makeFile("my.photo.final.jpg"), PNG);

    expect(result.fileName).toBe("my.photo.final-cropped.png");
  });

  it("passes quality to the lossy encoders and 1 to PNG, which ignores it", async () => {
    await cropImage(makeCanvas(), makeFile("photo.png"), JPEG);
    expect(mockCanvasToBlob).toHaveBeenLastCalledWith(expect.anything(), "image/jpeg", 0.8);

    await cropImage(makeCanvas(), makeFile("photo.png"), { format: "png", quality: 0.3 });
    expect(mockCanvasToBlob).toHaveBeenLastCalledWith(expect.anything(), "image/png", 1);
  });

  it("reports the source size as originalSize and the blob size as newSize", async () => {
    const result = await cropImage(makeCanvas(), makeFile("photo.jpg", 4096), PNG);

    expect(result.originalSize).toBe(4096);
    expect(result.newSize).toBe(512);
  });

  it("rejects when the canvas cannot be encoded", async () => {
    mockCanvasToBlob.mockRejectedValueOnce(new Error("Canvas export failed"));

    await expect(cropImage(makeCanvas(), makeFile("photo.jpg"), PNG)).rejects.toThrow(
      "Canvas export failed",
    );
  });

  /* ──────────────────────────────────────────────────────────────────────
     The trap the format picker introduced.

     A rotated crop leaves the corners the image never covered fully
     transparent. JPEG has no alpha channel, so those pixels reach the encoder
     as RGB 0,0,0 and save as BLACK — not the white a user expects. The fix is
     `fillBackground` BEFORE the draw, and these assert the pixels, not the
     call, because the call could be made and still composite the wrong way
     round.
     ────────────────────────────────────────────────────────────────────── */

  it("hands the JPEG encoder white where a rotated crop left a hole, not black", async () => {
    const canvas = makeCanvas(64, 64, "transparent");
    // The source really is a transparent hole — if this ever stops being true
    // the test below passes for the wrong reason.
    expect(pixelAt(canvas, 0, 0)).toEqual([0, 0, 0, 0]);

    await cropImage(canvas, makeFile("photo.png"), JPEG);

    const encoded = mockCanvasToBlob.mock.calls[0][0] as HTMLCanvasElement;
    expect(encoded).not.toBe(canvas);
    expect(pixelAt(encoded, 0, 0)).toEqual([255, 255, 255, 255]);
    // And the part the image DID cover is untouched mid-grey, so the fill went
    // under the picture rather than over it.
    expect(pixelAt(encoded, 63, 63)).toEqual([128, 128, 128, 255]);
  });

  it("leaves the hole alone for PNG and WebP, which carry alpha", async () => {
    const canvas = makeCanvas(64, 64, "transparent");
    await cropImage(canvas, makeFile("photo.png"), PNG);
    expect(mockCanvasToBlob.mock.calls[0][0]).toBe(canvas);
    expect(pixelAt(canvas, 0, 0)).toEqual([0, 0, 0, 0]);

    mockCanvasToBlob.mockResolvedValue(webpBlob());
    const webpCanvas = makeCanvas(64, 64, "transparent");
    await cropImage(webpCanvas, makeFile("photo.png"), WEBP);
    expect(mockCanvasToBlob.mock.calls[1][0]).toBe(webpCanvas);
    expect(pixelAt(webpCanvas, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("says it filled with white only when the crop actually held transparency", async () => {
    const holed = await cropImage(makeCanvas(64, 64, "transparent"), makeFile("a.png"), JPEG);
    expect(holed.warnings).toEqual([
      "Transparent areas were filled with white — JPG carries no alpha channel.",
    ]);

    // Same format, opaque crop: the fill still runs (it costs nothing and a
    // failed probe must not be able to produce black), but nothing happened
    // that the user needs telling about.
    const opaque = await cropImage(makeCanvas(64, 64, "opaque"), makeFile("a.png"), JPEG);
    expect(opaque.warnings).toBeUndefined();

    // And a transparent crop kept as PNG has nothing to report either.
    const kept = await cropImage(makeCanvas(64, 64, "transparent"), makeFile("a.png"), PNG);
    expect(kept.warnings).toBeUndefined();
  });

  /* ──────────────────────────────────────────────────────────────────────
     `canvas.toBlob` silently substitutes PNG for a type it cannot encode
     (image-convert.ts:5-9), and Safari cannot encode WebP. Saving those bytes
     as `.webp` is the mislabelled-file bug `pdf-engine.ts` already guards.
     ────────────────────────────────────────────────────────────────────── */

  it("refuses to save PNG bytes under a .webp name", async () => {
    mockCanvasToBlob.mockResolvedValue(
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], {
        type: "image/webp",
      }),
    );

    await expect(cropImage(makeCanvas(), makeFile("photo.png"), WEBP)).rejects.toThrow(
      /can't encode WebP/i,
    );
  });

  it("accepts a real RIFF/WEBP container", async () => {
    mockCanvasToBlob.mockResolvedValue(webpBlob());

    const result = await cropImage(makeCanvas(), makeFile("photo.png"), WEBP);
    expect(result.fileName).toBe("photo-cropped.webp");
  });
});
