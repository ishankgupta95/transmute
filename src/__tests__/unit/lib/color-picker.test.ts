import { describe, it, expect } from "vitest";
import { parseHex, rgbToHex, rgbToHsl, hslToRgb } from "@/lib/tools/color-picker";

describe("parseHex", () => {
  it("parses 6-digit hex with or without #", () => {
    expect(parseHex("#2dd4bf")).toEqual([45, 212, 191]);
    expect(parseHex("2DD4BF")).toEqual([45, 212, 191]);
  });

  it("parses 3-digit shorthand — the old parser NaN'd it", () => {
    expect(parseHex("#abc")).toEqual([170, 187, 204]);
    expect(parseHex("fff")).toEqual([255, 255, 255]);
  });

  it("returns null (never NaN) for partial or garbage input", () => {
    expect(parseHex("#2d")).toBeNull();
    expect(parseHex("#2dd4b")).toBeNull();
    expect(parseHex("#gggggg")).toBeNull();
    expect(parseHex("")).toBeNull();
  });
});

describe("rgbToHex", () => {
  it("round-trips with parseHex", () => {
    expect(rgbToHex(45, 212, 191)).toBe("#2dd4bf");
  });

  it("clamps out-of-range and non-finite channels", () => {
    expect(rgbToHex(300, -5, 128)).toBe("#ff0080");
    expect(rgbToHex(NaN, 0, 0)).toBe("#000000");
  });
});

describe("rgb ↔ hsl", () => {
  it("round-trips primary colours", () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 100, 50]);
    expect(hslToRgb(0, 100, 50)).toEqual([255, 0, 0]);
    // Integer HSL loses precision; a round-trip lands within a few steps.
    const roundTrip = hslToRgb(...rgbToHsl(45, 212, 191));
    for (const [i, expected] of [45, 212, 191].entries()) {
      expect(Math.abs(roundTrip[i] - expected)).toBeLessThanOrEqual(3);
    }
  });

  it("handles achromatic grey", () => {
    expect(rgbToHsl(128, 128, 128)).toEqual([0, 0, 50]);
    expect(hslToRgb(0, 0, 50)).toEqual([128, 128, 128]);
  });
});
