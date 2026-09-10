"use client";

import { useMemo, useState } from "react";

import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CodeBlock,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
  lineCount,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { parseUrl, rebuildWithParams, type UrlParts } from "@/lib/tools/url-parse";

/** The one field box the redesign doc specifies — same shape as the subtitle tool's. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Every part `URL` exposes, in the order they appear in the string.
 *
 * All nine are drawn whether or not they hold anything: "this URL has no port"
 * and "the port row was omitted" look identical if empties are hidden, and the
 * first is the answer to a question people come here with.
 */
const PART_ROWS: readonly { key: keyof UrlParts; label: string; note: string }[] = [
  { key: "protocol", label: "protocol", note: "Includes the colon." },
  { key: "username", label: "username", note: "Credentials embedded in the URL." },
  { key: "password", label: "password", note: "Credentials embedded in the URL." },
  { key: "hostname", label: "hostname", note: "No port. Lower-cased and Punycoded by the parser." },
  { key: "port", label: "port", note: "Empty when the scheme's default port is in use." },
  { key: "pathname", label: "pathname", note: "Dot segments already resolved." },
  { key: "search", label: "search", note: "Includes the leading question mark." },
  { key: "hash", label: "hash", note: "Includes the leading hash. Never sent to the server." },
  { key: "origin", label: "origin", note: "Scheme, host and port — the security boundary." },
];

