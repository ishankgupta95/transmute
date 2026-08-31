"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { format as formatSql } from "sql-formatter";
import {
  ToolActions,
  ToolAside,
  ToolChoice,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

const DIALECTS = [
  { value: "sql", label: "Standard SQL" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "mariadb", label: "MariaDB" },
  { value: "sqlite", label: "SQLite" },
  { value: "bigquery", label: "BigQuery" },
  { value: "plsql", label: "PL/SQL" },
  { value: "transactsql", label: "T-SQL" },
] as const;

type Dialect = (typeof DIALECTS)[number]["value"];

export function SqlFormatterUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [dialect, setDialect] = useState<Dialect>("sql");
  const [uppercase, setUppercase] = useState(true);
  const { copied, copy } = useCopied();

  /*
    Parameterised so DIALECT and STYLE can re-run it the moment they change:
    a lit "PostgreSQL / lowercase" pair sitting over upper-cased standard SQL
    describes an output that was never produced.
  */
  const runFormat = useCallback((text: string, d: Dialect, upper: boolean) => {
    setError("");
    setOutput("");
    if (!text.trim()) return;
    try {
      const result = formatSql(text, {
        language: d,
        keywordCase: upper ? "upper" : "preserve",
        tabWidth: 2,
      });
      setOutput(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to format SQL");
    }
  }, []);

  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={output ? 2 : 1}>
          <TextPane
            label="Input SQL"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="SELECT id, name FROM users WHERE age > 18 ORDER BY name ASC"
              aria-label="Input SQL"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {output && (
            <TextPane
              tone="out"
              label="Formatted SQL"
              lines={lineCount(output)}
              size={formatFileSize(new Blob([output]).size)}
              action={
                <button
                  onClick={handleCopy}
                  className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              }
            >
              <pre className={TEXT_PANE_BODY} aria-label="Formatted SQL">{output}</pre>
            </TextPane>
          )}
        </TextPanes>

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <ToolActions
            primaryLabel="Format SQL"
            onPrimary={() => runFormat(input, dialect, uppercase)}
            primaryDisabled={!input.trim()}
          />
        }
      >
        {/* One bordered block for the whole control set — the doc gives its
            own rule only to START FROM, ADVANCED and OUTPUT. */}
        <ToolControlGroup>
          <ToolControl label="DIALECT">
            <ToolChoice
              label="SQL dialect"
              fill
              value={dialect}
              onChange={(d) => {
                setDialect(d);
                runFormat(input, d, uppercase);
              }}
              options={DIALECTS.map((d) => ({ value: d.value as Dialect, label: d.label }))}
            />
          </ToolControl>

          <ToolControl label="STYLE">
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={uppercase}
                onChange={(e) => {
                  setUppercase(e.target.checked);
                  runFormat(input, dialect, e.target.checked);
                }}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Uppercase keywords
            </label>
          </ToolControl>
        </ToolControlGroup>
      </ToolAside>
    </>
  );
}
