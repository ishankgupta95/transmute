"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN, SCROLL_CLASS } from "@/components/workspace/shared";
import { getToolBySlug } from "@/data/tools";
import { cn } from "@/lib/utils/cn";
import { triggerDownload } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  HarError,
  REDACTED_MARKER,
  REDACT_HEADER_NAMES,
  filterEntries,
  formatMs,
  isSensitiveHeader,
  methodsIn,
  parseHar,
  redactHar,
  redactedFileName,
  scanRedactions,
  sortEntries,
  summarizeHar,
  typesIn,
  type HarEntryView,
  type HarFile,
  type HarHeader,
  type HarSummary,
  type RedactionCounts,
  type SortKey,
  type StatusClass,
} from "@/lib/tools/har";

const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * How many rows are drawn.
 *
 * A single-page-app session recording runs to several thousand entries, and
 * every row is a DOM node with six children. The filter is the answer, and the
 * footnote says how many rows the cap is hiding rather than pretending the
 * list is the whole file.
 */
const ROW_LIMIT = 300;

/*
  The zone's default line is "NO SIZE CAP", and this page has no business
  printing it. Reading a HAR is `file.text()` — one JS string of the whole file,
  which V8 refuses outright above ~512 MB — and the page then holds the parsed
  document and the entry views beside it. Measured on a Chrome-shaped 33.6 MB
  capture (12 000 entries, node --expose-gc, heap after a forced collection):

    source text held                      33.6 MB   1.00x
    + parsed document and entry views    114.5 MB   3.41x
    + the redacted clone, when exported  165.3 MB   4.93x
    + the pretty-printed export string   223.0 MB   6.65x

  The last two are now built inside the download handler and dropped again, so
  a reader who never exports pays 3.4x rather than 6.7x — but 3.4x of a file
  with no cap on it is still a ceiling, and the sentence says so. Nothing is
  compared against `file.size`; this is a disclosure, not a limit.
*/
const PRACTICAL_LIMIT_NOTE = getToolBySlug("har-viewer")?.practicalLimitNote;

const GRID = "grid grid-cols-[58px_52px_minmax(0,1fr)_86px_78px_72px] items-center gap-3";

const STATUS_FILTERS: readonly { value: StatusClass | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "2xx", label: "2xx" },
  { value: "3xx", label: "3xx" },
  { value: "4xx", label: "4xx" },
  { value: "5xx", label: "5xx" },
];

const COLUMNS: readonly { key: SortKey; label: string; align?: "right" }[] = [
  { key: "method", label: "METHOD" },
  { key: "status", label: "CODE" },
  { key: "url", label: "URL" },
  { key: "type", label: "TYPE" },
  { key: "size", label: "SIZE", align: "right" },
  { key: "time", label: "TIME", align: "right" },
];

/** Status colour, so a wall of rows reads at a glance. */
function statusTone(entry: HarEntryView): string {
  switch (entry.statusClass) {
    case "2xx":
      return "text-success";
    case "3xx":
      return "text-neutral-300";
    case "4xx":
    case "5xx":
      return "text-error";
    default:
      return "text-text-muted";
  }
}

