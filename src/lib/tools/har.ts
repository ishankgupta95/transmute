/**
 * HAR (HTTP Archive) reading, summarising and redacting.
 *
 * Pure functions over a parsed JSON document. No DOM, no network, no
 * dependency — a HAR is just JSON with a `log.entries[]` array, and everything
 * hard about it is deciding which of its optional fields to believe.
 *
 * ── Why a local viewer is the right shape for this file ─────────────────────
 *
 * A HAR is a verbatim recording of a browsing session. It routinely carries
 * `Cookie` and `Set-Cookie` headers, `Authorization: Bearer …`, CSRF tokens,
 * API keys in custom headers, and whole POST bodies including the one from the
 * login form. Pasting one into a hosted viewer hands all of that to a third
 * party. That is the entire argument for reading it in the tab it never leaves.
 *
 * ── What `redactHar` does and does NOT do ───────────────────────────────────
 *
 * It replaces the VALUES of a named header set (see `REDACT_HEADER_NAMES` and
 * `SENSITIVE_HEADER_PATTERN`), every cookie value in the `cookies` arrays, and
 * `request.postData`. It leaves URLs, query strings and response bodies
 * untouched — an access token in `?access_token=…` or in a JSON login response
 * survives redaction completely. `RedactionReport` therefore reports counts of
 * what it removed rather than a verdict, and the UI is required to say the
 * result still needs reading before it is shared. "Safe to share" is a claim
 * this module cannot support and must never be worded into.
 */

/* ── Errors ───────────────────────────────────────────────────────────────── */

export class HarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarError";
  }
}

/* ── Shapes ───────────────────────────────────────────────────────────────── */

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarTiming {
  label: string;
  ms: number;
}

export type StatusClass = "1xx" | "2xx" | "3xx" | "4xx" | "5xx" | "none";

export interface HarEntryView {
  /** 1-based position in the file, kept so a sorted table can still cite it. */
  index: number;
  method: string;
  url: string;
  /** Host and path split out, because the table cannot show a 400-char URL. */
  host: string;
  path: string;
  status: number;
  statusText: string;
  statusClass: StatusClass;
  /** `_resourceType` when the recorder wrote one, otherwise read off the MIME type. */
  resourceType: string;
  mimeType: string;
  /** Bytes over the wire. `null` when the file does not say — never guessed as 0. */
  transferBytes: number | null;
  /** Uncompressed body size the recorder reported, or `null`. */
  contentBytes: number | null;
  /** Milliseconds. `null` when the file reports -1 (unknown). */
  timeMs: number | null;
  startedDateTime: string;
  serverIPAddress: string;
  httpVersion: string;
  requestHeaders: HarHeader[];
  responseHeaders: HarHeader[];
  queryString: HarHeader[];
  postData: { mimeType: string; text: string } | null;
  /** Only the phases the file actually reported (HAR writes -1 for "not applicable"). */
  timings: HarTiming[];
}

export interface HarFile {
  version: string;
  creator: string;
  browser: string;
  pageCount: number;
  entries: HarEntryView[];
  /** The parsed document, untouched — what `redactHar` works from. */
  raw: unknown;
}

/* ── Reading ──────────────────────────────────────────────────────────────── */

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A HAR size or duration field: `-1` is the spec's "unknown", not a value. */
const measured = (v: unknown): number | null => {
  const n = num(v);
  return n === null || n < 0 ? null : n;
};

function headerList(v: unknown): HarHeader[] {
  if (!Array.isArray(v)) return [];
  const out: HarHeader[] = [];
  for (const item of v) {
    const rec = asRecord(item);
    if (!rec) continue;
    out.push({ name: str(rec.name), value: str(rec.value) });
  }
  return out;
}

export function statusClassOf(status: number): StatusClass {
  if (status >= 100 && status < 200) return "1xx";
  if (status >= 200 && status < 300) return "2xx";
  if (status >= 300 && status < 400) return "3xx";
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  // Chrome writes `status: 0` for a request that was blocked, cancelled or
  // failed DNS. That is not a class of HTTP response and must not be counted
  // as one — a blocked tracker showing up under "2xx" would be a lie.
  return "none";
}

