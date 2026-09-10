import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  asExifOrientation,
  displayedDownUnit,
  displayedPageSize,
  displayedSize,
  fractionToUserSpace,
  isStampDrawable,
  normaliseRotation,
  orientationDraw,
  placeImageInBox,
  type ExifOrientation,
  type PdfRect,
  type PdfSize,
  type StampPlacement,
  unsupportedStampCharacters,
  visiblePageBox,
} from "@/lib/tools/pdf-stamp-core";

/*
 * ───────────────────────────────────────────────────────────────────────────
 * The numbers in pdf-stamp-core are unreadable by inspection — "rotate 270,
 * scaleX 1" is not something anyone can eyeball against a photograph — so this
 * file does not check them field by field and stop. It RENDERS with them.
 *
 * `renderPlacement` below is a faithful simulation of what a PDF reader does
 * with the arguments `placeImageInBox` returns: pdf-lib's own operator order
 * for drawImage is translate(x,y) · rotate(θ) · scale(w,h)
 * (node_modules/pdf-lib/cjs/api/operations.js:39-49, and `rotateRadians` is the
 * ordinary counter-clockwise matrix at operators.js:28), and a PDF image
 * XObject fills the unit square with its FIRST sample row at the TOP. Push a
 * 4×2 grid of uniquely-tagged cells through that and you get back the picture a
 * reader shows, which can be compared against ground truth.
 *
 * The ground truth is MEASURED, not remembered: a 40×20 JPEG with four
 * coloured quadrants, an Exif APP1 segment carrying each of the eight values
 * spliced in after the JFIF APP0, decoded by Chrome's own `createImageBitmap`
 * and read back corner by corner (2026-09-10). The tag was read back out of the
 * spliced bytes first as a positive control — a run where the decoder never
 * finds a tag reports "nothing rotated" for all eight values and looks like a
 * pass. Half the orientation tables in circulation have 5 and 7 the wrong way
 * round, this one included until the measurement said otherwise, which is
 * exactly why the expectation below is a measurement.
 * ───────────────────────────────────────────────────────────────────────────
 */

