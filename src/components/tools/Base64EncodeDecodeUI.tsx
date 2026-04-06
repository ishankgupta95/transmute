"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";

export function Base64EncodeDecodeUI() {
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [fileMode, setFileMode] = useState(false);

  const handleConvert = useCallback(
    (text: string, m: "encode" | "decode") => {
      setInput(text);
      setError("");
      setOutput("");
      if (!text.trim()) return;
      try {
        if (m === "encode") {
          // Handle UTF-8 properly
          const bytes = new TextEncoder().encode(text);
          let binary = "";
          for (const b of bytes) binary += String.fromCharCode(b);
          setOutput(btoa(binary));
        } else {
          const binary = atob(text.trim());
          const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          setOutput(new TextDecoder().decode(bytes));
        }
      } catch {
        setError(m === "encode" ? "Failed to encode" : "Invalid Base64 string");
      }
    },
    [],
  );

  const handleModeChange = useCallback(
    (m: "encode" | "decode") => {
      setMode(m);
      setFileMode(false);
      if (input.trim()) handleConvert(input, m);
    },
    [input, handleConvert],
  );

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] ?? "";
      setOutput(base64);
      setInput(f.name);
      setError("");
    };
    reader.readAsDataURL(f);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
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
        {mode === "encode" && (
          <button
            onClick={() => setFileMode(!fileMode)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              fileMode ? "bg-accent text-bg-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            File
          </button>
        )}
      </div>

      {/* Input */}
      {fileMode ? (
        <DropZone accept="*/*" onFiles={handleFiles} />
      ) : (
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">
            {mode === "encode" ? "Text to Encode" : "Base64 to Decode"}
          </label>
          <textarea
            value={input}
            onChange={(e) => handleConvert(e.target.value, mode)}
            placeholder={mode === "encode" ? "Enter text to encode..." : "Paste Base64 string..."}
            rows={6}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
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
            rows={6}
            className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y"
          />
        </div>
      )}
    </div>
  );
}
