"use client";

import { useCallback, useMemo, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";

interface Match {
  text: string;
  index: number;
  groups: string[];
}

export function RegexTesterUI() {
  const [pattern, setPattern] = useState("");
  const [flags, setFlags] = useState("g");
  const [testStr, setTestStr] = useState("");

  const flagSet = useMemo(() => new Set(flags.split("")), [flags]);

  const toggleFlag = useCallback(
    (flag: string) => {
      const newFlags = new Set(flagSet);
      if (newFlags.has(flag)) newFlags.delete(flag);
      else newFlags.add(flag);
      setFlags(Array.from(newFlags).join(""));
    },
    [flagSet],
  );

  const { matches, highlighted, regexError } = useMemo(() => {
    if (!pattern || !testStr) return { matches: [] as Match[], highlighted: "", regexError: "" };
    try {
      const re = new RegExp(pattern, flags);
      const found: Match[] = [];
      let m: RegExpExecArray | null;

      if (flags.includes("g")) {
        while ((m = re.exec(testStr)) !== null) {
          found.push({ text: m[0], index: m.index, groups: m.slice(1) });
          if (!m[0]) re.lastIndex++;
        }
      } else {
        m = re.exec(testStr);
        if (m) found.push({ text: m[0], index: m.index, groups: m.slice(1) });
      }

      // Build highlighted HTML
      let html = "";
      let last = 0;
      for (const match of found) {
        html += escapeHtml(testStr.slice(last, match.index));
        html += `<mark class="bg-accent/30 text-accent rounded px-0.5">${escapeHtml(match.text)}</mark>`;
        last = match.index + match.text.length;
      }
      html += escapeHtml(testStr.slice(last));

      return { matches: found, highlighted: html, regexError: "" };
    } catch (e) {
      return { matches: [] as Match[], highlighted: "", regexError: e instanceof Error ? e.message : "Invalid regex" };
    }
  }, [pattern, flags, testStr]);

  return (
    <div className="space-y-4">
      {/* Pattern input */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-sm font-medium text-text-secondary mb-1">Regex Pattern</label>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="[A-Za-z]+@[A-Za-z]+\.[A-Za-z]+"
            className="w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary font-mono placeholder:text-text-muted"
          />
        </div>
      </div>

      {/* Flags */}
      <div className="flex items-center justify-center gap-2">
        {["g", "i", "m", "s", "u"].map((f) => (
          <button
            key={f}
            onClick={() => toggleFlag(f)}
            className={`w-8 h-8 rounded-md text-sm font-mono font-medium transition-colors ${
              flagSet.has(f) ? "bg-accent text-bg-primary" : "bg-bg-elevated text-text-muted hover:bg-bg-hover"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Test string */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Test String</label>
        <textarea
          value={testStr}
          onChange={(e) => setTestStr(e.target.value)}
          placeholder="Enter text to test against..."
          rows={5}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      {regexError && <ErrorMessage message={regexError} />}

      {/* Highlighted result */}
      {highlighted && (
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            Matches ({matches.length})
          </label>
          <div
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono whitespace-pre-wrap"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </div>
      )}

      {/* Capture groups */}
      {matches.some((m) => m.groups.length > 0) && (
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Capture Groups</label>
          <div className="space-y-1">
            {matches.map((m, i) => (
              <div key={i} className="rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs font-mono">
                <span className="text-text-muted">Match {i + 1}:</span>{" "}
                <span className="text-text-primary">&quot;{m.text}&quot;</span>
                {m.groups.map((g, j) => (
                  <span key={j} className="ml-3 text-accent">
                    Group {j + 1}: &quot;{g}&quot;
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