const ORIENTATIONS: ExifOrientation[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** Stored grid: 4 wide, 2 tall, so an axis swap cannot hide. */
const STORED = { width: 4, height: 2 };

/** Every cell unique; the four corners tagged so a failure reads in English. */
const STORED_GRID: string[][] = Array.from({ length: STORED.height }, (_, r) =>
  Array.from({ length: STORED.width }, (_, c) => {
    if (c === 0 && r === 0) return "TL";
    if (c === STORED.width - 1 && r === 0) return "TR";
    if (c === 0 && r === STORED.height - 1) return "BL";
    if (c === STORED.width - 1 && r === STORED.height - 1) return "BR";
    return `${c}${r}`;
  }),
);

/**
 * Chrome, 2026-09-10. `displayed` is the bitmap size for a 40×20 source; the
 * four corners name which STORED corner the decoder put there.
 */
const CHROME_MEASURED: Record<
  ExifOrientation,
  { bitmap: string; TL: string; TR: string; BL: string; BR: string }
> = {
  1: { bitmap: "40x20", TL: "TL", TR: "TR", BL: "BL", BR: "BR" },
  2: { bitmap: "40x20", TL: "TR", TR: "TL", BL: "BR", BR: "BL" },
  3: { bitmap: "40x20", TL: "BR", TR: "BL", BL: "TR", BR: "TL" },
  4: { bitmap: "40x20", TL: "BL", TR: "BR", BL: "TL", BR: "TR" },
  5: { bitmap: "20x40", TL: "TL", TR: "BL", BL: "TR", BR: "BR" },
  6: { bitmap: "20x40", TL: "BL", TR: "TL", BL: "BR", BR: "TR" },
  7: { bitmap: "20x40", TL: "BR", TR: "TR", BL: "BL", BR: "TL" },
  8: { bitmap: "20x40", TL: "TR", TR: "BR", BL: "TL", BR: "BL" },
};

/** Exact quarter turns — Math.cos(Math.PI / 2) is 6.1e-17, which is not 0. */
const COS: Record<number, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<number, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

/** The user-space point that unit-square (u,v) lands on, per pdf-lib's CTM. */
function toUserSpace(p: StampPlacement, u: number, v: number): { x: number; y: number } {
  const cos = COS[p.rotate];
  const sin = SIN[p.rotate];
  return {
    x: p.x + cos * (p.width * u) - sin * (p.height * v),
    y: p.y + sin * (p.width * u) + cos * (p.height * v),
  };
}

/** The axis-aligned rectangle the drawn image actually covers on the page. */
function drawnBounds(p: StampPlacement): PdfRect {
  const corners = [
    toUserSpace(p, 0, 0),
    toUserSpace(p, 1, 0),
    toUserSpace(p, 0, 1),
    toUserSpace(p, 1, 1),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The picture a reader shows, as a grid of the stored cells' tags. Read off
 * the rectangle the placement actually covers, so it answers "is this the
 * right picture" independently of "is it in the right place" — the bounds
 * assertions answer the second. Throws rather than returning a wrong grid when
 * two cells collide, because that means the placement is not a bijection.
 */
function renderPlacement(placement: StampPlacement, shown: PdfSize): string[][] {
  const area = drawnBounds(placement);
  const grid: (string | null)[][] = Array.from({ length: shown.height }, () =>
    new Array<string | null>(shown.width).fill(null),
  );

  for (let r = 0; r < STORED.height; r++) {
    for (let c = 0; c < STORED.width; c++) {
      // The cell's centre in the XObject's unit square. Row 0 sits at v = 1:
      // a PDF image's first sample row is the TOP of the square.
      const u = (c + 0.5) / STORED.width;
      const v = 1 - (r + 0.5) / STORED.height;
      const pt = toUserSpace(placement, u, v);
      // User space is y-up; a displayed grid is y-down.
      const x = Math.floor(((pt.x - area.x) / area.width) * shown.width);
      const y = Math.floor(((area.y + area.height - pt.y) / area.height) * shown.height);
      if (x < 0 || x >= shown.width || y < 0 || y >= shown.height) {
        throw new Error(`${STORED_GRID[r][c]} landed outside the drawn area`);
      }
      if (grid[y][x] !== null) {
        throw new Error(`two cells landed on ${x},${y}`);
      }
      grid[y][x] = STORED_GRID[r][c];
    }
  }
  return grid as string[][];
}

/** Place the 4×2 grid in a box and render what a reader would see. */
function renderInBox(
  orientation: ExifOrientation,
  box: PdfRect,
  fit: "contain" | "stretch" = "stretch",
): string[][] {
  return renderPlacement(
    placeImageInBox({ stored: STORED, orientation, box, fit }),
    displayedSize(STORED, orientation),
  );
}

describe("orientationDraw", () => {
  it("gives the measured recipe for all eight values, field by field", () => {
    expect(orientationDraw(1)).toEqual({ rotate: 0, scaleX: 1, scaleY: 1, swapsAxes: false });
    expect(orientationDraw(2)).toEqual({ rotate: 0, scaleX: -1, scaleY: 1, swapsAxes: false });
    expect(orientationDraw(3)).toEqual({ rotate: 180, scaleX: 1, scaleY: 1, swapsAxes: false });
    expect(orientationDraw(4)).toEqual({ rotate: 0, scaleX: 1, scaleY: -1, swapsAxes: false });
    expect(orientationDraw(5)).toEqual({ rotate: 90, scaleX: -1, scaleY: 1, swapsAxes: true });
    expect(orientationDraw(6)).toEqual({ rotate: 270, scaleX: 1, scaleY: 1, swapsAxes: true });
    expect(orientationDraw(7)).toEqual({ rotate: 270, scaleX: -1, scaleY: 1, swapsAxes: true });
    expect(orientationDraw(8)).toEqual({ rotate: 90, scaleX: 1, scaleY: 1, swapsAxes: true });
  });

  it("swaps the axes for exactly 5..8", () => {
    const swapping = ORIENTATIONS.filter((o) => orientationDraw(o).swapsAxes);
    expect(swapping).toEqual([5, 6, 7, 8]);
  });

  it("mirrors for exactly the four reflections 2,4,5,7", () => {
    // Parity, stated independently of which axis carries the mirror: a
    // reflection has determinant -1, a rotation +1. Getting this wrong is how
    // a scanned signature ships back-to-front.
    const mirrored = ORIENTATIONS.filter((o) => {
      const d = orientationDraw(o);
      return d.scaleX * d.scaleY === -1;
    });
    expect(mirrored).toEqual([2, 4, 5, 7]);
  });

  it("hands back a fresh object, so a caller cannot poison the table", () => {
    const first = orientationDraw(6);
    first.rotate = 0;
    first.swapsAxes = false;
    expect(orientationDraw(6)).toEqual({ rotate: 270, scaleX: 1, scaleY: 1, swapsAxes: true });
  });

  it("treats an unreadable tag value as 1", () => {
    // readJpegOrientation returns a plain number because files say things like
    // 0 and 9; every one of them means "draw it as stored".
    const identity = { rotate: 0, scaleX: 1, scaleY: 1, swapsAxes: false };
    expect(orientationDraw(0 as ExifOrientation)).toEqual(identity);
    expect(orientationDraw(9 as ExifOrientation)).toEqual(identity);
    expect(orientationDraw(NaN as ExifOrientation)).toEqual(identity);
  });
});

describe("asExifOrientation", () => {
  it("passes 1..8 through and rewrites everything else to 1", () => {
    for (const o of ORIENTATIONS) expect(asExifOrientation(o)).toBe(o);
    expect(asExifOrientation(0)).toBe(1);
    expect(asExifOrientation(9)).toBe(1);
    expect(asExifOrientation(-6)).toBe(1);
    expect(asExifOrientation(6.5)).toBe(1);
    expect(asExifOrientation(NaN)).toBe(1);
    expect(asExifOrientation(Infinity)).toBe(1);
  });
});

describe("displayedSize", () => {
  it("swaps the stored axes for 5..8 and leaves 1..4 alone", () => {
    for (const o of ORIENTATIONS) {
      const shown = displayedSize({ width: 4000, height: 3000 }, o);
      if (o >= 5) expect(shown).toEqual({ width: 3000, height: 4000 });
      else expect(shown).toEqual({ width: 4000, height: 3000 });
    }
  });

  it("agrees with the bitmap size Chrome's decoder returns", () => {
    for (const o of ORIENTATIONS) {
      const shown = displayedSize({ width: 40, height: 20 }, o);
      expect(`${shown.width}x${shown.height}`).toBe(CHROME_MEASURED[o].bitmap);
    }
  });

  it("survives a source whose dimensions are missing or nonsense", () => {
    expect(displayedSize({ width: 0, height: -3 }, 1)).toEqual({ width: 1, height: 1 });
    expect(displayedSize({ width: NaN, height: 10 }, 6)).toEqual({ width: 10, height: 1 });
  });
});

describe("placeImageInBox — what a reader actually shows", () => {
  const box: PdfRect = { x: 0, y: 0, width: 400, height: 200 };
  const offset: PdfRect = { x: 33, y: 71, width: 400, height: 200 };

  it("reproduces Chrome's decoder for all eight orientations", () => {
    for (const o of ORIENTATIONS) {
      const shown = displayedSize(STORED, o);
      const grid = renderInBox(o, box);
      const measured = CHROME_MEASURED[o];
      const corners = {
        TL: grid[0][0],
        TR: grid[0][shown.width - 1],
        BL: grid[shown.height - 1][0],
        BR: grid[shown.height - 1][shown.width - 1],
      };
      expect({ orientation: o, ...corners }).toEqual({
        orientation: o,
        TL: measured.TL,
        TR: measured.TR,
        BL: measured.BL,
        BR: measured.BR,
      });
    }
  });

  it("puts every stored cell somewhere different — no fold, no overlap", () => {
    for (const o of ORIENTATIONS) {
      const flat = renderInBox(o, box).flat();
      expect(new Set(flat).size).toBe(STORED.width * STORED.height);
    }
  });

  it("lands on a box whose origin is not (0,0), and shows the same picture", () => {
    // The CropBox case. A placement that drops box.x/box.y draws the same
    // picture 33 points left and 71 points below the page area it was asked
    // for — which is the bug `visiblePageBox` exists to feed, so it is the
    // bounds half of this that can fail.
    for (const o of ORIENTATIONS) {
      expect(renderInBox(o, offset)).toEqual(renderInBox(o, box));
      const bounds = drawnBounds(
        placeImageInBox({ stored: STORED, orientation: o, box: offset, fit: "stretch" }),
      );
      expect(bounds.x).toBeCloseTo(offset.x, 9);
      expect(bounds.y).toBeCloseTo(offset.y, 9);
      expect(bounds.width).toBeCloseTo(offset.width, 9);
      expect(bounds.height).toBeCloseTo(offset.height, 9);
    }
  });

  it('"stretch" fills the box exactly, whatever the orientation', () => {
    for (const o of ORIENTATIONS) {
      const bounds = drawnBounds(
        placeImageInBox({
          stored: { width: 4000, height: 3000 },
          orientation: o,
          box,
          fit: "stretch",
        }),
      );
      expect(bounds).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    }
  });
});

describe("placeImageInBox — contain", () => {
  const landscapeBox: PdfRect = { x: 20, y: 40, width: 500, height: 300 };
  const portraitBox: PdfRect = { x: -15.5, y: 7.25, width: 300, height: 500 };
  const portraitImage = { width: 1200, height: 1600 };
  const landscapeImage = { width: 1600, height: 1200 };

  const cases: { name: string; stored: { width: number; height: number }; box: PdfRect }[] = [
    { name: "portrait image in a landscape box", stored: portraitImage, box: landscapeBox },
    { name: "landscape image in a portrait box", stored: landscapeImage, box: portraitBox },
    { name: "landscape image in a landscape box", stored: landscapeImage, box: landscapeBox },
    { name: "portrait image in a portrait box", stored: portraitImage, box: portraitBox },
  ];

  for (const { name, stored, box } of cases) {
    it(`letterboxes a ${name} for all eight orientations`, () => {
      for (const o of ORIENTATIONS) {
        const shown = displayedSize(stored, o);
        const bounds = drawnBounds(placeImageInBox({ stored, orientation: o, box, fit: "contain" }));
        const label = `${name}, orientation ${o}`;

        // Inside the box, to the last bit.
        expect(bounds.width, label).toBeLessThanOrEqual(box.width + 1e-9);
        expect(bounds.height, label).toBeLessThanOrEqual(box.height + 1e-9);
        expect(bounds.x, label).toBeGreaterThanOrEqual(box.x - 1e-9);
        expect(bounds.y, label).toBeGreaterThanOrEqual(box.y - 1e-9);
        expect(bounds.x + bounds.width, label).toBeLessThanOrEqual(box.x + box.width + 1e-9);
        expect(bounds.y + bounds.height, label).toBeLessThanOrEqual(box.y + box.height + 1e-9);

        // The DISPLAYED aspect ratio, not the stored one. This is the
        // assertion the shipped images→PDF bug fails: for orientation 6 it
        // fits a 4:3 grid into the box and shows a 3:4 picture stretched.
        expect(bounds.width / bounds.height, label).toBeCloseTo(shown.width / shown.height, 9);

        // Touching on the constraining axis — a "contain" that fits with room
        // to spare on both axes has just made the picture needlessly small.
        const touches =
          Math.abs(bounds.width - box.width) < 1e-9 || Math.abs(bounds.height - box.height) < 1e-9;
        expect(touches, `${label} must touch the box on one axis`).toBe(true);

        // Centred.
        expect(bounds.x + bounds.width / 2, label).toBeCloseTo(box.x + box.width / 2, 9);
        expect(bounds.y + bounds.height / 2, label).toBeCloseTo(box.y + box.height / 2, 9);
      }
    });
  }

  it("still shows the right picture once letterboxed", () => {
    // Aspect and bounds can both be right while the photo is upside down.
    const box: PdfRect = { x: 10, y: 10, width: 400, height: 400 };
    for (const o of ORIENTATIONS) {
      const shown = displayedSize(STORED, o);
      const grid = renderInBox(o, box, "contain");
      expect(grid[0][0]).toBe(CHROME_MEASURED[o].TL);
      expect(grid[0][shown.width - 1]).toBe(CHROME_MEASURED[o].TR);
      expect(grid[shown.height - 1][0]).toBe(CHROME_MEASURED[o].BL);
      expect(grid[shown.height - 1][shown.width - 1]).toBe(CHROME_MEASURED[o].BR);
    }
  });

  it("mirrors exactly the four reflections, in the sign of the drawn extents", () => {
    const box: PdfRect = { x: 0, y: 0, width: 100, height: 100 };
    const negative = ORIENTATIONS.filter((o) => {
      const p = placeImageInBox({ stored: STORED, orientation: o, box, fit: "contain" });
      return p.width < 0 || p.height < 0;
    });
    expect(negative).toEqual([2, 4, 5, 7]);
  });
});

describe("normaliseRotation", () => {
  it("wraps negative and over-full turns instead of collapsing them to 0", () => {
    // pdf-lib's own reduceRotation(-90) returns 0. A stamp placed with that
    // sits on the wrong edge of every page a scanner rotated backwards.
    expect(normaliseRotation(-450)).toBe(270);
    expect(normaliseRotation(-360)).toBe(0);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(90)).toBe(90);
    expect(normaliseRotation(359)).toBe(0);
  });

  it("covers the whole circle in both directions", () => {
    expect(normaliseRotation(180)).toBe(180);
    expect(normaliseRotation(270)).toBe(270);
    expect(normaliseRotation(360)).toBe(0);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(-180)).toBe(180);
    expect(normaliseRotation(-270)).toBe(90);
    expect(normaliseRotation(720)).toBe(0);
  });

  it("rounds a non-multiple of 90 to the nearest quarter turn, ties upward", () => {
    // /Rotate must be a multiple of 90 (PDF 32000-1 §7.7.3.3), so a file
    // carrying 47 is already broken; rounding keeps a stamp on the same side
    // of the page as the content instead of silently landing at 0.
    expect(normaliseRotation(44)).toBe(0);
    expect(normaliseRotation(45)).toBe(90);
    expect(normaliseRotation(47)).toBe(90);
    expect(normaliseRotation(134)).toBe(90);
    expect(normaliseRotation(136)).toBe(180);
    expect(normaliseRotation(-45)).toBe(0);
    expect(normaliseRotation(-46)).toBe(270);
    expect(normaliseRotation(358)).toBe(0);
  });

  it("gives a missing or nonsense angle the same answer as no /Rotate", () => {
    expect(normaliseRotation(NaN)).toBe(0);
    expect(normaliseRotation(Infinity)).toBe(0);
    expect(normaliseRotation(-Infinity)).toBe(0);
  });
});

describe("displayedPageSize", () => {
  const a4 = { width: 595.28, height: 841.89 };

  it("exchanges the axes for the quarter turns only", () => {
    expect(displayedPageSize(a4, 0)).toEqual({ width: 595.28, height: 841.89 });
    expect(displayedPageSize(a4, 90)).toEqual({ width: 841.89, height: 595.28 });
    expect(displayedPageSize(a4, 180)).toEqual({ width: 595.28, height: 841.89 });
    expect(displayedPageSize(a4, 270)).toEqual({ width: 841.89, height: 595.28 });
  });

  it("does not round a page size — A4 is 595.28 points, not 595", () => {
    expect(displayedPageSize(a4, 90).width).toBe(841.89);
  });

  it("normalises the rotation it is handed", () => {
    expect(displayedPageSize(a4, -90 as 0 | 90 | 180 | 270)).toEqual({
      width: 841.89,
      height: 595.28,
    });
  });
});

describe("fractionToUserSpace", () => {
  const zeroOrigin: PdfRect = { x: 0, y: 0, width: 600, height: 800 };
  const cropped: PdfRect = { x: 36, y: 54.5, width: 523.28, height: 733.89 };

  /** The four displayed corners, top-left first, as a preview overlay reports them. */
  const CORNERS = [
    { name: "top-left", fraction: { x: 0, y: 0 } },
    { name: "top-right", fraction: { x: 1, y: 0 } },
    { name: "bottom-left", fraction: { x: 0, y: 1 } },
    { name: "bottom-right", fraction: { x: 1, y: 1 } },
  ] as const;

  for (const box of [zeroOrigin, cropped]) {
    const label = box.x === 0 ? "zero-origin box" : "non-zero-origin box";

    it(`maps each displayed corner to a distinct box corner, all four rotations (${label})`, () => {
      const boxCorners = [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x, y: box.y + box.height },
        { x: box.x + box.width, y: box.y + box.height },
      ].map((c) => `${c.x},${c.y}`);

      for (const rotation of [0, 90, 180, 270] as const) {
        const got = CORNERS.map(({ fraction }) => {
          const p = fractionToUserSpace({ fraction, pageBox: box, rotation });
          return `${p.x},${p.y}`;
        });
        // Every corner used exactly once: the map is a bijection of corners,
        // which a dropped term or a duplicated axis breaks immediately.
        expect(new Set(got).size, `rotation ${rotation}`).toBe(4);
        expect([...got].sort(), `rotation ${rotation}`).toEqual([...boxCorners].sort());
      }
    });

    it(`sends each displayed corner to the corner /Rotate puts it on (${label})`, () => {
      // Named corners of the box in USER space: lower-left, lower-right,
      // upper-left, upper-right.
      const LL = { x: box.x, y: box.y };
      const LR = { x: box.x + box.width, y: box.y };
      const UL = { x: box.x, y: box.y + box.height };
      const UR = { x: box.x + box.width, y: box.y + box.height };

      // /Rotate turns the page CLOCKWISE for display, so the user-space corner
      // a viewer sees top-left walks backwards round the page: UL, then LL,
      // then LR, then UR. Each row is [top-left, top-right, bottom-left,
      // bottom-right] as the viewer sees them — the whole mapping, not just
      // the set, because swapping two corners keeps the set intact.
      const expected: Record<0 | 90 | 180 | 270, { x: number; y: number }[]> = {
        0: [UL, UR, LL, LR],
        90: [LL, UL, LR, UR],
        180: [LR, LL, UR, UL],
        270: [UR, LR, UL, LL],
      };

      for (const rotation of [0, 90, 180, 270] as const) {
        const got = CORNERS.map(({ fraction }) =>
          fractionToUserSpace({ fraction, pageBox: box, rotation }),
        );
        expect(got, `rotation ${rotation}`).toEqual(expected[rotation]);
      }
    });

    it(`round-trips through an inverse built from the same rule (${label})`, () => {
      // A full round trip, not just the corners: pick the user-space point,
      // work out which displayed fraction it must have come from, and check
      // the function agrees. Off-centre on purpose — a point at 0.5,0.5 is
      // fixed by every rotation and would pass a table of pure guesswork.
      const inverse = (
        rotation: 0 | 90 | 180 | 270,
        point: { x: number; y: number },
      ): { x: number; y: number } => {
        const a = (point.x - box.x) / box.width;
        const b = (point.y - box.y) / box.height;
        switch (rotation) {
          case 90:
            return { x: b, y: a };
          case 180:
            return { x: 1 - a, y: b };
          case 270:
            return { x: 1 - b, y: 1 - a };
          default:
            return { x: a, y: 1 - b };
        }
      };
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const fraction of [
          { x: 0.125, y: 0.375 },
          { x: 0.8, y: 0.05 },
          { x: 1, y: 0.5 },
        ]) {
          const point = fractionToUserSpace({ fraction, pageBox: box, rotation });
          const back = inverse(rotation, point);
          expect(back.x, `rotation ${rotation}`).toBeCloseTo(fraction.x, 9);
          expect(back.y, `rotation ${rotation}`).toBeCloseTo(fraction.y, 9);
        }
      }
    });
  }

  it("keeps the page's origin — a CropBox that starts at (36, 54.5) is not (0,0)", () => {
    const p = fractionToUserSpace({
      fraction: { x: 0, y: 1 },
      pageBox: cropped,
      rotation: 0,
    });
    expect(p).toEqual({ x: 36, y: 54.5 });
  });

  it("clamps a fraction that is not on the page", () => {
    const inside = fractionToUserSpace({
      fraction: { x: 1, y: 0 },
      pageBox: zeroOrigin,
      rotation: 0,
    });
    expect(
      fractionToUserSpace({ fraction: { x: 1.4, y: -2 }, pageBox: zeroOrigin, rotation: 0 }),
    ).toEqual(inside);
    expect(
      fractionToUserSpace({ fraction: { x: NaN, y: NaN }, pageBox: zeroOrigin, rotation: 0 }),
    ).toEqual({ x: 0, y: 800 });
  });

  it("normalises the rotation it is handed", () => {
    expect(
      fractionToUserSpace({ fraction: { x: 0, y: 0 }, pageBox: zeroOrigin, rotation: -90 as 0 }),
    ).toEqual(fractionToUserSpace({ fraction: { x: 0, y: 0 }, pageBox: zeroOrigin, rotation: 270 }));
  });
});

