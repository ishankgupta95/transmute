"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ProgressBar } from "@/components/tools/ProgressBar";
import { compressPdf } from "@/lib/tools/pdf-engine";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  DocCard,
  DocStrip,
  StatStrip,
} from "@/components/tools/ToolCanvas";

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

  if (!file) {
    return <DropZone accept=".pdf" onFiles={handleFiles} />;
  }

  return (
    <>
      {/* ── Canvas: the doc card and what compression did ──── */}
      <div className="min-w-0 space-y-[13px]">
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={result ? formatFileSize(result.size) : "PDF"}
        />

        <DocStrip>
          <DocCard index={1} name={file.name} meta={formatFileSize(file.size)} badge="PDF" />
        </DocStrip>

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.size) : "—" },
            {
              label: "SAVED",
              value:
                result && result.size < file.size
                  ? `${((1 - result.size / file.size) * 100).toFixed(1)}%`
                  : "—",
              tone: "ok",
            },
            { label: "ENGINE", value: "MUPDF", tone: "neutral" },
          ]}
        />

        {status === "processing" && <ProgressBar progress={null} />}
        {error && <ErrorMessage message={error} />}

        {result && result.size >= file.size && (
          <CanvasFootnote>
            THIS PDF IS ALREADY WELL-OPTIMIZED — NO SIGNIFICANT REDUCTION ACHIEVED
          </CanvasFootnote>
        )}
      </div>

      <ToolAside
        footer={
          <>
            {result && (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-compressed.pdf")}
                className="w-full justify-center"
              />
            )}
            <ToolResetLink onClick={handleReset} label="START OVER" />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", formatFileSize(file.size)],
              ["Out", result ? formatFileSize(result.size) : "—"],
              [
                "Saved",
                result && result.size < file.size
                  ? `${((1 - result.size / file.size) * 100).toFixed(1)}%`
                  : "—",
              ],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Streams are deflated and duplicate objects removed. Image-heavy PDFs shrink least.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
