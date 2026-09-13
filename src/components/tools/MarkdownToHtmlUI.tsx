"use client";

import { useCallback, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
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
import { cn } from "@/lib/utils/cn";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";
import "@/styles/prose.css";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

export function MarkdownToHtmlUI() {
  const [input, setInput] = useState("");
  const { copied, copy } = useCopied();
  const [view, setView] = useState<"preview" | "html">("preview");

  // Raw HTML is the tool's actual output (shown in the HTML view / copied).
  const html = input.trim() ? (marked.parse(input) as string) : "";
  // The live preview renders in our own origin, so it MUST be sanitized —
  // otherwise <script>/onerror in the user's markdown would execute as XSS.
  const safeHtml = html ? DOMPurify.sanitize(html) : "";

  const handleCopy = useCallback(() => {
    void copy(html);
  }, [copy, html]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes>
          <TextPane
            label="Markdown"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"# Hello World\n\nThis is **bold** and *italic*.\n\n- Item 1\n- Item 2"}
              aria-label="Markdown"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          <TextPane
            tone="out"
            label={view === "preview" ? "Preview" : "HTML"}
            lines={lineCount(html)}
            size={formatFileSize(new Blob([html]).size)}
            action={
              html ? (
                <button
                  onClick={handleCopy}
                  className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              ) : undefined
            }
          >
            {view === "preview" ? (
              <div
                tabIndex={0}
                role="region"
                aria-label="Rendered preview"
                className={cn(
                  TEXT_PANE_BODY,
                  "prose prose-invert max-w-none font-body text-sm leading-normal",
                  PANE_FOCUS,
                )}
                dangerouslySetInnerHTML={{ __html: safeHtml }}
              />
            ) : (
              <pre
                tabIndex={0}
                role="region"
                className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                aria-label="HTML output"
              >
                {html}
              </pre>
            )}
          </TextPane>
        </TextPanes>
      </div>

      <ToolAside
        footer={
          html ? (
            <ToolActions primaryLabel="Copy HTML" onPrimary={handleCopy} />
          ) : undefined
        }
      >
        <ToolAsideSection label="VIEW">
          <ToolChoice
            label="Output view"
            fill
            value={view}
            onChange={setView}
            options={[
              { value: "preview" as const, label: "Preview" },
              { value: "html" as const, label: "HTML" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The preview is sanitised; the HTML view and copy give you the raw output.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
