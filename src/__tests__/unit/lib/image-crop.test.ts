import { describe, it, expect, vi, beforeEach } from "vitest";

import { cropImage, type CropData } from "@/lib/tools/image-crop";

let canvasInstances: Array<Record<string, unknown>>;

function setupCanvasMock() {
  canvasInstances = [];
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      const canvas: Record<string, unknown> = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({
          drawImage: vi.fn(),
          translate: vi.fn(),
          rotate: vi.fn(),
        }),
        toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void, type: string) => {
          cb(new Blob(["cropped-data"], { type }));
        }),
      };
      canvasInstances.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    }
    return document.createElement(tag);
  });
}

function setupImageMock(naturalWidth = 800, naturalHeight = 600) {
  global.URL.createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();

  vi.spyOn(global, "Image").mockImplementation(function (this: Record<string, unknown>) {
    this.naturalWidth = naturalWidth;
    this.naturalHeight = naturalHeight;
    this.onload = null;
    this.onerror = null;
    this._src = "";
    const self = this;
    Object.defineProperty(this, "src", {
      get() { return self._src; },
      set(val: string) {
        self._src = val;
        setTimeout(() => { if (self.onload) (self.onload as () => void)(); }, 0);
      },
    });
    return this as unknown as HTMLImageElement;
  } as unknown as () => HTMLImageElement);
}

function setupImageErrorMock() {
  vi.spyOn(global, "Image").mockImplementation(function (this: Record<string, unknown>) {
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.onload = null;
    this.onerror = null;
    this._src = "";
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
}

function makeFile(name: string): File {
  return new File(["data"], name, { type: "image/png" });
}

describe("cropImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupCanvasMock();
    setupImageMock();
  });

  it("crops without rotation and produces correct filename", async () => {
    const file = makeFile("landscape.jpg");
    const cropData: CropData = { x: 10, y: 20, width: 300, height: 200, rotate: 0 };
    const result = await cropImage(file, cropData);

    expect(result.fileName).toBe("landscape-cropped.png");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe("image/png");
  });

  it("sets canvas dimensions from crop width/height (rounded)", async () => {
    const file = makeFile("photo.png");
    const cropData: CropData = { x: 0, y: 0, width: 250.7, height: 180.3, rotate: 0 };
    await cropImage(file, cropData);

    expect(canvasInstances[0].width).toBe(251);
    expect(canvasInstances[0].height).toBe(180);
  });

  it("draws cropped region from source image when no rotation", async () => {
    const file = makeFile("photo.png");
    const cropData: CropData = { x: 50, y: 100, width: 400, height: 300, rotate: 0 };
    await cropImage(file, cropData);

    const ctx = (canvasInstances[0].getContext as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      50, 100, 400, 300,
      0, 0, 400, 300,
    );
  });

  it("creates a rotated canvas when rotation is non-zero", async () => {
    const file = makeFile("photo.png");
    const cropData: CropData = { x: 10, y: 10, width: 200, height: 150, rotate: 45 };
    await cropImage(file, cropData);

    expect(canvasInstances.length).toBe(2);
    const rotCtx = (canvasInstances[1].getContext as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(rotCtx.translate).toHaveBeenCalled();
    expect(rotCtx.rotate).toHaveBeenCalled();
    expect(rotCtx.drawImage).toHaveBeenCalled();
  });

  it("outputs as PNG format", async () => {
    const file = makeFile("test.jpg");
    const cropData: CropData = { x: 0, y: 0, width: 100, height: 100, rotate: 0 };
    const result = await cropImage(file, cropData);

    expect(result.blob.type).toBe("image/png");
    const toBlob = canvasInstances[0].toBlob as ReturnType<typeof vi.fn>;
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", 1);
  });

  it("reports correct originalSize and newSize", async () => {
    const file = makeFile("photo.png");
    const cropData: CropData = { x: 0, y: 0, width: 100, height: 100, rotate: 0 };
    const result = await cropImage(file, cropData);

    expect(result.originalSize).toBe(file.size);
    expect(result.newSize).toBe(result.blob.size);
  });

  it("handles multi-dot filenames", async () => {
    const file = makeFile("my.photo.backup.png");
    const cropData: CropData = { x: 0, y: 0, width: 50, height: 50, rotate: 0 };
    const result = await cropImage(file, cropData);

    expect(result.fileName).toBe("my.photo.backup-cropped.png");
  });

  it("rejects when image fails to load", async () => {
    setupImageErrorMock();
    const file = makeFile("bad.png");
    const cropData: CropData = { x: 0, y: 0, width: 100, height: 100, rotate: 0 };
    await expect(cropImage(file, cropData)).rejects.toThrow("Failed to load image");
  });

  it("rejects when canvas context is null", async () => {
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        const c = {
          width: 0, height: 0,
          getContext: vi.fn().mockReturnValue(null),
          toBlob: vi.fn(),
        };
        canvasInstances.push(c);
        return c as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    const file = makeFile("photo.png");
    const cropData: CropData = { x: 0, y: 0, width: 100, height: 100, rotate: 0 };
    await expect(cropImage(file, cropData)).rejects.toThrow("Canvas 2D context not available");
  });

  it("rejects when toBlob returns null", async () => {
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        const c = {
          width: 0, height: 0,
          getContext: vi.fn().mockReturnValue({
            drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
          }),
          toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void) => { cb(null); }),
        };
        canvasInstances.push(c);
        return c as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });

    const file = makeFile("photo.png");
    const cropData: CropData = { x: 0, y: 0, width: 100, height: 100, rotate: 0 };
    await expect(cropImage(file, cropData)).rejects.toThrow("Canvas export failed");
  });

  it("crop with rotation uses drawImage from rotated canvas onto output", async () => {
    const file = makeFile("photo.png");
    const cropData: CropData = { x: 20, y: 30, width: 100, height: 80, rotate: 90 };
    await cropImage(file, cropData);

    const outCtx = (canvasInstances[0].getContext as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(outCtx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      20, 30, 100, 80,
      0, 0, 100, 80,
    );
  });
});
