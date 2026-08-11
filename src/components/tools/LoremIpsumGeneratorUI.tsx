"use client";

import { useCallback, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";

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
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);

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
    copyText(output).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    });
  }, [output]);

  return (
    <>
      {/* ── Canvas: the generated copy, in the doc's OUT pane ── */}
      <div className="min-w-0 space-y-[13px]">
        {output ? (
          <>
            <TextPanes columns={1}>
              <TextPane
                tone="out"
                label="Output"
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
                <div className={TEXT_PANE_BODY}>{output}</div>
              </TextPane>
            </TextPanes>
            <CanvasFootnote>GENERATED LOCALLY · NOTHING LOGGED</CanvasFootnote>
          </>
        ) : (
          <p className="py-10 text-center font-body text-sm text-text-muted">
            Choose a unit and a count, then generate.
          </p>
        )}
      </div>

      <ToolAside footer={<ToolActions primaryLabel="Generate" onPrimary={handleGenerate} />}>
        <ToolAsideSection label="UNIT">
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
        </ToolAsideSection>

        <ToolAsideSection label="HOW MANY">
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => {
              setCount(Math.max(1, Math.min(100, Number(e.target.value))));
              setOutput("");
            }}
            aria-label={`Number of ${unit}`}
            className="w-24 rounded-md border border-border bg-bg-elevated px-3 py-2 text-center font-mono text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
