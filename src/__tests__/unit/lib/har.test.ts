import { describe, expect, it } from "vitest";
import {
  HarError,
  filterEntries,
  formatMs,
  isSensitiveHeader,
  methodsIn,
  parseHar,
  redactHar,
  redactedFileName,
  resourceTypeOf,
  scanRedactions,
  sortEntries,
  statusClassOf,
  summarizeHar,
  typesIn,
  REDACTED_MARKER,
} from "@/lib/tools/har";

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const header = (name: string, value: string) => ({ name, value });

/**
 * Four entries covering the shapes a real HAR mixes: a Chrome-style document
 * with `_transferSize` and `_resourceType`, a Firefox-style JSON POST with
 * neither, a cached image whose dns/connect phases are -1, and a blocked
 * request Chrome writes as `status: 0`.
 */
const SAMPLE = {
  log: {
    version: "1.2",
    creator: { name: "WebInspector", version: "537.36" },
    browser: { name: "Chrome", version: "141.0" },
    pages: [{ id: "page_1" }],
    entries: [
      {
        startedDateTime: "2026-09-05T10:00:00.000Z",
        time: 412.5,
        _resourceType: "document",
        serverIPAddress: "93.184.216.34",
        request: {
          method: "GET",
          url: "https://example.com/index.html?ref=news",
          headers: [header("Cookie", "sid=abc123"), header("Accept", "text/html")],
          queryString: [header("ref", "news")],
          cookies: [{ name: "sid", value: "abc123" }],
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "http/2.0",
          headers: [header("Set-Cookie", "sid=xyz789"), header("Content-Type", "text/html")],
          cookies: [{ name: "sid", value: "xyz789" }],
          content: { size: 5120, mimeType: "text/html; charset=utf-8", text: "<html>…</html>" },
          _transferSize: 2048,
          headersSize: 300,
          bodySize: 1748,
        },
        timings: { blocked: 1.5, dns: 12, connect: 30, ssl: 20, send: 0.5, wait: 300, receive: 68.5 },
      },
      {
        startedDateTime: "2026-09-05T10:00:01.000Z",
        time: 980,
        request: {
          method: "post",
          url: "https://api.example.com/v1/login",
          headers: [
            header("Authorization", "Bearer eyJhbGciOi"),
            header("X-Api-Key", "k_live_9182"),
            header("Content-Type", "application/json"),
          ],
          queryString: [],
          cookies: [],
          postData: {
            mimeType: "application/json",
            text: '{"user":"ada","password":"hunter2"}',
            params: [{ name: "password", value: "hunter2" }],
          },
        },
        response: {
          status: 401,
          statusText: "Unauthorized",
          headers: [header("Content-Type", "application/json")],
          cookies: [],
          content: { size: 64, mimeType: "application/json", text: '{"error":"bad"}' },
          headersSize: 120,
          bodySize: 64,
        },
        timings: { blocked: 0, dns: -1, connect: -1, send: 1, wait: 970, receive: 9 },
      },
      {
        startedDateTime: "2026-09-05T10:00:02.000Z",
        time: -1,
        request: {
          method: "GET",
          url: "https://cdn.example.com/logo.png",
          headers: [header("X-Session-Id", "s-77")],
          queryString: [],
          cookies: [],
        },
        response: {
          status: 304,
          statusText: "Not Modified",
          headers: [],
          cookies: [],
          content: { size: -1, mimeType: "image/png" },
          headersSize: -1,
          bodySize: -1,
        },
        timings: { blocked: 0.2, dns: -1, connect: -1, send: 0, wait: 2, receive: 0 },
      },
      {
        startedDateTime: "2026-09-05T10:00:03.000Z",
        time: 0,
        _resourceType: "script",
        request: {
          method: "GET",
          url: "https://tracker.example.net/beacon.js",
          headers: [],
          queryString: [],
          cookies: [],
        },
        response: {
          status: 0,
          statusText: "",
          headers: [],
          cookies: [],
          content: { size: 0, mimeType: "" },
          headersSize: -1,
          bodySize: -1,
        },
        timings: { blocked: 0, send: 0, wait: 0, receive: 0 },
      },
    ],
  },
};

