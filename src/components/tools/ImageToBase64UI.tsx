"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { formatFileSize } from "@/lib/utils/file-helpers";

interface ImageToBase64UIProps {
  acceptFormats: string;
}

export function ImageToBase64UI({ acceptFormats }: ImageToBase64UIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [base64, setBase64] = useState<string>("");
  const [dataUri, setDataUri] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [outputMode, setOutputMode] = useState<"datauri" | "raw">("datauri");

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setCopied(false);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setDataUri(result);
      // Extract raw base64 (strip data:...;base64, prefix)
      const raw = result.split(",")[1] ?? "";
      setBase64(raw);
    };
    reader.readAsDataURL(f);
  }, []);

  const handleCopy = useCallback(() => {
    const text = outputMode === "datauri" ? dataUri : base64;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [outputMode, dataUri, base64]);

  const handleReset = useCallback(() => {
    setFile(null);
    setBase64("");
    setDataUri("");
    setCopied(false);
  }, []);

  const output = outputMode === "datauri" ? dataUri : base64;

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept={acceptFormats} onFiles={handleFiles} />
      ) : (
        <>
          {/* File info */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-bg-secondary p-4">
            <div>
              <p className="text-sm text-text-primary font-medium">{file.name}</p>
              <p className="text-xs text-text-muted">
                {formatFileSize(file.size)} · Base64: {formatFileSize(base64.length)}
              </p>
            </div>
            {dataUri && (
              <img src={dataUri} alt="Preview" className="h-12 w-12 rounded object-cover" />
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setOutputMode("datauri")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                outputMode === "datauri"
                  ? "bg-accent text-bg-primary"
                  : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
              }`}
            >
              Data URI
            </button>
            <button
              onClick={() => setOutputMode("raw")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                outputMode === "raw"
                  ? "bg-accent text-bg-primary"
                  : "bg-bg-elevated text-text-secondary hover:bg-bg-hover"
              }`}
            >
              Raw Base64
            </button>
          </div>

          {/* Output */}
          <div className="relative">
            <textarea
              readOnly
              value={output}
              rows={8}
              className="w-full rounded-lg border border-border bg-bg-elevated p-3 text-xs text-text-secondary font-mono resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-medium text-bg-primary hover:bg-accent-hover transition-colors"
            >
              {copied ? "Copied!" : "Copy to Clipboard"}
            </button>
            <button
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2.5 text-sm text-text-secondary hover:bg-bg-hover transition-colors"
            >
              Convert another
            </button>
          </div>

          {/* Usage hint */}
          {outputMode === "datauri" && (
            <div className="rounded-lg border border-border bg-bg-secondary p-4">
              <p className="text-xs text-text-muted mb-2">Usage in HTML:</p>
              <code className="text-xs text-accent break-all">
                {`<img src="${dataUri.slice(0, 60)}..." />`}
              </code>
            </div>
          )}
        </>
      )}
    </div>
  );
}