/**
 * The resource type, from `_resourceType` where the recorder wrote one and
 * from the MIME type otherwise.
 *
 * Firefox and curl-converted HARs have no `_resourceType` at all, so the fall
 * back is the difference between a working filter and an empty one. It is
 * deliberately coarse: nothing here tries to tell an XHR from a fetch, because
 * the MIME type genuinely cannot.
 */
export function resourceTypeOf(entry: Record<string, unknown>, mimeType: string): string {
  const declared = str(entry._resourceType).trim();
  if (declared) return declared.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (!mime) return "other";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("font/") || mime.includes("font")) return "font";
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return "media";
  if (mime.includes("html")) return "document";
  if (mime.includes("css")) return "stylesheet";
  if (mime.includes("javascript") || mime.includes("ecmascript")) return "script";
  if (mime.includes("json")) return "json";
  if (mime.includes("xml")) return "xml";
  if (mime.startsWith("text/")) return "text";
  return "other";
}

/** The HAR timing phases, in the order they happen. */
const TIMING_PHASES: readonly { key: string; label: string }[] = [
  { key: "blocked", label: "Blocked" },
  { key: "dns", label: "DNS" },
  { key: "connect", label: "Connect" },
  { key: "ssl", label: "TLS" },
  { key: "send", label: "Send" },
  { key: "wait", label: "Wait" },
  { key: "receive", label: "Receive" },
];

function timingList(v: unknown): HarTiming[] {
  const rec = asRecord(v);
  if (!rec) return [];
  const out: HarTiming[] = [];
  for (const phase of TIMING_PHASES) {
    const ms = measured(rec[phase.key]);
    // -1 means "not applicable to this request" in the HAR spec — a cached
    // response has no dns or connect phase. Printing "0 ms" for those would
    // claim the phase happened instantly rather than not at all.
    if (ms === null) continue;
    out.push({ label: phase.label, ms });
  }
  return out;
}

function splitUrl(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    // `data:` and `blob:` URLs parse, but they have no host and their
    // "pathname" is the entire payload minus the scheme — printing that in the
    // path column shows `image/png;base64,AAA` and loses the one token that
    // said what the row is. Only the two schemes with a real authority get
    // split; everything else is shown whole.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { host: "", path: url };
    }
    return { host: parsed.host, path: `${parsed.pathname}${parsed.search}` };
  } catch {
    // A hand-edited HAR can hold something that is not a URL at all. Show it
    // rather than dropping the row.
    return { host: "", path: url };
  }
}

function toEntry(raw: unknown, index: number): HarEntryView | null {
  const entry = asRecord(raw);
  if (!entry) return null;
  const request = asRecord(entry.request) ?? {};
  const response = asRecord(entry.response) ?? {};
  const content = asRecord(response.content) ?? {};

  const url = str(request.url);
  const { host, path } = splitUrl(url);
  const mimeType = str(content.mimeType).split(";")[0].trim();
  const status = num(response.status) ?? 0;

  const postRaw = asRecord(request.postData);
  const postData = postRaw
    ? { mimeType: str(postRaw.mimeType), text: str(postRaw.text) }
    : null;

  /*
    Transfer size, in the order the recorders actually write it.

    Chrome's `_transferSize` is the compressed bytes on the wire and is the
    only field that is straightforwardly that. Failing that, the spec's
    `headersSize` + `bodySize` is the same number when both are known — but
    either may be -1, and adding -1 to a real number silently understates the
    total by exactly one byte, which is the kind of wrong that never gets
    noticed. So an unknown component makes the whole figure unknown, and
    `summarizeHar` reports how many entries that happened to.
  */
  const transfer = measured(response._transferSize);
  const headersSize = measured(response.headersSize);
  const bodySize = measured(response.bodySize);
  const transferBytes =
    transfer !== null
      ? transfer
      : headersSize !== null && bodySize !== null
        ? headersSize + bodySize
        : null;

  return {
    index,
    method: str(request.method, "—").toUpperCase(),
    url,
    host,
    path,
    status,
    statusText: str(response.statusText),
    statusClass: statusClassOf(status),
    resourceType: resourceTypeOf(entry, mimeType),
    mimeType,
    transferBytes,
    contentBytes: measured(content.size),
    timeMs: measured(entry.time),
    startedDateTime: str(entry.startedDateTime),
    serverIPAddress: str(entry.serverIPAddress),
    httpVersion: str(response.httpVersion),
    requestHeaders: headerList(request.headers),
    responseHeaders: headerList(response.headers),
    queryString: headerList(request.queryString),
    postData,
    timings: timingList(entry.timings),
  };
}

