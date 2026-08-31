"use client";

import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { compressPdf } from "@/lib/tools/pdf-engine";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ToolAside,
  ToolAsideSection,
  ToolDone,
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
import { ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

export function CompressPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setStatus("processing");
    setError(null);
    setElapsed(null);
    const startedAt = performance.now();
    try {
      const buf = await f.arrayBuffer();
      const bytes = await compressPdf(buf);
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A tiny PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to compress PDF");
      setStatus("error");
    }
  }, []);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setElapsed(null);
    setStatus("idle");
    setError(null);
  }, []);

  if (!file) {
    return <DropZone accept=".pdf" onFiles={handleFiles} />;
  }

  /*
    MuPDF re-encodes small or already-linearised documents into a LARGER file
    (sample-doc.pdf: 5.1 KB in, 8.9 KB out). Handing that back under a
    "-compressed" name is a lie, so the smaller of the two is what ships — and
    every readout describes THAT file, not the discarded re-encode.
  */
  const grew = result !== null && result.size >= file.size;
  const output = result === null ? null : grew ? file : result;

  return (
    <>
      {/* ── Canvas: the doc card and what compression did ──── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={output ? formatFileSize(output.size) : "PDF"}
        />

        <DocStrip>
          <DocCard index={1} name={file.name} meta={formatFileSize(file.size)} badge="PDF" />
        </DocStrip>

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: output ? formatFileSize(output.size) : "—" },
            {
              label: "SAVED",
              // "—" read as "not measured"; the honest answer when re-encoding
              // does not help is that nothing was saved.
              value: !output ? "—" : grew ? "0%" : `${((1 - output.size / file.size) * 100).toFixed(1)}%`,
              tone: grew ? "neutral" : "ok",
            },
            { label: "ENGINE", value: "MUPDF", tone: "neutral" },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {result && grew && (
          <CanvasFootnote>
            RE-ENCODING THIS PDF WOULD MAKE IT LARGER ({formatFileSize(result.size)})
            — YOUR ORIGINAL IS ALREADY SMALLER, SO THE DOWNLOAD HANDS BACK THE ORIGINAL BYTES
          </CanvasFootnote>
        )}
      </div>

      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress phase="COMPRESSING" percent={null} label="Compressing PDF" />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {output && (
              // The name stays stable whichever blob wins, so the download is
              // predictable and the golden-path assertion still holds.
              <DownloadButton
                blob={output}
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
              ["Out", output ? formatFileSize(output.size) : "—"],
              [
                "Saved",
                !output ? "—" : grew ? "0%" : `${((1 - output.size / file.size) * 100).toFixed(1)}%`,
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