/** One header row in the detail panel, with the value hidden while redacting. */
function HeaderRows({ headers, hide }: { headers: HarHeader[]; hide: boolean }) {
  if (headers.length === 0) {
    return <span className="font-body text-[11.5px] text-text-muted">None recorded.</span>;
  }
  return (
    <div className="flex flex-col gap-1">
      {headers.map((h, i) => {
        const masked = hide && isSensitiveHeader(h.name);
        return (
          <div key={`${h.name}-${i}`} className="flex gap-2 font-mono text-[11px] leading-[1.6]">
            <span className="w-[38%] flex-none break-all text-text-muted">{h.name}</span>
            <span className={cn("min-w-0 break-all", masked ? "text-warning" : "text-neutral-300")}>
              {masked ? REDACTED_MARKER : h.value || "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * What TOTAL TIME actually is, for this file.
 *
 * The page used to end this paragraph with "requests overlap, so it is longer
 * than the wall clock" — an unconditional claim about the reader's file that is
 * false whenever the session sat idle, which is most of them. A "preserve log"
 * capture over a five-minute debugging session sums a few seconds of request
 * time across 300 s, and the repo's own four-entry fixture sums 1.39 s across a
 * 3.00 s recording. Both figures are already in `HarSummary`, so the comparison
 * is derived and the explanation is picked from its sign.
 *
 * The comparison is only made when every entry carries a parsable
 * `startedDateTime`: a span computed from some of the entries is not the length
 * of the recording, and saying it was would be the same class of mistake.
 */
export function timingSentence(summary: HarSummary): string {
  if (summary.timedEntries === 0) {
    return "No request in this file reported a duration — the HAR writes -1 for unknown — so there is no total time to show.";
  }
  const covered =
    summary.timedEntries === summary.count
      ? "Total time adds up each request’s own duration"
      : `Total time adds up the ${summary.timedEntries} of ${summary.count} requests that reported a duration`;

  const span = summary.wallClockMs;
  if (span === null || summary.timestampedEntries !== summary.count) {
    return `${covered}, so it is neither the wall clock nor a page-load time.`;
  }
  const across = `: ${formatMs(summary.totalTimeMs)} of request time across a ${formatMs(span)} recording`;
  // A millisecond of slack, because both figures are rounded to print.
  if (summary.totalTimeMs - span > 1) {
    return `${covered}${across} — requests overlapped, so the durations add up to more than the clock.`;
  }
  if (span - summary.totalTimeMs > 1) {
    return `${covered}${across} — the rest of that span was idle, not spent waiting on these requests.`;
  }
  return `${covered}${across}.`;
}

/**
 * What redaction found, worded as what it is.
 *
 * The old sentence led with `total` — headers + cookies + BODIES — under the
 * noun "credential values", so a recording of forty anonymous POSTs announced
 * "40 credential values" two clauses before its own breakdown said zero header
 * values and zero cookie values. Only the header and cookie matches are matched
 * BECAUSE they look like credentials; bodies are removed whether or not they
 * hold one, and that is a separate sentence.
 */
export function redactionSentence(counts: RedactionCounts): string {
  const cred = counts.credentialValues;
  const credPart =
    cred === 0
      ? "No credential header or cookie value was found in this recording."
      : `This recording carries ${cred.toLocaleString()} credential ${cred === 1 ? "value" : "values"}: ${counts.headerValues.toLocaleString()} header ${counts.headerValues === 1 ? "value" : "values"}${counts.headerNames.length > 0 ? ` (${counts.headerNames.join(", ")})` : ""} and ${counts.cookieValues.toLocaleString()} cookie ${counts.cookieValues === 1 ? "value" : "values"}.`;
  const bodyPart =
    counts.bodies === 0
      ? ""
      : ` Redaction ${cred === 0 ? "still" : "also"} replaces the ${counts.bodies.toLocaleString()} request ${counts.bodies === 1 ? "body" : "bodies"} here — ${counts.bodyValues.toLocaleString()} ${counts.bodyValues === 1 ? "value" : "values"} — whether or not ${counts.bodies === 1 ? "it holds" : "they hold"} a credential, because nothing on this page can tell a login form from an analytics ping.`;
  return `${credPart}${bodyPart} Nothing has left this tab. Use the redact control before you send this file to anyone.`;
}

function DetailSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-text-muted">
        {label}
      </span>
      {children}
    </div>
  );
}

export function HarViewerUI() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [har, setHar] = useState<HarFile | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const [statusClass, setStatusClass] = useState<StatusClass | "all">("all");
  const [method, setMethod] = useState("all");
  const [resourceType, setResourceType] = useState("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("index");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<number | null>(null);
  const [redact, setRedact] = useState(true);

  /*
    `text()` is async, so a slow first read can resolve after a second file has
    replaced it. Every load and every reset bumps the token; a stale read drops
    its result rather than showing one file's requests under another's name.
  */
  const loadToken = useRef(0);

  const handleFiles = useCallback(async (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    const token = ++loadToken.current;
    setFile(picked);
    setHar(null);
    setSource(null);
    setParseError(null);
    setSelected(null);
    setStatusClass("all");
    setMethod("all");
    setResourceType("all");
    setQuery("");
    try {
      const text = await picked.text();
      if (loadToken.current !== token) return;
      setSource(text);
      setHar(parseHar(text));
    } catch (err) {
      if (loadToken.current !== token) return;
      setParseError(
        err instanceof HarError
          ? err.message
          : err instanceof Error
            ? `This file could not be read: ${err.message}`
            : "This file could not be read.",
      );
    }
  }, []);

  const handleReset = useCallback(() => {
    loadToken.current++;
    setFile(null);
    setSource(null);
    setHar(null);
    setParseError(null);
    setSelected(null);
  }, []);

  // Memoised for identity, not for cost: `har?.entries ?? []` allocates a
  // fresh empty array on every render, which would re-run every memo below it
  // (and re-sort the whole table) on any keystroke in the filter box.
  const entries = useMemo(() => har?.entries ?? [], [har]);
  const summary = useMemo(() => summarizeHar(entries), [entries]);
  const methods = useMemo(() => methodsIn(entries), [entries]);
  const types = useMemo(() => typesIn(entries), [entries]);

  const filtered = useMemo(
    () => filterEntries(entries, { statusClass, method, resourceType, query }),
    [entries, statusClass, method, resourceType, query],
  );
  const sorted = useMemo(
    () => sortEntries(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir],
  );
  const rows = sorted.slice(0, ROW_LIMIT);

  /*
    Counting is a read-only walk (`scanRedactions`); REDACTING copies the whole
    document. This page needs the counts the instant a file loads and the copy
    only if someone downloads, so the copy is built in the click handler below
    and dropped again — see the measurement block at the top of this file.
  */
  const redaction = useMemo(() => (har ? scanRedactions(har.raw) : null), [har]);

  /*
    The card describes the row you clicked, so it is looked up in the rows that
    are actually DRAWN. Looking it up in `entries` left the card on screen under
    a table the filter had emptied of it — a 200 for /index.html sitting below
    "3 OF 412 REQUESTS MATCH" in a 5xx-only list, with no highlighted row.
  */
  const detail = selected === null ? null : (rows.find((e) => e.index === selected) ?? null);

  const handleDownload = useCallback(() => {
    if (!har || !source) return;
    const name = file?.name ?? "session.har";
    if (!redact) {
      triggerDownload(new Blob([source], { type: "application/json" }), name);
      return;
    }
    // Both the clone and the string it serialises to are locals: they are
    // garbage the moment the Blob has copied the bytes.
    const { har: redacted } = redactHar(har.raw);
    triggerDownload(
      new Blob([JSON.stringify(redacted, null, 2)], { type: "application/json" }),
      redactedFileName(name),
    );
  }, [har, source, file, redact]);

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      // Size and time are asked about in one direction: biggest and slowest
      // first. Alphabetical columns are asked about in the other.
      setSortDir(key === "size" || key === "time" ? "desc" : "asc");
    },
    [sortKey],
  );

  const detailTotal = detail ? detail.timings.reduce((sum, t) => sum + t.ms, 0) : 0;

  return (
    <>
      {/* ── Canvas: the request table, then one request in full ────────── */}
      <div className={CANVAS_COLUMN}>
        {!file ? (
          <DropZone
            accept=".har,.json"
            onFiles={handleFiles}
            label="Drop a HAR file — it is read in this tab and never uploaded"
            acceptLabel="HAR JSON"
            practicalLimitNote={PRACTICAL_LIMIT_NOTE}
          />
        ) : (
          <>
            <CanvasHeader
              file={file.name}
              meta={`${formatFileSize(file.size)}${har?.creator ? ` · ${har.creator}` : ""}`}
              trailing={
                har
                  ? `${summary.count.toLocaleString()} ${summary.count === 1 ? "REQUEST" : "REQUESTS"}`
                  : undefined
              }
            />

            {parseError && <ErrorMessage message={parseError} />}

            {har && redaction && redaction.total > 0 && (
              <WarningMessage message={redactionSentence(redaction)} />
            )}

            {har && (
              <>
                <StatStrip
                  stats={[
                    { label: "REQUESTS", value: summary.count.toLocaleString(), tone: "neutral" },
                    {
                      label: "TRANSFERRED",
                      value:
                        summary.sizedEntries > 0
                          ? formatFileSize(summary.transferBytes)
                          : "NOT RECORDED",
                    },
                    {
                      // Same treatment as TRANSFERRED beside it. `formatMs`
                      // refuses to print 0 for an unknown; summing nothing and
                      // handing it a real 0 defeated that, so a recording whose
                      // entries all report time -1 claimed "0 ms".
                      label: "TOTAL TIME",
                      value:
                        summary.timedEntries > 0
                          ? formatMs(summary.totalTimeMs)
                          : "NOT RECORDED",
                      tone: "neutral",
                    },
                    {
                      label: "SLOWEST",
                      value: summary.slowest ? formatMs(summary.slowest.timeMs) : "—",
                    },
                  ]}
                />

                <div className="flex flex-col overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary">
                  <div className={cn("overflow-x-auto", SCROLL_CLASS)}>
                    <div className="min-w-[620px]">
                      <div
                        className={cn(
                          GRID,
                          "border-b border-border px-3.5 py-[9px] font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-text-muted",
                        )}
                      >
                        {COLUMNS.map((col) => (
                          <button
                            key={col.key}
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            aria-label={`Sort by ${col.label.toLowerCase()}`}
                            className={cn(
                              "cursor-pointer truncate tracking-[0.1em] transition-colors hover:text-accent-200",
                              col.align === "right" && "text-right",
                              sortKey === col.key && "text-accent-300",
                            )}
                          >
                            {col.label}
                            {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                          </button>
                        ))}
                      </div>

                      <div className={cn("max-h-[26rem] overflow-y-auto", SCROLL_CLASS)}>
                        {rows.map((entry) => (
                          <button
                            key={entry.index}
                            type="button"
                            onClick={() =>
                              setSelected((s) => (s === entry.index ? null : entry.index))
                            }
                            aria-pressed={selected === entry.index}
                            className={cn(
                              GRID,
                              "w-full cursor-pointer border-b border-text-primary/6 px-3.5 py-[9px] text-left font-body text-xs leading-none transition-colors last:border-b-0 hover:bg-text-primary/4",
                              selected === entry.index && "bg-accent/8",
                            )}
                          >
                            <span className="font-mono text-[10.5px] text-text-muted">
                              {entry.method}
                            </span>
                            <span className={cn("font-mono text-[10.5px]", statusTone(entry))}>
                              {entry.status === 0 ? "—" : entry.status}
                            </span>
                            <span className="min-w-0 truncate text-neutral-300">
                              {entry.path || entry.url}
                              {entry.host && (
                                <span className="text-text-muted"> · {entry.host}</span>
                              )}
                            </span>
                            <span className="truncate font-mono text-[10px] text-text-muted">
                              {entry.resourceType}
                            </span>
                            <span className="text-right font-mono text-[10.5px] text-accent-300">
                              {entry.transferBytes === null
                                ? "—"
                                : formatFileSize(entry.transferBytes)}
                            </span>
                            <span className="text-right font-mono text-[10.5px] text-text-muted">
                              {formatMs(entry.timeMs)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <CanvasFootnote>
                  {sorted.length > ROW_LIMIT
                    ? `SHOWING ${ROW_LIMIT} OF ${sorted.length.toLocaleString()} MATCHING REQUESTS — NARROW THE FILTER TO SEE THE REST`
                    : `${sorted.length.toLocaleString()} OF ${summary.count.toLocaleString()} REQUESTS MATCH — SELECT A ROW FOR HEADERS, QUERY STRING, BODY AND TIMINGS`}
                </CanvasFootnote>

                {detail && (
                  <div
                    className={cn(
                      "flex max-h-[30rem] flex-col gap-3.5 overflow-y-auto rounded-[10px] border border-neutral-800 bg-nocturne-sunken p-3.5",
                      SCROLL_CLASS,
                    )}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-[11px] leading-none font-medium text-accent-300">
                        {detail.method} {detail.status === 0 ? "(no response)" : detail.status}{" "}
                        {detail.statusText}
                      </span>
                      <span className="font-mono text-[10.5px] leading-none text-text-muted">
                        {detail.httpVersion || "http version not recorded"}
                        {detail.serverIPAddress ? ` · ${detail.serverIPAddress}` : ""}
                        {detail.startedDateTime ? ` · ${detail.startedDateTime}` : ""}
                      </span>
                    </div>
                    <p className="m-0 font-mono text-[11px] leading-[1.6] break-all text-neutral-300">
                      {detail.url}
                    </p>

                    {detail.timings.length > 0 && (
                      <DetailSection label="TIMINGS">
                        <div className="flex flex-col gap-1">
                          {detail.timings.map((t) => (
                            <div key={t.label} className="flex items-center gap-2.5">
                              <span className="w-[62px] flex-none font-mono text-[10.5px] text-text-muted">
                                {t.label}
                              </span>
                              <span className="h-[3px] flex-1 overflow-hidden rounded-[2px] bg-neutral-800">
                                <span
                                  className="block h-full rounded-[2px] bg-accent"
                                  style={{
                                    width: `${detailTotal > 0 ? (t.ms / detailTotal) * 100 : 0}%`,
                                  }}
                                />
                              </span>
                              <span className="w-[64px] flex-none text-right font-mono text-[10.5px] text-neutral-300">
                                {formatMs(t.ms)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </DetailSection>
                    )}

                    {detail.queryString.length > 0 && (
                      <DetailSection label="QUERY STRING (NEVER REDACTED)">
                        <HeaderRows headers={detail.queryString} hide={false} />
                      </DetailSection>
                    )}

                    <DetailSection label="REQUEST HEADERS">
                      <HeaderRows headers={detail.requestHeaders} hide={redact} />
                    </DetailSection>

                    {detail.postData && (
                      <DetailSection label={`REQUEST BODY · ${detail.postData.mimeType || "unknown type"}`}>
                        <pre className="m-0 max-h-40 overflow-auto font-mono text-[11px] leading-[1.6] break-words whitespace-pre-wrap text-neutral-300">
                          {redact ? REDACTED_MARKER : detail.postData.text || "(empty)"}
                        </pre>
                      </DetailSection>
                    )}

                    <DetailSection label="RESPONSE HEADERS">
                      <HeaderRows headers={detail.responseHeaders} hide={redact} />
                    </DetailSection>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Controls ──────────────────────────────────────────────────── */}
      <ToolAside
        footer={
          /*
            One ToolActions, and the export is built inside its handler rather
            than on load: the reader who only came to read the table never pays
            for the redacted clone or the string it serialises to.
          */
          har && source ? (
            <ToolActions
              primaryLabel={redact ? "Download redacted copy" : "Download this file unchanged"}
              onPrimary={handleDownload}
              onReset={handleReset}
              resetLabel="CHANGE FILE"
            />
          ) : file ? (
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          ) : null
        }
      >
        {har ? (
          <>
            <ToolControlGroup>
              <ToolControl label="STATUS">
                <ToolChoice
                  label="Filter by status class"
                  value={statusClass}
                  onChange={setStatusClass}
                  options={STATUS_FILTERS}
                />
              </ToolControl>

              <ToolControl label="METHOD">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  aria-label="Filter by method"
                  className={cn(FIELD_CLASS, "w-full")}
                >
                  <option value="all">Every method</option>
                  {methods.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </ToolControl>

              <ToolControl label="TYPE">
                <select
                  value={resourceType}
                  onChange={(e) => setResourceType(e.target.value)}
                  aria-label="Filter by resource type"
                  className={cn(FIELD_CLASS, "w-full")}
                >
                  <option value="all">Every type</option>
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  Chrome and Edge record the type themselves. Firefox and curl-converted HARs do
                  not, and the type is read off the response MIME type instead.
                </span>
              </ToolControl>

              <ToolControl label="URL CONTAINS">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="/api/"
                  aria-label="Filter by URL substring"
                  className={cn(FIELD_CLASS, "w-full")}
                />
              </ToolControl>
            </ToolControlGroup>

            <ToolAsideSection label="REDACT BEFORE SHARING">
              <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
                <input
                  type="checkbox"
                  checked={redact}
                  onChange={(e) => setRedact(e.target.checked)}
                  className="size-4 rounded-sm border-border accent-accent"
                />
                Strip credentials from the download
              </label>
              <ToolOutput
                rows={[
                  [
                    "Header values",
                    redaction ? redaction.headerValues.toLocaleString() : "—",
                  ],
                  ["Cookie values", redaction ? redaction.cookieValues.toLocaleString() : "—"],
                  ["Request bodies", redaction ? redaction.bodies.toLocaleString() : "—"],
                ]}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Removed by name: {REDACT_HEADER_NAMES.join(", ")} — plus any header whose name
                contains token, secret, api-key or session, every value in the request and
                response{" "}
                <code className="font-mono text-[10.5px] text-neutral-300">cookies</code> arrays,
                and the whole request body.
              </span>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                This is not the same as safe. URLs and query strings are left exactly as recorded,
                and so are response bodies — a token in{" "}
                <code className="font-mono text-[10.5px] text-neutral-300">?access_token=</code>{" "}
                or in a JSON login response survives redaction untouched. Read the file before you
                send it.
              </span>
            </ToolAsideSection>

            <ToolAsideSection label="SUMMARY">
              <ToolOutput
                rows={[
                  ["Showing", `${sorted.length.toLocaleString()} of ${summary.count.toLocaleString()}`],
                  [
                    "By status",
                    summary.byStatusClass.map((s) => `${s.label} ${s.count}`).join(" · ") || "—",
                  ],
                  [
                    "Sizes recorded",
                    `${summary.sizedEntries} of ${summary.count}`,
                  ],
                  [
                    "Times recorded",
                    `${summary.timedEntries} of ${summary.count}`,
                  ],
                ]}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                {summary.unsizedEntries > 0
                  ? `${summary.unsizedEntries} ${summary.unsizedEntries === 1 ? "request reports" : "requests report"} no transfer size (the HAR writes -1 for unknown), so the total above is the sum of the ${summary.sizedEntries} that do. Cached and blocked requests are the usual reason.`
                  : "Every request in this file reported its transfer size, so the total is the whole recording."}{" "}
                {timingSentence(summary)}
              </span>
            </ToolAsideSection>
          </>
        ) : (
          <ToolAsideSection label="WHY LOCALLY">
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              A HAR is a verbatim recording of a browsing session:{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">Cookie</code> and{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">Authorization</code>{" "}
              headers, session tokens, API keys and the body of every POST, including the one from
              the login form. Uploading one to a hosted viewer hands all of that to a stranger.
              This page parses it in the tab; the filters, the table and the redacted export are
              all built here.
            </span>
          </ToolAsideSection>
        )}
      </ToolAside>
    </>
  );
}