const sampleText = () => JSON.stringify(SAMPLE);

/* ── Parsing ──────────────────────────────────────────────────────────────── */

describe("parseHar — refusing what is not a HAR", () => {
  it("rejects an empty file", () => {
    expect(() => parseHar("   ")).toThrow(HarError);
    expect(() => parseHar("")).toThrow(/empty/i);
  });

  it("rejects text that is not JSON, and says why", () => {
    expect(() => parseHar("<html>nope</html>")).toThrow(/not valid JSON/i);
  });

  it("rejects JSON that has no log object", () => {
    expect(() => parseHar('{"entries":[]}')).toThrow(/no top-level "log" object/i);
  });

  it("rejects a log with no entries array", () => {
    expect(() => parseHar('{"log":{"version":"1.2"}}')).toThrow(/no "entries" array/i);
  });

  it("does not pretend a zero-entry recording worked", () => {
    expect(() => parseHar('{"log":{"version":"1.2","entries":[]}}')).toThrow(
      /entries list is empty/i,
    );
  });
});

describe("parseHar — reading a real file", () => {
  const har = parseHar(sampleText());

  it("reads the log metadata", () => {
    expect(har.version).toBe("1.2");
    expect(har.creator).toBe("WebInspector 537.36");
    expect(har.browser).toBe("Chrome 141.0");
    expect(har.pageCount).toBe(1);
    expect(har.entries).toHaveLength(4);
  });

  it("numbers entries from 1 in source order", () => {
    expect(har.entries.map((e) => e.index)).toEqual([1, 2, 3, 4]);
  });

  it("upper-cases the method a HAR wrote in lower case", () => {
    expect(har.entries[1].method).toBe("POST");
  });

  it("splits the URL into host and path so a table can show it", () => {
    expect(har.entries[0].host).toBe("example.com");
    expect(har.entries[0].path).toBe("/index.html?ref=news");
  });

  it("classifies statuses, and does not call a blocked request 2xx", () => {
    expect(har.entries.map((e) => e.statusClass)).toEqual(["2xx", "4xx", "3xx", "none"]);
  });

  it("prefers _transferSize, then headersSize + bodySize", () => {
    expect(har.entries[0].transferBytes).toBe(2048);
    expect(har.entries[1].transferBytes).toBe(184);
  });

  it("reports an unknown size as null rather than zero", () => {
    // -1 is the HAR spec's "unknown". Adding it to a total, or printing it as
    // 0 B, both understate the file.
    expect(har.entries[2].transferBytes).toBeNull();
    expect(har.entries[2].contentBytes).toBeNull();
    expect(har.entries[2].timeMs).toBeNull();
  });

  it("reads the resource type from _resourceType, and from the MIME type when absent", () => {
    expect(har.entries[0].resourceType).toBe("document");
    expect(har.entries[1].resourceType).toBe("json");
    expect(har.entries[2].resourceType).toBe("image");
  });

  it("strips the charset off the MIME type", () => {
    expect(har.entries[0].mimeType).toBe("text/html");
  });

  it("drops timing phases the file reported as not applicable", () => {
    const cached = har.entries[1].timings.map((t) => t.label);
    expect(cached).not.toContain("DNS");
    expect(cached).not.toContain("Connect");
    expect(cached).toContain("Wait");
    expect(har.entries[0].timings.map((t) => t.label)).toEqual([
      "Blocked",
      "DNS",
      "Connect",
      "TLS",
      "Send",
      "Wait",
      "Receive",
    ]);
  });

  it("keeps request and response headers, query string and post body", () => {
    expect(har.entries[0].requestHeaders).toContainEqual(header("Cookie", "sid=abc123"));
    expect(har.entries[0].queryString).toEqual([header("ref", "news")]);
    expect(har.entries[1].postData?.text).toContain("hunter2");
    expect(har.entries[0].postData).toBeNull();
  });

  it("keeps an entry whose request object is missing entirely", () => {
    const har2 = parseHar('{"log":{"entries":[{"startedDateTime":"x"}]}}');
    expect(har2.entries).toHaveLength(1);
    expect(har2.entries[0].method).toBe("—");
    expect(har2.entries[0].status).toBe(0);
  });

  it("shows a data: URL rather than dropping it", () => {
    const har2 = parseHar(
      '{"log":{"entries":[{"request":{"method":"GET","url":"data:image/png;base64,AAA"}}]}}',
    );
    expect(har2.entries[0].host).toBe("");
    expect(har2.entries[0].path).toBe("data:image/png;base64,AAA");
  });
});