describe("visiblePageBox", () => {
  const media: PdfRect = { x: 0, y: 0, width: 612, height: 792 };

  it("is the MediaBox when there is no CropBox", () => {
    expect(visiblePageBox({ mediaBox: media })).toEqual(media);
    expect(visiblePageBox({ mediaBox: media, cropBox: null })).toEqual(media);
  });

  it("is the CropBox when the page declares a smaller one", () => {
    const crop: PdfRect = { x: 36, y: 36, width: 540, height: 720 };
    expect(visiblePageBox({ mediaBox: media, cropBox: crop })).toEqual(crop);
  });

  it("intersects a CropBox that hangs off the MediaBox", () => {
    // Only the overlap is ever shown (PDF 32000-1 §14.11.2).
    expect(
      visiblePageBox({ mediaBox: media, cropBox: { x: -100, y: 100, width: 400, height: 1000 } }),
    ).toEqual({ x: 0, y: 100, width: 300, height: 692 });
  });

  it("falls back to the MediaBox when the CropBox misses it entirely", () => {
    expect(
      visiblePageBox({ mediaBox: media, cropBox: { x: 5000, y: 5000, width: 100, height: 100 } }),
    ).toEqual(media);
  });

  it("re-corners a rectangle written with its corners the other way round", () => {
    // pdf-lib's asRectangle subtracts element 0 from element 2 verbatim
    // (core/objects/PDFArray.js:54-66), so the legal `/MediaBox [0 792 612 0]`
    // arrives as height -792. Left alone it puts every stamp off the page.
    expect(visiblePageBox({ mediaBox: { x: 0, y: 792, width: 612, height: -792 } })).toEqual(media);
  });

  it("keeps a page whose box does not start at the origin", () => {
    const shifted: PdfRect = { x: 100, y: 200, width: 300, height: 400 };
    expect(visiblePageBox({ mediaBox: shifted })).toEqual(shifted);
  });
});

