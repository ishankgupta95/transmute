"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { copyText } from "@/lib/utils/clipboard";

export function UrlEncodeDecodeUI() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleConvert = useCallback(
    (text: string, m: "encode" | "decode") => {
      setInput(text);
      setError("");
      setOutput("");
      if (!text.trim()) return;
      try {
        setOutput(m === "encode" ? encodeURIComponent(text) : decodeURIComponent(text));
      } catch {
        setError(m === "encode" ? "Failed to encode" : "Invalid percent-encoded string");
      }
    },
    [],
  );

  const handleModeChange = useCallback(
    (m: "encode" | "decode") => {
      setMode(m);
      if (input.trim()) handleConvert(input, m);
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
          {mode === "encode" ? "Text to Encode" : "URL-Encoded String"}
        </label>
        <textarea
          value={input}
          onChange={(e) => handleConvert(e.target.value, mode)}
          placeholder={mode === "encode" ? "Hello World & foo=bar" : "Hello%20World%20%26%20foo%3Dbar"}
          rows={4}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      {error && (
        <ErrorMessage message={error} />
      )}

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
            rows={4}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y"
          />
        </div>
      )}
    </div>
  );
}
