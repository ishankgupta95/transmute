/**
 * Aspect ratios: solving for a missing dimension, reducing to integers, and
 * fitting one box inside another.
 *
 * Pure arithmetic over numbers. No DOM, no dependency.
 *
 * ── What "16:9" actually means here ─────────────────────────────────────────
 *
 * A ratio in this module is a pair of positive numbers, and the reduced form
 * is the pair divided by their greatest common divisor. That is exact for
 * integer dimensions and it is where most of the value is: 1366×768 reduces to
 * 683:384, NOT to 16:9. The two differ by 0.0488% — invisible on a desktop,
 * but enough that "resize this to 16:9" and "keep this panel's ratio" are
 * different instructions, and a calculator that rounds 683:384 to 16:9 has
 * answered a question nobody asked.
 *
 * So `describeRatio` reports both: the exact reduced integers, and the nearest
 * NAMED ratio with the percentage it is out by. `matchesPreset` is true only
 * when the reduced pair equals the named ratio's own reduced pair exactly.
 *
 * ── Rounding ────────────────────────────────────────────────────────────────
 *
 * Pixels are integers and the arithmetic is not, so every function that
 * produces a dimension rounds ONCE, at the end, and returns `rounded: true`
 * when the exact value was not already whole. Nothing here rounds an
 * intermediate value: 1920 ÷ (16/9) is 1080 exactly, but 1917 ÷ (16/9) is
 * 1078.3125, and quietly calling that 1078 changes the ratio it came from.
 *
 * ── The cinema names ────────────────────────────────────────────────────────
 *
 * "21:9" is a marketing name and not a ratio any panel has — it does not even
 * name one shape. The 2560×1080 ultrawides sold under it are 64:27 (2.370:1),
 * the 3440×1440 ones are 43:18 (2.389:1), and the 3840×1600 ones are 12:5
 * (2.4:1): three ratios, one badge. "2.39:1" is the modern anamorphic
 * projection standard (SMPTE 195, which superseded the older 2.35:1 in 1970),
 * and "1.85:1" is the American flat standard. Those two are stored as the
 * integer pairs they actually are — 239:100 and 37:20 — and the 21:9 chip is
 * stored as 64:27, the commonest of the three panels it names. Every preset is
 * stored in lowest terms and labelled with the name people search for, which
 * is not the same string; "16:10" is filed as 8:5 for the same reason.
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface Ratio {
  w: number;
  h: number;
}

export interface RatioPreset extends Ratio {
  id: string;
  /** What people call it — "21:9", "2.39:1". Not always `w:h`. */
  label: string;
  /** One honest clause about where it comes from, shown under the chips. */
  note: string;
}

export interface RatioDescription {
  /** The pair as given, unreduced. */
  given: Ratio;
  /** Smallest integer pair with the same ratio. Exact for integer inputs. */
  reduced: Ratio;
  /**
   * False when the inputs were not whole numbers, so `reduced` came from a
   * continued-fraction approximation rather than a GCD and is only close.
   */
  reductionExact: boolean;
  /** w ÷ h — 1.7777777777777777 for 16:9. */
  decimal: number;
  /** The named ratio it is closest to, or null when nothing is within 5%. */
  nearest: RatioPreset | null;
  /** True only when `reduced` equals the reduced form of `nearest` exactly. */
  matchesPreset: boolean;
  /**
   * Signed percentage the decimal is away from `nearest`: 1366×768 against
   * 16:9 gives +0.0488, meaning 0.0488% wider than the named ratio. Null when
   * `nearest` is null.
   */
  offByPercent: number | null;
  /** "683:384". */
  label: string;
}

export interface SolveResult {
  width: number;
  height: number;
  ratio: Ratio;
  /** True when the solved dimension was not a whole number before rounding. */
  rounded: boolean;
  /** The unrounded value of whichever dimension was solved for. */
  exact: number;
}

export interface FitResult {
  /** The scaled box, rounded to whole pixels. */
  width: number;
  height: number;
  /** Multiplier applied to the source box. Not rounded. */
  scale: number;
  /** True when either dimension was fractional before rounding. */
  rounded: boolean;
  /**
   * Contain: the empty frame left over, in pixels, per side. Cover: the pixels
   * cut off each side instead. One axis is always 0 — a box cannot be
   * letterboxed and pillarboxed at once.
   *
   * The two sides of an axis are reported SEPARATELY because they are not
   * always equal: 563 px of picture in a 1000 px frame leaves 437 px over,
   * which is 218 above and 219 below (the odd pixel goes to the bottom, or to
   * the right). One number used twice would have the bars and the picture
   * adding up to 1001 px of a 1000 px frame.
   */
  barsLeft: number;
  barsRight: number;
  barsTop: number;
  barsBottom: number;
  /**
   * What actually happens to the frame. Contain leaves bars; cover cuts. The
   * two are never spelled the same way, because "letterboxed" and "cropped top
   * and bottom" are opposite outcomes for the same pair of numbers.
   */
  effect: "letterbox" | "pillarbox" | "crops-top-and-bottom" | "crops-sides" | "none";
  /** Share of the target frame the image covers, 0–1. Always 1 for cover. */
  coverage: number;
}

