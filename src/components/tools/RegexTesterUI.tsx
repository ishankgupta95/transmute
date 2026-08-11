"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
import { chipClass } from "@/components/workspace/shared";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { evalRegexSync, type RegexMatch } from "@/lib/tools/regex-eval";
import { evalRegexGuarded, regexRunsInline } from "@/lib/workers/regex-client";

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
  const [copied, setCopied] = useState(false);
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
    copyText(matches.map((m) => m.text).join("\n")).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [matches]);

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className="min-w-0 space-y-4">
        {/* Pattern input */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium text-text-secondary mb-1">Regex Pattern</label>
            <input
              type="text"
              value={pattern}
              onChange={(e) => handlePattern(e.target.value)}
              placeholder="[A-Za-z]+@[A-Za-z]+\.[A-Za-z]+"
              className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-muted"
            />
          </div>
        </div>

        <TextPanes columns={highlighted ? 2 : 1}>
          <TextPane label="Test String" lines={lineCount(testStr)}>
            <textarea
              value={testStr}
              onChange={(e) => handleTestStr(e.target.value)}
              placeholder="Enter text to test against..."
              aria-label="Test string"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {highlighted && (
            <TextPane tone="out" label={`Matches (${matches.length})`} lines={lineCount(testStr)}>
              <div
                data-testid="regex-highlight"
                className={TEXT_PANE_BODY}
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            </TextPane>
          )}
        </TextPanes>

        {regexError && <ErrorMessage message={regexError} />}

        {/* Capture groups */}
        {matches.some((m) => m.groups.length > 0) && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Capture Groups</label>
            <div className="space-y-1">
              {matches.map((m, i) => (
                <div key={i} className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs font-mono">
                  <span className="text-text-muted">Match {i + 1}:</span>{" "}
                  <span className="text-text-primary">&quot;{m.text}&quot;</span>
                  {m.groups.map((g, j) => (
                    <span key={j} className="ml-3 text-accent">
                      Group {j + 1}: &quot;{g}&quot;
                    </span>
                  ))}
                </div>
              ))}
            </div>
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
