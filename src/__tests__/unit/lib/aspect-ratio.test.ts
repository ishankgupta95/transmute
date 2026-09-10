import { describe, it, expect } from "vitest";

import {
  RATIO_PRESETS,
  describeRatio,
  fitBox,
  gcd,
  parseDimension,
  parseRatio,
  ratioLabel,
  reduceRatio,
  solveHeight,
  solveWidth,
} from "@/lib/tools/aspect-ratio";

/**
 * The point of these is the difference between "close to 16:9" and "16:9".
 * A calculator that rounds 683:384 up to 16:9 is wrong in the one case anybody
 * consults a calculator for, so the reduction, the preset match and the
 * percentage it is out by are all pinned separately.
 */

describe("gcd", () => {
  it("reduces the textbook cases", () => {
    expect(gcd(1920, 1080)).toBe(120);
    expect(gcd(1366, 768)).toBe(2);
    expect(gcd(7, 13)).toBe(1);
    expect(gcd(10, 0)).toBe(10);
    expect(gcd(0, 0)).toBe(0);
  });
});

describe("reduceRatio", () => {
  it("is exact for whole numbers", () => {
    expect(reduceRatio(1920, 1080)).toEqual({ ratio: { w: 16, h: 9 }, exact: true });
    expect(reduceRatio(3840, 2160)).toEqual({ ratio: { w: 16, h: 9 }, exact: true });
    expect(reduceRatio(2560, 1080)).toEqual({ ratio: { w: 64, h: 27 }, exact: true });
  });

  it("does NOT round 1366x768 to 16:9", () => {
    expect(reduceRatio(1366, 768).ratio).toEqual({ w: 683, h: 384 });
  });

  it("approximates a fractional pair and says so", () => {
    const { ratio, exact } = reduceRatio(2.39, 1);
    expect(exact).toBe(false);
    expect(ratio.w / ratio.h).toBeCloseTo(2.39, 6);
  });

  it("refuses a zero or negative side", () => {
    expect(reduceRatio(0, 9).exact).toBe(false);
    expect(reduceRatio(16, -9).ratio).toEqual({ w: 0, h: 0 });
  });
});

describe("ratioLabel", () => {
  it("writes the pair with a colon", () => {
    expect(ratioLabel({ w: 16, h: 9 })).toBe("16:9");
  });
});

