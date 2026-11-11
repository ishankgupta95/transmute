import { describe, it, expect } from "vitest";

import {
  MAX_DIMENSION_STEPS,
  MAX_QUALITY_PASSES,
  MAX_SCALE_FACTOR,
  MIN_LONGEST_SIDE,
  MIN_SCALE_FACTOR,
  QUALITY_CEILING,
  QUALITY_CLOSE_ENOUGH,
  QUALITY_FLOOR,
  nextScale,
  scaledImagesWarning,
  scaledToTargetWarning,
  searchQuality,
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

describe("scaledImagesWarning", () => {
  /*
    The document-level counterpart, used by recompress-pdf-images. It is a
    single-producer user-facing string with no other coverage anywhere — the
    UI is its only caller and the conversion suite does not assert on it — so
    the wording is pinned here or it is pinned nowhere.
  */
  it("names the floor, because the factor is NOT applied to images near it", () => {
    // The clause is load-bearing: clampScale raises the scale for any image
    // whose longest side would drop under MIN_LONGEST_SIDE, so a flat "scaled
    // to 50%" would be false for exactly those images.
    expect(scaledImagesWarning(0.5)).toContain(`${MIN_LONGEST_SIDE}px`);
  });

  it("produces the exact user-facing string", () => {
    expect(scaledImagesWarning(0.5)).toBe(
      "Images scaled to 50% of their original size to reach the target — " +
        "except any that would have fallen below 64px, which were scaled less.",
    );
    expect(scaledImagesWarning(0.729)).toBe(
      "Images scaled to 73% of their original size to reach the target — " +
        "except any that would have fallen below 64px, which were scaled less.",
    );
  });

  it("never renders a bare 1 as a scale, because the caller gates on scale < 1", () => {
    // Documents the contract between producer and caller rather than the
    // maths: at scale 1 nothing was resized, so the sentence must not appear.
    // If a future caller drops that gate, this string is what it would show.
    expect(scaledImagesWarning(1)).toContain("Images scaled to 100% of their original size");
  });

  it("rounds rather than truncating, so a 99.6% scale does not read as 99%", () => {
    expect(scaledImagesWarning(0.996)).toContain("Images scaled to 100% of their original size");
  });
});

/*
  ── searchQuality ──────────────────────────────────────────────────────

  The quality half of the engine, and the half that decides how much CPU a
  target-size run costs: every pass is a full re-encode of the image at the
  current dimensions. A fake encoder is used here rather than a canvas, which
  is what makes the pass COUNT directly assertable — the thing the floor probe
  exists to reduce and the thing a canvas mock can only measure by proxy.

  Sizes are a function of quality, never of call order, so these tests pin
  behaviour and not the number of times the search happens to encode.
*/

/**
 * A fake encoder: `sizeAt(quality)` bytes per call, with the qualities it was
 * asked for recorded. Monotonic size in quality is the only thing
 * `searchQuality` assumes, so that is what the helpers below provide.
 */
function fakeEncoder(sizeAt: (quality: number) => number) {
  const qualities: number[] = [];
  const encode = (quality: number): Promise<Blob> => {
    qualities.push(quality);
    return Promise.resolve(new Blob([new Uint8Array(Math.max(0, Math.round(sizeAt(quality))))]));
  };
  return { encode, qualities, get calls() { return qualities.length; } };
}

/** Linear in quality, from `min` at quality 0 to `max` at quality 1. */
const ramp = (min: number, max: number) => (q: number) => min + (max - min) * q;

describe("searchQuality", () => {
  it("takes the fast path when best quality already fits, with one encode", async () => {
    const enc = fakeEncoder(ramp(100, 1000));
    const { under, smallest } = await searchQuality(enc.encode, 5000);

    expect(enc.calls, "a target already met at q=1.0 needs no search").toBe(1);
    expect(enc.qualities).toEqual([QUALITY_CEILING]);
    expect(under?.size).toBe(1000);
    expect(smallest.size).toBe(1000);
  });

  it("rules an unreachable target out with two encodes, not eleven", async () => {
    /*
      THE WHOLE POINT OF THE FLOOR PROBE. Nothing between 2000 and 4000 bytes
      can satisfy a 1000-byte target, and one encode at the floor says so.
      Before the probe this cost the full bisection — once per dimension step,
      at full resolution, every time.
    */
    const sizeAt = ramp(2000, 4000);
    const enc = fakeEncoder(sizeAt);
    const { under, smallest } = await searchQuality(enc.encode, 1000);

    expect(enc.calls).toBe(2);
    expect(enc.qualities).toEqual([QUALITY_CEILING, QUALITY_FLOOR]);
    expect(under, "no quality reaches the target, and the caller must be told").toBeNull();
    // The floor is QUALITY_FLOOR, not 0 — it is a real encode at a real
    // quality, so derive the figure rather than assuming the bottom of the ramp.
    expect(smallest.size, "the floor encode is the smallest thing available").toBe(
      Math.round(sizeAt(QUALITY_FLOOR)),
    );
  });

  it("finds an under-target result and never exceeds the pass cap", async () => {
    const enc = fakeEncoder(ramp(100, 10_000));
    const target = 4000;
    const { under, smallest } = await searchQuality(enc.encode, target);

    expect(under, "this target is reachable").not.toBeNull();
    expect(under!.size).toBeLessThanOrEqual(target);
    expect(smallest.size).toBeLessThanOrEqual(under!.size);
    // Ceiling probe + floor probe + at most MAX_QUALITY_PASSES bisections.
    expect(enc.calls).toBeLessThanOrEqual(2 + MAX_QUALITY_PASSES);
  });

  it("stops once the result is inside the close-enough band", async () => {
    const enc = fakeEncoder(ramp(100, 10_000));
    const target = 4000;
    const { under } = await searchQuality(enc.encode, target);

    // Landing just under the target is the goal: a much smaller file means
    // quality the user asked for and did not get.
    expect(under!.size).toBeGreaterThan(target * QUALITY_CLOSE_ENOUGH);
    expect(under!.size).toBeLessThanOrEqual(target);
  });

  it("returns a result for a target only the very bottom of the range reaches", async () => {
    /*
      A REGRESSION THE PROBE CLOSED. Ten bisections from [0.01, 1.0] bring the
      upper bound down to about 0.011 and never evaluate the floor itself, so a
      target that only q <= 0.0105 satisfies used to fall out of the loop as
      `under: null` — and the caller would downscale a picture that did not
      need it. The floor is a measured point now, so it cannot.
    */
    const target = 1000;
    const enc = fakeEncoder((q) => (q <= 0.0105 ? 900 : 5000));
    const { under, smallest } = await searchQuality(enc.encode, target);

    expect(under, "reachable at the floor, so a blob must come back").not.toBeNull();
    expect(under!.size).toBeLessThanOrEqual(target);
    expect(smallest.size).toBe(900);
  });

  it("tracks the smallest blob seen even when it is not the answer", async () => {
    const enc = fakeEncoder(ramp(50, 10_000));
    const { under, smallest } = await searchQuality(enc.encode, 9000);

    expect(under!.size).toBeLessThanOrEqual(9000);
    // The floor probe is the smallest thing encoded, and stays reported as
    // such — it is what `nextScale` steers the next dimension step with.
    expect(smallest.size).toBeLessThan(under!.size);
  });

  it("reports one pass per encode, for the progress bars that count them", async () => {
    const enc = fakeEncoder(ramp(100, 10_000));
    let passes = 0;
    await searchQuality(enc.encode, 4000, () => { passes++; });

    expect(passes).toBe(enc.calls);
  });

  it("never asks for a quality outside the declared bounds", async () => {
    const enc = fakeEncoder(ramp(100, 10_000));
    await searchQuality(enc.encode, 4000);

    for (const q of enc.qualities) {
      expect(q).toBeGreaterThanOrEqual(QUALITY_FLOOR);
      expect(q).toBeLessThanOrEqual(QUALITY_CEILING);
    }
  });
});
