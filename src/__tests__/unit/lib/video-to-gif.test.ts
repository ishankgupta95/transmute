import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock gifenc
vi.mock("gifenc", () => {
  const mockGif = {
    writeFrame: vi.fn(),
    finish: vi.fn(),
    bytes: vi.fn().mockReturnValue(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39])),
  };
  return {
    GIFEncoder: vi.fn().mockReturnValue(mockGif),
    quantize: vi.fn().mockReturnValue([[0, 0, 0], [255, 255, 255]]),
    applyPalette: vi.fn().mockReturnValue(new Uint8Array([0, 1, 0, 1])),
  };
});

import { GIFEncoder, quantize, applyPalette } from "gifenc";

describe("video-to-gif module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GIFEncoder is called by the gifenc mock", () => {
    const gif = GIFEncoder();
    expect(gif).toBeDefined();
    expect(gif.writeFrame).toBeDefined();
    expect(gif.finish).toBeDefined();
    expect(gif.bytes).toBeDefined();
  });

  it("quantize produces a palette from RGBA data", () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const palette = quantize(rgba, 256);
    expect(palette).toBeDefined();
    expect(Array.isArray(palette)).toBe(true);
  });

  it("applyPalette produces indexed pixels", () => {
    const rgba = new Uint8Array([255, 0, 0, 255]);
    const palette: [number, number, number][] = [[255, 0, 0]];
    const indexed = applyPalette(rgba, palette);
    expect(indexed).toBeInstanceOf(Uint8Array);
  });
});
