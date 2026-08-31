"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { formatJson, minifyJson } from "@/lib/tools/json-format";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

/**
 * Where the parser stopped, read off the engine's own message.
 *
 * V8 says `… at position 7 (line 1 column 8)`; SpiderMonkey says `… at line 1
 * column 8 of the JSON data`; JavaScriptCore says only `JSON Parse error:
 * Expected '}'`. Take line/column when the engine gives them, fall back to the
 * byte offset, and return null when neither is on offer rather than guessing —
 * the doc's `LINE 1 · COL 158` readout has to be true or absent.
 */
function locateError(
  message: string,
  source: string,
): { line: number; col: number } | null {
  const lineCol = message.match(/line (\d+) column (\d+)/i);
  if (lineCol) return { line: Number(lineCol[1]), col: Number(lineCol[2]) };

  const pos = message.match(/at position (\d+)/i);
  if (!pos) return null;
  const offset = Math.min(Number(pos[1]), source.length);
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  return { line, col: offset - before.lastIndexOf("\n") };
}

export function JsonFormatterUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"format" | "minify">("format");
  const { copied, copy } = useCopied();

  const handleFormat = useCallback(
    (text: string, m: "format" | "minify") => {
      setInput(text);
      setError("");
      setOutput("");
      if (!text.trim()) return;
      try {
        // Parse for VALIDITY only. The output is a whitespace-only rewrite of
        // the raw text, so a 64-bit id survives as the digits the user pasted
        // instead of the nearest double (see lib/tools/json-format.ts).
        JSON.parse(text);
        setOutput(m === "format" ? formatJson(text) : minifyJson(text));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid JSON");
      }
    },
    [],
  );

  const handleModeChange = useCallback(
    (m: "format" | "minify") => {
      setMode(m);
      if (input.trim()) handleFormat(input, m);
    },
    [input, handleFormat],
  );

  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  const at = useMemo(
    () => (error ? locateError(error, input) : null),
    [error, input],
  );

  /** Three lines of context around the failure, offending character marked. */
  const excerpt = useMemo(() => {
    if (!at) return null;
    const lines = input.split("\n");
    const from = Math.max(0, at.line - 2);
    const to = Math.min(lines.length, at.line + 1);
    return lines.slice(from, to).map((text, i) => {
      const n = from + i + 1;
      if (n !== at.line) return { n, before: text, mark: "", after: "" };
      const i0 = Math.max(0, at.col - 1);
      return {
        n,
        before: text.slice(0, i0),
        mark: text.slice(i0, i0 + 1),
        after: text.slice(i0 + 1),
      };
    });
  }, [at, input]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={output || error ? 2 : 1}>
          <TextPane
            label="Input JSON"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
            <textarea
              value={input}
              onChange={(e) => handleFormat(e.target.value, mode)}
              placeholder='{"name": "John", "age": 30}'
              aria-label="Input JSON"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {output && (
            <TextPane
              tone="out"
              label="Output"
              lines={lineCount(output)}
              size={formatFileSize(new Blob([output]).size)}
              action={
                <button
                  onClick={handleCopy}
                  className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              }
            >
              <pre className={TEXT_PANE_BODY} aria-label="Formatted JSON">{output}</pre>
            </TextPane>
          )}

          {/*
            The doc turns the OUT pane itself into the failure report: the
            header becomes `✕ PARSE ERROR` with `LINE 1 · COL 158` on the
            right, and the body carries a bordered card plus an excerpt with
            the offending character highlighted. That is far more locatable
            than the single-line banner this used to drop under the panes.

            The card keeps `--color-error` (#e06a6a) rather than the doc's
            one-off #f0a3a3 — that token is the shared error colour across all
            67 tools and a second red would fork it.
          */}
          {!output && error && (
            <TextPane
              label="✕ Parse error"
              action={
                at && (
                  <span className="text-error">
                    LINE {at.line} · COL {at.col}
                  </span>
                )
              }
            >
              <div className="flex min-h-[12rem] flex-1 flex-col gap-2.5 overflow-auto p-3.5">
                <div
                  role="alert"
                  className="flex flex-col gap-[5px] rounded-md border border-error/35 bg-error/7 px-[13px] py-[11px]"
                >
                  <span className="font-body text-xs leading-[1.4] font-medium text-error">
                    {error}
                  </span>
                  <span className="font-body text-[11.5px] leading-[1.5] text-text-muted">
                    Everything up to the highlighted character parsed. Nothing
                    was rewritten — fix the source and the output returns.
                  </span>
                </div>
                {excerpt && (
                  <pre className="m-0 overflow-auto font-mono text-[11.5px] leading-[1.8] whitespace-pre-wrap text-neutral-400">
                    {/* `<pre>`'s content model is phrasing content, so the
                        rows are spans made block, not divs. */}
                    {excerpt.map((l) => (
                      <span key={l.n} className="block">
                        <span className="mr-3 inline-block w-6 text-right text-text-muted select-none">
                          {l.n}
                        </span>
                        {l.before}
                        {l.mark && (
                          <span className="rounded-[2px] bg-error/25 px-0.5 text-error">
                            {l.mark}
                          </span>
                        )}
                        {l.after}
                      </span>
                    ))}
                  </pre>
                )}
              </div>
            </TextPane>
          )}
        </TextPanes>
      </div>

      <ToolAside
        footer={
          output ? (
            <ToolActions
              primaryLabel={copied ? "Copied to clipboard" : "Copy output"}
              onPrimary={handleCopy}
            />
          ) : undefined
        }
      >
        <ToolAsideSection label="MODE">
          <ToolChoice
            label="Output mode"
            fill
            value={mode}
            onChange={handleModeChange}
            options={[
              { value: "format" as const, label: "Format" },
              { value: "minify" as const, label: "Minify" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Runs as you type. Errors report the exact line.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", `${input.length} chars`],
              ["Out", output ? `${output.length} chars` : "—"],
              ["Valid", input ? (error ? "No" : "Yes") : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
