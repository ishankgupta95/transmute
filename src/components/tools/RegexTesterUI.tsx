"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import {
  chipClass,
  CANVAS_COLUMN,
  MONO_LABEL,
} from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  GenList,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { evalRegexSync, type RegexMatch } from "@/lib/tools/regex-eval";
import { evalRegexGuarded, regexRunsInline } from "@/lib/workers/regex-client";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

/** What each flag letter does, for the rail's hint line. */
const FLAGS: readonly { flag: string; hint: string }[] = [
  { flag: "g", hint: "global" },
  { flag: "i", hint: "ignore case" },
  { flag: "m", hint: "multiline" },
  { flag: "s", hint: "dot matches newline" },
  { flag: "u", hint: "unicode" },
];

interface EvalState {
  matches: RegexMatch[];
  error: string;
  /** The string the matches were computed against — highlights must use it. */
  evaluated: string;
}

const EMPTY_EVAL: EvalState = { matches: [], error: "", evaluated: "" };

export function RegexTesterUI() {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [testStr, setTestStr] = useState("");
  const { copied, copy } = useCopied();
  const [evalState, setEvalState] = useState<EvalState>(EMPTY_EVAL);

  /*
    Evaluation runs in a pool worker with a hard timeout — a catastrophically
    backtracking pattern used to freeze the tab on every keystroke inside a
    useMemo. Event handlers kick it off; a run id drops stale results.
    Without Worker (jsdom) it evaluates inline, synchronously.
  */
  const runIdRef = useRef(0);
  const evaluate = useCallback((p: string, f: string, t: string) => {
    const runId = ++runIdRef.current;
    if (!p || !t) {
      setEvalState(EMPTY_EVAL);
      return;
    }
    if (regexRunsInline()) {
      const { matches, error } = evalRegexSync(p, f, t);
      setEvalState({ matches, error, evaluated: t });
      return;
    }
    void evalRegexGuarded(p, f, t).then(({ matches, error }) => {
      if (runIdRef.current === runId) setEvalState({ matches, error, evaluated: t });
    });
  }, []);

  const handlePattern = useCallback(
    (value: string) => {
      setPattern(value);
      evaluate(value, flags, testStr);
    },
    [evaluate, flags, testStr],
  );

  const handleTestStr = useCallback(
    (value: string) => {
      setTestStr(value);
      evaluate(pattern, flags, value);
    },
    [evaluate, pattern, flags],
  );

  const flagSet = useMemo(() => new Set(flags.split("")), [flags]);

  const toggleFlag = useCallback(
    (flag: string) => {
      const newFlags = new Set(flagSet);
      if (newFlags.has(flag)) newFlags.delete(flag);
      else newFlags.add(flag);
      const next = Array.from(newFlags).join("");
      setFlags(next);
      evaluate(pattern, next, testStr);
    },
    [flagSet, evaluate, pattern, testStr],
  );

  const { matches, error: regexError, evaluated } = evalState;

  const highlighted = useMemo(() => {
    if (matches.length === 0 && !evaluated) return "";
    let html = "";
    let last = 0;
    for (const match of matches) {
      html += escapeHtml(evaluated.slice(last, match.index));
      html += `<mark class="bg-accent/30 text-accent rounded px-0.5">${escapeHtml(match.text)}</mark>`;
      last = match.index + match.text.length;
    }
    html += escapeHtml(evaluated.slice(last));
    return html;
  }, [matches, evaluated]);

  const groupCount = matches.reduce((n, m) => n + m.groups.length, 0);

  const handleCopy = useCallback(() => {
    void copy(matches.map((m) => m.text).join("\n"));
  }, [copy, matches]);

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        {/* Pattern input — the tool's primary control. It stays in the canvas,
            directly above the string it filters; only its tokens change, from
            generic Tailwind sizes to the Nocturne field scale the rest of the
            dev family uses. The heading is a <span>, not a <label>: it never
            pointed at the input, so the field had no accessible name at all —
            aria-label is what supplies one now. */}
        <div className="flex flex-col">
          <span className={cn(MONO_LABEL, "mb-1.5 block tracking-[0.1em] text-text-muted")}>
            PATTERN
          </span>
          <input
            type="text"
            value={pattern}
            onChange={(e) => handlePattern(e.target.value)}
            placeholder="[A-Za-z]+@[A-Za-z]+\.[A-Za-z]+"
            aria-label="Regex pattern"
            className="h-[30px] w-full rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>

        <TextPanes columns={highlighted ? 2 : 1}>
          <TextPane
            label="Test String"
            lines={lineCount(testStr)}
            size={formatFileSize(new Blob([testStr]).size)}
          >
            <textarea
              value={testStr}
              onChange={(e) => handleTestStr(e.target.value)}
              placeholder="Enter text to test against..."
              aria-label="Test string"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {highlighted && (
            <TextPane
              tone="out"
              label={`Matches (${matches.length})`}
              lines={lineCount(testStr)}
              size={formatFileSize(new Blob([testStr]).size)}
            >
              <div
                tabIndex={0}
                role="region"
                aria-label="Match highlights"
                data-testid="regex-highlight"
                className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            </TextPane>
          )}
        </TextPanes>

        {regexError && <ErrorMessage message={regexError} />}

        {/* Capture groups — GenList is the system's list primitive; this was
            the only hand-rolled one left in the dev family. The heading labels
            a list, not a control, so it is a <span>. */}
        {matches.some((m) => m.groups.length > 0) && (
          <div className="flex flex-col">
            <span className={cn(MONO_LABEL, "mb-1.5 block tracking-[0.1em] text-text-muted")}>
              CAPTURE GROUPS
            </span>
            <GenList
              rows={matches.flatMap((m, i) =>
                // An optional group that did not participate is `undefined` —
                // show the em dash rather than an empty row.
                m.groups.map((g, j) => ({ value: g ?? "—", meta: `M${i + 1} · G${j + 1}` })),
              )}
            />
          </div>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          matches.length > 0 ? (
            <ToolActions
              primaryLabel={copied ? "Copied to clipboard" : "Copy all hits"}
              onPrimary={handleCopy}
            />
          ) : undefined
        }
      >
        <ToolAsideSection label="FLAGS">
          {/* Flags are a multi-select, so these are toggles rather than a ToolChoice. */}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Regex flags">
            {FLAGS.map(({ flag, hint }) => (
              <button
                key={flag}
                type="button"
                onClick={() => toggleFlag(flag)}
                aria-pressed={flagSet.has(flag)}
                title={hint}
                className={chipClass(flagSet.has(flag), "size-8 font-mono text-sm")}
              >
                {flag}
              </button>
            ))}
          </div>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {FLAGS.filter(({ flag }) => flagSet.has(flag))
              .map(({ flag, hint }) => `${flag} — ${hint}`)
              .join(" · ") || "No flags: first match only, case sensitive."}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Hits", pattern && testStr ? String(matches.length) : "—"],
              ["Captures", pattern && testStr ? String(groupCount) : "—"],
              ["Pattern", pattern ? `/${pattern}/${flags}` : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