/**
 * Parse a HAR file's text.
 *
 * Throws `HarError` with a sentence the UI prints verbatim. Every failure mode
 * gets its own sentence, because "invalid file" sends the reader nowhere: a
 * truncated download, a JSON file that is not a HAR, and an empty recording
 * are three different problems with three different fixes.
 */
export function parseHar(text: string): HarFile {
  if (!text.trim()) {
    throw new HarError("This file is empty.");
  }

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new HarError(
      `This file is not valid JSON, so it cannot be a HAR: ${
        err instanceof Error ? err.message : "the parser gave no reason"
      }. A HAR saved from a browser is one JSON object; a truncated download is the usual cause.`,
    );
  }

  const root = asRecord(doc);
  const log = root ? asRecord(root.log) : null;
  if (!log) {
    throw new HarError(
      "This is valid JSON but not a HAR: there is no top-level \"log\" object. A HAR always looks like {\"log\": {\"version\": …, \"entries\": [ … ]}}.",
    );
  }
  if (!Array.isArray(log.entries)) {
    throw new HarError(
      "This file has a \"log\" object but no \"entries\" array, so there are no requests in it to show.",
    );
  }

  const entries: HarEntryView[] = [];
  for (const item of log.entries) {
    const view = toEntry(item, entries.length + 1);
    if (view) entries.push(view);
  }

  if (entries.length === 0) {
    throw new HarError(
      "This is a valid HAR whose entries list is empty — the recording captured no requests. Recording usually has to be started before the page loads, not after.",
    );
  }

  const creator = asRecord(log.creator);
  const browser = asRecord(log.browser);

  return {
    version: str(log.version, "1.2"),
    creator: creator
      ? [str(creator.name), str(creator.version)].filter(Boolean).join(" ")
      : "",
    browser: browser
      ? [str(browser.name), str(browser.version)].filter(Boolean).join(" ")
      : "",
    pageCount: Array.isArray(log.pages) ? log.pages.length : 0,
    entries,
    raw: doc,
  };
}

/* ── Summary ──────────────────────────────────────────────────────────────── */

export interface HarSummary {
  count: number;
  /** Sum over the entries that reported a size. */
  transferBytes: number;
  /** How many entries contributed to that sum, and how many could not. */
  sizedEntries: number;
  unsizedEntries: number;
  /** Sum of per-entry `time`. Not wall-clock — see `wallClockMs`. */
  totalTimeMs: number;
  timedEntries: number;
  /**
   * How long the recording actually ran: the earliest `startedDateTime` to the
   * latest `startedDateTime + time`. `null` when no entry carries a timestamp
   * a `Date` can parse.
   *
   * This exists so the page can COMPARE the two figures instead of asserting a
   * relationship between them. Summed duration is longer than the clock when
   * requests overlap and SHORTER than it whenever the session sat idle — a
   * "preserve log" capture across a five-minute debugging session sums a few
   * seconds of request time over a 300 s span — so which way round it comes out
   * is a property of the file, not of HAR.
   */
  wallClockMs: number | null;
  /**
   * How many entries carried a parsable `startedDateTime`. `wallClockMs` spans
   * only those, so the UI may only state it as the whole recording's length
   * when this equals `count`.
   */
  timestampedEntries: number;
  slowest: HarEntryView | null;
  largest: HarEntryView | null;
  byStatusClass: { label: StatusClass; count: number }[];
  byType: { label: string; count: number }[];
}

const STATUS_ORDER: readonly StatusClass[] = ["1xx", "2xx", "3xx", "4xx", "5xx", "none"];