describe("statusClassOf and resourceTypeOf", () => {
  it("bands the HTTP classes", () => {
    expect(statusClassOf(100)).toBe("1xx");
    expect(statusClassOf(204)).toBe("2xx");
    expect(statusClassOf(301)).toBe("3xx");
    expect(statusClassOf(404)).toBe("4xx");
    expect(statusClassOf(503)).toBe("5xx");
    expect(statusClassOf(0)).toBe("none");
    expect(statusClassOf(999)).toBe("none");
  });

  it("derives a type from the MIME type when the recorder wrote none", () => {
    expect(resourceTypeOf({}, "text/css")).toBe("stylesheet");
    expect(resourceTypeOf({}, "application/javascript")).toBe("script");
    expect(resourceTypeOf({}, "font/woff2")).toBe("font");
    expect(resourceTypeOf({}, "video/mp4")).toBe("media");
    expect(resourceTypeOf({}, "text/plain")).toBe("text");
    expect(resourceTypeOf({}, "")).toBe("other");
  });

  it("prefers what the file says over what the MIME type implies", () => {
    expect(resourceTypeOf({ _resourceType: "XHR" }, "image/png")).toBe("xhr");
  });
});

/* ── Summary ──────────────────────────────────────────────────────────────── */

describe("summarizeHar", () => {
  const har = parseHar(sampleText());
  const summary = summarizeHar(har.entries);

  it("counts every entry", () => {
    expect(summary.count).toBe(4);
  });

  it("totals only the entries that reported a size, and says how many did not", () => {
    expect(summary.transferBytes).toBe(2048 + 184);
    expect(summary.sizedEntries).toBe(2);
    expect(summary.unsizedEntries).toBe(2);
  });

  it("totals only the entries that reported a time", () => {
    expect(summary.totalTimeMs).toBeCloseTo(412.5 + 980 + 0, 5);
    expect(summary.timedEntries).toBe(3);
  });

  it("names the slowest and the largest request", () => {
    expect(summary.slowest?.url).toBe("https://api.example.com/v1/login");
    expect(summary.largest?.url).toBe("https://example.com/index.html?ref=news");
  });

  it("counts by status class in ascending order, skipping absent classes", () => {
    expect(summary.byStatusClass).toEqual([
      { label: "2xx", count: 1 },
      { label: "3xx", count: 1 },
      { label: "4xx", count: 1 },
      { label: "none", count: 1 },
    ]);
  });

  it("counts by resource type, most common first", () => {
    expect(summary.byType.map((t) => t.label).sort()).toEqual([
      "document",
      "image",
      "json",
      "script",
    ]);
  });

  it("survives an empty list without inventing a slowest request", () => {
    const empty = summarizeHar([]);
    expect(empty.count).toBe(0);
    expect(empty.slowest).toBeNull();
    expect(empty.largest).toBeNull();
    expect(empty.byStatusClass).toEqual([]);
    expect(empty.wallClockMs).toBeNull();
    expect(empty.timestampedEntries).toBe(0);
  });
});

