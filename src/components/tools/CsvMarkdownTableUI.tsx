"use client";

import { useCallback, useMemo, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { ToolAside, ToolAsideSection, ToolOutput } from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";
import type { Alignment } from "@/lib/tools/markdown-table";
import {
  markdownToRows,
  parseCsv,
  rowsToCsv,
  rowsToMarkdown,
} from "@/lib/tools/markdown-table";

/** Matches the other text panes; see the note in PdfToTextUI for `outline-solid`. */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

const SAMPLE = "name,role,joined\nAda Lovelace,Analyst,1843\nGrace Hopper,Engineer,1944";

export function CsvMarkdownTableUI() {
  const [input, setInput] = useState(SAMPLE);
  const [toMarkdown, setToMarkdown] = useState(true);
  const [align, setAlign] = useState<Alignment>("left");
  const [pad, setPad] = useState(true);
  const { copied, copy } = useCopied();

  const { output, rows, columns, error } = useMemo(() => {
    try {
      if (!input.trim()) return { output: "", rows: 0, columns: 0, error: null };
      const parsed = toMarkdown ? parseCsv(input) : markdownToRows(input);
      const text = toMarkdown ? rowsToMarkdown(parsed, { align, pad }) : rowsToCsv(parsed);
      return {
        output: text,
        rows: parsed.length,
        columns: parsed.length ? Math.max(...parsed.map((r) => r.length)) : 0,
        error: null,
      };
    } catch (err) {
      return {
        output: "",
        rows: 0,
        columns: 0,
        error: err instanceof Error ? err.message : "Could not read that",
      };
    }
  }, [align, input, pad, toMarkdown]);

  const blob = useMemo(
    () => new Blob([output], { type: toMarkdown ? "text/markdown" : "text/csv" }),
    [output, toMarkdown],
  );

  const swap = useCallback(() => {
    // Swapping feeds the current OUTPUT back in, so a round trip is one click
    // and you can see immediately whether anything was lost.
    setInput(output || input);
    setToMarkdown((v) => !v);
  }, [input, output]);

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={2}>
          <TextPane
            tone="in"
            label={toMarkdown ? "CSV" : "Markdown table"}
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              aria-label={toMarkdown ? "CSV input" : "Markdown table input"}
              className={cn(TEXT_PANE_BODY, "w-full resize-none bg-transparent")}
            />
          </TextPane>
          <TextPane
            tone="out"
            label={toMarkdown ? "Markdown table" : "CSV"}
            lines={lineCount(output)}
            size={formatFileSize(blob.size)}
            action={
              output ? (
                <button
                  onClick={() => void copy(output)}
                  className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              ) : undefined
            }
          >
            <pre tabIndex={0} role="region" aria-label="Result" className={cn(TEXT_PANE_BODY, PANE_FOCUS)}>
              {output}
            </pre>
          </TextPane>
        </TextPanes>

        <CanvasFootnote>
          PIPES AND BACKSLASHES ARE ESCAPED AND LINE BREAKS BECOME &lt;br&gt; — WITHOUT THAT, ONE
          URL WITH A QUERY STRING SILENTLY ADDS A COLUMN
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          output ? (
            <DownloadButton
              blob={blob}
              fileName={toMarkdown ? "table.md" : "table.csv"}
              className="w-full justify-center"
            />
          ) : null
        }
      >
        <ToolAsideSection label="DIRECTION">
          <button
            onClick={swap}
            className="cursor-pointer self-start text-[12px] text-accent hover:text-accent-hover"
          >
            {toMarkdown ? "CSV → Markdown" : "Markdown → CSV"} · swap
          </button>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Swapping feeds the result back in, so a round trip is one click and you can see at
            once whether anything was lost.
          </span>
        </ToolAsideSection>

        {toMarkdown && (
          <ToolAsideSection label="TABLE">
            <label className="flex items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <select
                value={align}
                onChange={(e) => setAlign(e.target.value as Alignment)}
                className="rounded-sm border border-border bg-transparent px-1.5 py-1 text-[12px]"
                aria-label="Column alignment"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
              Alignment
            </label>
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={pad}
                onChange={(e) => setPad(e.target.checked)}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Line the columns up
            </label>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Padding is for reading the source and in a diff — every renderer ignores it.
            </span>
          </ToolAsideSection>
        )}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Rows", String(rows)],
              ["Columns", String(columns)],
              ["Size", formatFileSize(blob.size)],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