/* ── Named ratios ─────────────────────────────────────────────────────────── */

/**
 * The presets, stored as the integer pairs they really are.
 *
 * Every pair is in LOWEST TERMS, because `matchesPreset` compares a
 * GCD-reduced input against these numbers: a preset filed as 16:10 rather than
 * 8:5 can never equal a reduced pair, so every exact 16:10 screen would be
 * told it is "not 16:10, 0% off". The label carries the name people search
 * for; the pair carries the arithmetic. `RATIO_PRESETS` is pinned in lowest
 * terms by a test for exactly this reason.
 *
 * Sorted by decimal so the chip row reads squarest-to-widest rather than in
 * whatever order they were typed.
 */
export const RATIO_PRESETS: readonly RatioPreset[] = [
  {
    id: "9-16",
    label: "9:16",
    w: 9,
    h: 16,
    note: "Vertical video — phone full screen, Reels, Shorts, TikTok. 16:9 stood on end.",
  },
  { id: "1-1", label: "1:1", w: 1, h: 1, note: "Square. Profile pictures, album art, feed posts." },
  {
    id: "4-3",
    label: "4:3",
    w: 4,
    h: 3,
    note: "Standard-definition television and most compact-camera sensors. Also the iPad's screen.",
  },
  {
    id: "3-2",
    label: "3:2",
    w: 3,
    h: 2,
    note: "35mm film, and every full-frame and APS-C camera that inherited it. 6×4 prints are this.",
  },
  {
    id: "16-10",
    label: "16:10",
    w: 8,
    h: 5,
    note: "Stored as 8:5, the same shape in lowest terms. Common on laptops and monitors sold for work — noticeably taller than 16:9.",
  },
  {
    id: "16-9",
    label: "16:9",
    w: 16,
    h: 9,
    note: "HD and UHD. 1280×720, 1920×1080 and 3840×2160 are all exactly this; 1366×768 is not.",
  },
  {
    id: "1-85",
    label: "1.85:1",
    w: 37,
    h: 20,
    note: "Cinema flat. Stored as 37:20, which is 1.85 exactly.",
  },
  {
    id: "2-35",
    label: "2.35:1",
    w: 47,
    h: 20,
    note: "The older anamorphic standard, used for prints struck before 1970. Stored as 47:20.",
  },
  {
    id: "21-9",
    label: "21:9",
    w: 64,
    h: 27,
    note: "A marketing name, not a ratio — and not even one shape. 2560×1080 ultrawides are 64:27 (2.370:1); 3440×1440 ones are 43:18 (2.389:1). Stored as 64:27.",
  },
  {
    id: "2-39",
    label: "2.39:1",
    w: 239,
    h: 100,
    note: "Cinema scope — the current anamorphic projection standard. Stored as 239:100.",
  },
];

/* ── Reduction ────────────────────────────────────────────────────────────── */

/** Greatest common divisor, Euclid. Both arguments are used as absolute values. */
export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

/**
 * A decimal ratio as the smallest integer pair within `maxDenominator`.
 *
 * Continued fractions, the standard best-rational-approximation algorithm.
 * Used only for a ratio typed as a decimal ("1.777") — integer dimensions go
 * through `gcd`, which is exact and needs no ceiling.
 */
function approximate(value: number, maxDenominator = 1000): Ratio {
  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  let x = value;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(x);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDenominator) break;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    const frac = x - a;
    if (frac < 1e-12) break;
    x = 1 / frac;
  }
  return { w: h1, h: k1 || 1 };
}

/** The exact reduced pair for whole numbers; a close one for anything else. */
export function reduceRatio(w: number, h: number): { ratio: Ratio; exact: boolean } {
  if (!(w > 0) || !(h > 0)) return { ratio: { w: 0, h: 0 }, exact: false };
  if (Number.isInteger(w) && Number.isInteger(h)) {
    const d = gcd(w, h) || 1;
    return { ratio: { w: w / d, h: h / d }, exact: true };
  }
  return { ratio: approximate(w / h), exact: false };
}

/** "16:9". */
export function ratioLabel(r: Ratio): string {
  return `${r.w}:${r.h}`;
}

/**
 * Everything worth saying about one pair of numbers.
 *
 * `nearest` is capped at 5% because past that the "nearest name" is noise —
 * 4:3 is 25% off 16:9 and calling it "close to 16:9" would be worse than
 * saying nothing.
 */