export function summarizeHar(entries: readonly HarEntryView[]): HarSummary {
  let transferBytes = 0;
  let sizedEntries = 0;
  let totalTimeMs = 0;
  let timedEntries = 0;
  let slowest: HarEntryView | null = null;
  let largest: HarEntryView | null = null;
  let timestampedEntries = 0;
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;
  const statusCounts = new Map<StatusClass, number>();
  const typeCounts = new Map<string, number>();

  for (const entry of entries) {
    // An entry with no parsable timestamp contributes nothing to the span
    // rather than being pinned to the epoch, which would report a 56-year
    // recording. A request whose duration is unknown ends when it started —
    // the alternative is guessing a length the file declined to give.
    const startedAt = Date.parse(entry.startedDateTime);
    if (Number.isFinite(startedAt)) {
      timestampedEntries++;
      const endedAt = startedAt + (entry.timeMs ?? 0);
      if (earliestStart === null || startedAt < earliestStart) earliestStart = startedAt;
      if (latestEnd === null || endedAt > latestEnd) latestEnd = endedAt;
    }
    if (entry.transferBytes !== null) {
      transferBytes += entry.transferBytes;
      sizedEntries++;
      if (!largest || (largest.transferBytes ?? -1) < entry.transferBytes) largest = entry;
    }
    if (entry.timeMs !== null) {
      totalTimeMs += entry.timeMs;
      timedEntries++;
      if (!slowest || (slowest.timeMs ?? -1) < entry.timeMs) slowest = entry;
    }
    statusCounts.set(entry.statusClass, (statusCounts.get(entry.statusClass) ?? 0) + 1);
    typeCounts.set(entry.resourceType, (typeCounts.get(entry.resourceType) ?? 0) + 1);
  }

  return {
    count: entries.length,
    transferBytes,
    sizedEntries,
    unsizedEntries: entries.length - sizedEntries,
    totalTimeMs,
    timedEntries,
    wallClockMs:
      earliestStart !== null && latestEnd !== null ? latestEnd - earliestStart : null,
    timestampedEntries,
    slowest,
    largest,
    byStatusClass: STATUS_ORDER.filter((c) => statusCounts.has(c)).map((label) => ({
      label,
      count: statusCounts.get(label) ?? 0,
    })),
    byType: [...typeCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

/* ── Filtering and sorting ────────────────────────────────────────────────── */

export interface HarFilter {
  /** `"all"` or one of the status classes. */
  statusClass?: StatusClass | "all";
  /** `"all"` or an uppercase method. */
  method?: string;
  /** Case-insensitive substring of the URL. */
  query?: string;
  /** `"all"` or a resource type. */
  resourceType?: string;
}

export function filterEntries(
  entries: readonly HarEntryView[],
  filter: HarFilter,
): HarEntryView[] {
  const needle = (filter.query ?? "").trim().toLowerCase();
  return entries.filter((entry) => {
    if (filter.statusClass && filter.statusClass !== "all") {
      if (entry.statusClass !== filter.statusClass) return false;
    }
    if (filter.method && filter.method !== "all" && entry.method !== filter.method) return false;
    if (filter.resourceType && filter.resourceType !== "all") {
      if (entry.resourceType !== filter.resourceType) return false;
    }
    if (needle && !entry.url.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export type SortKey = "index" | "method" | "status" | "url" | "type" | "size" | "time";

/**
 * Sort a copy. An unknown size or time sorts LAST in both directions rather
 * than being treated as zero — "no figure" is not "the smallest figure", and
 * putting the unknowns at the bottom of a descending "slowest first" list is
 * what a reader means by that sort.
 */
export function sortEntries(
  entries: readonly HarEntryView[],
  key: SortKey,
  dir: "asc" | "desc",
): HarEntryView[] {
  const sign = dir === "asc" ? 1 : -1;
  const missingLast = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return null;
  };
  return [...entries].sort((a, b) => {
    switch (key) {
      case "method":
        return sign * a.method.localeCompare(b.method) || a.index - b.index;
      case "status":
        return sign * (a.status - b.status) || a.index - b.index;
      case "url":
        return sign * a.url.localeCompare(b.url) || a.index - b.index;
      case "type":
        return sign * a.resourceType.localeCompare(b.resourceType) || a.index - b.index;
      case "size": {
        const missing = missingLast(a.transferBytes, b.transferBytes);
        if (missing !== null) return missing || a.index - b.index;
        return sign * ((a.transferBytes ?? 0) - (b.transferBytes ?? 0)) || a.index - b.index;
      }
      case "time": {
        const missing = missingLast(a.timeMs, b.timeMs);
        if (missing !== null) return missing || a.index - b.index;
        return sign * ((a.timeMs ?? 0) - (b.timeMs ?? 0)) || a.index - b.index;
      }
      default:
        return sign * (a.index - b.index);
    }
  });
}

/* ── Redaction ────────────────────────────────────────────────────────────── */

/**
 * The header names removed by name. Printed on screen verbatim — a redaction
 * control that will not say what it removes is worth nothing.
 */
export const REDACT_HEADER_NAMES: readonly string[] = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-csrf-token",
  "x-xsrf-token",
];

/**
 * …plus any header whose NAME matches this. Vendors put credentials in
 * `X-Api-Key`, `X-Session-Id`, `X-Auth-Token` and a hundred other spellings,
 * and a fixed list would miss every one of them.
 */
export const SENSITIVE_HEADER_PATTERN = /token|secret|api[-_]?key|session/i;

/** What replaces a removed value, so the shape of the HAR still parses. */
export const REDACTED_MARKER = "[redacted by Transmute]";

export function isSensitiveHeader(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return REDACT_HEADER_NAMES.includes(lower) || SENSITIVE_HEADER_PATTERN.test(lower);
}

/**
 * What redaction would remove, counted.
 *
 * The nouns are load-bearing, because the UI prints them. `headerValues` and
 * `cookieValues` are matched BECAUSE they look like credentials, so their sum
 * — `credentialValues` — is the only figure that may be worded as one. Request
 * bodies are removed unconditionally: nothing here can tell a login form from
 * an analytics ping, so a body count is a count of bodies and never evidence
 * of a credential. Rolling the two together is what let a HAR of forty
 * anonymous POSTs announce "40 credential values" beside its own breakdown
 * reading zero headers and zero cookies.
 */
export interface RedactionCounts {
  /** Header values replaced. */
  headerValues: number;
  /** The distinct header names that were actually found, lower-cased and sorted. */
  headerNames: string[];
  /** Cookie values replaced in the `cookies` arrays. */
  cookieValues: number;
  /** `headerValues + cookieValues` — the values matched as credentials. */
  credentialValues: number;
  /** ENTRIES whose `request.postData` was touched. */
  bodies: number;
  /**
   * VALUES replaced inside those bodies — the body text counts one, and each
   * form parameter counts one more. A single POST carrying eight form fields
   * is 1 body and 9 values; `bodies` alone under a "values" label understated
   * that by eight.
   */
  bodyValues: number;
  /** Every value replaced, of any kind: `credentialValues + bodyValues`. */
  total: number;
}

export interface RedactionReport extends RedactionCounts {
  /** The redacted document, ready to `JSON.stringify`. */
  har: unknown;
}

function redactHeaderArray(value: unknown, found: Set<string>, apply: boolean): number {
  if (!Array.isArray(value)) return 0;
  let n = 0;
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec || typeof rec.name !== "string") continue;
    if (!isSensitiveHeader(rec.name)) continue;
    found.add(rec.name.trim().toLowerCase());
    if (apply) rec.value = REDACTED_MARKER;
    n++;
  }
  return n;
}

function redactCookieArray(value: unknown, apply: boolean): number {
  if (!Array.isArray(value)) return 0;
  let n = 0;
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec) continue;
    // Every cookie in a `cookies` array is a session value by construction —
    // unlike headers, there is nothing here to match a pattern against.
    if (apply) rec.value = REDACTED_MARKER;
    n++;
  }
  return n;
}

/**
 * One walk, two callers.
 *
 * `apply: false` counts and touches nothing, so the page can print the
 * breakdown without paying for a second copy of the document; `apply: true`
 * runs over a clone and writes the markers. Sharing the walk is the point —
 * two implementations would be two chances for the number on screen to stop
 * describing the file that downloads.
 */
function walkRedactions(doc: unknown, apply: boolean): RedactionCounts {
  const found = new Set<string>();
  let headerValues = 0;
  let cookieValues = 0;
  let bodies = 0;
  let bodyValues = 0;

  const root = asRecord(doc);
  const log = root ? asRecord(root.log) : null;
  const entries = log && Array.isArray(log.entries) ? log.entries : [];

  for (const item of entries) {
    const entry = asRecord(item);
    if (!entry) continue;
    const request = asRecord(entry.request);
    const response = asRecord(entry.response);

    if (request) {
      headerValues += redactHeaderArray(request.headers, found, apply);
      cookieValues += redactCookieArray(request.cookies, apply);
      const post = asRecord(request.postData);
      if (post) {
        let values = 0;
        if (typeof post.text === "string" && post.text.length > 0) {
          if (apply) post.text = REDACTED_MARKER;
          values++;
        }
        if (Array.isArray(post.params)) {
          for (const param of post.params) {
            const rec = asRecord(param);
            if (!rec || typeof rec.value !== "string") continue;
            if (apply) rec.value = REDACTED_MARKER;
            values++;
          }
        }
        if (values > 0) {
          bodies++;
          bodyValues += values;
        }
      }
    }

    if (response) {
      headerValues += redactHeaderArray(response.headers, found, apply);
      cookieValues += redactCookieArray(response.cookies, apply);
    }
  }

  const credentialValues = headerValues + cookieValues;
  return {
    headerValues,
    headerNames: [...found].sort(),
    cookieValues,
    credentialValues,
    bodies,
    bodyValues,
    total: credentialValues + bodyValues,
  };
}

/**
 * Count what redaction would remove, WITHOUT copying the document.
 *
 * The viewer needs the breakdown on screen the moment a file loads; it needs
 * the redacted document only if someone clicks Download. Splitting the two
 * keeps a second full copy of a large HAR out of the tab for every reader who
 * only came to read the table. Reads the document and mutates nothing.
 */
export function scanRedactions(doc: unknown): RedactionCounts {
  return walkRedactions(doc, false);
}

/**
 * Strip credentials out of a parsed HAR and say exactly what went.
 *
 * Works on a deep copy, so the on-screen table keeps showing the real file
 * while the download carries the redacted one. `JSON.parse(JSON.stringify(…))`
 * is the right clone here and not a shortcut: the input came from `JSON.parse`
 * in the first place, so it holds nothing a JSON round trip could lose. It is
 * also the expensive step — call it when a download is asked for, not on load.
 *
 * NOT removed, and the UI is required to say so: the URL (including its query
 * string), `response.content.text`, and any credential a site chose to put
 * somewhere else. This function reports counts; it does not certify anything.
 */
export function redactHar(doc: unknown): RedactionReport {
  const clone: unknown = JSON.parse(JSON.stringify(doc));
  return { har: clone, ...walkRedactions(clone, true) };
}

/* ── Formatting helpers the UI prints ─────────────────────────────────────── */

/** `842 ms`, `1.24 s`. `null` prints as an em dash, never as zero. */
export function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** `notes.har` → `notes.redacted.har`. */
export function redactedFileName(sourceName: string): string {
  const trimmed = sourceName.trim() || "session.har";
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return `${trimmed}.redacted.har`;
  return `${trimmed.slice(0, dot)}.redacted${trimmed.slice(dot)}`;
}

/** The methods present in a file, for the filter chips. Sorted, GET first. */
export function methodsIn(entries: readonly HarEntryView[]): string[] {
  const set = new Set(entries.map((e) => e.method));
  return [...set].sort((a, b) => (a === "GET" ? -1 : b === "GET" ? 1 : a.localeCompare(b)));
}

/** The resource types present in a file, most common first. */
export function typesIn(entries: readonly HarEntryView[]): string[] {
  return summarizeHar(entries).byType.map((t) => t.label);
}
