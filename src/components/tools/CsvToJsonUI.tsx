"use client";

import { useCallback, useState } from "react";
import { triggerDownload } from "@/lib/utils/download";

function csvToJson(csv: string): string {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) throw new Error("CSV must have a header row and at least one data row");

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseLine(lines[0]);
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseLine(lines[i]);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = values[j] ?? "";
    }
    data.push(obj);
  }
  return JSON.stringify(data, null, 2);
}

export function CsvToJsonUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleConvert = useCallback(() => {
    setError("");
    setOutput("");
    if (!input.trim()) return;
    try {
      setOutput(csvToJson(input));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid CSV");
    }
  }, [input]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([output], { type: "application/json" });
    triggerDownload(blob, "data.json");
  }, [output]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Input CSV</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={"name,age,city\nAlice,30,NYC\nBob,25,LA"}
          rows={8}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleConvert}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          Convert to JSON
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      )}

      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">JSON Output</label>
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
