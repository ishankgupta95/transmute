import { describe, expect, it } from "vitest";
import { luma, ssim } from "@/lib/tools/image-metrics";

/*
  Pure-math coverage only. `ssimFromBlobs` needs canvas + createImageBitmap,
  which jsdom lacks — the browser path is exercised by the conversion E2E
  (compress-image renders a computed SSIM stat).
*/

function flat(value: number, size: number): Float64Array {
  return new Float64Array(size).fill(value);
}

describe("luma", () => {
  it("applies Rec. 601 weights and ignores alpha", () => {
    // One red, one green, one blue, one white pixel.
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 0,
      0, 0, 255, 128,
      255, 255, 255, 255,
    ]);
    const y = luma(data, 4, 1);
    expect(y[0]).toBeCloseTo(0.299 * 255, 5);
    expect(y[1]).toBeCloseTo(0.587 * 255, 5);
    expect(y[2]).toBeCloseTo(0.114 * 255, 5);
    expect(y[3]).toBeCloseTo(255, 5);
  });
});

describe("ssim", () => {
  it("returns 1 for identical images", () => {
    const a = new Float64Array(16 * 16).map((_, i) => (i * 37) % 256);
    expect(ssim(a, new Float64Array(a), 16, 16)).toBeCloseTo(1, 10);
  });

  it("matches the closed form for two flat images", () => {
    // Flat fields have zero variance and covariance, so SSIM reduces to
    // (2·μa·μb + C1) / (μa² + μb² + C1).
    const C1 = (0.01 * 255) ** 2;
    const a = flat(100, 16 * 16);
    const b = flat(110, 16 * 16);
    const expected = (2 * 100 * 110 + C1) / (100 ** 2 + 110 ** 2 + C1);
    expect(ssim(a, b, 16, 16)).toBeCloseTo(expected, 10);
  });

  it("scores an inverted image far below a lightly shifted one", () => {
    const base = new Float64Array(32 * 32).map((_, i) => (i * 53) % 256);
    const shifted = base.map((v) => Math.min(255, v + 3));
    const inverted = base.map((v) => 255 - v);
    const near = ssim(base, shifted, 32, 32);
    const far = ssim(base, inverted, 32, 32);
    expect(near).toBeGreaterThan(0.9);
    expect(far).toBeLessThan(0.2);
    expect(near).toBeGreaterThan(far);
  });

  it("falls back to a whole-image window below 8×8", () => {
    const a = flat(50, 4 * 4);
    expect(ssim(a, new Float64Array(a), 4, 4)).toBeCloseTo(1, 10);
  });

  it("throws on mismatched dimensions", () => {
    expect(() => ssim(flat(0, 16), flat(0, 32), 4, 4)).toThrow();
  });
});