/*
  The page used to end its SUMMARY paragraph with "requests overlap, so it is
  longer than the wall clock" — an unconditional claim about the reader's file.
  It is false for THIS fixture and for any recording with idle time in it, which
  is what a "preserve log" capture over a debugging session always is. The span
  is derivable from fields the parser already keeps, so it is derived.
*/
describe("summarizeHar — the recording's own wall clock", () => {
  const summary = summarizeHar(parseHar(sampleText()).entries);

  it("spans the first request's start to the last one's end", () => {
    // Starts 10:00:00 / :01 / :02 / :03; the last entry's time is 0, so the
    // span is exactly 3.000 s.
    expect(summary.wallClockMs).toBe(3000);
    expect(summary.timestampedEntries).toBe(4);
    expect(summary.timestampedEntries).toBe(summary.count);
  });

  it("the summed duration is SHORTER than the span here, so nothing may assert otherwise", () => {
    expect(summary.totalTimeMs).toBeCloseTo(1392.5, 5);
    expect(summary.totalTimeMs).toBeLessThan(summary.wallClockMs as number);
  });

  it("counts the last request's duration into the span, not just its start", () => {
    const har = parseHar(
      JSON.stringify({
        log: {
          entries: [
            { startedDateTime: "2026-09-05T10:00:00.000Z", time: 100, request: {}, response: {} },
            { startedDateTime: "2026-09-05T10:00:01.000Z", time: 500, request: {}, response: {} },
          ],
        },
      }),
    );
    // 1000 ms between the starts, plus the 500 ms the second one ran for.
    expect(summarizeHar(har.entries).wallClockMs).toBe(1500);
  });

  it("can come out SHORTER than the span (idle) or LONGER (overlap)", () => {
    const at = (iso: string, time: number) => ({
      startedDateTime: iso,
      time,
      request: {},
      response: {},
    });
    const overlapping = summarizeHar(
      parseHar(
        JSON.stringify({
          log: {
            entries: [
              at("2026-09-05T10:00:00.000Z", 2000),
              at("2026-09-05T10:00:00.100Z", 2000),
              at("2026-09-05T10:00:00.200Z", 2000),
            ],
          },
        }),
      ).entries,
    );
    expect(overlapping.totalTimeMs).toBe(6000);
    expect(overlapping.wallClockMs).toBe(2200);
    expect(overlapping.totalTimeMs).toBeGreaterThan(overlapping.wallClockMs as number);
  });

  it("reports no span at all when nothing carries a parsable timestamp", () => {
    const har = parseHar(
      '{"log":{"entries":[{"time":10,"request":{},"response":{}},{"startedDateTime":"not a date","time":10}]}}',
    );
    const s = summarizeHar(har.entries);
    expect(s.wallClockMs).toBeNull();
    expect(s.timestampedEntries).toBe(0);
  });

  it("does not pin an unparsable entry to the epoch and claim a 56-year recording", () => {
    const har = parseHar(
      JSON.stringify({
        log: {
          entries: [
            { startedDateTime: "2026-09-05T10:00:00.000Z", time: 40, request: {}, response: {} },
            { startedDateTime: "", time: 40, request: {}, response: {} },
            { startedDateTime: "2026-09-05T10:00:00.500Z", time: 40, request: {}, response: {} },
          ],
        },
      }),
    );
    const s = summarizeHar(har.entries);
    expect(s.wallClockMs).toBe(540);
    // …and it says the span covers 2 of 3, so the UI knows not to call it the
    // length of the recording.
    expect(s.timestampedEntries).toBe(2);
    expect(s.count).toBe(3);
  });

  it("reports no total time to print when every entry says -1", () => {
    const har = parseHar(
      '{"log":{"entries":[{"startedDateTime":"2026-09-05T10:00:00.000Z","time":-1,"request":{},"response":{}},{"startedDateTime":"2026-09-05T10:02:00.000Z","time":-1,"request":{},"response":{}}]}}',
    );
    const s = summarizeHar(har.entries);
    expect(s.timedEntries).toBe(0);
    expect(s.totalTimeMs).toBe(0);
    // The recording plainly took two minutes; the sum is 0 because nothing was
    // measured, which is why the strip may not print it as a duration.
    expect(s.wallClockMs).toBe(120000);
  });
});

/* ── Filter and sort ──────────────────────────────────────────────────────── */

