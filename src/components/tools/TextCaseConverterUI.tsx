"use client";

import { useCallback, useState } from "react";

function toWords(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .replace(/[_\-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const converters: Record<string, (text: string) => string> = {
  UPPERCASE: (t) => t.toUpperCase(),
  lowercase: (t) => t.toLowerCase(),
  "Title Case": (t) => toWords(t).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" "),
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
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Input Text</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter text to convert..."
          rows={4}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      {/* Case buttons */}
      <div className="flex flex-wrap justify-center gap-2">
        {Object.keys(converters).map((name) => (
          <button
            key={name}
            onClick={() => handleConvert(name)}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              activeCase === name
                ? "bg-accent text-bg-primary"
                : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">{activeCase}</label>
            <button onClick={handleCopy} className="text-xs text-accent hover:text-accent-hover transition-colors">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <textarea
            readOnly
            value={output}
            rows={4}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y"
          />
        </div>
      )}
    </div>
  );
}
