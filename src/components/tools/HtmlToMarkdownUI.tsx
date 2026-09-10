"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
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
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export function HtmlToMarkdownUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const { copied, copy } = useCopied();

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
    void copy(output);
  }, [copy, output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={output ? 2 : 1}>
          <TextPane
            label="Input HTML"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
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
              <pre
                tabIndex={0}
                role="region"
                className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                aria-label="Markdown output"
              >
                {output}
              </pre>
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
