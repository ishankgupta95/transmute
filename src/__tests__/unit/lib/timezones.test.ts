import { describe, it, expect } from "vitest";

import {
  CURATED_ZONES,
  filterZones,
  formatOffset,
  isValidZone,
  isoDate,
  isoTime,
  listTimeZones,
  localZone,
  parseUnixTimestamp,
  readZone,
  readZones,
  resolveWallClock,
  unixSeconds,
  wallClockIn,
  zoneAbbreviation,
  zoneCity,
  zoneOffsetMinutes,
  zoneRegion,
} from "@/lib/tools/timezones";

/**
 * These tests pin the two things the tool promises that are easy to get wrong:
 * that every offset is derived from an INSTANT rather than assumed constant
 * for a zone, and that the two DST discontinuities are reported instead of
 * being quietly resolved one way.
 *
 * Instants are named in UTC so the assertions do not depend on the machine's
 * own zone. `Intl` is the system under test, so nothing here is stubbed.
 */

const JAN = new Date("2026-01-15T12:00:00Z");
const JUL = new Date("2026-07-15T12:00:00Z");

describe("zoneOffsetMinutes", () => {
  it("is derived per instant, not per zone — New York moves with DST", () => {
    expect(zoneOffsetMinutes("America/New_York", JAN)).toBe(-300);
    expect(zoneOffsetMinutes("America/New_York", JUL)).toBe(-240);
  });

  it("handles the half- and quarter-hour zones", () => {
    expect(zoneOffsetMinutes("Asia/Kolkata", JUL)).toBe(330);
    expect(zoneOffsetMinutes("Asia/Kathmandu", JUL)).toBe(345);
    expect(zoneOffsetMinutes("Australia/Adelaide", JAN)).toBe(630);
  });

  it("is zero for UTC in both halves of the year", () => {
    expect(zoneOffsetMinutes("UTC", JAN)).toBe(0);
    expect(zoneOffsetMinutes("UTC", JUL)).toBe(0);
  });

  it("is unaffected by sub-second components of the instant", () => {
    const withMs = new Date("2026-01-15T12:00:00.750Z");
    expect(zoneOffsetMinutes("Asia/Kolkata", withMs)).toBe(330);
    expect(zoneOffsetMinutes("America/New_York", withMs)).toBe(-300);
  });

  it("tracks the southern hemisphere in the opposite direction", () => {
    // Sydney is on DST in January and standard time in July — the reverse of
    // New York, which is exactly what a constant-offset table gets wrong.
    expect(zoneOffsetMinutes("Australia/Sydney", JAN)).toBe(660);
    expect(zoneOffsetMinutes("Australia/Sydney", JUL)).toBe(600);
  });
});

describe("formatOffset", () => {
  it("signs and pads every value", () => {
    expect(formatOffset(0)).toBe("+00:00");
    expect(formatOffset(-300)).toBe("-05:00");
    expect(formatOffset(330)).toBe("+05:30");
    expect(formatOffset(345)).toBe("+05:45");
    expect(formatOffset(-570)).toBe("-09:30");
    expect(formatOffset(840)).toBe("+14:00");
  });
});

describe("wallClockIn", () => {
  it("reads midnight as hour 0, not hour 24", () => {
    expect(wallClockIn("UTC", new Date("2026-01-15T00:30:00Z")).hour).toBe(0);
  });

  it("returns 1-based months", () => {
    const w = wallClockIn("UTC", new Date("2026-01-15T12:00:00Z"));
    expect(w.month).toBe(1);
    expect(w.day).toBe(15);
    expect(w.year).toBe(2026);
  });

  it("crosses the date line — Auckland is already tomorrow", () => {
    const w = wallClockIn("Pacific/Auckland", new Date("2026-01-15T23:00:00Z"));
    expect(isoDate(w)).toBe("2026-01-16");
  });
});

describe("isoDate / isoTime", () => {
  it("pad every field", () => {
    const w = { year: 2026, month: 3, day: 8, hour: 7, minute: 5, second: 0 };
    expect(isoDate(w)).toBe("2026-03-08");
    expect(isoTime(w)).toBe("07:05");
  });
});

describe("readZone", () => {
  it("carries the date, not only the time", () => {
    const r = readZone("Asia/Tokyo", new Date("2026-01-15T23:00:00Z"), "Europe/London");
    expect(r.date).toBe("2026-01-16");
    expect(r.time).toBe("08:00");
    expect(r.weekday).toBe("Friday");
  });

  it("reports the day shift against the reference zone", () => {
    const instant = new Date("2026-01-15T23:00:00Z");
    expect(readZone("Asia/Tokyo", instant, "Europe/London").dayShift).toBe(1);
    expect(readZone("America/Los_Angeles", instant, "Asia/Tokyo").dayShift).toBe(-1);
    expect(readZone("Europe/London", instant, "Europe/London").dayShift).toBe(0);
  });

  it("labels the offset for the instant given", () => {
    expect(readZone("America/New_York", JAN, "UTC").offsetLabel).toBe("-05:00");
    expect(readZone("America/New_York", JUL, "UTC").offsetLabel).toBe("-04:00");
  });
});

