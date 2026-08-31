"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
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
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

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

/** The rail's OUTPUT readout wants the shape, so the conversion reports it. */
interface JsonResult {
  json: string;
  rows: number;
  cols: number;
}

function csvToJson(csv: string): JsonResult {
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
  return { json: JSON.stringify(data, null, 2), rows: data.length, cols: headers.length };
}

export function CsvToJsonUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [shape, setShape] = useState<{ rows: number; cols: number } | null>(null);
  const [error, setError] = useState("");
  const { copied, copy } = useCopied();

  const handleConvert = useCallback(() => {
    setError("");
    setOutput("");
    setShape(null);
    if (!input.trim()) return;
    try {
      const result = csvToJson(input);
      setOutput(result.json);
      setShape({ rows: result.rows, cols: result.cols });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid CSV");
    }
  }, [input]);

  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([output], { type: "application/json" });
    triggerDownload(blob, "data.json");
  }, [output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={output ? 2 : 1}>
          <TextPane
            label="Input CSV"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={"name,age,city\nAlice,30,NYC\nBob,25,LA"}
              aria-label="Input CSV"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {output && (
            <TextPane
              tone="out"
              label="JSON Output"
              lines={lineCount(output)}
              size={formatFileSize(new Blob([output]).size)}
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
              <pre className={TEXT_PANE_BODY} aria-label="JSON output">{output}</pre>
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
              primaryLabel="Convert to JSON"
              onPrimary={handleConvert}
              primaryDisabled={!input.trim()}
            />
            {output && <ToolResetLink onClick={handleDownload} label="SAVE data.json" />}
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
            Quoted fields keep their commas and newlines; every value stays a string.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