describe("filterEntries", () => {
  const entries = parseHar(sampleText()).entries;

  it("returns everything with no filter", () => {
    expect(filterEntries(entries, {})).toHaveLength(4);
    expect(filterEntries(entries, { statusClass: "all", method: "all" })).toHaveLength(4);
  });

  it("filters by status class", () => {
    expect(filterEntries(entries, { statusClass: "4xx" }).map((e) => e.index)).toEqual([2]);
    expect(filterEntries(entries, { statusClass: "none" }).map((e) => e.index)).toEqual([4]);
  });

  it("filters by method", () => {
    expect(filterEntries(entries, { method: "POST" }).map((e) => e.index)).toEqual([2]);
  });

  it("filters by a case-insensitive URL substring", () => {
    expect(filterEntries(entries, { query: "CDN." }).map((e) => e.index)).toEqual([3]);
    expect(filterEntries(entries, { query: "   " })).toHaveLength(4);
  });

  it("filters by resource type", () => {
    expect(filterEntries(entries, { resourceType: "image" }).map((e) => e.index)).toEqual([3]);
  });

  it("intersects filters rather than unioning them", () => {
    expect(filterEntries(entries, { method: "GET", statusClass: "4xx" })).toEqual([]);
  });
});

describe("sortEntries", () => {
  const entries = parseHar(sampleText()).entries;

  it("sorts by size, largest first, with unknown sizes last", () => {
    expect(sortEntries(entries, "size", "desc").map((e) => e.index)).toEqual([1, 2, 3, 4]);
  });

  it("keeps unknown sizes last when sorting the other way too", () => {
    // "No figure" is not "the smallest figure": a null must not out-rank a
    // real 184 bytes just because the sort flipped.
    const asc = sortEntries(entries, "size", "asc").map((e) => e.index);
    expect(asc.slice(0, 2)).toEqual([2, 1]);
    expect(asc.slice(2).sort()).toEqual([3, 4]);
  });

  it("sorts by time, slowest first", () => {
    expect(sortEntries(entries, "time", "desc")[0].index).toBe(2);
  });

  it("sorts by status", () => {
    expect(sortEntries(entries, "status", "asc").map((e) => e.status)).toEqual([0, 200, 304, 401]);
  });

  it("breaks ties by source order", () => {
    expect(sortEntries(entries, "method", "asc").map((e) => e.index)).toEqual([1, 3, 4, 2]);
  });

  it("does not mutate the input", () => {
    const before = entries.map((e) => e.index);
    sortEntries(entries, "time", "desc");
    expect(entries.map((e) => e.index)).toEqual(before);
  });

  it("falls back to source order for the index key", () => {
    expect(sortEntries(entries, "index", "asc").map((e) => e.index)).toEqual([1, 2, 3, 4]);
  });
});

describe("methodsIn / typesIn", () => {
  const entries = parseHar(sampleText()).entries;

  it("lists the methods present, GET first", () => {
    expect(methodsIn(entries)).toEqual(["GET", "POST"]);
  });

  it("lists the resource types present", () => {
    expect(typesIn(entries).sort()).toEqual(["document", "image", "json", "script"]);
  });
});

/* ── Redaction ────────────────────────────────────────────────────────────── */

describe("isSensitiveHeader", () => {
  it("matches the named headers, case-insensitively", () => {
    expect(isSensitiveHeader("Cookie")).toBe(true);
    expect(isSensitiveHeader("set-cookie")).toBe(true);
    expect(isSensitiveHeader("  AUTHORIZATION ")).toBe(true);
    expect(isSensitiveHeader("Proxy-Authorization")).toBe(true);
  });

  it("matches the pattern for vendor-invented credential headers", () => {
    expect(isSensitiveHeader("X-Api-Key")).toBe(true);
    expect(isSensitiveHeader("x_api_key")).toBe(true);
    expect(isSensitiveHeader("X-Session-Id")).toBe(true);
    expect(isSensitiveHeader("X-CSRF-Token")).toBe(true);
    expect(isSensitiveHeader("client-secret")).toBe(true);
  });

  it("leaves ordinary headers alone", () => {
    expect(isSensitiveHeader("Content-Type")).toBe(false);
    expect(isSensitiveHeader("Accept")).toBe(false);
    expect(isSensitiveHeader("User-Agent")).toBe(false);
  });
});