describe("readZones", () => {
  it("dates every row against the first zone", () => {
    const rows = readZones(
      ["Europe/London", "Asia/Tokyo", "America/Los_Angeles"],
      new Date("2026-01-15T23:00:00Z"),
      "Europe/London",
    );
    expect(rows.map((r) => r.dayShift)).toEqual([0, 1, 0]);
    expect(rows.map((r) => r.zone)).toEqual([
      "Europe/London",
      "Asia/Tokyo",
      "America/Los_Angeles",
    ]);
  });
});

describe("zoneAbbreviation", () => {
  it("gives the letter form where one exists", () => {
    expect(zoneAbbreviation("America/New_York", JAN)).toBe("EST");
    expect(zoneAbbreviation("America/New_York", JUL)).toBe("EDT");
  });

  it("passes through a GMT offset form rather than inventing letters", () => {
    // India has no ICU abbreviation in en-US; "GMT+5:30" is the honest answer.
    expect(zoneAbbreviation("Asia/Kolkata", JAN)).toMatch(/GMT\+5:30|IST/);
  });
});

describe("resolveWallClock", () => {
  it("resolves an ordinary wall clock to exactly one instant", () => {
    const r = resolveWallClock("America/New_York", {
      year: 2026,
      month: 6,
      day: 1,
      hour: 12,
      minute: 0,
      second: 0,
    });
    expect(r.kind).toBe("unique");
    expect(r.instant.toISOString()).toBe("2026-06-01T16:00:00.000Z");
  });

  it("reports the spring-forward gap instead of picking silently", () => {
    // 02:30 on 2026-03-08 does not exist in New York: 02:00 EST becomes
    // 03:00 EDT.
    const r = resolveWallClock("America/New_York", {
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30,
      second: 0,
    });
    expect(r.kind).toBe("gap");
    if (r.kind !== "gap") throw new Error("unreachable");
    expect(r.gapMinutes).toBe(60);
    expect(r.landsOn.hour).toBe(3);
    expect(r.landsOn.minute).toBe(30);
    expect(r.instant.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("reports a fall-back ambiguity with both instants", () => {
    // 01:30 on 2026-11-01 happens twice in New York, an hour apart.
    const r = resolveWallClock("America/New_York", {
      year: 2026,
      month: 11,
      day: 1,
      hour: 1,
      minute: 30,
      second: 0,
    });
    expect(r.kind).toBe("ambiguous");
    if (r.kind !== "ambiguous") throw new Error("unreachable");
    expect(r.instants.map((d) => d.toISOString())).toEqual([
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ]);
    expect(r.offsets).toEqual([-240, -300]);
    expect(r.repeatMinutes).toBe(60);
    // The default is the earlier of the two.
    expect(r.instant.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("finds a 30-minute gap, not just the 60-minute kind", () => {
    // Lord Howe Island shifts by half an hour, which a 60-minute assumption
    // would either miss or overstate.
    const r = resolveWallClock("Australia/Lord_Howe", {
      year: 2026,
      month: 10,
      day: 4,
      hour: 2,
      minute: 15,
      second: 0,
    });
    expect(r.kind).toBe("gap");
    if (r.kind !== "gap") throw new Error("unreachable");
    expect(r.gapMinutes).toBe(30);
  });

  /*
    `resolveWallClock`'s ±1-day candidate bracket is justified in its doc
    comment by the largest transition any zone has ever made: a full 24 hours.
    That comment used to cite "the Line Islands skipping 30 December 2011",
    which is two mistakes in one — Samoa and Tokelau skipped 30 December 2011,
    and the Line Islands skipped 31 December 1994. Resolving Pacific/Kiritimati
    at 2011-12-30 returns a plain `unique`, so the evidence offered for the
    bracket did not reproduce. These pin the events the comment now names, so
    the justification and the code cannot drift apart again.
  */
  it("finds the 24-hour gaps the ±1-day bracket is justified by", () => {
    const noon = { hour: 12, minute: 0, second: 0 };
    const skipped: [string, number, number, number][] = [
      ["Pacific/Apia", 2011, 12, 30],
      ["Pacific/Fakaofo", 2011, 12, 30],
      ["Pacific/Kiritimati", 1994, 12, 31],
    ];
    for (const [zone, year, month, day] of skipped) {
      const r = resolveWallClock(zone, { year, month, day, ...noon });
      expect(r.kind, `${zone} ${year}-${month}-${day}`).toBe("gap");
      if (r.kind !== "gap") throw new Error("unreachable");
      expect(r.gapMinutes, zone).toBe(1440);
      expect(r.landsOn.hour).toBe(12);
    }
  });

  it("does not claim the Line Islands skipped 30 December 2011", () => {
    // The date the old comment gave for Pacific/Kiritimati is an ordinary day
    // there — this is the assertion that made the old comment unusable as
    // evidence.
    const r = resolveWallClock("Pacific/Kiritimati", {
      year: 2011,
      month: 12,
      day: 30,
      hour: 12,
      minute: 0,
      second: 0,
    });
    expect(r.kind).toBe("unique");
  });

  it("round-trips through readZone for a unique instant", () => {
    const wall = { year: 2026, month: 9, day: 5, hour: 14, minute: 45, second: 0 };
    const r = resolveWallClock("Asia/Kolkata", wall);
    expect(r.kind).toBe("unique");
    const back = readZone("Asia/Kolkata", r.instant, "Asia/Kolkata");
    expect(back.date).toBe("2026-09-05");
    expect(back.time).toBe("14:45");
  });

  it("never resolves UTC to anything but itself", () => {
    const r = resolveWallClock("UTC", {
      year: 2026,
      month: 3,
      day: 8,
      hour: 2,
      minute: 30,
      second: 0,
    });
    expect(r.kind).toBe("unique");
    expect(r.instant.toISOString()).toBe("2026-03-08T02:30:00.000Z");
  });
});

describe("listTimeZones", () => {
  it("returns a usable list and names where it came from", () => {
    const { zones, source } = listTimeZones();
    expect(zones.length).toBeGreaterThan(50);
    expect(zones).toContain("UTC");
    expect(["intl", "curated"]).toContain(source);
  });

  it("falls back to the curated list when supportedValuesOf is missing", () => {
    const original = (Intl as unknown as Record<string, unknown>).supportedValuesOf;
    try {
      delete (Intl as unknown as Record<string, unknown>).supportedValuesOf;
      const { zones, source } = listTimeZones();
      expect(source).toBe("curated");
      expect(zones).toContain("UTC");
      expect(zones).toContain("Asia/Kolkata");
      expect(zones.length).toBeGreaterThan(50);
    } finally {
      if (original !== undefined) {
        (Intl as unknown as Record<string, unknown>).supportedValuesOf = original;
      }
    }
  });

  it("falls back when supportedValuesOf throws", () => {
    const original = (Intl as unknown as Record<string, unknown>).supportedValuesOf;
    try {
      (Intl as unknown as Record<string, unknown>).supportedValuesOf = () => {
        throw new TypeError("nope");
      };
      expect(listTimeZones().source).toBe("curated");
    } finally {
      (Intl as unknown as Record<string, unknown>).supportedValuesOf = original;
    }
  });
});

describe("CURATED_ZONES", () => {
  it("has no duplicates", () => {
    expect(new Set(CURATED_ZONES).size).toBe(CURATED_ZONES.length);
  });

  it("is valid on this engine, every entry", () => {
    for (const zone of CURATED_ZONES) expect(isValidZone(zone)).toBe(true);
  });
});

describe("isValidZone", () => {
  it("rejects a name Intl does not know", () => {
    expect(isValidZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidZone("Europe/Paris")).toBe(true);
  });
});

describe("localZone", () => {
  it("names a zone this engine accepts", () => {
    expect(isValidZone(localZone())).toBe(true);
  });
});

describe("zoneCity / zoneRegion", () => {
  it("splits a multi-part identifier", () => {
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneRegion("America/Argentina/Buenos_Aires")).toBe("America/Argentina");
    expect(zoneCity("UTC")).toBe("UTC");
    expect(zoneRegion("UTC")).toBe("");
  });
});

describe("filterZones", () => {
  const zones = ["America/New_York", "Europe/London", "Asia/Kolkata", "Pacific/Auckland"];

  it("matches across the separator and the underscore", () => {
    expect(filterZones(zones, "newyork")).toEqual(["America/New_York"]);
    expect(filterZones(zones, "america/new")).toEqual(["America/New_York"]);
    expect(filterZones(zones, "KOLKATA")).toEqual(["Asia/Kolkata"]);
  });

  it("returns everything for a blank query", () => {
    expect(filterZones(zones, "   ")).toEqual(zones);
  });

  it("returns nothing for a miss", () => {
    expect(filterZones(zones, "atlantis")).toEqual([]);
  });
});

describe("parseUnixTimestamp", () => {
  it("takes the unit as a parameter rather than guessing", () => {
    expect(parseUnixTimestamp("1700000000", "s")?.toISOString()).toBe(
      "2023-11-14T22:13:20.000Z",
    );
    expect(parseUnixTimestamp("1700000000", "ms")?.toISOString()).toBe(
      "1970-01-20T16:13:20.000Z",
    );
  });

  it("accepts a negative timestamp", () => {
    expect(parseUnixTimestamp("-1", "s")?.toISOString()).toBe("1969-12-31T23:59:59.000Z");
  });

  it("rejects junk, blanks and out-of-range values", () => {
    expect(parseUnixTimestamp("", "s")).toBeNull();
    expect(parseUnixTimestamp("abc", "s")).toBeNull();
    expect(parseUnixTimestamp("12e5", "s")).toBeNull();
    expect(parseUnixTimestamp("999999999999999999", "ms")).toBeNull();
  });

  it("round-trips through unixSeconds", () => {
    const d = parseUnixTimestamp("1700000000", "s");
    expect(d).not.toBeNull();
    expect(unixSeconds(d as Date)).toBe(1700000000);
  });

  it("floors rather than rounds when converting back", () => {
    expect(unixSeconds(new Date("2023-11-14T22:13:20.999Z"))).toBe(1700000000);
  });
});
