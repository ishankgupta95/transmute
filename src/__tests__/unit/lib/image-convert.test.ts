import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock heic2any
vi.mock("heic2any", () => ({
  default: vi.fn().mockResolvedValue(new Blob(["png-data"], { type: "image/png" })),
}));

// Mock utif2
vi.mock("utif2", () => ({
  decode: vi.fn().mockReturnValue([{ width: 100, height: 80 }]),
  decodeImage: vi.fn(),
  toRGBA8: vi.fn().mockReturnValue(new Uint8Array(100 * 80 * 4)),
}));

import { convertImage, type ImageConvertOptions } from "@/lib/tools/image-convert";
import heic2any from "heic2any";
import * as UTIF from "utif2";

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

  it("converts to BMP format", async () => {
    const file = makeFile("test.png", "image/png");
    const opts: ImageConvertOptions = { targetFormat: "bmp", quality: 1 };
    const result = await convertImage(file, opts);

    expect(result.fileName).toBe("test.bmp");
    expect(result.blob.type).toBe("image/bmp");
  });

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

    expect(heic2any).toHaveBeenCalledWith({ blob: file, toType: "image/png" });
  });

  it("handles HEIF files by converting via heic2any", async () => {
    const file = makeFile("photo.heif", "image/heif");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await convertImage(file, opts);

    expect(heic2any).toHaveBeenCalledWith({ blob: file, toType: "image/png" });
  });

  it("handles heic2any returning an array", async () => {
    const firstBlob = new Blob(["first"], { type: "image/png" });
    const secondBlob = new Blob(["second-longer"], { type: "image/png" });
    vi.mocked(heic2any).mockResolvedValueOnce([
      firstBlob,
      secondBlob,
    ] as unknown as Blob);

    const file = makeFile("multi.heic", "image/heic");
    const opts: ImageConvertOptions = { targetFormat: "jpeg", quality: 0.8 };
    const result = await convertImage(file, opts);

    expect(result.blob).toBeInstanceOf(Blob);
    // The first blob ("first", 5 bytes) should be used, not the second ("second-longer", 13 bytes)
    // Verify createObjectURL was called with the first blob (size 5), not the second (size 13)
    expect(URL.createObjectURL).toHaveBeenCalledWith(firstBlob);
    expect(result.fileName).toBe("multi.jpg");
  });

  it("handles TIFF files by decoding via utif2", async () => {
    const file = makeFile("scan.tiff", "image/tiff");
    const opts: ImageConvertOptions = { targetFormat: "png", quality: 1 };
    await convertImage(file, opts);

    expect(UTIF.decode).toHaveBeenCalled();
    expect(UTIF.decodeImage).toHaveBeenCalled();
    expect(UTIF.toRGBA8).toHaveBeenCalled();
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
