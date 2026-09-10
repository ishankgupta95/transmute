/**
 * Data-size arithmetic in exact rational numbers.
 *
 * Pure functions over `bigint`. No DOM, no dependency.
 *
 * ── Why not just use `number` ──────────────────────────────────────────────
 *
 * A JavaScript number is a double, which represents every integer up to 2^53
 * exactly and nothing above it. 2^53 bytes is 9.007 PB — comfortably inside
 * the range of numbers this tool is asked about, since a 16 PB volume, a 40 PB
 * archive and "how many bytes in an exabyte" are all real questions. Past that
 * boundary a double silently rounds: `9007199254740993` evaluates to
 * `9007199254740992`, and an "exact byte count" computed that way is a lie
 * that looks like arithmetic.
 *
 * So every value here is an exact rational — a `bigint` numerator over a
 * `bigint` denominator — and the byte count is either an exact integer or is
 * reported as not being one. Nothing rounds unless it is being formatted for
 * display, and the formatter says whether what it printed was the whole value.
 *
 * ── Why bits are the base ──────────────────────────────────────────────────
 *
 * Because the 8× error is the second reason people come to a page like this:
 * a 100 Mbit/s link moves 12.5 MB/s, not 100. Storing everything in bits makes
 * `Mbit` and `MB` the same kind of thing — two units with different factors —
 * instead of two systems that need a conversion step somebody forgets.
 *
 * ── Decimal against binary ─────────────────────────────────────────────────
 *
 * kB is 1000 bytes; KiB is 1024. They were the same word for thirty years,
 * which is why a "1 TB" drive shows up as 931 GB in Windows: the manufacturer
 * counted 10^12 bytes and the operating system divided by 2^30 while printing
 * the decimal unit. macOS switched to decimal units in 10.6 and Linux tools
 * mostly print binary. `SHORTFALL_PERCENT` below computes that gap rather than
 * quoting it.
 */

/* ── Exact rationals ──────────────────────────────────────────────────────── */

/*
  Every bigint here is written `BigInt(8)` rather than `8n`. The repo's
  tsconfig targets ES2017 (`tsconfig.json`), and `tsc` rejects a BigInt LITERAL
  below an ES2020 target — `TS2737: BigInt literals are not available when
  targeting lower than ES2020` — while the `BigInt()` call is just a function
  call and compiles fine. Do not "tidy" these back into literals without
  raising the target first, and note the one place it actually matters:
  `BigInt(9007199254740993)` would round through a double on the way in, so any
  constant longer than 15 digits must be written `BigInt("…")` with a string.
*/

/** A non-negative exact value `n / d`. `d` is always > 0. */
export interface Rat {
  n: bigint;
  d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < BigInt(0) ? -a : a;
  let y = b < BigInt(0) ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
};

/** Reduce to lowest terms so denominators do not grow without bound. */
export function rat(n: bigint, d: bigint): Rat {
  if (d === BigInt(0)) throw new Error("zero denominator");
  const g = gcd(n, d) || BigInt(1);
  return { n: n / g, d: d / g };
}

export const isZero = (r: Rat): boolean => r.n === BigInt(0);

const POW10 = (e: number): bigint => BigInt(10) ** BigInt(e);

/* ── Units ────────────────────────────────────────────────────────────────── */

export type UnitFamily = "bits" | "decimal" | "binary";

export interface Unit {
  id: string;
  /** How it is written: "MiB", "Mbit". */
  label: string;
  /** Long name, for the accessible label on each field. */
  name: string;
  family: UnitFamily;
  /** Exact size of one of these, in bits. */
  bits: bigint;
}

const B = BigInt(8);

/**
 * Every unit the tool converts between, in the order the three columns show
 * them. A byte heads the decimal column because it is the base of both
 * systems — 8 bits either way — and the split only begins at the prefix.
 */
export const UNITS: readonly Unit[] = [
  { id: "bit", label: "bit", name: "Bits", family: "bits", bits: BigInt(1) },
  { id: "kbit", label: "kbit", name: "Kilobits", family: "bits", bits: BigInt(1000) },
  { id: "Mbit", label: "Mbit", name: "Megabits", family: "bits", bits: BigInt(1000) ** BigInt(2) },
  { id: "Gbit", label: "Gbit", name: "Gigabits", family: "bits", bits: BigInt(1000) ** BigInt(3) },
  { id: "Tbit", label: "Tbit", name: "Terabits", family: "bits", bits: BigInt(1000) ** BigInt(4) },

  { id: "B", label: "B", name: "Bytes", family: "decimal", bits: B },
  { id: "kB", label: "kB", name: "Kilobytes (1000 bytes)", family: "decimal", bits: B * BigInt(1000) },
  { id: "MB", label: "MB", name: "Megabytes (1000² bytes)", family: "decimal", bits: B * BigInt(1000) ** BigInt(2) },
  { id: "GB", label: "GB", name: "Gigabytes (1000³ bytes)", family: "decimal", bits: B * BigInt(1000) ** BigInt(3) },
  { id: "TB", label: "TB", name: "Terabytes (1000⁴ bytes)", family: "decimal", bits: B * BigInt(1000) ** BigInt(4) },
  { id: "PB", label: "PB", name: "Petabytes (1000⁵ bytes)", family: "decimal", bits: B * BigInt(1000) ** BigInt(5) },

  { id: "KiB", label: "KiB", name: "Kibibytes (1024 bytes)", family: "binary", bits: B * BigInt(1024) },
  { id: "MiB", label: "MiB", name: "Mebibytes (1024² bytes)", family: "binary", bits: B * BigInt(1024) ** BigInt(2) },
  { id: "GiB", label: "GiB", name: "Gibibytes (1024³ bytes)", family: "binary", bits: B * BigInt(1024) ** BigInt(3) },
  { id: "TiB", label: "TiB", name: "Tebibytes (1024⁴ bytes)", family: "binary", bits: B * BigInt(1024) ** BigInt(4) },
  { id: "PiB", label: "PiB", name: "Pebibytes (1024⁵ bytes)", family: "binary", bits: B * BigInt(1024) ** BigInt(5) },
];

