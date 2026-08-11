"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
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

export function JsonFormatterUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"format" | "minify">("format");
  const [copied, setCopied] = useState(false);

  const handleFormat = useCallback(
    (text: string, m: "format" | "minify") => {
      setInput(text);
      setError("");
      setOutput("");
      if (!text.trim()) return;
      try {
        const parsed = JSON.parse(text);
        setOutput(m === "format" ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed));
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
    copyText(output).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes columns={output ? 2 : 1}>
          <TextPane label="Input JSON" lines={lineCount(input)}>
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
        </TextPanes>

        {error && <ErrorMessage message={error} />}
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