/**
 * The redacted document, read back as plain JSON.
 *
 * `typeof SAMPLE` would infer `postData` as present on only one of the four
 * entry shapes and absent from the union, so every assertion about the body
 * would need a guard that has nothing to do with what is being tested.
 */
interface RawHar {
  log: {
    entries: {
      request: {
        url: string;
        headers: { name: string; value: string }[];
        queryString: { name: string; value: string }[];
        cookies: { name: string; value: string }[];
        postData: { text: string; params: { name: string; value: string }[] };
      };
      response: {
        headers: { name: string; value: string }[];
        cookies: { name: string; value: string }[];
        content: { text: string };
      };
    }[];
  };
}

describe("redactHar", () => {
  const doc = JSON.parse(sampleText()) as RawHar;
  const report = redactHar(doc);
  const out = report.har as RawHar;

  it("replaces every matched header value", () => {
    const first = out.log.entries[0];
    expect(first.request.headers[0].value).toBe(REDACTED_MARKER);
    expect(first.response.headers[0].value).toBe(REDACTED_MARKER);
    const second = out.log.entries[1];
    expect(second.request.headers[0].value).toBe(REDACTED_MARKER);
    expect(second.request.headers[1].value).toBe(REDACTED_MARKER);
  });

  it("leaves ordinary headers untouched", () => {
    expect(out.log.entries[0].request.headers[1]).toEqual(header("Accept", "text/html"));
    expect(out.log.entries[1].response.headers[0]).toEqual(
      header("Content-Type", "application/json"),
    );
  });

  it("empties the cookies arrays as well as the Cookie headers", () => {
    expect(out.log.entries[0].request.cookies[0].value).toBe(REDACTED_MARKER);
    expect(out.log.entries[0].response.cookies[0].value).toBe(REDACTED_MARKER);
    expect(report.cookieValues).toBe(2);
  });

  it("removes the request body and its form parameters", () => {
    const post = out.log.entries[1].request.postData;
    expect(post.text).toBe(REDACTED_MARKER);
    expect(post.params[0].value).toBe(REDACTED_MARKER);
    expect(report.bodies).toBe(1);
  });

  it("counts what it removed and names the headers it found", () => {
    expect(report.headerValues).toBe(5);
    expect(report.headerNames).toEqual([
      "authorization",
      "cookie",
      "set-cookie",
      "x-api-key",
      "x-session-id",
    ]);
    // 5 header values + 2 cookie values are the credentials; the login POST
    // contributes 2 more VALUES (its text and its one form parameter) from 1
    // body. `total` counts values, so it is 9 — it used to add `bodies`, an
    // entry count, into a figure the page printed as "credential values".
    expect(report.credentialValues).toBe(5 + 2);
    expect(report.bodies).toBe(1);
    expect(report.bodyValues).toBe(2);
    expect(report.total).toBe(5 + 2 + 2);
  });

  it("does NOT touch the URL or its query string — the disclosed gap", () => {
    expect(out.log.entries[0].request.url).toBe("https://example.com/index.html?ref=news");
    expect(out.log.entries[0].request.queryString[0]).toEqual(header("ref", "news"));
  });

  it("does NOT touch a response body — the other disclosed gap", () => {
    expect(out.log.entries[1].response.content.text).toBe('{"error":"bad"}');
  });

  it("works on a copy, so the on-screen table keeps the real values", () => {
    expect(doc.log.entries[0].request.headers[0].value).toBe("sid=abc123");
    expect(doc.log.entries[1].request.postData.text).toContain("hunter2");
  });

  it("reports zeroes for a HAR with nothing to remove", () => {
    const clean = redactHar({
      log: { entries: [{ request: { headers: [header("Accept", "*/*")] } }] },
    });
    expect(clean.total).toBe(0);
    expect(clean.headerNames).toEqual([]);
  });

  it("does not count an empty request body as a removal", () => {
    const empty = redactHar({
      log: { entries: [{ request: { postData: { mimeType: "text/plain", text: "" } } }] },
    });
    expect(empty.bodies).toBe(0);
  });

  it("survives a document that is not a HAR at all", () => {
    expect(redactHar({ nope: true }).total).toBe(0);
  });
});

