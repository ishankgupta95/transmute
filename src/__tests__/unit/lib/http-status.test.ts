import { describe, it, expect } from "vitest";

import {
  ALL_STATUSES,
  HEURISTICALLY_CACHEABLE,
  STANDARD_STATUSES,
  STATUS_CLASSES,
  VENDOR_STATUSES,
  filterStatuses,
  findStatus,
  matchesQuery,
  statusClass,
} from "@/lib/tools/http-status";

/**
 * This file is a reference table, so the tests are mostly INVARIANTS rather
 * than spot checks: the failure mode of a hand-written registry is a
 * duplicate, a code in the wrong class group, a vendor entry that forgot to
 * name its vendor, or a cacheability flag that drifted away from the one list
 * RFC 9110 actually defines.
 */

describe("registry shape", () => {
  it("has no duplicate codes within either list, or across them", () => {
    const all = ALL_STATUSES.map((s) => s.code);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps the standard and vendor lists disjoint", () => {
    const standard = new Set(STANDARD_STATUSES.map((s) => s.code));
    for (const v of VENDOR_STATUSES) expect(standard.has(v.code)).toBe(false);
  });

  it("gives every entry a phrase, a reference and a summary", () => {
    for (const s of ALL_STATUSES) {
      expect(s.phrase.length).toBeGreaterThan(0);
      expect(s.reference.length).toBeGreaterThan(0);
      expect(s.summary.length).toBeGreaterThan(40);
    }
  });

  it("names the software behind every vendor code", () => {
    for (const v of VENDOR_STATUSES) expect(v.source.length).toBeGreaterThan(0);
  });

  it("lists standard codes in ascending order", () => {
    const codes = STANDARD_STATUSES.map((s) => s.code);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
  });

  it("covers all five classes with at least one standard code each", () => {
    for (const cls of STATUS_CLASSES) {
      expect(STANDARD_STATUSES.some((s) => statusClass(s.code) === cls.id)).toBe(true);
    }
  });
});

describe("references", () => {
  it("cites a real-looking RFC for every standard entry", () => {
    for (const s of STANDARD_STATUSES) {
      expect(s.reference).toMatch(/^RFC \d{3,4}( §15\.\d\.\d{1,2})?$/);
    }
  });

  it("only attaches a section number to RFC 9110", () => {
    for (const s of STANDARD_STATUSES) {
      if (s.reference.includes("§")) expect(s.reference.startsWith("RFC 9110 ")).toBe(true);
    }
  });

  it("puts each RFC 9110 code in the section block for its class", () => {
    // 15.2.x is 1xx, 15.3.x is 2xx, and so on: the second component is the
    // class digit + 1. A typo here is exactly the kind of wrong-but-plausible
    // citation this page must not ship.
    for (const s of STANDARD_STATUSES) {
      const m = /§15\.(\d)\./.exec(s.reference);
      if (!m) continue;
      expect(Number(m[1])).toBe(Math.floor(s.code / 100) + 1);
    }
  });
});

describe("cacheability", () => {
  it("flags exactly the twelve codes RFC 9110 §15.1 names", () => {
    const flagged = ALL_STATUSES.filter((s) => s.heuristicallyCacheable).map((s) => s.code);
    expect(flagged.sort((a, b) => a - b)).toEqual([...HEURISTICALLY_CACHEABLE].sort((a, b) => a - b));
  });

  it("does not flag 302 or 307, which need explicit freshness headers", () => {
    expect(findStatus(302)?.heuristicallyCacheable).toBeUndefined();
    expect(findStatus(307)?.heuristicallyCacheable).toBeUndefined();
  });

  it("does flag 301 and 308, which do not", () => {
    expect(findStatus(301)?.heuristicallyCacheable).toBe(true);
    expect(findStatus(308)?.heuristicallyCacheable).toBe(true);
  });
});

describe("3xx method preservation", () => {
  it("states an answer for every 3xx and for no other class", () => {
    for (const s of STANDARD_STATUSES) {
      if (Math.floor(s.code / 100) === 3) expect(s.methodPreserved).toBeTruthy();
      else expect(s.methodPreserved).toBeUndefined();
    }
  });

  it("says 307 and 308 preserve the method and 303 does not", () => {
    expect(findStatus(307)?.methodPreserved).toMatch(/^Yes/);
    expect(findStatus(308)?.methodPreserved).toMatch(/^Yes/);
    expect(findStatus(303)?.methodPreserved).toMatch(/^No/);
  });

  it("is honest that 301 and 302 lose the method in practice", () => {
    expect(findStatus(301)?.methodPreserved).toMatch(/in practice no/i);
    expect(findStatus(302)?.methodPreserved).toMatch(/in practice no/i);
  });
});

describe("the awkward entries", () => {
  it("lists 418 as unused rather than as a teapot status", () => {
    const teapot = findStatus(418);
    expect(teapot?.phrase).toBe("(Unused)");
    expect(teapot?.summary).toContain("2324");
    expect(teapot?.deprecated).toBeTruthy();
  });

  it("marks the deprecated codes and leaves the live ones alone", () => {
    expect(findStatus(305)?.deprecated).toBeTruthy();
    expect(findStatus(306)?.deprecated).toBeTruthy();
    expect(findStatus(510)?.deprecated).toBeTruthy();
    expect(findStatus(200)?.deprecated).toBeUndefined();
  });

  it("keeps 999 out of every class rather than forcing it into one", () => {
    expect(statusClass(999)).toBeNull();
    expect(findStatus(999)?.reference).toBe("LinkedIn");
  });

  /*
    430 used to be described as "Shopify's variant of 431 … told apart from a
    rate limit in their edge logs" — a mechanism no source supports. Shopify's
    own response-code documentation calls it a Security Rejection and keeps
    429 for rate limits, so the entry says that and points at the docs.
  */
  it("describes 430 the way Shopify documents it, not as a 431 variant", () => {
    const shopify = findStatus(430);
    expect(shopify?.phrase).toBe("Shopify Security Rejection");
    expect(shopify?.reference).toMatch(/docs/i);
    expect(shopify?.summary).not.toMatch(/variant of 431[^,]*used so/i);
    expect(shopify?.summary).toMatch(/not a rate limit/i);
  });
});

