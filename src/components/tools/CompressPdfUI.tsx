"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { compressPdf } from "@/lib/tools/pdf-engine";
import { formatFileSize } from "@/lib/utils/file-helpers";

export function CompressPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus("processing");
    setError(null);
    try {
      const buf = await f.arrayBuffer();
      const bytes = await compressPdf(buf);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compress PDF");
      setStatus("error");
    }
  }, []);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setStatus("idle");
    setError(null);
  }, []);

  return (
    <div className="space-y-6">
      {!file ? (
        <DropZone accept=".pdf" onFiles={handleFiles} />
      ) : (
        <>
          {status === "processing" && <ProgressBar progress={50} />}
          {error && <p className="text-sm text-error">{error}</p>}

          {result && (
            <div className="rounded-lg border border-border bg-bg-secondary p-5 space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-text-muted">Original</p>
                  <p className="text-text-primary font-medium">{formatFileSize(file.size)}</p>
                </div>
                <div>
                  <p className="text-text-muted">Compressed</p>
                  <p className="text-text-primary font-medium">{formatFileSize(result.size)}</p>
                </div>
              </div>
              {result.size < file.size ? (
                <p className="text-sm text-success">
                  Reduced by {((1 - result.size / file.size) * 100).toFixed(1)}%
                </p>
              ) : (
                <p className="text-sm text-text-muted">
                  This PDF is already well-optimized — no significant reduction achieved.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            {result && (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-compressed.pdf")}
              />
            )}
            <button onClick={handleReset} className="text-sm text-text-muted hover:text-text-secondary transition-colors">
              Reset
            </button>
          </div>
        </>
      )}
    </div>
  );
}
