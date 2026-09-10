/**
 * Time-zone reading and wall-clock resolution, through `Intl` and nothing else.
 *
 * Pure functions over `Date` and strings. No DOM, no dependency, no table of
 * offsets: every number here comes out of `Intl.DateTimeFormat` with a
 * `timeZone` option, which reads the platform's own IANA database.
 *
 * ── Why no arithmetic ───────────────────────────────────────────────────────
 *
 * An offset is a property of an INSTANT, not of a zone. "America/New_York is
 * UTC−5" is false for eight months of the year, and "Europe/Dublin is UTC+1 in
 * summer" is true only because Ireland's standard time is legally the summer
 * one. Zones also change permanently — Egypt reintroduced DST in 2023, Mexico
 * abolished most of it in 2022, Lord Howe Island shifts by 30 minutes rather
 * than 60. So nothing in this file adds hours to a timestamp; it asks the
 * platform what the clock read at that instant and works back from the answer.
 *
 * ── The two DST edge cases, and why they are returned rather than hidden ────
 *
 * Resolving a WALL CLOCK ("08:30 on 8 March in New York") to an instant is not
 * a total function:
 *
 *   · **Gap** — the hour a spring-forward deletes. 02:30 on 2026-03-08 in
 *     New York never happened. Every library has to pick something; this one
 *     says so and reports what the time you asked for actually lands on.
 *   · **Ambiguity** — the hour a fall-back repeats. 01:30 on 2026-11-01 in
 *     New York happened twice, 60 minutes apart, once at UTC−4 and once at
 *     UTC−5. `resolveWallClock` returns both instants; it does not pick one
 *     quietly.
 *
 * The resolution algorithm is the standard two-candidate one: take the wall
 * clock as if it were UTC, subtract the zone's offset from a day earlier and
 * from a day later, and keep whichever of those two instants actually reads
 * back as the wall clock you asked for. Zero survivors is a gap; two is an
 * ambiguity.
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

/** A calendar date and time with no zone attached — what a clock face shows. */
export interface WallClock {
  year: number;
  /** 1–12, not the `Date` 0–11. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** One zone's reading of one instant. Everything here is derived from `Intl`. */
export interface ZoneReading {
  zone: string;
  /** Minutes east of UTC AT THIS INSTANT: +330 for Asia/Kolkata, -480 for PST. */
  offsetMinutes: number;
  /** The same offset as "+05:30" / "-08:00" / "+00:00", with an ASCII hyphen. */
  offsetLabel: string;
  /**
   * Whatever the platform calls the zone at this instant — "EST", "AEDT",
   * "GMT+5:30". Not every zone has a letter abbreviation, and the ones that do
   * are not unique worldwide, so this is a label and never an identifier.
   */
  abbreviation: string;
  /** ISO calendar date in the zone: "2026-03-08". */
  date: string;
  /** 24-hour clock in the zone: "14:05". */
  time: string;
  /** The full wall clock, for callers that need the parts. */
  wall: WallClock;
  /** English weekday name — "Sunday". */
  weekday: string;
  /** Calendar days ahead of (+) or behind (−) the reference zone: −1, 0, +1. */
  dayShift: number;
}

/** What `resolveWallClock` found. Three outcomes, never silently collapsed. */
export type WallClockResolution =
  | { kind: "unique"; instant: Date; offsetMinutes: number }
  | {
      kind: "gap";
      /** The instant you get anyway, using the offset in force BEFORE the jump. */
      instant: Date;
      /** The wall clock that instant actually reads as. */
      landsOn: WallClock;
      /** How much the clock jumped forward, in minutes. Usually 60. */
      gapMinutes: number;
    }
  | {
      kind: "ambiguous";
      /** The earlier of the two, which is what a caller gets if it ignores this. */
      instant: Date;
      /** Both instants that read as the wall clock you asked for, in order. */
      instants: [Date, Date];
      /** Their offsets, in the same order. The first is the larger (pre-shift). */
      offsets: [number, number];
      /** How far apart they are, in minutes. Usually 60. */
      repeatMinutes: number;
    };

/* ── Zone lists ───────────────────────────────────────────────────────────── */

/**
 * The fallback list, used when `Intl.supportedValuesOf` is missing.
 *
 * `Intl.supportedValuesOf("timeZone")` is ES2022 and is NOT in every engine
 * this site runs in — it landed in Safari 15.4, and anything older throws a
 * `TypeError` on the call. When it is absent the tool falls back to this list
 * and says so on screen, because ~90 named zones and "every zone your browser
 * knows" are different claims and only one of them would be true.
 *
 * Chosen for coverage of the offsets people actually schedule against, not for
 * completeness: one or two zones per populated offset, plus the half-hour and
 * quarter-hour ones (Kolkata, Kathmandu, Tehran, Adelaide, St John's) that are
 * the whole reason a converter beats mental arithmetic.
 */
export const CURATED_ZONES: readonly string[] = [
  "UTC",
  "Africa/Accra",
  "Africa/Algiers",
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "Africa/Nairobi",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Caracas",
  "America/Chicago",
  "America/Denver",
  "America/Guatemala",
  "America/Halifax",
  "America/Lima",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Panama",
  "America/Phoenix",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/St_Johns",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Almaty",
  "Asia/Baghdad",
  "Asia/Bangkok",
  "Asia/Beirut",
  "Asia/Colombo",
  "Asia/Dhaka",
  "Asia/Dubai",
  "Asia/Ho_Chi_Minh",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Kabul",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Asia/Riyadh",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tashkent",
  "Asia/Tehran",
  "Asia/Tokyo",
  "Asia/Yangon",
  "Asia/Yekaterinburg",
  "Atlantic/Azores",
  "Atlantic/Reykjavik",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Darwin",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Athens",
  "Europe/Berlin",
  "Europe/Brussels",
  "Europe/Bucharest",
  "Europe/Budapest",
  "Europe/Copenhagen",
  "Europe/Dublin",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Kyiv",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Moscow",
  "Europe/Oslo",
  "Europe/Paris",
  "Europe/Prague",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Vienna",
  "Europe/Warsaw",
  "Europe/Zurich",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Guam",
  "Pacific/Honolulu",
  "Pacific/Port_Moresby",
];

/** True when this engine's `Intl` accepts the identifier at all. */
export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export interface ZoneList {
  zones: string[];
  /**
   * `"intl"` — every zone this engine knows, from `Intl.supportedValuesOf`.
   * `"curated"` — the built-in list above, because that call is unavailable.
   * The UI prints which one it got; the two are not the same claim.
   */
  source: "intl" | "curated";
}

/**
 * Every zone this engine will accept, or the curated fallback.
 *
 * `supportedValuesOf` is feature-detected rather than assumed, and its result
 * is still filtered through `isValidZone` — the two are separate lists in the
 * spec, and an engine that returns a name it then refuses would otherwise put
 * an option in the picker that throws when selected.
 */
export function listTimeZones(): ZoneList {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      const zones = supported.call(Intl, "timeZone");
      if (Array.isArray(zones) && zones.length > 0) {
        const usable = zones.filter(isValidZone);
        if (usable.length > 0) {
          if (!usable.includes("UTC")) usable.unshift("UTC");
          return { zones: usable, source: "intl" };
        }
      }
    } catch {
      // Falls through to the curated list below.
    }
  }
  return { zones: CURATED_ZONES.filter(isValidZone), source: "curated" };
}

