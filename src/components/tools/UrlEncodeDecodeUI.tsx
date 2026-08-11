"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";

export function UrlEncodeDecodeUI() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleConvert = useCallback(
    (text: string, m: "encode" | "decode") => {
      setInput(text);
      setError("");
      setOutput("");
      if (!text.trim()) return;
      try {
        setOutput(m === "encode" ? encodeURIComponent(text) : decodeURIComponent(text));
      } catch {
        setError(m === "encode" ? "Failed to encode" : "Invalid percent-encoded string");
      }
    },
    [],
  );

  const handleModeChange = useCallback(
    (m: "encode" | "decode") => {
      setMode(m);
      if (input.trim()) handleConvert(input, m);
    },
    [input, handleConvert],
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
      {/* ── Canvas: the doc's two-up IN / OUT panes ──────────── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes columns={output ? 2 : 1}>
          <TextPane
            label={mode === "encode" ? "Text to Encode" : "URL-Encoded String"}
            lines={lineCount(input)}
          >
            <textarea
              value={input}
              onChange={(e) => handleConvert(e.target.value, mode)}
              placeholder={mode === "encode" ? "Hello World & foo=bar" : "Hello%20World%20%26%20foo%3Dbar"}
              aria-label={mode === "encode" ? "Text to encode" : "URL-encoded string"}
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
              {/* A readonly textarea, not a <pre>: the value stays selectable
                  and scrollable, and it keeps the output a form value. */}
              <textarea readOnly value={output} aria-label="Output" className={TEXT_PANE_BODY} />
            </TextPane>
          )}
        </TextPanes>

        {error && (
          <ErrorMessage message={error} />
        )}
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
        <ToolAsideSection label="DIRECTION">
          <ToolChoice
            label="Direction"
            fill
            value={mode}
            onChange={handleModeChange}
            options={[
              { value: "encode" as const, label: "Encode" },
              { value: "decode" as const, label: "Decode" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Converts as you type — nothing to run.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
