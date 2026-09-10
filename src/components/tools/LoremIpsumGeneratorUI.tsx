"use client";

import { useCallback, useState } from "react";

import {
  ToolActions,
  ToolAside,
  ToolChoice,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
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

/**
 * The doc's one field box, from the RANGE strip:
 * `height:30px;border-radius:7px;background:var(--color-surface);border:1px
 * solid var(--color-divider);font:400 12px/1 'IBM Plex Mono';padding:0 10px`.
 * The same shape `RangeField` and the regex pattern input already wear.
 */
const FIELD_CLASS =
  "h-[30px] w-24 rounded-[7px] border border-border bg-bg-elevated px-2.5 text-center font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const LOREM_WORDS = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum".split(" ");

const LOREM_SENTENCES = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
  "Nisi ut aliquip ex ea commodo consequat.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "Curabitur pretium tincidunt lacus, nec ullamcorper nisi aliquet vel.",
  "Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.",
  "Proin sapien ipsum, porta a auctor quis, euismod ut nisl.",
  "Mauris placerat eleifend leo, quis laoreet enim maximus vel.",
  "Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae.",
  "Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh.",
  "Donec sodales sagittis magna, sed consequat leo placerat nec.",
  "Nulla facilisi, cras non velit nec nisi vulputate nonummy.",
  "Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero.",
];

function generateWords(count: number): string {
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(LOREM_WORDS[i % LOREM_WORDS.length]);
  }
  result[0] = "Lorem";
  // A word list, not a sentence: asking for N words used to return N words
  // plus a bolted-on period — wrong the moment it lands in a design comp.
  // Sentence punctuation belongs to the sentences/paragraphs modes.
  return result.join(" ");
}

function generateSentences(count: number): string {
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    result.push(LOREM_SENTENCES[i % LOREM_SENTENCES.length]);
  }
  return result.join(" ");
}

function generateParagraphs(count: number): string {
  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    const sentCount = 4 + (i % 3);
    const sentences: string[] = [];
    for (let j = 0; j < sentCount; j++) {
      sentences.push(LOREM_SENTENCES[(i * sentCount + j) % LOREM_SENTENCES.length]);
    }
    result.push(sentences.join(" "));
  }
  return result.join("\n\n");
}

type Unit = "paragraphs" | "sentences" | "words";

export function LoremIpsumGeneratorUI() {
  const [unit, setUnit] = useState<Unit>("paragraphs");
  const [count, setCount] = useState(3);
  /*
    The field holds a string draft. Binding it straight to the clamped number
    meant `Number("")` was 0, `Math.max(1, 0)` wrote 1 back into the controlled
    value, and backspacing to empty repopulated "1" — so retyping 25 landed as
    "125" and clamped to 100. `count` stays the clamped number generation reads.
  */
  const [countText, setCountText] = useState("3");
  const [output, setOutput] = useState("");
  const { copied, copy } = useCopied();

  const handleGenerate = useCallback(() => {
    switch (unit) {
      case "paragraphs":
        setOutput(generateParagraphs(count));
        break;
      case "sentences":
        setOutput(generateSentences(count));
        break;
      case "words":
        setOutput(generateWords(count));
        break;
    }
  }, [unit, count]);

  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  return (
    <>
      {/* ── Canvas: the generated copy, in the doc's OUT pane ── */}
      <div className={CANVAS_COLUMN}>
        {output ? (
          <>
            <TextPanes columns={1}>
              <TextPane
                tone="out"
                label="Output"
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
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Generated text"
                  className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                >
                  {output}
                </div>
              </TextPane>
            </TextPanes>
            <CanvasFootnote>GENERATED LOCALLY · NOTHING LOGGED</CanvasFootnote>
          </>
        ) : (
          <p className="py-10 text-center font-body text-[12.5px] leading-[1.5] text-text-muted">
            Choose a unit and a count, then generate.
          </p>
        )}
      </div>

      <ToolAside footer={<ToolActions primaryLabel="Generate" onPrimary={handleGenerate} />}>
        {/* One bordered block for the whole control set — the doc gives its
            own rule only to START FROM, ADVANCED and OUTPUT. */}
        <ToolControlGroup>
          <ToolControl label="UNIT">
            <ToolChoice
              label="Unit"
              fill
              value={unit}
              onChange={(u) => {
                setUnit(u);
                setOutput(""); // three paragraphs under a lit "Words" chip lie
              }}
              options={[
                { value: "paragraphs" as const, label: "Paragraphs" },
                { value: "sentences" as const, label: "Sentences" },
                { value: "words" as const, label: "Words" },
              ]}
            />
          </ToolControl>

          <ToolControl label="HOW MANY">
            <input
              type="number"
              min={1}
              max={100}
              value={countText}
              onChange={(e) => {
                const text = e.target.value;
                setCountText(text);
                setOutput(""); // three paragraphs under a "20" count lie
                const n = Number(text);
                if (text !== "" && Number.isFinite(n)) {
                  setCount(Math.max(1, Math.min(100, n)));
                }
              }}
              onBlur={() => setCountText(String(count))}
              aria-label={`Number of ${unit}`}
              className={FIELD_CLASS}
            />
          </ToolControl>
        </ToolControlGroup>
      </ToolAside>
    </>
  );
}
