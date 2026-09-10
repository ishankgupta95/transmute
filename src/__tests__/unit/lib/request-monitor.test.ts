import { describe, expect, it } from "vitest";
import {
  EMPTY_TALLY,
  describeTally,
  supportsRequestMonitoring,
  tallyAll,
  tallyRequest,
} from "@/lib/privacy/request-monitor";

/*
  The classification lives in a pure module for the same reason `sw-policy.ts`
  does: jsdom implements no `PerformanceObserver` for resource entries, so a
  rule written inside the observer callback is a rule that ships unverified.
  Everything below tests the rule; `RequestReadout` only plumbs it.
*/

const ORIGIN = "https://transmute.tools";

describe("tallyRequest classifies by origin", () => {
  it("counts this origin's own assets as same-origin", () => {
    const t = tallyAll(
      [
        "https://transmute.tools/_next/static/chunks/main.js",
        "https://transmute.tools/ffmpeg-core.wasm",
        "https://transmute.tools/vendor/lamejs.js",
      ],
      ORIGIN,
    );
    expect(t.sameOrigin).toBe(3);
    expect(t.crossOrigin).toBe(0);
    expect(t.foreignOrigins).toEqual([]);
  });

  it("counts anything else as off-origin and names the origin, not the URL", () => {
    const t = tallyAll(
      [
        "https://transmute.tools/app.js",
        "https://www.googletagmanager.com/gtag/js?id=G-XXXX",
        "https://www.googletagmanager.com/g/collect?v=2&tid=G-XXXX&secret=1",
      ],
      ORIGIN,
    );
    expect(t.sameOrigin).toBe(1);
    expect(t.crossOrigin).toBe(2);
    // the ORIGIN only — a status bar must never put a query string on screen
    expect(t.foreignOrigins).toEqual(["https://www.googletagmanager.com"]);
  });

  it("treats a different port or scheme as a different origin", () => {
    expect(tallyRequest(EMPTY_TALLY, "http://transmute.tools/x", ORIGIN).crossOrigin).toBe(1);
    expect(tallyRequest(EMPTY_TALLY, "https://transmute.tools:8443/x", ORIGIN).crossOrigin).toBe(1);
    // and a subdomain is NOT this origin
    expect(tallyRequest(EMPTY_TALLY, "https://cdn.transmute.tools/x", ORIGIN).crossOrigin).toBe(1);
  });

  it("resolves a relative URL against the page, so it is not miscounted as foreign", () => {
    const t = tallyRequest(EMPTY_TALLY, "/workers/pdf.worker.js", ORIGIN);
    expect(t.sameOrigin).toBe(1);
    expect(t.crossOrigin).toBe(0);
  });

  it("counts an unparseable URL as same-origin — the direction that cannot invent a scare", () => {
    /*
      The conservative direction is load-bearing. This counter's job is to
      notice foreign traffic, so a parse failure must be able to UNDER-report,
      never to put a number on screen that the reader's own DevTools will not
      show them.

      ⚠ THE FIXTURE MATTERS AND THE OBVIOUS ONE DOES NOT WORK. `"::::not a
      url::::"` was the first fixture here and it is NOT unparseable: with a
      base, the WHATWG parser treats it as a relative path and resolves it to
      this origin, so the catch branch was never entered and this test passed
      against a mutation that sent unparseable URLs down the CROSS-origin path.
      Found by mutation-testing it. Strings that genuinely throw with a base
      are the malformed-authority ones, measured: "http://", "//", "https://[".
    */
    for (const malformed of ["http://", "//", "https://["]) {
      expect(() => new URL(malformed, ORIGIN), `${malformed} must really be unparseable`).toThrow();
      const t = tallyRequest(EMPTY_TALLY, malformed, ORIGIN);
      expect(t.crossOrigin, malformed).toBe(0);
      expect(t.sameOrigin, malformed).toBe(1);
    }
  });

  it("counts an opaque-origin scheme as off-origin", () => {
    // `new URL("foo://bar", base).origin` is the string "null" — not this
    // origin, so it is foreign, which is the safe reading for an unknown scheme.
    const t = tallyRequest(EMPTY_TALLY, "foo://bar", ORIGIN);
    expect(t.crossOrigin).toBe(1);
    expect(t.foreignOrigins).toEqual(["null"]);
  });

  it("does not mutate the tally it is given", () => {
    const before = tallyAll(["https://evil.example/x"], ORIGIN);
    const snapshot = JSON.parse(JSON.stringify(before));
    tallyRequest(before, "https://other.example/y", ORIGIN);
    expect(before).toEqual(snapshot);
  });

  it("records each foreign origin once, in first-contact order", () => {
    const t = tallyAll(
      ["https://b.example/1", "https://a.example/1", "https://b.example/2"],
      ORIGIN,
    );
    expect(t.crossOrigin).toBe(3);
    expect(t.foreignOrigins).toEqual(["https://b.example", "https://a.example"]);
  });
});

describe("describeTally says requests, never bytes", () => {
  it("speaks the off-origin half only when there is one", () => {
    expect(describeTally({ sameOrigin: 14, crossOrigin: 0, foreignOrigins: [] })).toBe(
      "14 REQUESTS · NONE OFF-ORIGIN",
    );
    expect(
      describeTally({ sameOrigin: 14, crossOrigin: 2, foreignOrigins: ["https://x.example"] }),
    ).toBe("14 REQUESTS · 2 OFF-ORIGIN");
  });

  it("agrees with itself on one", () => {
    expect(describeTally({ sameOrigin: 1, crossOrigin: 0, foreignOrigins: [] })).toBe(
      "1 REQUEST · NONE OFF-ORIGIN",
    );
  });

  it("never claims anything about bytes", () => {
    /*
      THE ASSERTION THIS MODULE EXISTS FOR. The string it replaced was
      `0 BYTES SENT`, and `PerformanceResourceTiming` exposes bytes RECEIVED and
      nothing whatever about a request body — so any sentence about bytes sent
      would be exactly as unfounded as the hard-coded one, with the added
      dishonesty of looking measured.
    */
    for (const tally of [
      { sameOrigin: 0, crossOrigin: 0, foreignOrigins: [] },
      { sameOrigin: 99, crossOrigin: 3, foreignOrigins: ["https://x.example"] },
    ]) {
      expect(describeTally(tally)).not.toMatch(/byte/i);
      expect(describeTally(tally)).not.toMatch(/sent/i);
    }
  });
});

describe("supportsRequestMonitoring", () => {
  it("answers without throwing in this environment", () => {
    expect(typeof supportsRequestMonitoring()).toBe("boolean");
  });
});