export function unitById(id: string): Unit | undefined {
  return UNITS.find((u) => u.id === id);
}

export const unitsOf = (family: UnitFamily): Unit[] => UNITS.filter((u) => u.family === family);

/* ── Parsing ──────────────────────────────────────────────────────────────── */

/**
 * Read a typed amount into an exact rational.
 *
 * Accepts plain decimals (`1.5`), scientific notation (`1e9`, `2.5E-3`),
 * underscore separators (`1_000_000`) and comma thousands separators — but
 * only in the unambiguous grouped form `1,234,567`, because `1,5` means one
 * and a half in half of Europe and one thousand five hundred nowhere, and
 * guessing between them would silently change the answer by 1000×.
 *
 * Negative values return `null`: there is no such thing as −3 MB, and a minus
 * sign in this field is a typo rather than an intention.
 */
export function parseAmount(text: string): Rat | null {
  let s = text.trim().replace(/[\s_]/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  const m = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return null;

  const whole = m[1];
  const frac = m[2] ?? "";
  const exp = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > 400) return null;

  let n = BigInt(whole + frac);
  let d = POW10(frac.length);
  if (exp > 0) n *= POW10(exp);
  else if (exp < 0) d *= POW10(-exp);
  return rat(n, d);
}

/* ── Conversion ───────────────────────────────────────────────────────────── */

/** The exact number of bits in `amount` of `unit`. */
export function toBits(amount: Rat, unit: Unit): Rat {
  return rat(amount.n * unit.bits, amount.d);
}

/** The exact number of `unit`s in `bits`. */
export function fromBits(bits: Rat, unit: Unit): Rat {
  return rat(bits.n, bits.d * unit.bits);
}

/**
 * The exact whole-byte count, or `null` when the value is not a whole number
 * of bytes — 5 bits, or 1.5 bits worth of a fractional kilobit.
 *
 * `null` is the honest answer rather than a rounded integer: the page prints
 * "not a whole number of bytes" in that case instead of claiming exactness it
 * does not have.
 */
export function exactBytes(bits: Rat): bigint | null {
  const d = bits.d * BigInt(8);
  return bits.n % d === BigInt(0) ? bits.n / d : null;
}

