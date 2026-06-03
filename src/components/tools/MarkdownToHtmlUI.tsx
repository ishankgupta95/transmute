"use client";

import { useCallback, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { copyText } from "@/lib/utils/clipboard";

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
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Input */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Markdown</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={"# Hello World\n\nThis is **bold** and *italic*.\n\n- Item 1\n- Item 2"}
            rows={16}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
          />
        </div>

        {/* Output */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex gap-2">
              {(["preview", "html"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`text-sm font-medium transition-colors ${
                    view === v ? "text-accent" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {v === "preview" ? "Preview" : "HTML"}
                </button>
              ))}
            </div>
            {html && (
              <button onClick={handleCopy} className="text-xs text-accent hover:text-accent-hover transition-colors">
                {copied ? "Copied!" : "Copy HTML"}
              </button>
            )}
          </div>
          {view === "preview" ? (
            <div
              className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary prose prose-invert max-w-none min-h-[24rem] overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <pre className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono overflow-x-auto whitespace-pre-wrap min-h-[24rem] max-h-96 overflow-y-auto">
              {html}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
