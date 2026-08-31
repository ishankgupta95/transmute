"use client";

import { useCallback, useState } from "react";

import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
} from "@/components/tools/ToolAside";
import {
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { chipClass, CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { formatFileSize } from "@/lib/utils/file-helpers";

export function toWords(text: string): string[] {
  return text
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // HTMLParser → HTML Parser
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .replace(/[_\-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** All-caps runs of 2+ letters are acronyms — "NASA" must not become "Nasa". */
function isAcronym(word: string): boolean {
  return /^[A-Z]{2,}$/.test(word);
}

export const converters: Record<string, (text: string) => string> = {
  UPPERCASE: (t) => t.toUpperCase(),
  lowercase: (t) => t.toLowerCase(),
  "Title Case": (t) =>
    toWords(t)
      .map((w) => (isAcronym(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(" "),
  camelCase: (t) => {
    const words = toWords(t);
    return words.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join("");
  },
  snake_case: (t) => toWords(t).map((w) => w.toLowerCase()).join("_"),
  "kebab-case": (t) => toWords(t).map((w) => w.toLowerCase()).join("-"),
  PascalCase: (t) => toWords(t).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""),
};

export function TextCaseConverterUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [activeCase, setActiveCase] = useState("");
  const { copied, copy } = useCopied();

  const handleConvert = useCallback(
    (caseName: string) => {
      setActiveCase(caseName);
      setOutput(converters[caseName](input));
    },
    [input],
  );

  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  return (
    <>
      {/* ── Canvas: the doc's two-up IN / OUT panes ────────── */}
      <div className={CANVAS_COLUMN}>
        <TextPanes columns={output ? 2 : 1}>
          <TextPane
            label="Input Text"
            lines={lineCount(input)}
            size={formatFileSize(new Blob([input]).size)}
          >
            <textarea
              value={input}
              onChange={(e) => {
                // Recompute, don't just invalidate: the sibling formatters run
                // as you type, and a lit "UPPERCASE" pane holding the previous
                // input's conversion is what "Copy output" would put on the
                // clipboard. `activeCase` starts "" — converters[""] is
                // undefined, so the guard is load-bearing.
                const v = e.target.value;
                setInput(v);
                if (activeCase) setOutput(converters[activeCase](v));
              }}
              placeholder="Enter text to convert..."
              aria-label="Input text"
              className={TEXT_PANE_BODY}
            />
          </TextPane>

          {output && (
            <TextPane
              tone="out"
              label={activeCase}
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
              <textarea readOnly value={output} aria-label="Converted text" className={TEXT_PANE_BODY} />
            </TextPane>
          )}
        </TextPanes>
      </div>

      <ToolAside
        footer={
          output ? (
            <ToolActions
              primaryLabel={copied ? "Copied to clipboard" : "Copy output"}
              onPrimary={handleCopy}
            />
          ) : undefined
        }
      >
        <ToolAsideSection label="CASE">
          <div className="flex flex-col gap-1.5">
            {Object.keys(converters).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => handleConvert(name)}
                aria-pressed={activeCase === name}
                className={chipClass(activeCase === name, "px-3 py-[7px] text-left text-xs")}
              >
                {name}
              </button>
            ))}
          </div>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
