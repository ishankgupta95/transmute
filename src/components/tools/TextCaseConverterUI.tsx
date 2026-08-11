"use client";

import { useCallback, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";
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
import { chipClass } from "@/components/workspace/shared";

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
  const [copied, setCopied] = useState(false);

  const handleConvert = useCallback(
    (caseName: string) => {
      setActiveCase(caseName);
      setOutput(converters[caseName](input));
    },
    [input],
  );

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
          <TextPane label="Input Text" lines={lineCount(input)}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
