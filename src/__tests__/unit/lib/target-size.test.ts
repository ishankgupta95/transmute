import { describe, it, expect } from "vitest";

import {
  MAX_DIMENSION_STEPS,
  MAX_SCALE_FACTOR,
  MIN_LONGEST_SIDE,
  MIN_SCALE_FACTOR,
  nextScale,
  scaledToTargetWarning,
  stepDimensions,
} from "@/lib/tools/target-size";

/**
 * The dimension-stepping policy is pure math shared by BOTH image pipelines
 * (worker and fallback), so this file pins it exhaustively — a drift here is
 * a drift in what two different code paths ship to the user.
 */

describe("constants", () => {
  it("are internally coherent", () => {
    expect(MIN_SCALE_FACTOR).toBeGreaterThan(0);
    expect(MIN_SCALE_FACTOR).toBeLessThan(MAX_SCALE_FACTOR);
    expect(MAX_SCALE_FACTOR).toBeLessThan(1);
    expect(MIN_LONGEST_SIDE).toBeGreaterThan(0);
    expect(MAX_DIMENSION_STEPS).toBeGreaterThanOrEqual(1);
  });
});

describe("nextScale", () => {
  it("uses the sqrt heuristic between the clamp bounds", () => {
    // 2× over target → linear factor sqrt(1/2).
    expect(nextScale(2048, 1024)).toBeCloseTo(Math.SQRT1_2, 10);
    // 1.5× over target → sqrt(2/3), comfortably inside [0.5, 0.9].
    expect(nextScale(1536, 1024)).toBeCloseTo(Math.sqrt(1024 / 1536), 10);
  });

  it("clamps at the lower bound when the overshoot is huge", () => {
    // 100× over target → sqrt gives 0.1; the clamp refuses to nuke detail.
    expect(nextScale(100 * 1024, 1024)).toBe(MIN_SCALE_FACTOR);
    expect(nextScale(4 * 1024, 1024)).toBe(MIN_SCALE_FACTOR); // exactly sqrt(1/4)
  });

  it("clamps at the upper bound when barely (or not) over target", () => {
    // 1% over → sqrt ≈ 0.995; the clamp guarantees real progress.
    expect(nextScale(1034, 1024)).toBe(MAX_SCALE_FACTOR);
    // At or under target the ratio is ≥ 1 — still clamped, never grows.
    expect(nextScale(1024, 1024)).toBe(MAX_SCALE_FACTOR);
    expect(nextScale(512, 1024)).toBe(MAX_SCALE_FACTOR);
  });

  it("stays inside the clamp for a sweep of ratios", () => {
    for (let current = 1; current <= 1 << 20; current *= 2) {
      const f = nextScale(current, 1024);
      expect(f).toBeGreaterThanOrEqual(MIN_SCALE_FACTOR);
      expect(f).toBeLessThanOrEqual(MAX_SCALE_FACTOR);
    }
  });

  it("degenerate byte counts fall back to a valid factor, never NaN", () => {
    expect(nextScale(0, 1024)).toBe(MIN_SCALE_FACTOR); // ratio Infinity — degenerate
    expect(nextScale(1024, 0)).toBe(MIN_SCALE_FACTOR);
    expect(nextScale(-5, 1024)).toBe(MIN_SCALE_FACTOR);
    expect(nextScale(NaN, 1024)).toBe(MIN_SCALE_FACTOR);
  });
});

describe("stepDimensions", () => {
  it("scales both sides by the factor and returns integers", () => {
    expect(stepDimensions(4000, 3000, 0.5)).toEqual({ width: 2000, height: 1500 });
    expect(stepDimensions(3000, 4000, 0.5)).toEqual({ width: 1500, height: 2000 });
    const stepped = stepDimensions(333, 777, 0.7)!;
    expect(Number.isInteger(stepped.width)).toBe(true);
    expect(Number.isInteger(stepped.height)).toBe(true);
  });

  it("preserves the aspect ratio to within rounding", () => {
    const stepped = stepDimensions(1600, 900, 0.63)!;
    expect(stepped.width / stepped.height).toBeCloseTo(1600 / 900, 1);
  });

  it("clamps the factor to the policy bounds", () => {
    // 0.01 would skip straight past every useful size — clamped to 0.5.
    expect(stepDimensions(1000, 500, 0.01)).toEqual({ width: 500, height: 250 });
    // 0.99 makes no real progress — clamped to 0.9.
    expect(stepDimensions(1000, 500, 0.99)).toEqual({ width: 900, height: 450 });
    // A NaN factor must not poison the dims.
    expect(stepDimensions(1000, 500, NaN)).toEqual({ width: 500, height: 250 });
  });

  it("lands exactly on the floor instead of jumping past it", () => {
    // 0.5 × 100 = 50 < 64 → the step is softened to land at 64.
    expect(stepDimensions(100, 50, 0.5)).toEqual({ width: 64, height: 32 });
    // One pixel above the floor still steps — to the floor itself.
    const oneAbove = stepDimensions(65, 65, 0.5)!;
    expect(Math.max(oneAbove.width, oneAbove.height)).toBe(MIN_LONGEST_SIDE);
  });

  it("returns null at or below the floor — the loop's stop signal", () => {
    expect(stepDimensions(64, 48, 0.5)).toBeNull();
    expect(stepDimensions(48, 64, 0.5)).toBeNull();
    expect(stepDimensions(63, 63, 0.9)).toBeNull();
    expect(stepDimensions(1, 1, 0.5)).toBeNull();
  });

  it("returns null for degenerate inputs", () => {
    expect(stepDimensions(0, 100, 0.5)).toBeNull();
    expect(stepDimensions(100, 0, 0.5)).toBeNull();
    expect(stepDimensions(-800, 600, 0.5)).toBeNull();
    expect(stepDimensions(NaN, 600, 0.5)).toBeNull();
    expect(stepDimensions(Infinity, 600, 0.5)).toBeNull();
  });

  it("never returns a zero side, even for extreme aspect ratios", () => {
    // A 65×1 banner: the short side must round to 1, not 0.
    expect(stepDimensions(65, 1, 0.5)).toEqual({ width: 64, height: 1 });
    expect(stepDimensions(1, 65, 0.5)).toEqual({ width: 1, height: 64 });
  });

  it("shrinks strictly and monotonically until the floor, then stops", () => {
    // Walk from a large photo with the WEAKEST factor (0.9, the slowest
    // shrink) — the longest side must fall every step, neither side may ever
    // grow, and the walk must terminate at exactly the floor.
    let dims = { width: 4000, height: 3000 };
    let steps = 0;
    for (;;) {
      const next = stepDimensions(dims.width, dims.height, 0.9);
      if (next === null) break;
      expect(Math.max(next.width, next.height)).toBeLessThan(Math.max(dims.width, dims.height));
      expect(next.width).toBeLessThanOrEqual(dims.width);
      expect(next.height).toBeLessThanOrEqual(dims.height);
      dims = next;
      steps++;
      expect(steps, "stepping must terminate").toBeLessThan(200);
    }
    expect(Math.max(dims.width, dims.height)).toBe(MIN_LONGEST_SIDE);
  });
});

describe("scaledToTargetWarning", () => {
  it("produces the exact user-facing string, × character included", () => {
    expect(scaledToTargetWarning(800, 600)).toBe(
      "Scaled to 800×600 to reach the target size.",
    );
    expect(scaledToTargetWarning(64, 48)).toBe("Scaled to 64×48 to reach the target size.");
  });
});
