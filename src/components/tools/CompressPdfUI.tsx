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
    A rewrite is not guaranteed to be smaller than what it was given, and
    handing back a bigger file under a "-compressed" name is a lie. So the
    smaller of the two ships, and every readout below describes THAT file
    rather than the discarded re-encode.

    This guard is not vestigial. The old MuPDF engine tripped it constantly —
    it wrote a plain cross-reference table and no object streams, so an already
    optimised document came back 74–88% LARGER and the user only ever saw the
    original because of this comparison. pdf-lib does not inflate like that,
    but it still cannot beat a file that is already garbage-collected, already
    deflated and already packed into object streams: the two checked-in samples
    come back byte for byte identical, `grew` fires on the `>=`, and the
    footnote below explains why nothing was saved.
  */
  const grew = result !== null && result.size >= file.size;
  /*
    Two different outcomes hide behind `grew`, and saying the wrong one is a
    lie the user can check against the two sizes printed directly above the
    sentence. Under the old MuPDF engine the rewrite genuinely came back
    BIGGER, so "would make it larger" was the only case worth describing.
    pdf-lib does not inflate: on a document that is already garbage-collected
    and already packed into object streams it comes back the SAME size — which
    is now the ordinary no-win outcome, and the one the two checked-in samples
    produce. Telling that user their file "would be larger" while the readout
    shows two identical numbers is exactly the kind of claim this project
    treats as a bug.
  */
  const noSmaller = result !== null && result.size === file.size;
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
            { label: "ENGINE", value: "PDF-LIB", tone: "neutral" },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {result && grew && (
          <CanvasFootnote>
            {noSmaller ? (
              <>
                THIS PDF IS ALREADY COMPRESSED AS FAR AS THIS TOOL CAN TAKE IT — NOTHING
                UNREFERENCED TO DROP, NOTHING LEFT UNDEFLATED, SO THE DOWNLOAD IS YOUR
                ORIGINAL BYTES
              </>
            ) : (
              <>
                REWRITING THIS PDF WOULD MAKE IT LARGER ({formatFileSize(result.size)})
                — YOUR ORIGINAL IS ALREADY SMALLER, SO THE DOWNLOAD HANDS BACK THE ORIGINAL BYTES
              </>
            )}
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
            Objects nothing references are dropped, streams that arrived uncompressed are
            deflated, and the file is repacked into object streams. Images are never
            re-encoded, so PDFs that are mostly photographs shrink least.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
