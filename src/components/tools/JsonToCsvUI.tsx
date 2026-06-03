"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
import { triggerDownload } from "@/lib/utils/download";

/** Flatten nested objects into dot-notation keys (address.city, etc.). */
function flatten(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      flatten(v as Record<string, unknown>, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function jsonToCsv(jsonStr: string): string {
  const data = JSON.parse(jsonStr);
  if (!Array.isArray(data) || data.length === 0) throw new Error("Input must be a non-empty JSON array");

  const flatRows: Record<string, unknown>[] = [];
  const headers = new Set<string>();
  for (const row of data) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("Each array element must be an object");
    }
    const flat = flatten(row as Record<string, unknown>);
    flatRows.push(flat);
    for (const key of Object.keys(flat)) headers.add(key);
  }
  const cols = Array.from(headers);

  const escape = (val: unknown): string => {
    let s: string;
    if (val === null || val === undefined) s = "";
    else if (typeof val === "object") s = JSON.stringify(val); // arrays
    else s = String(val);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [cols.map(escape).join(",")];
  for (const flat of flatRows) {
    lines.push(cols.map((c) => escape(flat[c])).join(","));
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
    copyText(output).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
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
