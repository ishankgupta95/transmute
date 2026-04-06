"use client";

import { useCallback, useMemo, useState } from "react";
import { diffLines, diffWords } from "diff";

type DiffMode = "inline" | "side-by-side";

export function TextDiffUI() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [mode, setMode] = useState<DiffMode>("inline");

  const diff = useMemo(() => {
    if (!left && !right) return [];
    return mode === "side-by-side" ? diffLines(left, right) : diffWords(left, right);
  }, [left, right, mode]);

  const handleSwap = useCallback(() => {
    setLeft(right);
    setRight(left);
  }, [left, right]);

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center justify-center gap-2">
        {(["inline", "side-by-side"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              mode === m ? "bg-accent text-bg-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {m === "inline" ? "Inline" : "Side-by-Side"}
          </button>
        ))}
        <button
          onClick={handleSwap}
          className="rounded-md px-4 py-2 text-sm font-medium bg-bg-elevated text-text-secondary hover:bg-bg-hover transition-colors"
        >
          Swap
        </button>
      </div>

      {/* Input areas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Original</label>
          <textarea
            value={left}
            onChange={(e) => setLeft(e.target.value)}
            placeholder="Paste original text..."
            rows={10}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Modified</label>
          <textarea
            value={right}
            onChange={(e) => setRight(e.target.value)}
            placeholder="Paste modified text..."
            rows={10}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
          />
        </div>
      </div>

      {/* Diff output */}
      {diff.length > 0 && (left || right) && (
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Diff</label>
          <div className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
            {diff.map((part, i) => (
              <span
                key={i}
                className={
                  part.added
                    ? "bg-success/20 text-success"
                    : part.removed
                      ? "bg-error/20 text-error line-through"
                      : "text-text-primary"
                }
              >
                {part.value}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
