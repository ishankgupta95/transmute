"use client";

import { useCallback, useMemo, useState } from "react";
import { diffLines, diffWords } from "diff";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";

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

  const added = diff.filter((p) => p.added).length;
  const removed = diff.filter((p) => p.removed).length;

  return (
    <>
      {/* ── Canvas: what you look at ─────────────────────────── */}
      <div className="min-w-0 space-y-[13px]">
        <TextPanes>
          <TextPane label="Original" lines={lineCount(left)}>
            <textarea
              value={left}
              onChange={(e) => setLeft(e.target.value)}
              placeholder="Paste original text..."
              aria-label="Original text"
              className={TEXT_PANE_BODY}
            />
          </TextPane>
          <TextPane label="Modified" lines={lineCount(right)}>
            <textarea
              value={right}
              onChange={(e) => setRight(e.target.value)}
              placeholder="Paste modified text..."
              aria-label="Modified text"
              className={TEXT_PANE_BODY}
            />
          </TextPane>
        </TextPanes>

        {diff.length > 0 && (left || right) && (
          <TextPanes columns={1}>
            <TextPane tone="out" label="Diff" lines={added + removed}>
              <div className={TEXT_PANE_BODY}>
                {diff.map((part, i) => (
                  <span
                    key={i}
                    className={
                      part.added
                        ? "bg-success/20 text-success"
                        : part.removed
                          ? "bg-error/20 text-error line-through"
                          : "text-neutral-300"
                    }
                  >
                    {part.value}
                  </span>
                ))}
              </div>
            </TextPane>
          </TextPanes>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <ToolActions
            primaryLabel="Swap"
            onPrimary={handleSwap}
            primaryDisabled={!left && !right}
          />
        }
      >
        <ToolAsideSection label="GRANULARITY">
          <ToolChoice
            label="Diff granularity"
            fill
            value={mode}
            onChange={setMode}
            options={[
              { value: "inline" as const, label: "Inline" },
              { value: "side-by-side" as const, label: "Side-by-Side" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {mode === "inline"
              ? "Word by word — best for prose."
              : "Line by line — best for code and config."}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Insertions", left || right ? String(added) : "—"],
              ["Deletions", left || right ? String(removed) : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
