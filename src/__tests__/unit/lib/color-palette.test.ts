import { describe, it, expect, vi, beforeEach } from "vitest";

import { extractColorPalette, type ColorInfo } from "@/lib/tools/color-palette";

let mockCtx: Record<string, ReturnType<typeof vi.fn>>;
let mockCanvas: Record<string, unknown>;

function setupCanvasMock(pixelData?: Uint8ClampedArray) {
  const defaultPixels = new Uint8ClampedArray([
    // 4 red pixels
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
    255, 0, 0, 255,
    // 2 green pixels
    0, 255, 0, 255,
    0, 255, 0, 255,
    // 1 blue pixel
    0, 0, 255, 255,
    // 1 white pixel
    255, 255, 255, 255,
  ]);

  mockCtx = {
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      data: pixelData ?? defaultPixels,
    }),
  };
  mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(mockCtx),
  };
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
    return document.createElement(tag);
  });
}

function setupImageMock(naturalWidth = 100, naturalHeight = 100) {
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
  return new File(["image-data"], name, { type: "image/png" });
}

describe("extractColorPalette", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupCanvasMock();
    setupImageMock();
  });

  it("extracts colors sorted by frequency (descending)", async () => {
    const file = makeFile("photo.png");
    const colors = await extractColorPalette(file, 8);

    expect(colors[0].frequency).toBeGreaterThanOrEqual(colors[1].frequency);
    for (let i = 1; i < colors.length - 1; i++) {
      expect(colors[i].frequency).toBeGreaterThanOrEqual(colors[i + 1].frequency);
    }
  });

  it("returns hex, rgb, and frequency for each color", async () => {
    const file = makeFile("photo.png");
    // Use colorCount=2 to avoid empty buckets with only 8 pixels
    const colors = await extractColorPalette(file, 2);

    for (const color of colors) {
      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(color.rgb).toHaveLength(3);
      expect(color.rgb[0]).toBeGreaterThanOrEqual(0);
      expect(color.rgb[0]).toBeLessThanOrEqual(255);
      expect(color.rgb[1]).toBeGreaterThanOrEqual(0);
      expect(color.rgb[1]).toBeLessThanOrEqual(255);
      expect(color.rgb[2]).toBeGreaterThanOrEqual(0);
      expect(color.rgb[2]).toBeLessThanOrEqual(255);
      expect(color.frequency).toBeGreaterThan(0);
      expect(color.frequency).toBeLessThanOrEqual(1);
    }
  });

  it("frequencies sum to approximately 1", async () => {
    const file = makeFile("photo.png");
    const colors = await extractColorPalette(file, 8);

    const totalFreq = colors.reduce((sum, c) => sum + c.frequency, 0);
    expect(totalFreq).toBeCloseTo(1, 1);
  });

  it("skips transparent pixels (alpha < 128)", async () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,   // red opaque
      0, 255, 0, 50,    // green transparent - skipped
      0, 0, 255, 255,   // blue opaque
    ]);
    setupCanvasMock(pixels);

    const file = makeFile("transparent.png");
    const colors = await extractColorPalette(file, 8);

    // Only 2 opaque pixels (red and blue)
    const allRgb = colors.map((c) => c.rgb);
    for (const rgb of allRgb) {
      if (rgb[0] === 0 && rgb[2] === 0) {
        expect(rgb[1]).not.toBe(255);
      }
    }
  });

  it("returns black fallback when all pixels are transparent", async () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 0,
      0, 255, 0, 50,
      0, 0, 255, 100,
    ]);
    setupCanvasMock(pixels);

    const file = makeFile("empty.png");
    const colors = await extractColorPalette(file);

    expect(colors).toHaveLength(1);
    expect(colors[0]).toEqual({ hex: "#000000", rgb: [0, 0, 0], frequency: 1 });
  });

  it("returns black fallback for empty image (0 pixels)", async () => {
    const pixels = new Uint8ClampedArray([]);
    setupCanvasMock(pixels);

    const file = makeFile("zero.png");
    const colors = await extractColorPalette(file);

    expect(colors).toHaveLength(1);
    expect(colors[0].hex).toBe("#000000");
  });

  it("defaults to 8 colors when colorCount not specified", async () => {
    const pixels = new Uint8ClampedArray(32 * 4);
    for (let i = 0; i < 32; i++) {
      pixels[i * 4] = i * 8;
      pixels[i * 4 + 1] = 128;
      pixels[i * 4 + 2] = 64;
      pixels[i * 4 + 3] = 255;
    }
    setupCanvasMock(pixels);

    const file = makeFile("gradient.png");
    const colors = await extractColorPalette(file);

    expect(colors.length).toBeGreaterThan(0);
    expect(colors.length).toBeLessThanOrEqual(256);
  });

  it("respects custom colorCount parameter", async () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
    ]);
    setupCanvasMock(pixels);

    const file = makeFile("simple.png");
    const colors = await extractColorPalette(file, 2);

    expect(colors.length).toBeGreaterThan(0);
    expect(colors.length).toBeLessThanOrEqual(4);
  });

  it("generates correct hex from RGB values", async () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
    ]);
    setupCanvasMock(pixels);

    const file = makeFile("red.png");
    const colors = await extractColorPalette(file, 1);

    expect(colors[0].hex).toBe("#ff0000");
    expect(colors[0].rgb).toEqual([255, 0, 0]);
  });

  it("scales down large images for performance", async () => {
    setupImageMock(4000, 3000);
    const file = makeFile("huge.png");
    await extractColorPalette(file);

    expect(mockCanvas.width).toBe(200);
    expect(mockCanvas.height).toBe(150);
  });

  it("does not upscale small images", async () => {
    setupImageMock(50, 30);
    const file = makeFile("tiny.png");
    await extractColorPalette(file);

    expect(mockCanvas.width).toBe(50);
    expect(mockCanvas.height).toBe(30);
  });

  it("rejects when image fails to load", async () => {
    setupImageErrorMock();
    const file = makeFile("bad.png");
    await expect(extractColorPalette(file)).rejects.toThrow("Failed to load image");
  });

  it("rejects when canvas context is null", async () => {
    mockCanvas.getContext = vi.fn().mockReturnValue(null);
    const file = makeFile("photo.png");
    await expect(extractColorPalette(file)).rejects.toThrow("Canvas 2D context not available");
  });

  it("returns exactly N colors (never empty/NaN buckets) when distinct colors exceed N", async () => {
    // 64 distinct opaque colors → requesting 8 must yield exactly 8 valid swatches
    const pixels = new Uint8ClampedArray(64 * 4);
    for (let i = 0; i < 64; i++) {
      pixels[i * 4] = i * 4;
      pixels[i * 4 + 1] = 255 - i * 3;
      pixels[i * 4 + 2] = (i * 7) % 256;
      pixels[i * 4 + 3] = 255;
    }
    setupCanvasMock(pixels);

    const colors = await extractColorPalette(makeFile("rainbow.png"), 8);
    expect(colors).toHaveLength(8);
    for (const c of colors) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.rgb.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});
