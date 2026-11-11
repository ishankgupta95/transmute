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
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

/*
  The chips name the GRANULARITY, which is all this control has ever changed.
  They used to read "Inline" / "Side-by-Side" while both modes rendered the
  same single full-width combined pane — a labelled promise of a layout that
  was never built. Renaming is the honest fix; a real two-column diff is a
  feature, not a defect.
*/
type DiffMode = "words" | "lines";

export function TextDiffUI() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [mode, setMode] = useState<DiffMode>("words");

  const diff = useMemo(() => {
    if (!left && !right) return [];
    /*
      `ignoreNewlineAtEof`: jsdiff keeps each line's "\n" in its token, so a
      last line with no newline ("gamma") and the same line followed by more
      text ("gamma\n") are different tokens — "alpha\nbeta\ngamma" against
      "alpha\nBETA\ngamma\ndelta" showed the untouched "gamma" as removed and
      re-added (found 2026-11-11, pinned in e2e/dev/utilities-correctness).
      The cost: texts that differ ONLY by a final newline compare equal, the
      usual behaviour for a pasted-text diff.
    */
    return mode === "lines"
      ? diffLines(left, right, { ignoreNewlineAtEof: true })
      : diffWords(left, right);
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
      <div className={CANVAS_COLUMN}>
        <TextPanes>
          <TextPane
            label="Original"
            lines={lineCount(left)}
            size={formatFileSize(new Blob([left]).size)}
          >
            <textarea
              value={left}
              onChange={(e) => setLeft(e.target.value)}
              placeholder="Paste original text..."
              aria-label="Original text"
              className={TEXT_PANE_BODY}
            />
          </TextPane>
          <TextPane
            label="Modified"
            lines={lineCount(right)}
            size={formatFileSize(new Blob([right]).size)}
          >
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
            {/* `added + removed` counts diff PARTS, not lines — under a
                header that says "N LINES" that was a third, unrelated
                number. Count the rendered text instead. */}
            <TextPane
              tone="out"
              label="Diff"
              lines={lineCount(diff.map((p) => p.value).join(""))}
              size={formatFileSize(new Blob([diff.map((p) => p.value).join("")]).size)}
            >
              <div
                tabIndex={0}
                role="region"
                aria-label="Diff output"
                className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
              >
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
              { value: "words" as const, label: "By word" },
              { value: "lines" as const, label: "By line" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {mode === "words"
              ? "Word by word — best for prose."
              : "Line by line — best for code and config."}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              // `added`/`removed` are counts of diff parts — contiguous runs
              // of changed text — not lines and not words. Say so.
              ["Added runs", left || right ? String(added) : "—"],
              ["Removed runs", left || right ? String(removed) : "—"],
            ]}
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
