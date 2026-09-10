import { readFileSync } from "node:fs";

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import {
  CanvasStage,
  CompareStage,
  QueueTable,
  RangeField,
  RecordStage,
  TrimOverlay,
  Waveform,
} from "@/components/tools/ToolCanvas";

/*
  ToolCanvas — WCAG 1.4.11 Non-text Contrast (AA) and 2.2.2 Pause/Stop/Hide (A).

  jsdom runs no Tailwind, so there is no computed colour to read: a class name
  is all the DOM has of a colour. Rather than assert the class STRING (which
  pins the fix but proves nothing about the ratio, and goes stale the moment a
  token is retuned), every test below resolves the rendered class back through
  `src/app/globals.css` to a literal sRGB triple and computes the WCAG ratio.
  So these fail two ways, which is the point:

    * revert the component  → the class resolves to the old token → RED
    * retune the token in globals.css → the same class resolves darker → RED

  The audit that produced this work prescribed `neutral-700` for the input
  border and the waveform and claimed it "measures 3.31:1 on the rail". It does
  not — neutral-700 is #595d6c and measures 2.72:1 there, 2.69:1 on the tool
  plate and 2.83:1 on the canvas ground. Every number in this file was computed
  by the harness below, whose positive control reproduces the two canonical
  WCAG boundary colours to two decimals.
*/

// ─────────────────────────────────────────────────────────────────────────────
// The measuring harness
// ─────────────────────────────────────────────────────────────────────────────

/** Straight (non-premultiplied) sRGB, 0–255, plus alpha 0–1. */
type Rgba = { r: number; g: number; b: number; a: number };

const GLOBALS = readFileSync("src/app/globals.css", "utf8");

/** Every `--custom-property: value;` in globals.css, last declaration wins. */
const DECLS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const m of GLOBALS.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
})();

function hex(value: string): Rgba {
  const s = value.replace("#", "");
  const full =
    s.length === 3
      ? s
          .split("")
          .map((c) => c + c)
          .join("")
      : s;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: 1,
  };
}

/** Splits `a, b, c` at top level only — commas inside nested parens survive. */
function splitArgs(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());
  return parts;
}

/**
 * Resolves a CSS colour expression as it appears in globals.css: a hex, a
 * `var()` chain, `rgba()`, `transparent`, or `color-mix(in srgb, …)`.
 *
 * `color-mix(in srgb, …)` is a component-wise mix of the GAMMA-ENCODED sRGB
 * values — CSS Color 4 names the linear space `srgb-linear`, so `srgb` is the
 * encoded one — with premultiplied alpha. Mixing an opaque colour into
 * `transparent` therefore yields that colour at the stated alpha, which is
 * exactly what `--color-nocturne-divider` is.
 */
function resolveColor(expr: string, seen: Set<string> = new Set()): Rgba {
  const v = expr.trim();

  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (v.startsWith("#")) return hex(v);

  const rgbaMatch = v.match(/^rgba?\(([^)]+)\)$/);
  if (rgbaMatch) {
    const [r, g, b, a] = splitArgs(rgbaMatch[1]).map(Number);
    return { r, g, b, a: a === undefined || Number.isNaN(a) ? 1 : a };
  }

  const varMatch = v.match(/^var\((--[\w-]+)\)$/);
  if (varMatch) {
    const name = varMatch[1];
    // `@theme inline` aliases some names onto themselves (`--radius-sm:
    // var(--radius-sm)`); a cycle here would hang the suite, not fail it.
    if (seen.has(name)) throw new Error(`cycle resolving ${name}`);
    const next = DECLS[name];
    if (next === undefined) throw new Error(`no declaration for ${name}`);
    return resolveColor(next, new Set(seen).add(name));
  }

  // No `s` flag: a declaration value is always one line here, and the repo's
  // tsconfig target predates dotAll.
  const mixMatch = v.match(/^color-mix\(\s*in\s+srgb\s*,\s*(.+)\)$/);
  if (mixMatch) {
    const [first, second] = splitArgs(mixMatch[1]);
    const pct = first.match(/\s(\d+(?:\.\d+)?)%$/);
    if (!pct) throw new Error(`no percentage in color-mix: ${v}`);
    const p = Number(pct[1]) / 100;
    const a = resolveColor(first.replace(/\s\d+(?:\.\d+)?%$/, ""), seen);
    const b = resolveColor(second, seen);
    const alpha = a.a * p + b.a * (1 - p);
    // Premultiplied interpolation, then un-premultiply.
    const ch = (x: number, y: number) =>
      alpha === 0 ? 0 : (x * a.a * p + y * b.a * (1 - p)) / alpha;
    return { r: ch(a.r, b.r), g: ch(a.g, b.g), b: ch(a.b, b.b), a: alpha };
  }

  throw new Error(`cannot resolve colour: ${v}`);
}