/** The exact whole-bit count, or `null` when the value is fractional bits. */
export function exactBits(bits: Rat): bigint | null {
  return bits.n % bits.d === BigInt(0) ? bits.n / bits.d : null;
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

/** `1234567` → `1,234,567`. Hand-rolled so the output does not vary by locale. */
export function groupDigits(n: bigint): string {
  const s = (n < BigInt(0) ? -n : n).toString();
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return n < BigInt(0) ? `-${grouped}` : grouped;
}

/**
 * `floor(log10(value))` for a positive rational, by repeated scaling rather
 * than by going through a double — which is the whole point of this module.
 */
function magnitude(r: Rat): number {
  if (r.n === BigInt(0)) return 0;
  let e = 0;
  let { n, d } = r;
  while (n / d >= BigInt(10)) {
    d *= BigInt(10);
    e++;
  }
  while (n < d) {
    n *= BigInt(10);
    e--;
  }
  return e;
}

export interface Formatted {
  text: string;
  /** True when `text` is the whole value, with nothing rounded away. */
  exact: boolean;
}

/**
 * Render a rational with a fixed number of decimal places, rounded half-up,
 * and say whether the rendering lost anything.
 *
 * `exact` is computed BEFORE the rounding, so 931.322574615478515625 rendered
 * at two places reports `exact: false` even though the printed digits are
 * correctly rounded. That flag is what the UI uses to decide whether to show
 * "≈" — a page that prints an approximation as though it were the value is
 * exactly the failure this file exists to avoid.
 */
export function formatFixed(r: Rat, decimals: number): Formatted {
  const scale = POW10(decimals);
  const scaled = r.n * scale;
  let q = scaled / r.d;
  const rem = scaled % r.d;
  const exact = rem === BigInt(0);
  if (rem * BigInt(2) >= r.d) q += BigInt(1);

  const whole = q / scale;
  const frac = (q % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return { text: frac ? `${groupDigits(whole)}.${frac}` : groupDigits(whole), exact };
}

/**
 * Render with roughly `sig` significant digits, which is what a column of
 * mixed magnitudes needs: 1 bit is 1.25e-16 PB and 1 PB is 8e15 bits, and a
 * fixed decimal count prints one of those as `0` and the other as a wall.
 *
 * Values below 10^-`floor` after that are given as `< 0.000…1` rather than
 * `0`, because `0` in a conversion table reads as "this unit cannot express
 * it" instead of "this is very small".
 */
export function formatValue(r: Rat, sig = 6): Formatted {
  if (r.n === BigInt(0)) return { text: "0", exact: true };
  const e = magnitude(r);
  const decimals = Math.min(30, Math.max(0, sig - 1 - e));
  const out = formatFixed(r, decimals);
  if (out.text === "0" || out.text === "0.") {
    return { text: `< ${formatFixed({ n: BigInt(1), d: POW10(decimals) }, decimals).text}`, exact: false };
  }
  return out;
}

/** Every unit's value for one input, in `UNITS` order. */
export interface Conversion {
  unit: Unit;
  value: Rat;
  formatted: Formatted;
}

export function convertAll(bits: Rat, sig = 6): Conversion[] {
  return UNITS.map((unit) => {
    const value = fromBits(bits, unit);
    return { unit, value, formatted: formatValue(value, sig) };
  });
}

/* ── The decimal/binary gap, computed ─────────────────────────────────────── */

/** Each binary unit and the decimal unit at the same prefix level. */
export const DECIMAL_TWIN: Readonly<Record<string, string>> = {
  KiB: "kB",
  MiB: "MB",
  GiB: "GB",
  TiB: "TB",
  PiB: "PB",
};

/**
 * What a drive sold as `amount` of `sold` reads as in `shownIn` — the
 * "1 TB drive shows 931 GiB" arithmetic, done rather than quoted.
 *
 * `percent` is how much smaller the printed number is than the number on the
 * box AT THE SAME PREFIX LEVEL: a 1 TB drive is 1000 GB and 931.32 GiB, and
 * the gap is `(GiB − GB) / GiB`, which is 6.87% for every giga-sized drive
 * regardless of how many of them you bought. It is `null` when `shownIn` has
 * no decimal twin — there is nothing to compare a bit count against.
 */
export function driveShortfall(
  amount: number,
  sold: Unit,
  shownIn: Unit,
): { shown: Formatted; percent: Formatted | null } {
  const bits = toBits(rat(BigInt(amount), BigInt(1)), sold);
  const shown = fromBits(bits, shownIn);
  const twin = unitById(DECIMAL_TWIN[shownIn.id] ?? "");
  const percent = twin
    ? formatFixed(rat((shownIn.bits - twin.bits) * BigInt(100), shownIn.bits), 2)
    : null;
  return { shown: formatValue(shown, 6), percent };
}

/** The headline example, computed at module load so the copy cannot drift. */
export const ONE_TB_IN_GIB = driveShortfall(1, unitById("TB")!, unitById("GiB")!);

/* ── Transfer time ────────────────────────────────────────────────────────── */

export interface LinkSpeed {
  id: string;
  label: string;
  /** Bits per second. Link speeds are ALWAYS quoted in bits; that is the trap. */
  bps: bigint;
}

export const LINK_SPEEDS: readonly LinkSpeed[] = [
  { id: "56k", label: "56 kbit/s dial-up", bps: BigInt(56_000) },
  { id: "10m", label: "10 Mbit/s", bps: BigInt(10_000_000) },
  { id: "50m", label: "50 Mbit/s", bps: BigInt(50_000_000) },
  { id: "100m", label: "100 Mbit/s", bps: BigInt(100_000_000) },
  { id: "300m", label: "300 Mbit/s", bps: BigInt(300_000_000) },
  { id: "1g", label: "1 Gbit/s", bps: BigInt(1_000_000_000) },
  { id: "2.5g", label: "2.5 Gbit/s", bps: BigInt(2_500_000_000) },
  { id: "10g", label: "10 Gbit/s", bps: BigInt(10_000_000_000) },
];

/** Exact seconds to move `bits` down a link of `bps` bits per second. */
export function transferSeconds(bits: Rat, bps: bigint): Rat {
  return rat(bits.n, bits.d * bps);
}

/**
 * A duration as words. Rounded to whole seconds above a minute, because
 * "2 h 14 min 09.37 s" is precision nobody asked for on a number that already
 * ignores protocol overhead.
 */
export function formatDuration(seconds: Rat): string {
  const total = Number(seconds.n) / Number(seconds.d);
  if (!Number.isFinite(total)) return "—";
  if (total < 1) return `${formatFixed(seconds, 3).text} s`;
  if (total < 60) return `${formatFixed(seconds, 2).text} s`;

  const whole = Math.round(total);
  const d = Math.floor(whole / 86400);
  const h = Math.floor((whole % 86400) / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} d`);
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (s && !d) parts.push(`${s} s`);
  return parts.join(" ");
}
