"use client";

import { useCallback, useState } from "react";

import { copyText } from "@/lib/utils/clipboard";

function encodeHtmlEntities(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (ch) => map[ch]);
}

function decodeHtmlEntities(text: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

export function HtmlEntityEncodeDecodeUI() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);

  const handleConvert = useCallback(
    (text: string, m: "encode" | "decode") => {
      setInput(text);
      setOutput("");
      if (!text) return;
      setOutput(m === "encode" ? encodeHtmlEntities(text) : decodeHtmlEntities(text));
    },
    [],
  );

  const handleModeChange = useCallback(
    (m: "encode" | "decode") => {
      setMode(m);
      if (input) handleConvert(input, m);
    },
    [input, handleConvert],
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
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2">
        {(["encode", "decode"] as const).map((m) => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              mode === m ? "bg-accent text-bg-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {m === "encode" ? "Encode" : "Decode"}
          </button>
        ))}
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">
          {mode === "encode" ? "Text to Encode" : "HTML Entities to Decode"}
        </label>
        <textarea
          value={input}
          onChange={(e) => handleConvert(e.target.value, mode)}
          placeholder={mode === "encode" ? '<p>Hello & "World"</p>' : "&lt;p&gt;Hello &amp; &quot;World&quot;&lt;/p&gt;"}
          rows={5}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-text-secondary">Output</label>
            <button onClick={handleCopy} className="text-xs text-accent hover:text-accent-hover transition-colors">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <textarea
            readOnly
            value={output}
            rows={5}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y"
          />
        </div>
      )}
    </div>
  );
}
