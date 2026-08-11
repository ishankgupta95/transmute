"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";
import { format as formatSql } from "sql-formatter";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";

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
  const [copied, setCopied] = useState(false);

  const handleFormat = useCallback(() => {
    setError("");
    setOutput("");
    if (!input.trim()) return;
    try {
      const result = formatSql(input, {
        language: dialect,
        keywordCase: uppercase ? "upper" : "preserve",
        tabWidth: 2,
      });
      setOutput(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to format SQL");
    }
  }, [input, dialect, uppercase]);

  const handleCopy = useCallback(() => {
    copyText(output).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes columns={output ? 2 : 1}>
          <TextPane label="Input SQL" lines={lineCount(input)}>
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
            onPrimary={handleFormat}
            primaryDisabled={!input.trim()}
          />
        }
      >
        <ToolAsideSection label="DIALECT">
          <ToolChoice
            label="SQL dialect"
            value={dialect}
            onChange={setDialect}
            options={DIALECTS.map((d) => ({ value: d.value as Dialect, label: d.label }))}
          />
        </ToolAsideSection>

        <ToolAsideSection label="STYLE">
          <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
            <input
              type="checkbox"
              checked={uppercase}
              onChange={(e) => setUppercase(e.target.checked)}
              className="size-4 rounded border-border accent-accent"
            />
            Uppercase keywords
          </label>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