export function UrlParserUI() {
  const [input, setInput] = useState("");
  const [baseText, setBaseText] = useState("");
  /*
    Edits are pinned to the href they were made against. When the URL in the
    left pane changes, the pin no longer matches and the table falls back to
    the freshly parsed parameters instead of showing edits made to a URL that
    is no longer on screen.
  */
  const [edits, setEdits] = useState<{ href: string; rows: { key: string; value: string }[] } | null>(
    null,
  );
  const { copied, copy } = useCopied();

  const result = useMemo(() => parseUrl(input, baseText), [input, baseText]);

  const parsedParams = result.ok ? result.params : [];
  const edited = result.ok && edits !== null && edits.href === result.parts.href;
  const rows =
    edited && edits ? edits.rows : parsedParams.map((p) => ({ key: p.key, value: p.value }));

  const rebuilt = result.ok ? rebuildWithParams(result.parts.href, rows) : "";

  /*
    Plain functions rather than `useCallback`: every one of them closes over
    `rows`, which is rebuilt on each render from the parse, and hand-written
    dependency arrays over a value like that are exactly what the React
    Compiler refuses to preserve. It memoises these itself.
  */
  const setRows = (next: { key: string; value: string }[]) => {
    if (!result.ok) return;
    setEdits({ href: result.parts.href, rows: next });
  };

  const handleParam = (index: number, field: "key" | "value", value: string) => {
    setRows(rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const handleRemoveParam = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const handleAddParam = () => {
    setRows([...rows, { key: "", value: "" }]);
  };

  const handleApply = () => {
    if (!rebuilt) return;
    setInput(rebuilt);
    setEdits(null);
  };

  const handleCopy = () => {
    void copy(rebuilt);
  };

  const handleReset = () => {
    setInput("");
    setBaseText("");
    setEdits(null);
  };

  const doubleEncoded = parsedParams.filter((p) => p.doubleEncoded);
  const malformed = parsedParams.filter((p) => p.malformed);
  const decodedPath = result.ok ? `/${result.pathSegments.join("/")}` : "";
  const pathWasEncoded = result.ok && decodedPath !== result.parts.pathname && result.pathSegments.length > 0;

  return (
    <>
      {/* ── Canvas: the URL, and every part of it ────────────────────── */}
      <div className={CANVAS_COLUMN}>
        {!result.ok && input.trim() !== "" && (
          <ErrorMessage
            message={`${result.reason}${result.needsBase && !baseText.trim() ? " The BASE URL field in the rail is where that goes." : ""}`}
          />
        )}

        {result.ok && result.normalised && (
          <WarningMessage
            message={`The parser rewrote what you typed. It returned ${result.parts.href}, which is not the string you pasted — schemes and hosts are lower-cased, a default port is dropped, dot segments are resolved, and non-ASCII is escaped. Every part below describes the rewritten URL, because that is the one a browser would actually request.`}
          />
        )}

        {result.ok && result.host.differs && (
          <WarningMessage
            message={`This hostname is internationalised. It reads as ${result.host.unicode} and goes on the wire as ${result.host.ascii} — the Punycode form is what DNS resolves and what a certificate is issued against. Two visually identical names can have different Punycode, which is how homograph lookalikes work, so compare the xn-- form rather than the pretty one.`}
          />
        )}

        {result.ok && result.hasCredentials && (
          <WarningMessage
            message={`This URL carries a username${result.parts.password ? " and a password" : ""} in the authority, before the @. They are shown below exactly as they appear in the string. Anything that logs, caches or shares this URL captures them with it — nothing here transmits them, but the URL itself does wherever it is used.`}
          />
        )}

        {doubleEncoded.length > 0 && (
          <WarningMessage
            message={`${doubleEncoded.length} ${doubleEncoded.length === 1 ? "value is" : "values are"} percent-encoded twice: ${doubleEncoded.map((p) => p.key).join(", ")}. Decoding once still leaves a %XX sequence in the result, which usually means an already-encoded URL was encoded again on its way into this one. The table shows the once-decoded value; the raw line under it is what is really in the string.`}
          />
        )}

        {malformed.length > 0 && (
          <WarningMessage
            message={`${malformed.length} ${malformed.length === 1 ? "value contains" : "values contain"} percent-encoding this browser cannot decode — a bare % or an incomplete escape. ${malformed.map((p) => p.key).join(", ")} ${malformed.length === 1 ? "is" : "are"} shown raw rather than guessed at.`}
          />
        )}

        <TextPanes columns={result.ok ? 2 : 1}>
          <TextPane
            label="URL"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setEdits(null);
              }}
              placeholder="https://user@example.com:8443/a/b?tag=x&tag=y&next=https%3A%2F%2Felsewhere#frag"
              aria-label="URL to parse"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {result.ok && (
            <TextPane
              tone="out"
              label={result.usedBase ? "Components · resolved against the base" : "Components"}
            >
              <div className="flex min-h-[12rem] flex-1 flex-col overflow-auto">
                {PART_ROWS.map((part) => {
                  const value = result.parts[part.key];
                  return (
                    <div
                      key={part.key}
                      className="flex items-baseline gap-3 border-b border-border px-3.5 py-2 last:border-b-0"
                    >
                      <span className="w-[74px] shrink-0 font-mono text-[10px] leading-none text-text-muted">
                        {part.label}
                      </span>
                      {value === "" ? (
                        <span
                          className="font-body text-[11.5px] leading-none text-text-muted italic"
                          title={part.note}
                        >
                          empty
                        </span>
                      ) : (
                        <code
                          className="min-w-0 flex-1 font-mono text-[11.5px] leading-[1.5] break-all text-neutral-200"
                          title={part.note}
                        >
                          {value}
                        </code>
                      )}
                    </div>
                  );
                })}
                {result.opaquePath && (
                  <div className="px-3.5 py-2.5 font-body text-[11px] leading-[1.5] text-text-muted">
                    This scheme has no{" "}
                    <code className="font-mono text-[11px] text-neutral-300">{"//"}</code>{" "}
                    authority, so
                    there is no host, no port and no origin — the whole payload sits in the path,
                    and the origin is the literal string{" "}
                    <code className="font-mono text-[11px] text-neutral-300">null</code>.
                  </div>
                )}
                {pathWasEncoded && (
                  <div className="px-3.5 py-2.5 font-body text-[11px] leading-[1.5] text-text-muted">
                    Path decoded:{" "}
                    <code className="font-mono text-[11px] break-all text-neutral-300">
                      {decodedPath}
                    </code>
                  </div>
                )}
              </div>
            </TextPane>
          )}
        </TextPanes>

        {result.ok && (
          <TextPanes columns={1}>
            <TextPane
              label={`Query parameters · ${rows.length}`}
              action={
                <button
                  onClick={handleAddParam}
                  aria-label="Add a query parameter"
                  className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                >
                  Add
                </button>
              }
            >
              <div className="flex flex-col">
                {rows.length === 0 && (
                  <div className="px-3.5 py-3 font-body text-[12px] leading-[1.5] text-text-muted">
                    No query string. Add a parameter above and the rebuilt URL below picks it up.
                  </div>
                )}
                {rows.map((row, i) => {
                  const source = edited ? undefined : parsedParams[i];
                  const showRaw =
                    source !== undefined &&
                    (source.rawValue !== source.value || source.rawKey !== source.key);
                  return (
                    <div key={i} className="flex flex-col gap-1.5 border-b border-border px-3.5 py-2.5 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={row.key}
                          onChange={(e) => handleParam(i, "key", e.target.value)}
                          aria-label={`Parameter ${i + 1} name`}
                          placeholder="name"
                          className={cn(FIELD_CLASS, "w-[150px]")}
                        />
                        <input
                          type="text"
                          value={row.value}
                          onChange={(e) => handleParam(i, "value", e.target.value)}
                          aria-label={`Parameter ${i + 1} value`}
                          placeholder="value"
                          className={cn(FIELD_CLASS, "min-w-[10rem] flex-1")}
                        />
                        {source?.doubleEncoded && (
                          <span className="rounded-[5px] border border-warning/40 px-1.5 py-0.5 font-mono text-[9px] leading-none text-warning">
                            DOUBLE-ENCODED
                          </span>
                        )}
                        {source?.malformed && (
                          <span className="rounded-[5px] border border-error/40 px-1.5 py-0.5 font-mono text-[9px] leading-none text-error">
                            BAD ESCAPE
                          </span>
                        )}
                        {source?.valueless && (
                          <span className="rounded-[5px] border border-border px-1.5 py-0.5 font-mono text-[9px] leading-none text-text-muted">
                            NO =
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRemoveParam(i)}
                          aria-label={`Remove parameter ${i + 1}`}
                          className="flex-none cursor-pointer font-mono text-[11px] leading-none text-text-muted transition-colors hover:text-error"
                        >
                          ✕
                        </button>
                      </div>
                      {showRaw && (
                        <span className="font-mono text-[10px] leading-[1.5] break-all text-text-muted">
                          RAW {source.rawKey}={source.rawValue}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </TextPane>
          </TextPanes>
        )}

        {result.ok && (
          <CodeBlock
            label={edited ? "Rebuilt from the edited table" : "Rebuilt URL"}
            action={
              <button
                onClick={handleApply}
                aria-label="Put the rebuilt URL back in the input"
                className="cursor-pointer font-body text-[10.5px] leading-none text-accent transition-colors hover:text-accent-hover"
              >
                Send it back up
              </button>
            }
          >
            {rebuilt}
          </CodeBlock>
        )}

        <CanvasFootnote>
          {result.ok
            ? `${rows.length} ${rows.length === 1 ? "PARAMETER" : "PARAMETERS"}${
                parsedParams.length !== new Set(parsedParams.map((p) => p.key)).size
                  ? ` · ${parsedParams.length - new Set(parsedParams.map((p) => p.key)).size} REPEATED KEY${parsedParams.length - new Set(parsedParams.map((p) => p.key)).size === 1 ? "" : "S"} KEPT AS REPEATS`
                  : ""
              } · NOTHING IS REQUESTED — THIS ONLY READS THE STRING`
            : "PARSED IN THIS TAB — NOTHING IS REQUESTED AND NOTHING IS SENT"}
        </CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel={copied ? "Copied to clipboard" : "Copy the rebuilt URL"}
            onPrimary={handleCopy}
            primaryDisabled={!rebuilt}
            onReset={handleReset}
            resetLabel="CLEAR"
          />
        }
      >
        <ToolControlGroup>
          <ToolControl label="BASE URL">
            <input
              type="text"
              value={baseText}
              onChange={(e) => setBaseText(e.target.value)}
              placeholder="https://example.com/app/"
              aria-label="Base URL"
              className={cn(FIELD_CLASS, "w-full")}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              For a reference that is not a whole URL —{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">/api/v1?page=2</code>,{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">
                {"//cdn.example.net/a.js"}
              </code>{" "}
              or{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">../b.png</code>. Left
              empty, those are reported as relative rather than parsed. An absolute URL above
              ignores this field entirely.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Parsed", input.trim() === "" ? "—" : result.ok ? "Yes" : "No"],
              ["Parameters", result.ok ? String(rows.length) : "—"],
              [
                "Host",
                result.ok
                  ? result.host.differs
                    ? "Punycoded"
                    : result.parts.hostname
                      ? "ASCII"
                      : "none"
                  : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT THIS DOES AND DOES NOT DO">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The decomposition is the browser&rsquo;s own{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">URL</code> parser, so it
            agrees with what the browser would do with the same string — including the parts it
            rewrites on the way. Repeated keys are kept as repeats, because a server that reads
            the first and a server that reads the last will disagree about the URL and collapsing
            them hides that.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Editing the table rebuilds the query with standard percent-encoding: a space comes
            back as{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">+</code>, and a character
            the original left literal may end up escaped. The result is an equivalent URL, not the
            same bytes.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Nothing is fetched, resolved or sent. No request is made to the host, no DNS lookup
            happens, and the URL never leaves this tab — this page only reads the string you typed.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
