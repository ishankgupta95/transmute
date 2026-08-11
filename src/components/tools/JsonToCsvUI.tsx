"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
import { triggerDownload } from "@/lib/utils/download";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";

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

/** The rail's OUTPUT readout wants the shape, so the conversion reports it. */
interface CsvResult {
  csv: string;
  rows: number;
  cols: number;
}

function jsonToCsv(jsonStr: string): CsvResult {
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
  return { csv: lines.join("\n"), rows: flatRows.length, cols: cols.length };
}

export function JsonToCsvUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [shape, setShape] = useState<{ rows: number; cols: number } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleConvert = useCallback(() => {
    setError("");
    setOutput("");
    setShape(null);
    if (!input.trim()) return;
    try {
      const result = jsonToCsv(input);
      setOutput(result.csv);
      setShape({ rows: result.rows, cols: result.cols });
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
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes columns={output ? 2 : 1}>
          <TextPane label="Input JSON Array" lines={lineCount(input)}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='[{"name": "Alice", "age": 30}, {"name": "Bob", "age": 25}]'
              aria-label="Input JSON array"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {output && (
            <TextPane
              tone="out"
              label="CSV Output"
              lines={lineCount(output)}
              action={
                <>
                  <button onClick={handleCopy} className="cursor-pointer text-accent transition-colors hover:text-accent-hover">
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button onClick={handleDownload} className="cursor-pointer text-accent transition-colors hover:text-accent-hover">
                    Download
                  </button>
                </>
              }
            >
              <pre className={TEXT_PANE_BODY} aria-label="CSV output">{output}</pre>
            </TextPane>
          )}
        </TextPanes>

        {error && (
          <ErrorMessage message={error} />
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            <ToolActions
              primaryLabel="Convert to CSV"
              onPrimary={handleConvert}
              primaryDisabled={!input.trim()}
            />
            {output && <ToolResetLink onClick={handleDownload} label="SAVE data.csv" />}
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Rows", shape ? String(shape.rows) : "—"],
              ["Columns", shape ? String(shape.cols) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Nested objects flatten to dot-notation columns; arrays are kept as JSON in the cell.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
