"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { format as formatSql } from "sql-formatter";

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
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  return (
    <div className="space-y-4">
      {/* Options row */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <select
          value={dialect}
          onChange={(e) => setDialect(e.target.value as Dialect)}
          className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary"
        >
          {DIALECTS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={uppercase}
            onChange={(e) => setUppercase(e.target.checked)}
            className="rounded border-border"
          />
          Uppercase keywords
        </label>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Input SQL</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="SELECT id, name FROM users WHERE age > 18 ORDER BY name ASC"
          rows={8}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleFormat}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          Format SQL
        </button>
      </div>

      {error && (
        <ErrorMessage message={error} />
      )}

      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">Formatted SQL</label>
            <button onClick={handleCopy} className="text-xs text-accent hover:text-accent-hover transition-colors">
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