describe("statusClass", () => {
  it("buckets by hundreds", () => {
    expect(statusClass(100)).toBe("1xx");
    expect(statusClass(204)).toBe("2xx");
    expect(statusClass(301)).toBe("3xx");
    expect(statusClass(451)).toBe("4xx");
    expect(statusClass(599)).toBe("5xx");
  });

  it("returns null outside 100–599", () => {
    expect(statusClass(99)).toBeNull();
    expect(statusClass(600)).toBeNull();
    expect(statusClass(0)).toBeNull();
  });
});

describe("matchesQuery", () => {
  const notFound = findStatus(404)!;

  it("matches an empty query", () => {
    expect(matchesQuery(notFound, "  ")).toBe(true);
  });

  it("matches a numeric query by PREFIX, not by substring", () => {
    expect(matchesQuery(notFound, "40")).toBe(true);
    expect(matchesQuery(notFound, "404")).toBe(true);
    // `04` is inside "404" but is not the start of it — a code is a prefix.
    expect(matchesQuery(notFound, "04")).toBe(false);
  });

  it("matches the reason phrase case-insensitively", () => {
    expect(matchesQuery(notFound, "not found")).toBe(true);
    expect(matchesQuery(notFound, "NOT FOUND")).toBe(true);
  });

  it("matches the description, which is how symptom searches work", () => {
    expect(filterStatuses(ALL_STATUSES, "captive", "all").map((s) => s.code)).toEqual([511]);
    expect(filterStatuses(ALL_STATUSES, "rate limit", "all").map((s) => s.code)).toContain(429);
    expect(filterStatuses(ALL_STATUSES, "websocket", "all").map((s) => s.code)).toEqual([101]);
  });

  it("matches the reference, so 'RFC 6585' finds its four codes", () => {
    expect(filterStatuses(STANDARD_STATUSES, "rfc 6585", "all").map((s) => s.code)).toEqual([
      428, 429, 431, 511,
    ]);
  });

  /*
    A bare number is the query the page invites (the placeholder reads
    "429, gateway, rate limit, RFC 6585…") and it is two different things: the
    start of a code, and an RFC number. Matching only the first made `6585`
    and `9110` return nothing while the canvas footnote said search covered
    the RFC. Both rules run now; neither may quietly become a substring search
    over the prose, which is what the `04` case below is guarding.
  */
  it("matches a bare RFC number as well as a code prefix", () => {
    expect(filterStatuses(ALL_STATUSES, "6585", "all").map((s) => s.code)).toEqual([
      428, 429, 431, 511,
    ]);
    expect(filterStatuses(ALL_STATUSES, "2324", "all").map((s) => s.code)).toEqual([418]);
    // 2774 is cited in 510's summary rather than in its reference cell.
    expect(filterStatuses(ALL_STATUSES, "2774", "all").map((s) => s.code)).toEqual([510]);
    expect(filterStatuses(ALL_STATUSES, "9110", "all")).toHaveLength(
      STANDARD_STATUSES.filter((s) => s.reference.startsWith("RFC 9110")).length,
    );
  });

  it("does not let the RFC rule turn a bare number into a substring search", () => {
    // "04" is inside 304/403/404/410's prose and inside "404" itself. Neither
    // is a code prefix nor an RFC number, so it must still find nothing.
    expect(filterStatuses(ALL_STATUSES, "04", "all")).toEqual([]);
    // "15" appears in every "RFC 9110 §15.x.y" reference and must not drag
    // all 46 of them in.
    expect(filterStatuses(ALL_STATUSES, "15", "all")).toEqual([]);
    // An RFC number is a whole number, not a prefix of one.
    expect(filterStatuses(ALL_STATUSES, "658", "all")).toEqual([]);
  });

  it("reads a hyphen and a space as the same separator", () => {
    // The tool's About text tells the reader to type "captive portal"; 511
    // spells it "captive-portal".
    expect(filterStatuses(ALL_STATUSES, "captive portal", "all").map((s) => s.code)).toEqual([511]);
    expect(filterStatuses(ALL_STATUSES, "captive-portal", "all").map((s) => s.code)).toEqual([511]);
    expect(filterStatuses(ALL_STATUSES, "multi status", "all").map((s) => s.code)).toEqual([
      207, 208,
    ]);
    expect(filterStatuses(ALL_STATUSES, "Multi-Status", "all").map((s) => s.code)).toEqual([
      207, 208,
    ]);
  });
});

describe("filterStatuses", () => {
  it("intersects the class filter with the query", () => {
    const timeouts = filterStatuses(ALL_STATUSES, "timeout", "5xx");
    expect(timeouts.every((s) => statusClass(s.code) === "5xx")).toBe(true);
    expect(timeouts.map((s) => s.code)).toContain(504);
    expect(timeouts.map((s) => s.code)).not.toContain(408);
  });

  it("returns everything in a class when the query is empty", () => {
    const informational = filterStatuses(STANDARD_STATUSES, "", "1xx");
    expect(informational.map((s) => s.code)).toEqual([100, 101, 102, 103]);
  });

  it("returns an empty array rather than throwing on no match", () => {
    expect(filterStatuses(ALL_STATUSES, "zzzznope", "all")).toEqual([]);
  });
});
