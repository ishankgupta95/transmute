"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { triggerDownload } from "@/lib/utils/download";

function jsonToCsv(jsonStr: string): string {
  const data = JSON.parse(jsonStr);
  if (!Array.isArray(data) || data.length === 0) throw new Error("Input must be a non-empty JSON array");

  const headers = new Set<string>();
  for (const row of data) {
    if (typeof row !== "object" || row === null) throw new Error("Each array element must be an object");
    for (const key of Object.keys(row)) headers.add(key);
  }
  const cols = Array.from(headers);

  const escape = (val: unknown): string => {
    const s = val === null || val === undefined ? "" : String(val);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [cols.map(escape).join(",")];
  for (const row of data) {
    lines.push(cols.map((c) => escape((row as Record<string, unknown>)[c])).join(","));
  }
  return lines.join("\n");
}

export function JsonToCsvUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleConvert = useCallback(() => {
    setError("");
    setOutput("");
    if (!input.trim()) return;
    try {
      setOutput(jsonToCsv(input));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid input");
    }
  }, [input]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([output], { type: "text/csv" });
    triggerDownload(blob, "data.csv");
  }, [output]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Input JSON Array</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='[{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]'
          rows={8}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleConvert}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          Convert to CSV
        </button>
      </div>

      {error && (
        <ErrorMessage message={error} />
      )}

      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">CSV Output</label>
            <div className="flex gap-2">
              <button onClick={handleCopy} className="text-xs text-accent hover:text-accent-hover transition-colors">
                {copied ? "Copied!" : "Copy"}
              </button>
              <button onClick={handleDownload} className="text-xs text-accent hover:text-accent-hover transition-colors">
                Download
              </button>
            </div>
          </div>
          <pre className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