/** `token("--color-neutral-600")`. */
function token(name: string): Rgba {
  return resolveColor(`var(${name})`);
}

/** Source-over composite of `fg` onto an opaque `bg`. */
function over(fg: Rgba, bg: Rgba): Rgba {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio, rounded to 2dp so failures read as real numbers. */
function contrast(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [luminance(over(fg, bg)), luminance(bg)].sort((a, b) => b - a);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/**
 * The CSS custom property a Tailwind colour utility reads. `bg-neutral-600` →
 * `--color-neutral-600`, `border-border` → `--color-border`, and an arbitrary
 * value like `bg-[rgba(15,17,28,.45)]` resolves in place.
 */
function colorOf(className: string, prefix: "bg" | "border" | "outline"): Rgba {
  const arbitrary = className.match(
    new RegExp(`(?:^|\\s)${prefix}-\\[([^\\]]+)\\]`),
  );
  if (arbitrary) return resolveColor(arbitrary[1].replace(/_/g, " "));

  const named = className.match(
    new RegExp(`(?:^|\\s)${prefix}-((?:bg-|accent|neutral|success|error|border)[\\w-]*)`),
  );
  if (!named) throw new Error(`no ${prefix}-* colour in: ${className}`);
  return token(`--color-${named[1]}`);
}

const AA_NON_TEXT = 3;

/** Every element under `root` whose class list contains `needle`. */
function withClass(root: ParentNode, needle: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) =>
    el.className.split(/\s+/).includes(needle),
  );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("the contrast harness itself", () => {
  it("reproduces the canonical WCAG boundary values", () => {
    const white = hex("#ffffff");
    expect(contrast(hex("#000000"), white)).toBe(21);
    // The two colours the WCAG maths is normally calibrated against.
    expect(contrast(hex("#767676"), white)).toBe(4.54); // the 4.5:1 boundary
    expect(contrast(hex("#949494"), white)).toBe(3.03); // the 3:1 boundary
    expect(contrast(hex("#595959"), white)).toBe(7); // the AAA boundary
  });

  it("can return a FAILING value — it is not an `expect(true)` in disguise", () => {
    expect(contrast(hex("#ffffff"), hex("#ffffff"))).toBe(1);
    expect(contrast(hex("#ffffff"), hex("#ffffff"))).toBeLessThan(AA_NON_TEXT);
  });

  it("resolves globals.css var chains and color-mix the way a browser does", () => {
    // --color-neutral-600 → --color-nocturne-neutral-600 → #75798c
    expect(token("--color-neutral-600")).toMatchObject({ r: 0x75, g: 0x79, b: 0x8c });
    // --color-bg-primary → --bg-primary → --color-nocturne-bg → #161826
    expect(token("--color-bg-primary")).toMatchObject({ r: 0x16, g: 0x18, b: 0x26 });
    // color-mix(in srgb, #161826 78%, #000)
    expect(token("--color-nocturne-canvas")).toMatchObject({ r: 22 * 0.78, a: 1 });
    // color-mix(in srgb, #e9e9ed 16%, transparent) — a 16%-alpha hairline.
    expect(token("--color-border").a).toBeCloseTo(0.16, 5);
  });

  it("agrees with the audit on the ratios that were flagged as failures", () => {
    // These are the BEFORE values. They are asserted so that this file states,
    // in runnable form, what each fix below is worth.
    const plate = token("--color-bg-primary");
    expect(contrast(token("--color-neutral-800"), plate)).toBe(1.76); // waveform bar / queue track
    expect(contrast(token("--color-neutral-800"), token("--color-neutral-900"))).toBe(1.41); // meter
    expect(contrast(token("--color-border"), token("--color-nocturne-canvas"))).toBe(1.52); // input border
    // …and disagrees about the prescription. neutral-700 clears nothing here.
    expect(contrast(token("--color-neutral-700"), plate)).toBe(2.69);
    expect(contrast(token("--color-neutral-700"), token("--color-nocturne-canvas"))).toBe(2.83);
    expect(contrast(token("--color-neutral-700"), token("--color-nocturne-rail"))).toBe(2.72);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-3 · WCAG 1.4.11 Non-text Contrast (AA)
// ─────────────────────────────────────────────────────────────────────────────

describe("Waveform unselected bars (P2-3, WCAG 1.4.11)", () => {
  /**
   * Mirrors AudioTrimmerUI:293-300 — the ONLY caller that ever renders an
   * unselected bar. The other five `<Waveform>` sites pass `startPct={0}
   * endPct={100}`, so every bar there is `inSelection`, and none of them
   * mounts TrimOverlay at all.
   */
  function renderTrimmer() {
    // 4 peaks → positions 0, 25, 50, 75. Only i=2 falls inside 40–60.
    return render(
      <CanvasStage>
        <Waveform peaks={[0.3, 0.9, 0.5, 0.7]} startPct={40} endPct={60} />
        <TrimOverlay trimA={40} trimB={60} />
      </CanvasStage>,
    );
  }

  it("clears 3:1 against the plate AS MASKED — the overlay covers the bars", () => {
    const { container } = renderTrimmer();

    const plateEl = container.firstElementChild as HTMLElement;
    const bars = withClass(container, "rounded-[1px]");
    const unselected = bars.filter((b) => !b.className.includes("bg-accent"));
    const masks = Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) =>
      /bg-\[rgba\(/.test(el.className),
    );

    expect(bars).toHaveLength(4);
    expect(unselected).toHaveLength(3);
    expect(masks).toHaveLength(2); // left of the selection and right of it

    const plate = colorOf(plateEl.className, "bg");
    const mask = colorOf(masks[0].className, "bg");
    const bar = colorOf(unselected[0].className, "bg");

    // An unselected bar is BY DEFINITION outside [trimA, trimB], so it is
    // always under the mask — and so is the plate behind it. Measuring the
    // bar against the bare plate (which is what the audit did, reporting
    // 1.76:1) measures a state that never renders.
    const ratio = contrast(over(mask, bar), over(mask, plate));
    expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(ratio).toBe(3.48);

    // And the bare-plate reading, for the record: no longer a failure either.
    expect(contrast(bar, plate)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("would still fail with the old token or the old mask — both halves matter", () => {
    const { container } = renderTrimmer();
    const plate = colorOf((container.firstElementChild as HTMLElement).className, "bg");
    const mask = colorOf(
      Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) =>
        /bg-\[rgba\(/.test(el.className),
      )[0].className,
      "bg",
    );
    const bar = colorOf(
      withClass(container, "rounded-[1px]").filter((b) => !b.className.includes("bg-accent"))[0]
        .className,
      "bg",
    );

    const heavier: Rgba = { ...mask, a: 0.55 }; // the mask alpha before this pass
    // Old bar, current mask: 2.73. Current bar, old mask: 2.73. Old both: 1.23.
    expect(contrast(over(mask, token("--color-neutral-800")), over(mask, plate))).toBeLessThan(
      AA_NON_TEXT,
    );
    expect(contrast(over(heavier, bar), over(heavier, plate))).toBeLessThan(AA_NON_TEXT);
    // The token the audit prescribed does not reach 3:1 at ANY mask alpha the
    // design tolerates — it is 1.77:1 here and only 2.69:1 with no mask at all.
    expect(contrast(over(mask, token("--color-neutral-700")), over(mask, plate))).toBeLessThan(
      AA_NON_TEXT,
    );
  });

  it("keeps the selected bar readable too", () => {
    const { container } = renderTrimmer();
    const plate = colorOf((container.firstElementChild as HTMLElement).className, "bg");
    const selected = withClass(container, "rounded-[1px]").filter((b) =>
      b.className.includes("bg-accent"),
    );

    expect(selected).toHaveLength(1);
    // Selected bars sit on the BARE plate — the mask stops at the selection.
    expect(contrast(colorOf(selected[0].className, "bg"), plate)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });
});

describe("RecordStage input meter (P2-3, WCAG 1.4.11)", () => {
  function meterParts() {
    const { container } = render(
      <CanvasStage>
        <RecordStage elapsed="00:12.4" meta={["WEBM", "48 kHz"]} level={0.5} />
      </CanvasStage>,
    );
    const plate = colorOf((container.firstElementChild as HTMLElement).className, "bg");
    const track = withClass(container, "bg-neutral-900")[0];
    const segments = withClass(container, "duration-75");
    return { container, plate, track, segments };
  }

  it("draws the meter's unlit segments at 3:1 against their track", () => {
    const { track, segments } = meterParts();

    expect(segments).toHaveLength(40); // METER_SEGMENTS
    const unlit = segments.filter(
      (s) => !s.className.includes("bg-accent") && !s.className.includes("bg-error"),
    );
    // level 0.5 → 20 lit, 20 unlit.
    expect(unlit).toHaveLength(20);

    const trackColor = colorOf(track.className, "bg");
    const ratio = contrast(colorOf(unlit[0].className, "bg"), trackColor);
    expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(ratio).toBe(3.28);

    // The unlit segments are what draw the meter's full extent, so the old
    // value made the scale invisible, not merely quiet.
    expect(contrast(token("--color-neutral-800"), trackColor)).toBe(1.41);
  });

  it("keeps the lit segments readable against the same track", () => {
    const { track, segments } = meterParts();
    const trackColor = colorOf(track.className, "bg");
    const lit = segments.filter((s) => s.className.includes("bg-accent"));

    expect(lit.length).toBeGreaterThan(0);
    // `gap-0.5` + `p-px` means a segment's neighbour is always the track, so
    // this is the pairing that matters — not lit-against-unlit.
    expect(contrast(colorOf(lit[0].className, "bg"), trackColor)).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });

  it("shows the paused state at 3:1 against the plate", () => {
    const { container } = render(
      <CanvasStage>
        <RecordStage elapsed="00:12.4" meta={["WEBM"]} level={null} paused />
      </CanvasStage>,
    );
    const plate = colorOf((container.firstElementChild as HTMLElement).className, "bg");
    const dot = withClass(container, "size-11")[0];

    // Paused vs recording is a state, and 1.4.11 asks 3:1 of whatever shows it.
    expect(contrast(colorOf(dot.className, "bg"), plate)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast(token("--color-neutral-700"), plate)).toBeLessThan(AA_NON_TEXT);
  });
});

describe("RangeField text input border (P2-3, WCAG 1.4.11)", () => {
  it("bounds the field at 3:1 on BOTH sides of the border", () => {
    render(<RangeField value="1-3, 5" onChange={() => {}} onApply={() => {}} />);

    const input = screen.getByRole("textbox", { name: "Page range" });
    const border = colorOf(input.className, "border");
    const fill = colorOf(input.className, "bg");
    // All three consumers (ExtractPdfPagesUI, DeletePdfPagesUI, SplitPdfUI)
    // render RangeField straight onto the canvas ground.
    const ground = token("--color-nocturne-canvas");

    // A border is adjacent to two colours; the boundary has to be visible
    // against the ground it sits on AND against the field it encloses.
    expect(contrast(border, ground)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast(border, fill)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast(border, ground)).toBe(4.3);
    expect(contrast(border, fill)).toBe(3.52);

    // What it was: `border-border`, a 16%-alpha decorative hairline.
    expect(contrast(token("--color-border"), ground)).toBe(1.52);
    // What the audit asked for, which clears neither side.
    expect(contrast(token("--color-neutral-700"), ground)).toBeLessThan(AA_NON_TEXT);
    expect(contrast(token("--color-neutral-700"), fill)).toBeLessThan(AA_NON_TEXT);
  });
});

describe("QueueTable progress bar (P2-3, WCAG 1.4.11)", () => {
  function renderQueue() {
    return render(
      <QueueTable
        rows={[
          { name: "a.png", inSize: "2.0 MB", outSize: "0.8 MB", pct: 40, state: "RUNNING" },
          { name: "b.png", inSize: "1.0 MB", outSize: "0.4 MB", pct: 100, state: "DONE" },
          { name: "c.png", inSize: "3.0 MB", outSize: "—", pct: 0, state: "FAILED" },
        ]}
      />,
    );
  }

  it("draws the track's extent with a 3:1 outline instead of a 3:1 fill", () => {
    const { container } = renderQueue();

    const plate = colorOf(
      (container.querySelector(".bg-bg-primary") as HTMLElement).className,
      "bg",
    );
    const tracks = withClass(container, "rounded-[2px]").filter((el) =>
      el.className.includes("bg-neutral-800"),
    );
    expect(tracks).toHaveLength(3);

    const outline = colorOf(tracks[0].className, "outline");
    expect(tracks[0].className).toContain("outline-1");
    expect(contrast(outline, plate)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(contrast(outline, plate)).toBe(4.08);
  });

  it("keeps every fill 3:1 against the track it is drawn on", () => {
    const { container } = renderQueue();

    const tracks = withClass(container, "rounded-[2px]").filter((el) =>
      el.className.includes("bg-neutral-800"),
    );
    const trackColor = colorOf(tracks[0].className, "bg");
    const fills = tracks.map((t) => t.firstElementChild as HTMLElement);

    // RUNNING → accent, DONE → success, FAILED → error.
    expect(fills.map((f) => f.className.match(/bg-(accent|success|error)\b/)![1])).toEqual([
      "accent",
      "success",
      "error",
    ]);
    for (const fill of fills) {
      expect(contrast(colorOf(fill.className, "bg"), trackColor)).toBeGreaterThanOrEqual(
        AA_NON_TEXT,
      );
    }
  });

  it("proves the track could not simply be lightened — it is arithmetic", () => {
    /*
      A progress bar is a three-way constraint: track-vs-plate AND fill-vs-track
      both need 3:1. The fill clears the plate by 5.45:1, so any track wedged
      between them tops out at 5.45 / 3 = 1.82 on the far side; going darker is
      capped at 1.19:1 because the plate is already near-black. There is no
      single track colour that satisfies both — which is why the fix adds a
      second colour (the outline) rather than changing this one.
    */
    const { container } = renderQueue();
    const plate = colorOf(
      (container.querySelector(".bg-bg-primary") as HTMLElement).className,
      "bg",
    );
    const accent = token("--color-accent");

    for (const step of ["600", "700", "800"]) {
      const candidate = token(`--color-neutral-${step}`);
      const trackSide = contrast(candidate, plate);
      const fillSide = contrast(accent, candidate);
      expect(Math.min(trackSide, fillSide)).toBeLessThan(AA_NON_TEXT);
    }
    // Both extremes of the range, for completeness.
    expect(contrast(hex("#ffffff"), plate)).toBe(17.61);
    expect(contrast(hex("#000000"), plate)).toBe(1.19);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P2-7 · WCAG 2.2.2 Pause/Stop/Hide (A)
// ─────────────────────────────────────────────────────────────────────────────

/** Every rendered element carrying an `animate-tm-*` class. */
function animatedElements(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("*")).filter((el) =>
    /(?:^|\s)animate-tm-[\w-]+/.test(el.className),
  );
}

describe("Reduced-motion escapes (P2-7, WCAG 2.2.2)", () => {
  it("RecordStage's rise and its 2.4s infinite pulse both stop", () => {
    const { container } = render(
      <RecordStage elapsed="00:03.1" meta={["WEBM"]} level={0.4} />,
    );

    const animated = animatedElements(container);
    // The stage's own entrance, plus the pulsing ring around the dot.
    expect(animated.map((el) => el.className.match(/animate-(tm-[\w-]+)/)![1]).sort()).toEqual([
      "tm-pulse",
      "tm-rise",
    ]);
    for (const el of animated) {
      expect(el.className).toContain("motion-reduce:animate-none");
    }
  });

  it("does not animate the ring at all once the recorder is paused", () => {
    const { container } = render(
      <RecordStage elapsed="00:03.1" meta={["WEBM"]} level={null} paused />,
    );
    expect(
      animatedElements(container).map((el) => el.className.match(/animate-(tm-[\w-]+)/)![1]),
    ).toEqual(["tm-rise"]);
  });

  it("CompareStage's 1.5s infinite busy sweep stops", () => {
    const { container } = render(
      <CompareStage
        beforeUrl="blob:before"
        afterUrl={null}
        inLabel="ORIGINAL"
        outLabel="RESULT"
        split={50}
        onSplitChange={() => {}}
        busy
      />,
    );

    const animated = animatedElements(container);
    expect(animated).toHaveLength(1);
    expect(animated[0].className).toContain("animate-tm-sweep");
    expect(animated[0].className).toContain("motion-reduce:animate-none");
  });

  it("leaves no animate-tm-* in the file without an escape on the same line", () => {
    // Belt and braces for the sites a unit render cannot reach. This is the
    // audit's own grep, run as an assertion.
    const src = readFileSync("src/components/tools/ToolCanvas.tsx", "utf8");
    const offenders = src
      .split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /\banimate-tm-/.test(line) && !/motion-reduce:animate-none/.test(line));

    expect(offenders.map(({ n, line }) => `${n}: ${line.trim()}`)).toEqual([]);
    // Positive control: the grep does find the three sites when it looks for
    // them, so an empty result above is a pass and not a broken pattern.
    expect(src.match(/\banimate-tm-[\w-]+/g)).toHaveLength(3);
  });
});
