"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
import { triggerDownload } from "@/lib/utils/download";

/**
 * Single-pass CSV parser. Tracks quote state across the whole string so quoted
 * fields containing commas or newlines parse correctly, and normalizes CRLF /
 * CR / LF line endings (Excel/Windows exports use \r\n).
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++; // CRLF
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function csvToJson(csv: string): string {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c !== ""));
  if (rows.length < 2) throw new Error("CSV must have a header row and at least one data row");

  const headers = rows[0];
  const data = rows.slice(1).map((values) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => {
      obj[h] = values[j] ?? "";
    });
    return obj;
  });
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
    copyText(output).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
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
        <ErrorMessage message={error} />
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
