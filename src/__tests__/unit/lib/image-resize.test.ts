import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pica — toBlob echoes the requested mime so we can assert format preservation
const picaBlob = (_c: unknown, mime = "image/jpeg") =>
  Promise.resolve(new Blob(["resized"], { type: mime }));
const mockPicaInstance = {
  resize: vi.fn().mockResolvedValue(undefined),
  toBlob: vi.fn().mockImplementation(picaBlob),
};

vi.mock("pica", () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return mockPicaInstance;
    }),
  };
});

import {
  resizeImage,
  RESIZE_PRESETS,
  PERCENTAGE_PRESETS,
  type ImageResizeOptions,
} from "@/lib/tools/image-resize";

let canvasInstances: Record<string, unknown>[];

function setupCanvasMock() {
  canvasInstances = [];
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      const canvas: Record<string, unknown> = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
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
}

function makeFile(name: string): File {
  return new File(["data"], name, { type: "image/png" });
}

describe("RESIZE_PRESETS", () => {
  it("contains expected preset entries", () => {
    expect(RESIZE_PRESETS).toHaveLength(6);
    const labels = RESIZE_PRESETS.map((p) => p.label);
    expect(labels).toContain("Instagram Post (1080\u00d71080)");
    expect(labels).toContain("YouTube Thumbnail (1280\u00d7720)");
    expect(labels).toContain("Twitter Header (1500\u00d7500)");
    expect(labels).toContain("LinkedIn Banner (1584\u00d7396)");
    expect(labels).toContain("Passport Photo (600\u00d7600)");
    expect(labels).toContain("Instagram Story (1080\u00d71920)");
  });

  it("has valid width and height for every preset", () => {
    for (const preset of RESIZE_PRESETS) {
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.height).toBeGreaterThan(0);
    }
  });
});

describe("PERCENTAGE_PRESETS", () => {
  it("contains [25, 50, 75, 150, 200]", () => {
    expect(PERCENTAGE_PRESETS).toEqual([25, 50, 75, 150, 200]);
  });
});

