import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

/*
 * heic2any stub — deliberately shaped like the real vendored load, which looks
 * wrong at first glance.
 *
 * heic2any embeds LGPL libheif/libde265, so it is no longer bundled:
 * `npm run copy:wasm` copies upstream's UMD dist to `public/vendor/heic2any.js`
 * and lib/tools/image-convert.ts imports that URL at first HEIC. A UMD bundle
 * executed as an ES module matches none of its module-system branches and
 * falls through to `global.heic2any = factory()` — so the module namespace is
 * EMPTY and the decoder arrives on `globalThis`. The factory below therefore
 * returns nothing, and `installHeic2Any` (called per test) supplies the spy the
 * way the real script would.
 *
 * Mocking the URL rather than the package name is also what pins the cure in
 * place: a regression back to `import("heic2any")` would leave this spy
 * uncalled and every HEIC assertion below would fail.
 */
vi.mock("/vendor/heic2any.js", () => ({}));

/** Put a fresh decoder spy where the vendored UMD script would leave one. */
function installHeic2Any(): Mock {
  const spy = vi.fn().mockResolvedValue(new Blob(["png-data"], { type: "image/png" }));
  (globalThis as { heic2any?: Mock }).heic2any = spy;
  return spy;
}

/** The spy currently standing in for the vendored decoder. */
function heic2any(): Mock {
  const spy = (globalThis as { heic2any?: Mock }).heic2any;
  if (!spy) throw new Error("installHeic2Any() was not called for this test");
  return spy;
}

// Mock utif2
/*
 * utif2 is mocked to the shape the REAL library emits, verified against
 * `UTIF.encodeImage` output in Node: `decode()` returns IFD objects carrying
 * only numeric TIFF tags (t256 = ImageWidth, t257 = ImageLength) — `.width`
 * and `.height` do not exist until `decodeImage()` has populated them.
 *
 * The earlier mock put `width`/`height` straight on `decode()`'s return, which
 * no real TIFF ever does. That made the decode order untestable: reading the
 * dimensions before `decodeImage()` ran would have kept passing here while
 * producing a NaN-sized canvas in the browser. Populating them in
 * `decodeImage` instead pins the ordering the production path depends on.
 */
vi.mock("utif2", () => ({
  // A fresh IFD per call — real decode() never hands back a shared object,
  // and reusing one would leak decodeImage's mutations between tests.
  decode: vi.fn(() => [{ t256: [100], t257: [80] } as Record<string, unknown>]),
  decodeImage: vi.fn((_buf: ArrayBuffer, ifd: Record<string, unknown>) => {
    ifd.width = (ifd.t256 as number[])[0];
    ifd.height = (ifd.t257 as number[])[0];
  }),
  toRGBA8: vi.fn().mockReturnValue(new Uint8Array(100 * 80 * 4)),
}));

import { convertImage, type ImageConvertOptions } from "@/lib/tools/image-convert";
import { ANIMATED_GIF_WARNING, ANIMATED_WEBP_WARNING } from "@/lib/tools/image-frames";
import * as UTIF from "utif2";
import { animatedWebpBytes, gifBytes } from "./image-byte-fixtures";

// -- Canvas & Image mocking --

let mockCtx: Record<string, ReturnType<typeof vi.fn>>;
let mockCanvas: Record<string, unknown>;

function setupCanvasMock() {
  mockCtx = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn().mockReturnValue({ data: new Uint8Array(0) }),
    createImageData: vi.fn().mockImplementation((w: number, h: number) => ({
      data: new Uint8Array(w * h * 4),
    })),
    putImageData: vi.fn(),
  };
  mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockCtx),
    toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void, type: string) => {
      cb(new Blob(["canvas-data"], { type }));
    }),
  };
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
    return document.createElement(tag);
  });
}

