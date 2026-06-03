"use client";

import { useCallback, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";

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
  return result.join(" ") + ".";
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-center gap-3">
        <input
          type="number"
          min={1}
          max={100}
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value))))}
          className="w-20 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary text-center font-mono"
        />
        {(["paragraphs", "sentences", "words"] as const).map((u) => (
          <button
            key={u}
            onClick={() => setUnit(u)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              unit === u ? "bg-accent text-bg-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {u.charAt(0).toUpperCase() + u.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleGenerate}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          Generate
        </button>
      </div>

      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">Output</label>
            <button onClick={handleCopy} className="text-xs text-accent hover:text-accent-hover transition-colors">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary whitespace-pre-wrap max-h-96 overflow-y-auto">
            {output}
          </div>
        </div>
      )}
    </div>
  );
}