describe("resizeImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupCanvasMock();
    setupImageMock();
    mockPicaInstance.resize.mockResolvedValue(undefined);
    mockPicaInstance.toBlob.mockImplementation(picaBlob);
  });

  it("resizes a PNG and preserves PNG output (keeps transparency)", async () => {
    const file = makeFile("photo.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 400, height: 300, lockAspect: false, percentage: 100, quality: 0.9,
    };
    const result = await resizeImage(file, opts);

    expect(result.fileName).toBe("photo-400x300.png");
    expect(result.blob.type).toBe("image/png");
    expect(mockPicaInstance.resize).toHaveBeenCalled();
    expect(mockPicaInstance.toBlob).toHaveBeenCalledWith(expect.anything(), "image/png", 0.9);
  });

  it("resizes a JPG and keeps JPEG output", async () => {
    setupImageMock(1000, 500);
    const file = new File(["data"], "wide.jpg", { type: "image/jpeg" });
    const opts: ImageResizeOptions = {
      mode: "percentage", width: 0, height: 0, lockAspect: false, percentage: 50, quality: 0.85,
    };
    const result = await resizeImage(file, opts);

    expect(result.fileName).toBe("wide-500x250.jpg");
    expect(result.blob.type).toBe("image/jpeg");
  });

  it("resizes a WebP and keeps WebP output", async () => {
    const file = new File(["data"], "logo.webp", { type: "image/webp" });
    const opts: ImageResizeOptions = {
      mode: "custom", width: 200, height: 200, lockAspect: false, percentage: 100, quality: 0.9,
    };
    const result = await resizeImage(file, opts);

    expect(result.fileName).toBe("logo-200x200.webp");
    expect(result.blob.type).toBe("image/webp");
  });

  it("resizes with preset mode (uses width/height from options)", async () => {
    const file = makeFile("photo.png");
    const opts: ImageResizeOptions = {
      mode: "preset", width: 1080, height: 1080, lockAspect: false, percentage: 100, quality: 0.9,
    };
    const result = await resizeImage(file, opts);

    expect(result.fileName).toBe("photo-1080x1080.png");
  });

  it("clamps dimensions to minimum of 1", async () => {
    const file = makeFile("tiny.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 0, height: -5, lockAspect: false, percentage: 100, quality: 0.9,
    };
    const result = await resizeImage(file, opts);

    expect(result.fileName).toBe("tiny-1x1.png");
  });

  it("clamps dimensions to maximum of 8192", async () => {
    const file = makeFile("huge.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 10000, height: 20000, lockAspect: false, percentage: 100, quality: 0.9,
    };
    const result = await resizeImage(file, opts);

    expect(result.fileName).toBe("huge-8192x8192.png");
  });

  it("percentage 200 doubles dimensions", async () => {
    setupImageMock(400, 300);
    const file = makeFile("small.png");
    const opts: ImageResizeOptions = {
      mode: "percentage", width: 0, height: 0, lockAspect: false, percentage: 200, quality: 0.9,
    };
    const result = await resizeImage(file, opts);

    expect(result.fileName).toBe("small-800x600.png");
  });

  it("percentage clamped to 8192 max", async () => {
    setupImageMock(5000, 5000);
    const file = makeFile("big.png");
    const opts: ImageResizeOptions = {
      mode: "percentage", width: 0, height: 0, lockAspect: false, percentage: 200, quality: 0.9,
    };
    const result = await resizeImage(file, opts);

    expect(result.fileName).toBe("big-8192x8192.png");
  });

  it("passes quality 3 (Lanczos3) to pica.resize", async () => {
    const file = makeFile("photo.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 100, height: 100, lockAspect: false, percentage: 100, quality: 0.9,
    };
    await resizeImage(file, opts);

    expect(mockPicaInstance.resize).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), { quality: 3 },
    );
  });

  it("passes user quality to pica.toBlob", async () => {
    const file = makeFile("photo.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 100, height: 100, lockAspect: false, percentage: 100, quality: 0.75,
    };
    await resizeImage(file, opts);

    expect(mockPicaInstance.toBlob).toHaveBeenCalledWith(
      expect.anything(), "image/png", 0.75,
    );
  });

  it("reports correct originalSize and newSize", async () => {
    const file = makeFile("photo.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 100, height: 100, lockAspect: false, percentage: 100, quality: 0.9,
    };
    const result = await resizeImage(file, opts);

    expect(result.originalSize).toBe(file.size);
    expect(result.newSize).toBe(result.blob.size);
  });

  it("sets srcCanvas to source dimensions and destCanvas to output dimensions", async () => {
    setupImageMock(800, 600);
    const file = makeFile("photo.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 400, height: 300, lockAspect: false, percentage: 100, quality: 0.9,
    };
    await resizeImage(file, opts);

    expect(canvasInstances).toHaveLength(2);
    const [srcCanvas, destCanvas] = canvasInstances;
    // srcCanvas should have source image dimensions
    expect(srcCanvas.width).toBe(800);
    expect(srcCanvas.height).toBe(600);
    // destCanvas should have target output dimensions
    expect(destCanvas.width).toBe(400);
    expect(destCanvas.height).toBe(300);
  });

  it("passes srcCanvas and destCanvas to pica.resize", async () => {
    const file = makeFile("photo.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 200, height: 150, lockAspect: false, percentage: 100, quality: 0.9,
    };
    await resizeImage(file, opts);

    expect(canvasInstances).toHaveLength(2);
    const [srcCanvas, destCanvas] = canvasInstances;
    expect(mockPicaInstance.resize).toHaveBeenCalledWith(srcCanvas, destCanvas, { quality: 3 });
  });

  it("rejects when image fails to load", async () => {
    setupImageErrorMock();
    const file = makeFile("bad.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 100, height: 100, lockAspect: false, percentage: 100, quality: 0.9,
    };
    await expect(resizeImage(file, opts)).rejects.toThrow("Failed to load image");
  });

  it("rejects when canvas context is null", async () => {
    // Override setupCanvasMock so the first canvas returns null context
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        const canvas: Record<string, unknown> = {
          width: 0,
          height: 0,
          getContext: vi.fn().mockReturnValue(null),
        };
        canvasInstances.push(canvas);
        return canvas as unknown as HTMLCanvasElement;
      }
      return document.createElement(tag);
    });
    const file = makeFile("photo.png");
    const opts: ImageResizeOptions = {
      mode: "custom", width: 100, height: 100, lockAspect: false, percentage: 100, quality: 0.9,
    };
    await expect(resizeImage(file, opts)).rejects.toThrow("Canvas 2D context not available");
  });
});
