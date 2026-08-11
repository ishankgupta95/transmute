"use client";

import { useCallback, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
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
import { cn } from "@/lib/utils/cn";

export function MarkdownToHtmlUI() {
  const [input, setInput] = useState("");
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"preview" | "html">("preview");

  // Raw HTML is the tool's actual output (shown in the HTML view / copied).
  const html = input.trim() ? (marked.parse(input) as string) : "";
  // The live preview renders in our own origin, so it MUST be sanitized —
  // otherwise <script>/onerror in the user's markdown would execute as XSS.
  const safeHtml = html ? DOMPurify.sanitize(html) : "";

  const handleCopy = useCallback(() => {
    copyText(html).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [html]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes>
          <TextPane label="Markdown" lines={lineCount(input)}>
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
                className={cn(TEXT_PANE_BODY, "prose prose-invert max-w-none font-body text-sm leading-normal")}
                dangerouslySetInnerHTML={{ __html: safeHtml }}
              />
            ) : (
              <pre className={TEXT_PANE_BODY} aria-label="HTML output">{html}</pre>
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
