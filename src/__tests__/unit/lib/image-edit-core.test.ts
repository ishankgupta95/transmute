import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

import {
  clampDimension,
  drawEdit,
  editDestRect,
  editOutputPlan,
  editOutputSize,
  editSourceRect,
  editVerbSuffix,
  isMultiOutputEdit,
  MAX_CANVAS_DIMENSION,
  MAX_SPLIT_COLS,
  MAX_SPLIT_ROWS,
  needsOpaqueFill,
} from "@/lib/tools/image-edit-core";
import type { EditRect, ImageEditOptions } from "@/lib/workers/image-protocol";

/**
 * The eight edit verbs are one implementation shared by the worker and the
 * main-thread fallback, so every number they produce is pinned here: the
 * arithmetic that decides how big each output is, which part of the source it
 * comes from, and — for pixelate — where on the output that part lands.
 *
 * jsdom has no canvas, but it does not need one to read that last group back.
 * `drawEdit` puts its whole answer in the ARGUMENTS it hands `drawImage`, so
 * the pixelate arm is exercised at the bottom of this file against a recording
 * context. Leaving it unexercised is what let a version ship that painted the
 * blocks at source coordinates on a ceiling-scaled canvas.
 */

const rotate = (degrees: 90 | 180 | 270): ImageEditOptions => ({ kind: "rotate", degrees });
const split = (rows: number, cols: number): ImageEditOptions => ({ kind: "split", rows, cols });

describe("editVerbSuffix", () => {
  it("names every verb, and the names are the ones the filenames promise", () => {
    expect(editVerbSuffix(rotate(90))).toBe("rotated");
    expect(editVerbSuffix({ kind: "flip", axis: "horizontal" })).toBe("flipped");
    expect(
      editVerbSuffix({
        kind: "watermark",
        text: "x",
        scale: 0.1,
        opacity: 0.5,
        colour: "#ffffff",
        position: "center",
        rotationDeg: 0,
      }),
    ).toBe("watermarked");
    expect(editVerbSuffix({ kind: "pixelate", region: null, blockSize: 8 })).toBe("pixelated");
    expect(editVerbSuffix({ kind: "crop-circle", region: null })).toBe("circle");
    expect(
      editVerbSuffix({ kind: "border", top: 1, right: 1, bottom: 1, left: 1, colour: "#000000" }),
    ).toBe("bordered");
  });
});

describe("isMultiOutputEdit", () => {
  it("is true for exactly the two list-producing verbs", () => {
    expect(isMultiOutputEdit(split(2, 2))).toBe(true);
    expect(
      isMultiOutputEdit({ kind: "presets", outputs: [], fit: "cover", padColour: "#ffffff" }),
    ).toBe(true);
    expect(isMultiOutputEdit(rotate(180))).toBe(false);
    expect(isMultiOutputEdit({ kind: "crop-circle", region: null })).toBe(false);
  });
});

describe("needsOpaqueFill", () => {
  it("is true only for the format that cannot carry alpha", () => {
    expect(needsOpaqueFill("jpeg")).toBe(true);
    expect(needsOpaqueFill("png")).toBe(false);
    expect(needsOpaqueFill("webp")).toBe(false);
  });
});

describe("clampDimension", () => {
  it("rounds, floors at 1 and ceilings at the canvas limit", () => {
    expect(clampDimension(1.4)).toBe(1);
    expect(clampDimension(1023.6)).toBe(1024);
    expect(clampDimension(0)).toBe(1);
    expect(clampDimension(-40)).toBe(1);
    expect(clampDimension(MAX_CANVAS_DIMENSION + 1)).toBe(MAX_CANVAS_DIMENSION);
    // Non-finite is meaningless, not "as big as possible": NaN and Infinity
    // both collapse to the 1px floor rather than allocating the ceiling.
    expect(clampDimension(NaN)).toBe(1);
    expect(clampDimension(Infinity)).toBe(1);
  });
});