/*
  `total` was `headerValues + cookieValues + bodies`, and the page led with it
  under the noun "credential values". A recording of a public, unauthenticated
  API — no Cookie, no Authorization, just POST bodies — therefore announced
  credentials it did not contain, two clauses before its own breakdown said zero
  headers and zero cookies. The counts now separate what was matched BECAUSE it
  looks like a credential from what is removed regardless.
*/
describe("redaction counts — credentials are not the same thing as bodies", () => {
  const bodiesOnly = {
    log: {
      entries: [1, 2, 3].map(() => ({
        request: {
          method: "POST",
          url: "https://public.example/graphql",
          headers: [header("Content-Type", "application/json")],
          cookies: [],
          postData: { mimeType: "application/json", text: '{"query":"{ me }"}' },
        },
        response: { status: 200, headers: [], cookies: [] },
      })),
    },
  };

  it("reports zero credential values for a HAR that has none", () => {
    const counts = scanRedactions(bodiesOnly);
    expect(counts.headerValues).toBe(0);
    expect(counts.cookieValues).toBe(0);
    expect(counts.credentialValues).toBe(0);
    expect(counts.bodies).toBe(3);
    expect(counts.bodyValues).toBe(3);
    expect(counts.total).toBe(3);
  });

  it("counts body VALUES, not body entries, so eight form fields are not one", () => {
    const counts = scanRedactions({
      log: {
        entries: [
          {
            request: {
              postData: {
                mimeType: "application/x-www-form-urlencoded",
                text: "a=1&b=2&c=3",
                params: [
                  { name: "a", value: "1" },
                  { name: "b", value: "2" },
                  { name: "c", value: "3" },
                ],
              },
            },
          },
        ],
      },
    });
    expect(counts.bodies).toBe(1);
    expect(counts.bodyValues).toBe(4); // the text blob plus three parameters
    expect(counts.total).toBe(4);
  });

  it("keeps total as a sum of values: credentials plus body values", () => {
    const counts = scanRedactions(JSON.parse(sampleText()));
    expect(counts.total).toBe(counts.credentialValues + counts.bodyValues);
    expect(counts.credentialValues).toBe(counts.headerValues + counts.cookieValues);
  });
});

describe("scanRedactions", () => {
  it("returns exactly what redactHar would report, without copying the document", () => {
    const doc = JSON.parse(sampleText()) as RawHar;
    const before = sampleText();
    const scanned = scanRedactions(doc);
    // Read-only: the on-screen table is rendered from this same document.
    expect(JSON.stringify(doc)).toBe(before);
    expect(doc.log.entries[0].request.headers[0].value).toBe("sid=abc123");
    expect(doc.log.entries[1].request.postData.text).toContain("hunter2");

    const { har: _redacted, ...applied } = redactHar(JSON.parse(sampleText()));
    expect(scanned).toEqual(applied);
  });

  it("agrees with redactHar on a document that is not a HAR", () => {
    expect(scanRedactions({ nope: true }).total).toBe(0);
    expect(scanRedactions(null).total).toBe(0);
  });
});

/* ── Formatting ───────────────────────────────────────────────────────────── */

describe("formatMs", () => {
  it("prints an em dash for an unknown time, never 0 ms", () => {
    expect(formatMs(null)).toBe("—");
  });

  it("prints milliseconds below a second and seconds above", () => {
    expect(formatMs(412.5)).toBe("413 ms");
    expect(formatMs(0)).toBe("0 ms");
    expect(formatMs(1240)).toBe("1.24 s");
  });
});

describe("redactedFileName", () => {
  it("marks the stem and keeps the extension", () => {
    expect(redactedFileName("session.har")).toBe("session.redacted.har");
    expect(redactedFileName("api.calls.json")).toBe("api.calls.redacted.json");
  });

  it("handles a name with no extension and an empty name", () => {
    expect(redactedFileName("capture")).toBe("capture.redacted.har");
    expect(redactedFileName("  ")).toBe("session.redacted.har");
  });
});