export function describeRatio(w: number, h: number): RatioDescription | null {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const { ratio: reduced, exact } = reduceRatio(w, h);
  const decimal = w / h;

  let nearest: RatioPreset | null = null;
  let bestDelta = Infinity;
  for (const preset of RATIO_PRESETS) {
    const delta = Math.abs(preset.w / preset.h - decimal) / decimal;
    if (delta < bestDelta) {
      bestDelta = delta;
      nearest = preset;
    }
  }
  if (bestDelta > 0.05) nearest = null;

  /*
    Reduced against reduced. Every preset is already in lowest terms and a test
    pins that, but reducing here as well means a preset filed in the wrong form
    is a cosmetic slip rather than a name no screen on earth can ever match.
  */
  const named = nearest ? reduceRatio(nearest.w, nearest.h).ratio : null;
  const matchesPreset =
    named !== null && exact && reduced.w === named.w && reduced.h === named.h;

  return {
    given: { w, h },
    reduced,
    reductionExact: exact,
    decimal,
    nearest,
    matchesPreset,
    offByPercent: nearest ? ((decimal - nearest.w / nearest.h) / (nearest.w / nearest.h)) * 100 : null,
    label: ratioLabel(reduced),
  };
}

/* ── Parsing ──────────────────────────────────────────────────────────────── */

/**
 * "16:9", "16/9", "16 x 9", "1.85:1" or a bare decimal like "1.7778".
 *
 * A bare decimal is read as w ÷ h with h = 1, which is how "2.39:1" is written
 * in the trade anyway. Zero and negative numbers are rejected rather than
 * clamped — a ratio with a zero side has no meaning to round to.
 */
export function parseRatio(text: string): Ratio | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const pair = trimmed.match(/^(\d*\.?\d+)\s*[:/x×]\s*(\d*\.?\d+)$/i);
  if (pair) {
    const w = Number(pair[1]);
    const h = Number(pair[2]);
    if (w > 0 && h > 0) return { w, h };
    return null;
  }

  if (/^\d*\.?\d+$/.test(trimmed)) {
    const v = Number(trimmed);
    if (v > 0) return { w: v, h: 1 };
  }
  return null;
}

/** A dimension field: a positive number, or null. Blank is null, not zero. */
export function parseDimension(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed || !/^\d*\.?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n > 0 && Number.isFinite(n) ? n : null;
}

/* ── Solving ──────────────────────────────────────────────────────────────── */

/** width from height and ratio. Rounds once, and says whether it had to. */
export function solveWidth(height: number, ratio: Ratio): SolveResult | null {
  if (!(height > 0) || !(ratio.w > 0) || !(ratio.h > 0)) return null;
  const exact = (height * ratio.w) / ratio.h;
  const width = Math.round(exact);
  return { width, height, ratio, exact, rounded: width !== exact };
}

/** height from width and ratio. Rounds once, and says whether it had to. */
export function solveHeight(width: number, ratio: Ratio): SolveResult | null {
  if (!(width > 0) || !(ratio.w > 0) || !(ratio.h > 0)) return null;
  const exact = (width * ratio.h) / ratio.w;
  const height = Math.round(exact);
  return { width, height, ratio, exact, rounded: height !== exact };
}

/* ── Fitting one box into another ─────────────────────────────────────────── */

/**
 * Scale a source box into a target box, and report the bars or the crop.
 *
 * `contain` — the whole source fits, and empty frame is left over. That empty
 * frame is what "letterbox" and "pillarbox" name, and the four `bars*` fields
 * are its width per side, which is the number you type into an editor.
 *
 * `cover` — the target frame is filled and the overflow is cut off. The same
 * four fields then carry how much comes off each side.
 *
 * Both round the output dimensions once, at the end. A 1-pixel bar difference
 * after rounding is real and is not smoothed over: the leftover is split with
 * a floor and a remainder rather than halved and rounded twice, so
 * `barsLeft + width + barsRight` is exactly the frame width in contain and
 * exactly the scaled width in cover, and the same holds vertically.
 */
export function fitBox(source: Ratio, target: Ratio, mode: "contain" | "cover"): FitResult | null {
  if (!(source.w > 0) || !(source.h > 0) || !(target.w > 0) || !(target.h > 0)) return null;

  const sx = target.w / source.w;
  const sy = target.h / source.h;
  const scale = mode === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);

  const exactW = source.w * scale;
  const exactH = source.h * scale;
  const width = Math.round(exactW);
  const height = Math.round(exactH);

  /*
    Floor plus remainder, never half-and-round-twice: an odd leftover belongs
    to one side, and the two sides must still sum to it. The span is rounded
    first so the bars are whole pixels even for a frame typed with a fraction —
    in that one case the identity holds against the rounded frame.
  */
  const spanX = Math.round(Math.abs(target.w - width));
  const spanY = Math.round(Math.abs(target.h - height));
  const barsLeft = Math.floor(spanX / 2);
  const barsRight = spanX - barsLeft;
  const barsTop = Math.floor(spanY / 2);
  const barsBottom = spanY - barsTop;

  let effect: FitResult["effect"] = "none";
  if (spanX > 0 || spanY > 0) {
    if (mode === "contain") {
      effect = spanY > 0 ? "letterbox" : "pillarbox";
    } else {
      effect = spanX > 0 ? "crops-sides" : "crops-top-and-bottom";
    }
  }

  return {
    width,
    height,
    scale,
    rounded: width !== exactW || height !== exactH,
    barsLeft,
    barsRight,
    barsTop,
    barsBottom,
    effect,
    coverage:
      mode === "cover" ? 1 : Math.min(1, (width * height) / (target.w * target.h)),
  };
}
