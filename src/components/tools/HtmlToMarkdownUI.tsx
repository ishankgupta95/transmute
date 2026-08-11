"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
import TurndownService from "turndown";
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

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export function HtmlToMarkdownUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleConvert = useCallback(() => {
    setError("");
    setOutput("");
    if (!input.trim()) return;
    try {
      setOutput(turndown.turndown(input));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to convert HTML");
    }
  }, [input]);

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
          <TextPane label="Input HTML" lines={lineCount(input)}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"<h1>Hello World</h1>\n<p>This is <strong>bold</strong> and <em>italic</em>.</p>"}
              aria-label="Input HTML"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {output && (
            <TextPane
              tone="out"
              label="Markdown Output"
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
              <pre className={TEXT_PANE_BODY} aria-label="Markdown output">{output}</pre>
            </TextPane>
          )}
        </TextPanes>

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <ToolActions
            primaryLabel="Convert to Markdown"
            onPrimary={handleConvert}
            primaryDisabled={!input.trim()}
          />
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", `${input.length} chars`],
              ["Out", output ? `${output.length} chars` : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Links, images, headings and lists are preserved; inline styles are dropped.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