/** This device's zone, or "UTC" when the platform will not name one. */
export function localZone(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires". The picker's short label. */
export function zoneCity(zone: string): string {
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

/** "America/Argentina/Buenos_Aires" → "America/Argentina". Empty for "UTC". */
export function zoneRegion(zone: string): string {
  const parts = zone.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

/** Case- and separator-insensitive substring match over the whole identifier. */
export function filterZones(zones: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase().replace(/[\s_/]+/g, "");
  if (!q) return [...zones];
  return zones.filter((z) => z.toLowerCase().replace(/[\s_/]+/g, "").includes(q));
}

/* ── Reading an instant in a zone ─────────────────────────────────────────── */

/*
  One formatter per zone, cached. Constructing `Intl.DateTimeFormat` is the
  expensive part of every call in this file, and a meeting planner rebuilds
  every row on every keystroke: eight zones × two formatters × a re-render is
  32 constructions per character typed without this.
*/
const partsCache = new Map<string, Intl.DateTimeFormat>();
const nameCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
    });
    partsCache.set(zone, fmt);
  }
  return fmt;
}

function nameFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = nameCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" });
    nameCache.set(zone, fmt);
  }
  return fmt;
}

/** The wall clock (plus weekday) a zone shows at an instant. */
export function wallClockIn(zone: string, instant: Date): WallClock & { weekday: string } {
  const parts = partsFormatter(zone).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // `hourCycle: "h23"` still emits "24" for midnight on some ICU builds.
  const hour = Number(get("hour")) % 24;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

/** `Date.UTC` with years 0–99 kept literal instead of mapped into the 1900s. */
function utcFrom(w: WallClock): number {
  const ms = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  if (w.year >= 0 && w.year <= 99) {
    const d = new Date(ms);
    d.setUTCFullYear(w.year);
    return d.getTime();
  }
  return ms;
}

/**
 * Minutes east of UTC for `zone` AT `instant` — the only offset function here.
 *
 * Derived, not looked up: format the instant in the zone, read the clock face
 * back as if it were UTC, and the difference from the real instant IS the
 * offset. Correct across DST, across historical rule changes, and for the
 * 30- and 45-minute zones.
 */
export function zoneOffsetMinutes(zone: string, instant: Date): number {
  const wall = wallClockIn(zone, instant);
  // Both sides floored to the second: `formatToParts` has no milliseconds, so
  // comparing against the raw instant would leak sub-second drift.
  const asUtc = utcFrom(wall);
  const real = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - real) / 60000);
}

