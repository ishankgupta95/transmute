"use client";

import { useCallback, useState } from "react";
import TurndownService from "turndown";

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
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Input HTML</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={"<h1>Hello World</h1>\n<p>This is <strong>bold</strong> and <em>italic</em>.</p>"}
          rows={8}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleConvert}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          Convert to Markdown
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      )}

      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">Markdown Output</label>
            <button onClick={handleCopy} className="text-xs text-accent hover:text-accent-hover transition-colors">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
