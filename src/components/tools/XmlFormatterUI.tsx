"use client";

import { useCallback, useState } from "react";

function formatXml(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) throw new Error(errorNode.textContent ?? "Invalid XML");

  const serializer = new XMLSerializer();
  const raw = serializer.serializeToString(doc);

  // Pretty-print with indentation
  let formatted = "";
  let indent = 0;
  const parts = raw.replace(/(>)(<)/g, "$1\n$2").split("\n");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("</")) indent--;
    formatted += "  ".repeat(Math.max(0, indent)) + trimmed + "\n";
    if (trimmed.startsWith("<") && !trimmed.startsWith("</") && !trimmed.startsWith("<?") && !trimmed.endsWith("/>") && !trimmed.includes("</")) {
      indent++;
    }
  }
  return formatted.trim();
}

function minifyXml(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const errorNode = doc.querySelector("parsererror");
  if (errorNode) throw new Error(errorNode.textContent ?? "Invalid XML");
  return new XMLSerializer().serializeToString(doc).replace(/>\s+</g, "><");
}

export function XmlFormatterUI() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"format" | "minify">("format");
  const [copied, setCopied] = useState(false);

  const handleFormat = useCallback(() => {
    setError("");
    setOutput("");
    if (!input.trim()) return;
    try {
      setOutput(mode === "format" ? formatXml(input) : minifyXml(input));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid XML");
    }
  }, [input, mode]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-2">
        {(["format", "minify"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              mode === m ? "bg-accent text-bg-primary" : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {m === "format" ? "Format" : "Minify"}
          </button>
        ))}
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Input XML</label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='<root><item id="1"><name>Test</name></item></root>'
          rows={8}
          className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono resize-y placeholder:text-text-muted"
        />
      </div>

      <div className="flex justify-center">
        <button
          onClick={handleFormat}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
        >
          {mode === "format" ? "Format XML" : "Minify XML"}
        </button>
      </div>

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
          <pre className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-sm text-text-primary font-mono overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