describe("the leaf contract", () => {
  const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

  it("has no imports at all, runtime or type", () => {
    // The measurement is in pdf-protocol.ts: one static import of anything
    // that reaches pdf-engine-core turns a lazily-loaded 705 KB pdf-lib chunk
    // into an eagerly-loaded one, and a placement UI imports this module at
    // render time. `import type` is banned too — it erases today and stops
    // erasing the moment someone drops the `type` keyword.
    const source = read("src/lib/tools/pdf-stamp-core.ts");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bfrom\s+["']/);

    // Positive control: the same three patterns DO fire on a module that has
    // imports, so a rule that can never match is not what just passed.
    const neighbour = read("src/lib/tools/image-edit-core.ts");
    expect(neighbour).toMatch(/^\s*import\s/m);
    expect(neighbour).toMatch(/\bfrom\s+["']/);
    expect(read("src/lib/tools/image-edit.ts")).toMatch(/\bfrom\s+["']/);
  });

  it("touches no DOM API", () => {
    const source = read("src/lib/tools/pdf-stamp-core.ts");
    for (const forbidden of [
      /\bdocument\./,
      /\bwindow\./,
      /\bcanvas\b/i,
      /\bcreateImageBitmap\b/,
    ]) {
      // Comments mention Chrome and bitmaps by name; strip them first so the
      // check reads the CODE.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code).not.toMatch(forbidden);
    }
    // Positive control on the same stripped-comment pipeline.
    const withDom = read("src/lib/tools/image-edit-core.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(withDom).toMatch(/\bcanvas\b/i);
  });
});

describe("the WinAnsi table is a measurement, not a recollection", () => {
  /*
    THE TABLE'S ONLY JOB is to answer, without pdf-lib, the same question
    pdf-lib answers. So this test asks BOTH and requires them to agree across
    the entire Basic Multilingual Plane — not on a handful of examples, which
    is where a table like this goes wrong (it is the exotic scripts nobody
    thinks to sample that end up mis-classified).

    It is two-sided on purpose: a table that said "nothing is drawable" would
    pass a one-sided "we never claim a character works that doesn't" check.
  */
  it("agrees with pdf-lib on every codepoint from U+0000 to U+FFFF", async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create({ updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);

    const tableSays: number[] = [];
    const pdfLibSays: number[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) {
      const character = String.fromCodePoint(cp);
      if (isStampDrawable(character)) tableSays.push(cp);
      try {
        font.widthOfTextAtSize(character, 12);
        pdfLibSays.push(cp);
      } catch {
        // not encodable
      }
    }

    // Not vacuous: there really are drawable characters, and really are not.
    expect(pdfLibSays.length).toBe(218);
    expect(pdfLibSays.length).toBeLessThan(0x10000);

    const onlyTable = tableSays.filter((cp) => !pdfLibSays.includes(cp));
    const onlyPdfLib = pdfLibSays.filter((cp) => !tableSays.includes(cp));
    expect(
      onlyTable.map((cp) => cp.toString(16)),
      "the table claims characters pdf-lib cannot draw",
    ).toEqual([]);
    expect(
      onlyPdfLib.map((cp) => cp.toString(16)),
      "the table refuses characters pdf-lib can draw",
    ).toEqual([]);
  });

  it("names the characters a user will actually paste", () => {
    // Western European Latin, curly quotes, dashes and currency all draw.
    expect(unsupportedStampCharacters("Renée — “quoted” €5 · Ångström ç ñ ø æ")).toEqual([]);
    // Central/Eastern European Latin does NOT, which is the half a sentence
    // saying "Latin is fine" would get wrong.
    expect(unsupportedStampCharacters("Łódź")).toEqual(["Ł", "ó", "ź"].filter((c) => !isStampDrawable(c)));
    expect(unsupportedStampCharacters("Ł")).toEqual(["Ł"]);
    expect(unsupportedStampCharacters("日本")).toEqual(["日", "本"]);
    expect(unsupportedStampCharacters("Москва")[0]).toBe("М");
    // reported once each, in first-appearance order
    expect(unsupportedStampCharacters("a日b日c本")).toEqual(["日", "本"]);
    // newlines are not glyphs
    expect(unsupportedStampCharacters("one\ntwo")).toEqual([]);
  });
});

describe("displayedDownUnit", () => {
  const box = { x: 12, y: 34, width: 595.28, height: 841.89 };

  it("is the direction from the top of the displayed page to its bottom", () => {
    /*
      Derived from fractionToUserSpace rather than tabulated, so this test is
      really asking whether the derivation is sound at every rotation. It is
      what makes a top-left-anchored stamp drop by its own height in the
      direction the READER calls down — the correction that was previously
      hard-coded as `y - height` and was therefore wrong on any turned page.
    */
    expect(displayedDownUnit(box, 0)).toEqual({ x: 0, y: -1 });
    expect(displayedDownUnit(box, 90)).toEqual({ x: 1, y: 0 });
    expect(displayedDownUnit(box, 180)).toEqual({ x: 0, y: 1 });
    expect(displayedDownUnit(box, 270)).toEqual({ x: -1, y: 0 });
  });

  it("always points from fraction y=0 towards y=1", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const top = fractionToUserSpace({ fraction: { x: 0.5, y: 0 }, pageBox: box, rotation });
      const bottom = fractionToUserSpace({ fraction: { x: 0.5, y: 1 }, pageBox: box, rotation });
      const unit = displayedDownUnit(box, rotation);
      const span = Math.hypot(bottom.x - top.x, bottom.y - top.y);
      expect(top.x + unit.x * span).toBeCloseTo(bottom.x, 9);
      expect(top.y + unit.y * span).toBeCloseTo(bottom.y, 9);
    }
  });
});