describe("describeRatio", () => {
  it("matches an exact preset", () => {
    const d = describeRatio(1920, 1080);
    expect(d?.label).toBe("16:9");
    expect(d?.matchesPreset).toBe(true);
    expect(d?.nearest?.id).toBe("16-9");
    expect(d?.offByPercent).toBeCloseTo(0, 10);
  });

  it("reports 1366x768 as 683:384, near 16:9 but not equal to it", () => {
    const d = describeRatio(1366, 768);
    expect(d?.label).toBe("683:384");
    expect(d?.matchesPreset).toBe(false);
    expect(d?.nearest?.id).toBe("16-9");
    // 1366/768 = 1.778646, 16/9 = 1.777778 — 0.049% wider.
    expect(d?.offByPercent).toBeCloseTo(0.0488, 3);
  });

  it("calls an exact 16:10 screen 16:10 rather than '8:5, not 16:10'", () => {
    // The 16:10 preset used to be stored unreduced, so the GCD-reduced input
    // could never equal it and every one of these screens got an amber
    // "1920 × 1200 is 8:5, not 16:10 … 0% narrower" banner.
    for (const [w, h] of [
      [1920, 1200],
      [1280, 800],
      [1440, 900],
      [1680, 1050],
      [2560, 1600],
      [3840, 2400],
    ] as const) {
      const d = describeRatio(w, h);
      expect(`${w}x${h} ${d?.label} match=${d?.matchesPreset}`).toBe(`${w}x${h} 8:5 match=true`);
      expect(d?.nearest?.label).toBe("16:10");
      expect(d?.offByPercent).toBeCloseTo(0, 10);
    }
  });

  it("names 2560x1080 as 64:27 and not as 21:9 arithmetic", () => {
    const d = describeRatio(2560, 1080);
    expect(d?.label).toBe("64:27");
    expect(d?.matchesPreset).toBe(true);
    expect(d?.nearest?.label).toBe("21:9");
    expect(d?.decimal).toBeCloseTo(2.37037, 5);
  });

  it("reports 3440x1440 as 43:18, which is not the 64:27 the 21:9 badge implies", () => {
    // Three copy sites used to call this panel 64:27. It is not: gcd is 80.
    const d = describeRatio(3440, 1440);
    expect(d?.label).toBe("43:18");
    expect(d?.matchesPreset).toBe(false);
    expect(d?.decimal).toBeCloseTo(2.388889, 6);
    // 2560×1080 IS 64:27, so the two panels badged 21:9 are different shapes.
    expect(describeRatio(2560, 1080)?.label).toBe("64:27");
  });

  it("returns no nearest name when nothing is within 5%", () => {
    // 3:1 is 20% wider than 2.39:1, the widest name on the list, so nothing
    // claims it and the tool says so rather than pointing at the least-wrong.
    const d = describeRatio(3000, 1000);
    expect(d?.label).toBe("3:1");
    expect(d?.nearest).toBeNull();
    expect(d?.offByPercent).toBeNull();
  });

  it("handles a vertical ratio", () => {
    const d = describeRatio(1080, 1920);
    expect(d?.label).toBe("9:16");
    expect(d?.matchesPreset).toBe(true);
  });

  it("rejects a zero, a negative and a non-finite side", () => {
    expect(describeRatio(0, 100)).toBeNull();
    expect(describeRatio(100, -1)).toBeNull();
    expect(describeRatio(Number.NaN, 100)).toBeNull();
    expect(describeRatio(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });
});

describe("RATIO_PRESETS", () => {
  it("stores the cinema names as the integer pairs they really are", () => {
    const byId = Object.fromEntries(RATIO_PRESETS.map((p) => [p.id, p]));
    expect(byId["21-9"]).toMatchObject({ w: 64, h: 27, label: "21:9" });
    expect(byId["2-39"].w / byId["2-39"].h).toBeCloseTo(2.39, 10);
    expect(byId["2-35"].w / byId["2-35"].h).toBeCloseTo(2.35, 10);
    expect(byId["1-85"].w / byId["1-85"].h).toBeCloseTo(1.85, 10);
  });

  it("has unique ids and is sorted squarest to widest", () => {
    expect(new Set(RATIO_PRESETS.map((p) => p.id)).size).toBe(RATIO_PRESETS.length);
    const decimals = RATIO_PRESETS.map((p) => p.w / p.h);
    expect([...decimals].sort((a, b) => a - b)).toEqual(decimals);
  });

  it("stores every preset in lowest terms, so matchesPreset can reach it", () => {
    // A preset filed unreduced (16:10 rather than 8:5) is a name no screen can
    // ever match: describeRatio compares a GCD-reduced pair against these.
    const unreduced = RATIO_PRESETS.filter((p) => gcd(p.w, p.h) !== 1).map(
      (p) => `${p.id} is ${p.w}:${p.h}`,
    );
    expect(unreduced).toEqual([]);
  });

  it("declares 21:9 a marketing name in its own note, and names both shapes", () => {
    const ultrawide = RATIO_PRESETS.find((p) => p.id === "21-9");
    expect(ultrawide?.note).toMatch(/marketing/i);
    expect(ultrawide?.note).toMatch(/64:27/);
    // 3440×1440 is 43:18. The note used to say it was 64:27 alongside
    // 2560×1080, which is the very error this page exists to correct.
    expect(ultrawide?.note).toMatch(/43:18/);
    expect(ultrawide?.note).not.toMatch(/2560×1080 and 3440×1440/);
  });
});

describe("parseRatio", () => {
  it("takes colon, slash and x forms", () => {
    expect(parseRatio("16:9")).toEqual({ w: 16, h: 9 });
    expect(parseRatio("16/9")).toEqual({ w: 16, h: 9 });
    expect(parseRatio("1920 x 1080")).toEqual({ w: 1920, h: 1080 });
    expect(parseRatio("2.39:1")).toEqual({ w: 2.39, h: 1 });
  });

  it("takes a bare decimal as w:1", () => {
    expect(parseRatio("1.7778")).toEqual({ w: 1.7778, h: 1 });
  });

  it("rejects a zero side, junk and an empty string", () => {
    expect(parseRatio("16:0")).toBeNull();
    expect(parseRatio("0:9")).toBeNull();
    expect(parseRatio("wide")).toBeNull();
    expect(parseRatio("")).toBeNull();
    expect(parseRatio("-16:9")).toBeNull();
  });
});

describe("parseDimension", () => {
  it("takes a positive number and nothing else", () => {
    expect(parseDimension("1920")).toBe(1920);
    expect(parseDimension(" 1080 ")).toBe(1080);
    expect(parseDimension("0")).toBeNull();
    expect(parseDimension("-5")).toBeNull();
    expect(parseDimension("")).toBeNull();
    expect(parseDimension("12px")).toBeNull();
  });
});

describe("solveWidth / solveHeight", () => {
  it("solves cleanly when the answer is whole", () => {
    const h = solveHeight(1920, { w: 16, h: 9 });
    expect(h?.height).toBe(1080);
    expect(h?.rounded).toBe(false);

    const w = solveWidth(1080, { w: 16, h: 9 });
    expect(w?.width).toBe(1920);
    expect(w?.rounded).toBe(false);
  });

  it("flags a rounded answer and keeps the exact value", () => {
    const h = solveHeight(1917, { w: 16, h: 9 });
    expect(h?.height).toBe(1078);
    expect(h?.rounded).toBe(true);
    expect(h?.exact).toBeCloseTo(1078.3125, 6);
  });

  it("rounds only once — no intermediate rounding", () => {
    // 999 / (239/100) = 417.9916…; a two-step round would give 418 either way,
    // but the exact value must still be the unrounded one.
    const h = solveHeight(999, { w: 239, h: 100 });
    expect(h?.exact).toBeCloseTo(417.9916, 4);
    expect(h?.height).toBe(418);
  });

  it("refuses a zero input", () => {
    expect(solveHeight(0, { w: 16, h: 9 })).toBeNull();
    expect(solveWidth(100, { w: 0, h: 9 })).toBeNull();
  });
});

describe("fitBox", () => {
  it("letterboxes a 16:9 clip into a 4:3 frame", () => {
    const r = fitBox({ w: 1920, h: 1080 }, { w: 1440, h: 1080 }, "contain");
    expect(r).toMatchObject({ width: 1440, height: 810, effect: "letterbox" });
    expect(r?.barsTop).toBe(135);
    expect(r?.barsBottom).toBe(135);
    expect(r?.barsLeft).toBe(0);
    expect(r?.barsRight).toBe(0);
    expect(r?.scale).toBeCloseTo(0.75, 10);
  });

  it("pillarboxes a 4:3 clip into a 16:9 frame", () => {
    const r = fitBox({ w: 1440, h: 1080 }, { w: 1920, h: 1080 }, "contain");
    expect(r).toMatchObject({ width: 1440, height: 1080, effect: "pillarbox" });
    expect(r?.barsLeft).toBe(240);
    expect(r?.barsRight).toBe(240);
    expect(r?.barsTop).toBe(0);
    expect(r?.barsBottom).toBe(0);
  });

  it("leaves no bars when the ratios agree", () => {
    const r = fitBox({ w: 1920, h: 1080 }, { w: 1280, h: 720 }, "contain");
    expect(r).toMatchObject({
      width: 1280,
      height: 720,
      effect: "none",
      barsLeft: 0,
      barsRight: 0,
      barsTop: 0,
      barsBottom: 0,
    });
    expect(r?.coverage).toBeCloseTo(1, 6);
  });

  it("splits an odd leftover so the bars and the picture add up to the frame", () => {
    // 1920×1080 into a 1000×1000 frame scales to 1000×563, leaving 437 px of
    // empty frame — an odd number, so the two bars cannot be equal. Reporting
    // one number twice printed 219 above AND 219 below, a 1001 px composition
    // in a 1000 px frame. The odd pixel goes to the bottom.
    const r = fitBox({ w: 1920, h: 1080 }, { w: 1000, h: 1000 }, "contain");
    expect(r?.height).toBe(563);
    expect(r?.barsTop).toBe(218);
    expect(r?.barsBottom).toBe(219);
    expect((r?.barsTop ?? 0) + (r?.height ?? 0) + (r?.barsBottom ?? 0)).toBe(1000);
  });

  it("splits an odd pillarbox leftover the same way", () => {
    // 1:8 into 1920×1080 gives a 135 px-wide picture and 1785 px of frame.
    const r = fitBox({ w: 1, h: 8 }, { w: 1920, h: 1080 }, "contain");
    expect(r?.width).toBe(135);
    expect(r?.barsLeft).toBe(892);
    expect(r?.barsRight).toBe(893);
    expect((r?.barsLeft ?? 0) + (r?.width ?? 0) + (r?.barsRight ?? 0)).toBe(1920);
  });

  it("accounts for every cropped pixel when the overflow is odd", () => {
    // Cover mode: 1920×1080 into 1001×1000 scales to 1778×1000, so 777 px of
    // width is cut. Halving and rounding lost one of them.
    const r = fitBox({ w: 1920, h: 1080 }, { w: 1001, h: 1000 }, "cover");
    expect(r?.width).toBe(1778);
    expect(r?.barsLeft).toBe(388);
    expect(r?.barsRight).toBe(389);
    expect((r?.width ?? 0) - (r?.barsLeft ?? 0) - (r?.barsRight ?? 0)).toBe(1001);
  });

  it("keeps bars and picture summing to the frame across a wide sweep", () => {
    const frames = [
      { w: 1920, h: 1080 },
      { w: 1000, h: 1000 },
      { w: 1080, h: 1350 },
      { w: 1366, h: 768 },
      { w: 501, h: 999 },
    ];
    const broken: string[] = [];
    for (const frame of frames) {
      for (let w = 1; w <= 60; w++) {
        for (let h = 1; h <= 60; h++) {
          const c = fitBox({ w, h }, frame, "contain")!;
          if (c.barsLeft + c.width + c.barsRight !== frame.w) {
            broken.push(`contain ${w}:${h} into ${frame.w}×${frame.h} across`);
          }
          if (c.barsTop + c.height + c.barsBottom !== frame.h) {
            broken.push(`contain ${w}:${h} into ${frame.w}×${frame.h} down`);
          }
          const v = fitBox({ w, h }, frame, "cover")!;
          if (v.width - v.barsLeft - v.barsRight !== frame.w) {
            broken.push(`cover ${w}:${h} into ${frame.w}×${frame.h} across`);
          }
          if (v.height - v.barsTop - v.barsBottom !== frame.h) {
            broken.push(`cover ${w}:${h} into ${frame.w}×${frame.h} down`);
          }
        }
      }
    }
    expect(broken.slice(0, 5)).toEqual([]);
  });

  it("crops instead of barring in cover mode, and never calls that a letterbox", () => {
    const r = fitBox({ w: 1920, h: 1080 }, { w: 1080, h: 1080 }, "cover");
    expect(r).toMatchObject({ width: 1920, height: 1080, effect: "crops-sides" });
    expect(r?.barsLeft).toBe(420);
    expect(r?.barsRight).toBe(420);
    expect(r?.coverage).toBe(1);
  });

  it("crops top and bottom when the source is the taller one", () => {
    const r = fitBox({ w: 1080, h: 1920 }, { w: 1080, h: 1080 }, "cover");
    expect(r?.effect).toBe("crops-top-and-bottom");
    expect(r?.barsTop).toBe(420);
    expect(r?.barsBottom).toBe(420);
  });

  it("flags a rounded fit", () => {
    const r = fitBox({ w: 1366, h: 768 }, { w: 1000, h: 1000 }, "contain");
    expect(r?.rounded).toBe(true);
    expect(r?.width).toBe(1000);
    expect(r?.height).toBe(562); // 768 * (1000/1366) = 562.226…
  });

  it("reports coverage below 1 for a letterboxed fit", () => {
    const r = fitBox({ w: 1920, h: 1080 }, { w: 1440, h: 1080 }, "contain");
    expect(r?.coverage).toBeCloseTo(0.75, 4);
  });

  it("refuses a zero-sided box", () => {
    expect(fitBox({ w: 0, h: 1080 }, { w: 100, h: 100 }, "contain")).toBeNull();
    expect(fitBox({ w: 100, h: 100 }, { w: 100, h: 0 }, "cover")).toBeNull();
  });
});