/** -480 → "-08:00"; +330 → "+05:30"; 0 → "+00:00". Always signed, always padded. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = String(Math.floor(abs / 60)).padStart(2, "0");
  const m = String(abs % 60).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

/**
 * The platform's own short name for the zone at this instant.
 *
 * Often a letter abbreviation ("EST", "AEDT"), often just "GMT+5:30" — which
 * is the honest answer for a zone with no customary abbreviation, so it is
 * passed through rather than dressed up.
 */
export function zoneAbbreviation(zone: string, instant: Date): string {
  const part = nameFormatter(zone)
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026-03-08" from a wall clock. */
export function isoDate(w: WallClock): string {
  return `${String(w.year).padStart(4, "0")}-${pad2(w.month)}-${pad2(w.day)}`;
}

/** "14:05" from a wall clock. Seconds are deliberately not shown. */
export function isoTime(w: WallClock): string {
  return `${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** Days between two calendar dates, ignoring clocks entirely. */
function dayNumber(w: WallClock): number {
  return Math.round(Date.UTC(w.year, w.month - 1, w.day) / 86400000);
}

/**
 * One row of the meeting planner: what `zone` reads at `instant`, and how many
 * calendar days that is from `reference`.
 *
 * The date is carried alongside the time because that is the failure this tool
 * exists to prevent — "Thursday 22:00 in London" is Friday morning in Sydney,
 * and a column of times with no dates says nothing about which Friday.
 */
export function readZone(zone: string, instant: Date, reference?: string): ZoneReading {
  const wall = wallClockIn(zone, instant);
  const offsetMinutes = zoneOffsetMinutes(zone, instant);
  const dayShift = reference ? dayNumber(wall) - dayNumber(wallClockIn(reference, instant)) : 0;
  return {
    zone,
    offsetMinutes,
    offsetLabel: formatOffset(offsetMinutes),
    abbreviation: zoneAbbreviation(zone, instant),
    date: isoDate(wall),
    time: isoTime(wall),
    wall: {
      year: wall.year,
      month: wall.month,
      day: wall.day,
      hour: wall.hour,
      minute: wall.minute,
      second: wall.second,
    },
    weekday: wall.weekday,
    dayShift,
  };
}

/** Every zone's reading of one instant, dated against the first zone given. */
export function readZones(
  zones: readonly string[],
  instant: Date,
  reference: string,
): ZoneReading[] {
  return zones.map((z) => readZone(z, instant, reference));
}

/* ── Resolving a wall clock back to an instant ────────────────────────────── */

const DAY_MS = 86400000;

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/**
 * "08:30 on 8 March, in New York" → the instant that was, or an honest report
 * that there wasn't one, or that there were two.
 *
 * See the file header for why this is not a total function. The two candidates
 * come from the zone's offset a day either side of the target, which brackets
 * every transition any zone has ever made in a single step. The largest is a
 * full 24 hours, and there are two such events: Samoa and Tokelau skipping
 * 30 December 2011 (`Pacific/Apia`, `Pacific/Fakaofo`) and the Line Islands
 * skipping 31 December 1994 (`Pacific/Kiritimati`). Both come back from this
 * function as a 1440-minute gap — the tests pin all three zones — and the
 * ordinary case is 30 or 60 minutes.
 */
export function resolveWallClock(zone: string, wall: WallClock): WallClockResolution {
  const asUtc = utcFrom(wall);
  const before = zoneOffsetMinutes(zone, new Date(asUtc - DAY_MS));
  const after = zoneOffsetMinutes(zone, new Date(asUtc + DAY_MS));

  const candidates = Array.from(new Set([asUtc - before * 60000, asUtc - after * 60000]));
  const valid = candidates
    .filter((t) => sameWallClock(wallClockIn(zone, new Date(t)), wall))
    .sort((a, b) => a - b);

  if (valid.length === 1) {
    return {
      kind: "unique",
      instant: new Date(valid[0]),
      offsetMinutes: zoneOffsetMinutes(zone, new Date(valid[0])),
    };
  }

  if (valid.length >= 2) {
    const first = new Date(valid[0]);
    const second = new Date(valid[valid.length - 1]);
    return {
      kind: "ambiguous",
      instant: first,
      instants: [first, second],
      offsets: [zoneOffsetMinutes(zone, first), zoneOffsetMinutes(zone, second)],
      repeatMinutes: Math.round((second.getTime() - first.getTime()) / 60000),
    };
  }

  // Nothing read back: the clock skipped this time. Use the offset in force
  // before the jump, which is what every DST-aware library does, and report
  // exactly where that lands.
  const instant = new Date(asUtc - before * 60000);
  return {
    kind: "gap",
    instant,
    landsOn: wallClockIn(zone, instant),
    gapMinutes: after - before,
  };
}

/* ── Unix timestamps ──────────────────────────────────────────────────────── */

/**
 * A Unix timestamp in the stated unit → an instant.
 *
 * The unit is a parameter and never a guess. Digit-count heuristics are how
 * 1 700 000 000 (a Wednesday in November 2023, in seconds) becomes 20 January
 * 1970 (the same number read as milliseconds), and the two are indistinguishable
 * from the digits alone.
 */
export function parseUnixTimestamp(text: string, unit: "s" | "ms"): Date | null {
  const trimmed = text.trim();
  if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const ms = unit === "s" ? n * 1000 : n;
  // `new Date` accepts ±8.64e15 ms and produces an Invalid Date beyond it.
  if (Math.abs(ms) > 8.64e15) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole seconds since the epoch, floored — the value most APIs mean by "unix". */
export function unixSeconds(instant: Date): number {
  return Math.floor(instant.getTime() / 1000);
}