describe("rotate", () => {
  it("transposes the frame for 90 and 270 and leaves 180 alone", () => {
    expect(editOutputSize(800, 600, rotate(90))).toEqual({ width: 600, height: 800 });
    expect(editOutputSize(800, 600, rotate(270))).toEqual({ width: 600, height: 800 });
    expect(editOutputSize(800, 600, rotate(180))).toEqual({ width: 800, height: 600 });
  });

  it("draws from the whole source whatever the angle", () => {
    for (const degrees of [90, 180, 270] as const) {
      expect(editSourceRect(800, 600, rotate(degrees), 0)).toEqual({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      });
    }
  });
});

describe("flip", () => {
  it("keeps the frame on both axes", () => {
    expect(editOutputSize(800, 600, { kind: "flip", axis: "horizontal" })).toEqual({
      width: 800,
      height: 600,
    });
    expect(editOutputSize(800, 600, { kind: "flip", axis: "vertical" })).toEqual({
      width: 800,
      height: 600,
    });
  });
});

describe("crop-circle", () => {
  it("with no selection frames the largest centred square", () => {
    // Landscape: the square is the height, centred horizontally.
    expect(editSourceRect(800, 600, { kind: "crop-circle", region: null }, 0)).toEqual({
      x: 100,
      y: 0,
      width: 600,
      height: 600,
    });
    // Portrait: the square is the width, centred vertically.
    expect(editSourceRect(600, 800, { kind: "crop-circle", region: null }, 0)).toEqual({
      x: 0,
      y: 100,
      width: 600,
      height: 600,
    });
    expect(editOutputSize(800, 600, { kind: "crop-circle", region: null })).toEqual({
      width: 600,
      height: 600,
    });
  });

  it("fits a square inside a non-square selection rather than stretching it", () => {
    const edit: ImageEditOptions = {
      kind: "crop-circle",
      region: { x: 100, y: 50, width: 400, height: 200 },
    };
    // A 400×200 selection yields a 200×200 frame centred in it — an ellipse is
    // never the answer to "crop to a circle".
    expect(editSourceRect(800, 600, edit, 0)).toEqual({ x: 200, y: 50, width: 200, height: 200 });
  });

  it("clamps a selection that runs off the edge instead of reading past it", () => {
    const edit: ImageEditOptions = {
      kind: "crop-circle",
      region: { x: 700, y: 500, width: 400, height: 400 },
    };
    const rect = editSourceRect(800, 600, edit, 0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(800);
    expect(rect.y + rect.height).toBeLessThanOrEqual(600);
    expect(rect.width).toBe(rect.height);
  });
});

describe("border", () => {
  it("grows the frame by the four sides", () => {
    expect(
      editOutputSize(800, 600, {
        kind: "border",
        top: 10,
        right: 20,
        bottom: 30,
        left: 40,
        colour: "#000000",
      }),
    ).toEqual({ width: 800 + 40 + 20, height: 600 + 10 + 30 });
  });

  it("treats negative and non-finite widths as no border", () => {
    expect(
      editOutputSize(100, 100, {
        kind: "border",
        top: -50,
        right: NaN,
        bottom: 0,
        left: -1,
        colour: "#000000",
      }),
    ).toEqual({ width: 100, height: 100 });
  });
});

describe("pixelate", () => {
  it("keeps the frame and reports the region as the source rect", () => {
    const whole: ImageEditOptions = { kind: "pixelate", region: null, blockSize: 12 };
    expect(editOutputSize(800, 600, whole)).toEqual({ width: 800, height: 600 });
    expect(editSourceRect(800, 600, whole, 0)).toEqual({ x: 0, y: 0, width: 800, height: 600 });

    const partial: ImageEditOptions = {
      kind: "pixelate",
      region: { x: 10, y: 20, width: 100, height: 50 },
      blockSize: 12,
    };
    expect(editSourceRect(800, 600, partial, 0)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });
});

describe("split", () => {
  it("produces rows × cols outputs, labelled 1-based row/column", () => {
    const plan = editOutputPlan(800, 600, split(2, 3));
    expect(plan).toHaveLength(6);
    expect(plan.map((p) => p.label)).toEqual([
      "r1c1",
      "r1c2",
      "r1c3",
      "r2c1",
      "r2c2",
      "r2c3",
    ]);
  });

  it("tiles the source EXACTLY — no gap, no overlap, no overhang", () => {
    // The letterbox-rounding class of bug: widths rounded independently leave a
    // seam or a one-pixel overhang. Every awkward size and grid below is a case
    // where naive `round(w/cols)` per tile does not sum back to w.
    const cases: [number, number, number, number][] = [
      [800, 600, 3, 3],
      [1001, 999, 7, 5],
      [17, 13, 4, 3],
      [1920, 1080, 10, 10],
      [3, 3, 3, 3],
      [4000, 3000, 2, 7],
    ];
    for (const [w, h, rows, cols] of cases) {
      const edit = split(rows, cols);
      const plan = editOutputPlan(w, h, edit);
      expect(plan).toHaveLength(rows * cols);

      for (let row = 0; row < rows; row++) {
        // Widths across a row chain from x=0 to exactly w.
        let cursor = 0;
        for (let col = 0; col < cols; col++) {
          const cell = editSourceRect(w, h, edit, row * cols + col);
          expect(cell.x).toBe(cursor);
          expect(cell.width).toBeGreaterThan(0);
          cursor = cell.x + cell.width;
        }
        expect(cursor).toBe(w);
      }
      for (let col = 0; col < cols; col++) {
        let cursor = 0;
        for (let row = 0; row < rows; row++) {
          const cell = editSourceRect(w, h, edit, row * cols + col);
          expect(cell.y).toBe(cursor);
          expect(cell.height).toBeGreaterThan(0);
          cursor = cell.y + cell.height;
        }
        expect(cursor).toBe(h);
      }
      // Every output canvas is exactly its tile.
      plan.forEach((entry, index) => {
        const cell = editSourceRect(w, h, edit, index);
        expect(entry.width).toBe(cell.width);
        expect(entry.height).toBe(cell.height);
      });
    }
  });

  it("caps the grid at 10 × 10", () => {
    expect(editOutputPlan(2000, 2000, split(40, 40))).toHaveLength(
      MAX_SPLIT_ROWS * MAX_SPLIT_COLS,
    );
  });

  it("never asks for more tiles than the image has pixels", () => {
    // 4 columns out of a 3px-wide image would need a zero-width tile, and a
    // zero-width tile clamped up to 1 would break the exact-tiling invariant.
    const plan = editOutputPlan(3, 2, split(9, 9));
    expect(plan).toHaveLength(2 * 3);
    let cursor = 0;
    for (let col = 0; col < 3; col++) {
      const cell = editSourceRect(3, 2, split(9, 9), col);
      expect(cell.x).toBe(cursor);
      cursor = cell.x + cell.width;
    }
    expect(cursor).toBe(3);
  });

  it("clamps a rogue index to a real tile instead of returning undefined", () => {
    const edit = split(2, 2);
    expect(editSourceRect(100, 100, edit, 99)).toEqual(editSourceRect(100, 100, edit, 3));
    expect(editSourceRect(100, 100, edit, -5)).toEqual(editSourceRect(100, 100, edit, 0));
  });
});

describe("presets", () => {
  const outputs = [
    { label: "Instagram Square", width: 1080, height: 1080 },
    { label: "Twitter / X header", width: 1500, height: 500 },
    { label: "", width: 200, height: 200 },
  ];

  it("plans one output per preset and hyphenates the labels into filename stems", () => {
    const plan = editOutputPlan(4000, 3000, {
      kind: "presets",
      outputs,
      fit: "cover",
      padColour: "#ffffff",
    });
    expect(plan).toEqual([
      // `scaled` is false throughout: a preset is only ever a few thousand
      // pixels, so the canvas ceiling never bites here.
      { width: 1080, height: 1080, label: "instagram-square", scaled: false },
      { width: 1500, height: 500, label: "twitter-x-header", scaled: false },
      { width: 200, height: 200, label: "preset-3", scaled: false },
    ]);
  });

  it("cover centre-crops the source to the preset's aspect ratio", () => {
    const edit: ImageEditOptions = {
      kind: "presets",
      outputs,
      fit: "cover",
      padColour: "#ffffff",
    };
    // 4000×3000 into a 1:1 frame: the full height, centred horizontally.
    expect(editSourceRect(4000, 3000, edit, 0)).toEqual({
      x: 500,
      y: 0,
      width: 3000,
      height: 3000,
    });
    // …into a 3:1 frame: the full width, a 1333px band centred vertically.
    const banner = editSourceRect(4000, 3000, edit, 1);
    expect(banner.width).toBe(4000);
    expect(banner.height).toBe(Math.round(500 / (1500 / 4000)));
    expect(banner.y).toBe(Math.round((3000 - banner.height) / 2));
  });

  it("contain reads the whole source — the frame is filled with padding, not crop", () => {
    const edit: ImageEditOptions = {
      kind: "presets",
      outputs,
      fit: "contain",
      padColour: "#ffffff",
    };
    expect(editSourceRect(4000, 3000, edit, 1)).toEqual({
      x: 0,
      y: 0,
      width: 4000,
      height: 3000,
    });
  });

  it("an empty preset list plans nothing, and the size falls back to the source", () => {
    const edit: ImageEditOptions = {
      kind: "presets",
      outputs: [],
      fit: "cover",
      padColour: "#ffffff",
    };
    expect(editOutputPlan(800, 600, edit)).toEqual([]);
    expect(editOutputSize(800, 600, edit)).toEqual({ width: 800, height: 600 });
  });
});

describe("degenerate sources", () => {
  it("never plans a zero or fractional canvas", () => {
    const edits: ImageEditOptions[] = [
      rotate(90),
      { kind: "flip", axis: "vertical" },
      { kind: "crop-circle", region: null },
      { kind: "border", top: 5, right: 5, bottom: 5, left: 5, colour: "#000000" },
      split(3, 3),
    ];
    for (const edit of edits) {
      for (const [w, h] of [
        [0, 0],
        [0.4, 0.4],
        [NaN, 10],
        [-100, -100],
      ]) {
        for (const entry of editOutputPlan(w, h, edit)) {
          expect(Number.isInteger(entry.width)).toBe(true);
          expect(Number.isInteger(entry.height)).toBe(true);
          expect(entry.width).toBeGreaterThanOrEqual(1);
          expect(entry.height).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("clamps an enormous frame to the canvas ceiling", () => {
    const { width, height } = editOutputSize(20000, 20000, rotate(90));
    expect(width).toBe(MAX_CANVAS_DIMENSION);
    expect(height).toBe(MAX_CANVAS_DIMENSION);
  });
});

/*
  The regression this file was missing, and the reason it was missing it: the
  ceiling test above uses a SQUARE source, which is the one shape where
  clamping the two axes independently looks correct. It is not correct for any
  other shape, and the inputs that expose it are ordinary camera files rather
  than contrived ones — a 61 MP full-frame frame is 9504 x 6336, and a 12000px
  panorama is a normal thing to own.

  Before the fix, `Math.min(8192, edge)` per axis meant a flipped 9504 x 6336
  photo came out 8192 x 6336: the same picture squashed 13.8% along one axis,
  with nothing said about it. rotate and border failed differently — their
  draws are at natural size, so instead of squashing they CROPPED, and border
  additionally lost its right and bottom edges entirely.

  Aspect ratio is asserted rather than exact pixel sizes because the fit is a
  scale followed by a round, so one edge can land a pixel off; a shape that
  survives to within a pixel is the property that matters.
*/
describe("the canvas ceiling never changes the shape of the picture", () => {
  /** Sources with an edge past the ceiling, in both orientations. */
  const OVERSIZED: [number, number, string][] = [
    [12000, 3000, "a panorama"],
    [3000, 12000, "a tall panorama"],
    [9504, 6336, "a 61 MP full-frame frame"],
    [6336, 9504, "the same frame in portrait"],
    [8688, 5792, "a 50 MP photo"],
    [8193, 8192, "one pixel over on one edge only"],
  ];

  const WHOLE_FRAME_VERBS: [string, ImageEditOptions][] = [
    ["flip-h", { kind: "flip", axis: "horizontal" }],
    ["flip-v", { kind: "flip", axis: "vertical" }],
    ["watermark", {
      kind: "watermark",
      text: "draft",
      scale: 0.1,
      opacity: 0.5,
      colour: "#ffffff",
      position: "center",
      rotationDeg: 0,
    }],
    ["pixelate", { kind: "pixelate", region: null, blockSize: 8 }],
    ["rotate-180", rotate(180)],
  ];

  it.each(WHOLE_FRAME_VERBS)("%s keeps the source aspect ratio", (_name, verb) => {
    for (const [w, h, what] of OVERSIZED) {
      const [entry] = editOutputPlan(w, h, verb);
      const sourceAspect = w / h;
      const outputAspect = entry.width / entry.height;
      expect(
        Math.abs(outputAspect / sourceAspect - 1),
        `${what} (${w}x${h}) came out ${entry.width}x${entry.height}`,
      ).toBeLessThan(0.001);
      expect(entry.scaled).toBe(true);
    }
  });

  it("rotate transposes the shape without distorting it", () => {
    for (const degrees of [90, 270] as const) {
      for (const [w, h, what] of OVERSIZED) {
        const [entry] = editOutputPlan(w, h, rotate(degrees));
        // A quarter turn swaps the edges, so the OUTPUT's height/width must
        // match the SOURCE's width/height.
        expect(
          Math.abs(entry.height / entry.width / (w / h) - 1),
          `${what} rotated ${degrees} came out ${entry.width}x${entry.height}`,
        ).toBeLessThan(0.001);
      }
    }
  });

  it("border keeps the framed shape, borders included", () => {
    for (const [w, h, what] of OVERSIZED) {
      const edit: ImageEditOptions = {
        kind: "border",
        top: 100,
        right: 100,
        bottom: 100,
        left: 100,
        colour: "#000000",
      };
      const [entry] = editOutputPlan(w, h, edit);
      const framedAspect = (w + 200) / (h + 200);
      expect(
        Math.abs(entry.width / entry.height / framedAspect - 1),
        `${what} framed came out ${entry.width}x${entry.height}`,
      ).toBeLessThan(0.001);
    }
  });

  it("split keeps each tile's shape when a single tile is over the ceiling", () => {
    // One column of a 12000px panorama IS the whole panorama, so the tile
    // itself is oversized — the case a 3x3 grid never reaches.
    const [entry] = editOutputPlan(12000, 3000, split(1, 1));
    expect(Math.abs(entry.width / entry.height / (12000 / 3000) - 1)).toBeLessThan(0.001);
    expect(entry.scaled).toBe(true);
  });

  it("reports `scaled` only when it actually shrank something", () => {
    for (const [, verb] of WHOLE_FRAME_VERBS) {
      // Exactly at the ceiling is not over it.
      expect(editOutputPlan(MAX_CANVAS_DIMENSION, 4000, verb)[0].scaled).toBe(false);
      expect(editOutputPlan(640, 480, verb)[0].scaled).toBe(false);
      expect(editOutputPlan(MAX_CANVAS_DIMENSION + 1, 4000, verb)[0].scaled).toBe(true);
    }
  });

  it("never plans an output past the ceiling, for any verb or shape", () => {
    for (const [w, h] of OVERSIZED) {
      for (const [, verb] of WHOLE_FRAME_VERBS) {
        for (const entry of editOutputPlan(w, h, verb)) {
          expect(Math.max(entry.width, entry.height)).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
        }
      }
      for (const entry of editOutputPlan(w, h, split(1, 1))) {
        expect(Math.max(entry.width, entry.height)).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
      }
    }
  });
});

describe("editDestRect — where a natural-pixel region lands on the output canvas", () => {
  const pixelate = (region: EditRect | null, blockSize = 16): ImageEditOptions => ({
    kind: "pixelate",
    region,
    blockSize,
  });

  /** Sources under and over the ceiling, both orientations, both parities. */
  const SOURCES: [number, number][] = [
    [4000, 3000],
    [640, 480],
    [1200, 800],
    [12000, 3000],
    [3000, 12000],
    [9504, 6336],
    [6336, 9504],
    [8688, 5792],
    [8193, 8192],
    [30000, 400],
  ];

  /** Regions as a FRACTION of the source, so one list covers every size: the
   *  four edges, the four corners, the middle, and full-bleed. */
  const REGIONS: [number, number, number, number, string][] = [
    [0, 0, 0.25, 0.25, "top-left corner"],
    [0.75, 0, 0.25, 0.25, "top-right corner"],
    [0, 0.75, 0.25, 0.25, "bottom-left corner"],
    [0.75, 0.75, 0.25, 0.25, "bottom-right corner"],
    [0.4, 0.4, 0.2, 0.2, "the middle"],
    [0, 0.45, 1, 0.1, "a full-width band"],
    [0.45, 0, 0.1, 1, "a full-height band"],
    [0, 0, 1, 1, "the whole frame"],
    [0.5, 0.5, 0.001, 0.001, "a near-degenerate speck"],
  ];

  it("covers the selected content on the output, and never misses it", () => {
    for (const [srcW, srcH] of SOURCES) {
      const [plan] = editOutputPlan(srcW, srcH, pixelate(null));
      const scaleX = plan.width / srcW;
      const scaleY = plan.height / srcH;

      for (const [fx, fy, fw, fh, what] of REGIONS) {
        const region: EditRect = {
          x: Math.round(fx * srcW),
          y: Math.round(fy * srcH),
          width: Math.max(1, Math.round(fw * srcW)),
          height: Math.max(1, Math.round(fh * srcH)),
        };
        // Only rectangles that already fit are compared against the ideal —
        // a clamped one is a different rectangle, and gets its own case below.
        if (region.x + region.width > srcW || region.y + region.height > srcH) continue;
        const dest = editDestRect(region, srcW, srcH, plan.width, plan.height);
        const where = `${what} of ${srcW}x${srcH} -> ${plan.width}x${plan.height}`;

        // The area the background draw put that content in. Pinned to the
        // canvas at both ends: a full-bleed region's far edge lands on it to
        // within a float ulp, and no content lives outside it either way.
        const idealLeft = region.x * scaleX;
        const idealTop = region.y * scaleY;
        const idealRight = Math.min(plan.width, (region.x + region.width) * scaleX);
        const idealBottom = Math.min(plan.height, (region.y + region.height) * scaleY);

        // COVERS IT. A dest rect that stops short leaves a strip of the
        // original showing through the thing the user was hiding — the right
        // and bottom edges are where rounding to nearest gives that away.
        expect(dest.x, `${where}: left edge`).toBeLessThanOrEqual(idealLeft);
        expect(dest.y, `${where}: top edge`).toBeLessThanOrEqual(idealTop);
        expect(dest.x + dest.width, `${where}: right edge`).toBeGreaterThanOrEqual(idealRight);
        expect(dest.y + dest.height, `${where}: bottom edge`).toBeGreaterThanOrEqual(idealBottom);

        // …and covers no more than a pixel of the neighbours on any side, so
        // "cover it" cannot be met by painting over the whole picture.
        expect(idealLeft - dest.x, `${where}: left overhang`).toBeLessThan(1);
        expect(idealTop - dest.y, `${where}: top overhang`).toBeLessThan(1);
        expect(dest.x + dest.width - idealRight, `${where}: right overhang`).toBeLessThan(1);
        expect(dest.y + dest.height - idealBottom, `${where}: bottom overhang`).toBeLessThan(1);

        // Every edge on the canvas: a rect that runs off it is painted nowhere.
        expect(dest.x, `${where}: inside left`).toBeGreaterThanOrEqual(0);
        expect(dest.y, `${where}: inside top`).toBeGreaterThanOrEqual(0);
        expect(dest.x + dest.width, `${where}: inside right`).toBeLessThanOrEqual(plan.width);
        expect(dest.y + dest.height, `${where}: inside bottom`).toBeLessThanOrEqual(plan.height);
        expect(dest.width, `${where}: non-empty`).toBeGreaterThanOrEqual(1);
        expect(dest.height, `${where}: non-empty`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("is the identity for every source the ceiling did not touch", () => {
    // Below the ceiling the output canvas IS the source, so a mapping that
    // moved anything here would be the bug in the other direction.
    for (const [srcW, srcH] of SOURCES.filter(([w, h]) => Math.max(w, h) <= MAX_CANVAS_DIMENSION)) {
      const region: EditRect = {
        x: Math.round(srcW * 0.31),
        y: Math.round(srcH * 0.17),
        width: Math.round(srcW * 0.2),
        height: Math.round(srcH * 0.4),
      };
      expect(editDestRect(region, srcW, srcH, srcW, srcH)).toEqual(region);
    }
  });

  it("clamps a region that hangs off the edge instead of painting off-canvas", () => {
    // 12000x3000 plans to 8192x2048; the requested 600x400 at (11800, 2900)
    // only has 200x100 of source under it.
    const [plan] = editOutputPlan(12000, 3000, pixelate(null));
    expect([plan.width, plan.height]).toEqual([8192, 2048]);
    const dest = editDestRect(
      { x: 11800, y: 2900, width: 600, height: 400 },
      12000,
      3000,
      plan.width,
      plan.height,
    );
    expect(dest.x + dest.width).toBe(plan.width);
    expect(dest.y + dest.height).toBe(plan.height);
    expect(dest.x).toBe(Math.floor((11800 * 8192) / 12000));
    expect(dest.y).toBe(Math.floor((2900 * 2048) / 3000));
  });

  it("survives the sizes that mean nothing", () => {
    const rect = { x: 10, y: 10, width: 10, height: 10 };
    for (const bad of [0, -5, NaN, Infinity]) {
      const dest = editDestRect(rect, bad, bad, bad, bad);
      expect(Number.isFinite(dest.x) && Number.isFinite(dest.width)).toBe(true);
      expect(dest.width).toBeGreaterThanOrEqual(1);
      expect(dest.height).toBeGreaterThanOrEqual(1);
    }
  });
});

/**
 * A recording 2D context — canvas size in, `drawImage` arguments out.
 *
 * This is the whole apparatus `drawEdit` needs to be checked: no rasteriser,
 * no pixels, just the numbers it computes. `scratchContext` asks for an
 * OffscreenCanvas when the destination is not an HTMLCanvasElement, so the
 * stub below stands in for that too and the scratch surface is identifiable by
 * reference in the log.
 */
interface DrawCall {
  image: unknown;
  args: number[];
}

function recordingCtx(width: number, height: number, log: DrawCall[]) {
  return {
    canvas: { width, height },
    imageSmoothingEnabled: true,
    drawImage: (image: unknown, ...args: number[]) => log.push({ image, args }),
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    fillRect: () => undefined,
    fillStyle: "",
  };
}

describe("drawEdit — pixelate paints the blocks where the content actually is", () => {
  const log: DrawCall[] = [];

  beforeEach(() => {
    log.length = 0;
    class StubOffscreenCanvas {
      ctx: ReturnType<typeof recordingCtx>;
      constructor(
        public width: number,
        public height: number,
      ) {
        this.ctx = recordingCtx(width, height, log);
        this.ctx.canvas = this as unknown as { width: number; height: number };
      }
      getContext() {
        return this.ctx;
      }
    }
    vi.stubGlobal("OffscreenCanvas", StubOffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Run the pixelate verb over a source of the given size and read the log. */
  function runPixelate(srcW: number, srcH: number, region: EditRect | null, blockSize = 16) {
    log.length = 0;
    const edit: ImageEditOptions = { kind: "pixelate", region, blockSize };
    const [plan] = editOutputPlan(srcW, srcH, edit);
    const ctx = recordingCtx(plan.width, plan.height, log);
    const source = { width: srcW, height: srcH } as unknown as CanvasImageSource & {
      width: number;
      height: number;
    };
    drawEdit(ctx as unknown as Parameters<typeof drawEdit>[0], source, edit, 0);
    // Three draws: the background, the downscale into the scratch, the mosaic
    // back onto the output. The last one is the one that hides anything.
    expect(log).toHaveLength(3);
    const [background, sample, mosaic] = log;
    return {
      plan,
      background: background.args,
      sampledFrom: sample.args.slice(0, 4),
      paintedAt: {
        x: mosaic.args[4],
        y: mosaic.args[5],
        width: mosaic.args[6],
        height: mosaic.args[7],
      },
      blocks: { w: mosaic.args[2], h: mosaic.args[3] },
    };
  }

  it("paints over the selected face on a 61 MP frame the ceiling had to shrink", () => {
    // The reported case: a 9504x6336 body, a face at the right of the shot.
    // Before the fix the mosaic went to (8000, 5000) on an 8192-wide canvas —
    // 0x0 overlap with the face, which came out of a redaction-shaped tool
    // completely legible.
    const region = { x: 8000, y: 5000, width: 800, height: 600 };
    const run = runPixelate(9504, 6336, region);
    expect([run.plan.width, run.plan.height]).toEqual([8192, 5461]);

    // Sampled in SOURCE pixels — that half was always right.
    expect(run.sampledFrom).toEqual([8000, 5000, 800, 600]);

    // Painted in OUTPUT pixels, over the content the background draw put there.
    const scaleX = run.plan.width / 9504;
    const scaleY = run.plan.height / 6336;
    expect(run.paintedAt.x).toBeLessThanOrEqual(region.x * scaleX);
    expect(run.paintedAt.y).toBeLessThanOrEqual(region.y * scaleY);
    expect(run.paintedAt.x + run.paintedAt.width).toBeGreaterThanOrEqual(
      (region.x + region.width) * scaleX,
    );
    expect(run.paintedAt.y + run.paintedAt.height).toBeGreaterThanOrEqual(
      (region.y + region.height) * scaleY,
    );
    // …and entirely on the canvas, which is the part that failed outright.
    expect(run.paintedAt.x + run.paintedAt.width).toBeLessThanOrEqual(run.plan.width);
    expect(run.paintedAt.y + run.paintedAt.height).toBeLessThanOrEqual(run.plan.height);
  });

  it("leaves no unpixelated overlap at all between the region and the mosaic", () => {
    // The single number that says whether the tool did its job: how much of
    // the selected content the blocks do NOT cover.
    for (const [srcW, srcH, x, y] of [
      [9504, 6336, 8000, 5000],
      [12000, 3000, 9000, 400],
      [12000, 3000, 11400, 2600],
      [30000, 400, 29000, 100],
      [4000, 3000, 3000, 2000],
    ] as const) {
      const region = { x, y, width: Math.min(800, srcW - x), height: Math.min(600, srcH - y) };
      const run = runPixelate(srcW, srcH, region);
      const scaleX = run.plan.width / srcW;
      const scaleY = run.plan.height / srcH;
      const wanted = {
        left: region.x * scaleX,
        top: region.y * scaleY,
        right: Math.min(run.plan.width, (region.x + region.width) * scaleX),
        bottom: Math.min(run.plan.height, (region.y + region.height) * scaleY),
      };
      const covered =
        Math.max(0, Math.min(run.paintedAt.x + run.paintedAt.width, wanted.right) -
          Math.max(run.paintedAt.x, wanted.left)) *
        Math.max(0, Math.min(run.paintedAt.y + run.paintedAt.height, wanted.bottom) -
          Math.max(run.paintedAt.y, wanted.top));
      const asked = (wanted.right - wanted.left) * (wanted.bottom - wanted.top);
      expect(
        covered / asked,
        `${srcW}x${srcH} region at ${x},${y}: only ${((covered / asked) * 100).toFixed(1)}% of the selection is under the blocks`,
      ).toBe(1);
    }
  });

  it("changes nothing at all below the ceiling", () => {
    const region = { x: 3000, y: 2000, width: 800, height: 600 };
    const run = runPixelate(4000, 3000, region);
    expect([run.plan.width, run.plan.height]).toEqual([4000, 3000]);
    expect(run.paintedAt).toEqual(region);
    expect(run.sampledFrom).toEqual([3000, 2000, 800, 600]);
    // 800/16 and 600/16: the block grid is still counted in the image's own
    // pixels, which is what the slider's hint promises.
    expect(run.blocks).toEqual({ w: 50, h: 38 });
  });

  it("keeps the whole-image case covering the whole image", () => {
    const run = runPixelate(12000, 3000, null);
    expect(run.paintedAt).toEqual({ x: 0, y: 0, width: run.plan.width, height: run.plan.height });
    expect(run.background).toEqual([0, 0, run.plan.width, run.plan.height]);
  });

  it("never asks for a block grid finer than the canvas it lands on", () => {
    // A 30000px source scaled to 8192 with 2px blocks would want 15000 blocks
    // across a 219px patch — a nearest-neighbour downsample of the mosaic
    // rather than a mosaic. Coarser is the safe direction for this verb.
    const run = runPixelate(30000, 400, { x: 1000, y: 0, width: 800, height: 200 }, 2);
    expect(run.blocks.w).toBeLessThanOrEqual(run.paintedAt.width);
    expect(run.blocks.h).toBeLessThanOrEqual(run.paintedAt.height);
    expect(run.blocks.w).toBeGreaterThanOrEqual(1);
  });
});