function setupImageMock(naturalWidth = 200, naturalHeight = 150) {
  global.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();

  vi.spyOn(global, "Image").mockImplementation(function (this: Record<string, unknown>) {
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.onload = null;
    this.onerror = null;
    this._src = "";
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    Object.defineProperty(this, "src", {
      get() { return self._src; },
      set(val: string) {
        self._src = val;
        setTimeout(() => {
          if (self.onload) (self.onload as () => void)();
        }, 0);
      },
    });
    return this as unknown as HTMLImageElement;
  } as unknown as () => HTMLImageElement);
}

function makeFile(name: string, type = "image/png"): File {
  return new File(["file-data"], name, { type });
}

describe("convertImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // After restoreAllMocks so the global spy is never torn down under a test.
    installHeic2Any();
    setupCanvasMock();
    setupImageMock();
  });

  it("converts PNG to JPEG with correct filename extension (.jpg)", async () => {
    const file = makeFile("photo.png", "image/png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("photo.jpg");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe("image/jpeg");
    expect(result.originalSize).toBe(file.size);
    expect(result.newSize).toBe(result.blob.size);
  });

  it("converts WebP to PNG with correct filename", async () => {
    const file = makeFile("image.webp", "image/webp");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("image.png");
    expect(result.blob.type).toBe("image/png");
  });

  it("converts to WebP format", async () => {
    const file = makeFile("test.jpg", "image/jpeg");
    const opts: ImageConvertOptions = { targetFormat: "webp", quality: 0.9 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("test.webp");
    expect(result.blob.type).toBe("image/webp");
  });

  // There was a "converts to BMP format" case here. It only passed because
  // `canvasToBlob` is mocked to echo back whatever MIME it is handed — no real
  // browser encodes BMP, so `canvas.toBlob` fell back to PNG and the tool
  // produced PNG bytes named `.bmp`. BMP is source-only now, and the type no
  // longer admits it as a target.

  it("uses natural dimensions when width/height not specified", async () => {
    setupImageMock(800, 600);
    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    await convertImage(file, opts);

    expect(mockCanvas.width).toBe(800);
    expect(mockCanvas.height).toBe(600);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      800,
      600,
    );
  });

  it("uses custom dimensions when provided", async () => {
    setupImageMock(800, 600);
    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1, width: 400, height: 300 };
    await convertImage(file, opts);

    expect(mockCanvas.width).toBe(400);
    expect(mockCanvas.height).toBe(300);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      400,
      300,
    );
  });

  it("handles HEIC files by converting via heic2any", async () => {
    const file = makeFile("photo.heic", "image/heic");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.9 };
    await convertImage(file, opts);

    expect(heic2any()).toHaveBeenCalledWith({ blob: file, toType: "image/png" });
  });

  it("handles HEIF files by converting via heic2any", async () => {
    const file = makeFile("photo.heif", "image/heif");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await convertImage(file, opts);

    expect(heic2any()).toHaveBeenCalledWith({ blob: file, toType: "image/png" });
  });

  it("handles heic2any returning an array", async () => {
    const firstBlob = new Blob(["first"], { type: "image/png" });
    const secondBlob = new Blob(["second-longer"], { type: "image/png" });
    heic2any().mockResolvedValueOnce([firstBlob, secondBlob]);

    const file = makeFile("multi.heic", "image/heic");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    const result = await convertImage(file, opts);

    expect(result.blob).toBeInstanceOf(Blob);
    // The first blob ("first", 5 bytes) should be used, not the second ("second-longer", 13 bytes)
    // Verify createObjectURL was called with the first blob (size 5), not the second (size 13)
    expect(URL.createObjectURL).toHaveBeenCalledWith(firstBlob);
    expect(result.fileName).toBe("multi.jpg");
  });

  it("reports a clear failure when the vendored decoder registers no global", async () => {
    // The one genuinely new way HEIC can fail now that the decoder is fetched
    // rather than bundled: the script loads (or is cached) but leaves nothing
    // on globalThis. Without this guard the next line would be
    // `undefined is not a function`, which tells a user nothing.
    delete (globalThis as { heic2any?: Mock }).heic2any;

    const file = makeFile("photo.heic", "image/heic");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.9 };
    await expect(convertImage(file, opts)).rejects.toThrow("Could not load the HEIC decoder");
  });

  it("handles TIFF files by decoding via utif2", async () => {
    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await convertImage(file, opts);

    expect(UTIF.decode).toHaveBeenCalled();
    expect(UTIF.decodeImage).toHaveBeenCalled();
    expect(UTIF.toRGBA8).toHaveBeenCalled();
  });

  it("reads TIFF dimensions only after decodeImage has populated them", async () => {
    // Real utif2 leaves width/height undefined until decodeImage runs, so a
    // regression that reads them straight off decode()'s IFD would size the
    // canvas NaN x NaN. A decodeImage that populates nothing must break the run.
    vi.mocked(UTIF.decodeImage).mockImplementationOnce(() => {});

    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    // With no dimensions on the IFD the canvas is sized undefined x undefined
    // and the RGBA copy overruns a zero-length buffer — the browser-side
    // symptom of reading the tags too early, surfaced here as a rejection.
    await expect(convertImage(file, opts)).rejects.toThrow();
    expect(mockCtx.createImageData).toHaveBeenCalledWith(undefined, undefined);
  });

  it("sets RGBA data into imageData when converting TIFF", async () => {
    const rgbaData = new Uint8Array(100 * 80 * 4);
    rgbaData[0] = 255; // mark first pixel red channel
    vi.mocked(UTIF.toRGBA8).mockReturnValueOnce(rgbaData);

    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await convertImage(file, opts);

    // createImageData should have been called with TIFF dimensions
    expect(mockCtx.createImageData).toHaveBeenCalledWith(100, 80);
    // putImageData should have been called with imageData containing the RGBA bytes
    expect(mockCtx.putImageData).toHaveBeenCalled();
    const imageDataArg = mockCtx.putImageData.mock.calls[0][0] as { data: Uint8Array };
    expect(imageDataArg.data[0]).toBe(255);
  });

  it("handles .tif extension as TIFF", async () => {
    const file = makeFile("scan.tif", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    await convertImage(file, opts);

    expect(UTIF.decode).toHaveBeenCalled();
  });

  it("warns when a TIFF has more pages than the one it keeps", async () => {
    vi.mocked(UTIF.decode).mockReturnValueOnce([
      { t256: [100], t257: [80] },
      { t256: [50], t257: [40] },
      { t256: [25], t257: [20] },
    ] as unknown as ReturnType<typeof UTIF.decode>);

    // vi.restoreAllMocks leaves factory-made vi.fn history alone, so count
    // this test's decodeImage calls as a delta from here.
    vi.mocked(UTIF.decodeImage).mockClear();

    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    const result = await convertImage(file, opts);

    expect(result.warnings).toEqual([
      "This TIFF has 3 pages — only the first page was kept.",
    ]);
    // Only page 0 is decoded — eager decode of every page would OOM real scans.
    expect(UTIF.decodeImage).toHaveBeenCalledTimes(1);
  });

  it("attaches no warnings for a single-page TIFF", async () => {
    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    const result = await convertImage(file, opts);

    expect(result.warnings).toBeUndefined();
  });

  it("surfaces the exact animated-GIF and animated-WebP warnings — real bytes, real sniffer", async () => {
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };

    const gif = new File([gifBytes(2)], "anim.gif", { type: "image/gif" });
    expect((await convertImage(gif, opts)).warnings).toEqual([ANIMATED_GIF_WARNING]);

    const webp = new File([animatedWebpBytes()], "anim.webp", { type: "image/webp" });
    expect((await convertImage(webp, opts)).warnings).toEqual([ANIMATED_WEBP_WARNING]);

    // A still, single-frame GIF converts without any notice.
    const still = new File([gifBytes(1)], "still.gif", { type: "image/gif" });
    expect((await convertImage(still, opts)).warnings).toBeUndefined();
  });

  it("throws when TIFF has no IFDs", async () => {
    vi.mocked(UTIF.decode).mockReturnValueOnce([]);

    const file = makeFile("bad.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };

    await expect(convertImage(file, opts)).rejects.toThrow("Could not decode TIFF file");
  });

  it("handles SVG files by wrapping with correct MIME type", async () => {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const file = new File([svgContent], "icon.svg", { type: "image/svg+xml" });
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("icon.png");
  });

  it("strips old extension from multi-dot filenames", async () => {
    const file = makeFile("my.photo.backup.png");
    const opts: ImageConvertOptions = { targetFormat: "webp", quality: 0.9 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("my.photo.backup.webp");
  });

  it("passes quality to canvas.toBlob", async () => {
    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.5 };
    await convertImage(file, opts);

    // The toBlob mock is on the main output canvas (second call for TIFF skipped here)
    expect(mockCanvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/jpeg",
      0.5,
    );
  });

  it("revokes object URL after image loads", async () => {
    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await convertImage(file, opts);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("rejects when canvas.toBlob returns null", async () => {
    mockCanvas.toBlob = vi.fn().mockImplementation((cb: (b: Blob | null) => void) => {
      cb(null);
    });

    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    await expect(convertImage(file, opts)).rejects.toThrow("Canvas export failed");
  });

  it("rejects when image fails to load", async () => {
    vi.spyOn(global, "Image").mockImplementation(function (this: Record<string, unknown>) {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      this.onload = null;
      this.onerror = null;
      this._src = "";
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      Object.defineProperty(this, "src", {
        get() { return self._src; },
        set(val: string) {
          self._src = val;
          setTimeout(() => { if (self.onerror) (self.onerror as () => void)(); }, 0);
        },
      });
      return this as unknown as HTMLImageElement;
    } as unknown as () => HTMLImageElement);

    const file = makeFile("bad.png");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    await expect(convertImage(file, opts)).rejects.toThrow("Failed to load image");
  });

  it("rejects when canvas context is null", async () => {
    mockCanvas.getContext = vi.fn().mockReturnValue(null);

    const file = makeFile("photo.png");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await expect(convertImage(file, opts)).rejects.toThrow("Canvas 2D context not available");
  });
});

/*
  Dimensionless SVGs (viewBox only) report naturalWidth 0 and used to produce
  a 0×0 PNG. The raster fallback is pure string parsing — tested directly.
*/
import { svgFallbackSize } from "@/lib/tools/image-convert";

describe("svgFallbackSize", () => {
  it("scales a viewBox to a 1024px longest edge, marked non-explicit", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120"></svg>`;
    expect(svgFallbackSize(svg)).toEqual({ width: 1024, height: 512, explicit: false });
  });

  it("returns explicit width/height attributes unscaled", () => {
    const svg = `<svg width="240" height="120" viewBox="0 0 20 10"></svg>`;
    // An author-chosen 240px must never be inflated to 1024.
    expect(svgFallbackSize(svg)).toEqual({ width: 240, height: 120, explicit: true });
  });

  it("never scales DOWN an already-large viewBox", () => {
    const svg = `<svg viewBox="0 0 4096 2048"></svg>`;
    expect(svgFallbackSize(svg)).toEqual({ width: 4096, height: 2048, explicit: false });
  });

  it("handles negative viewBox origins", () => {
    const svg = `<svg viewBox="-10 -5 200 100"></svg>`;
    expect(svgFallbackSize(svg)).toEqual({ width: 1024, height: 512, explicit: false });
  });

  it("returns null for percentage-only or missing dimensions", () => {
    expect(svgFallbackSize(`<svg width="100%" height="100%"></svg>`)).toBeNull();
    expect(svgFallbackSize(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)).toBeNull();
    expect(svgFallbackSize(`not svg at all`)).toBeNull();
  });
});
