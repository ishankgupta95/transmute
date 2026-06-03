"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";

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
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center justify-center gap-2">
        {(["format", "minify"] as const).map((m) => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              mode === m
                ? "bg-accent text-bg-primary"
                : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {m === "format" ? "Format" : "Minify"}
          </button>
        ))}
      </div>

      {/* Input */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Input JSON</label>
        <textarea
          value={input}
          onChange={(e) => handleFormat(e.target.value, mode)}
          placeholder='{"name": "John", "age": 30}'
          rows={8}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      {/* Error */}
      {error && <ErrorMessage message={error} />}

      {/* Output */}
      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">Output</label>
            <button
              onClick={handleCopy}
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
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
