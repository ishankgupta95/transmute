"use client";

import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { compressPdf } from "@/lib/tools/pdf-engine";
import { PdfPageSizeTool } from "@/components/tools/ChangePdfPageSizeUI";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
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
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

/*
  "Resize a PDF" is genuinely two different jobs and people mean both by it:
  make the SHEET a different size, and make the FILE a different size. This
  page is the one place that offers both over the same dropped file, which is
  why it exists as its own tool rather than as a synonym doorway pointing at
  one of them.

  The page-dimension half is not reimplemented here — it mounts
  `PdfPageSizeTool`, the same component `change-pdf-page-size` mounts, so the
  two pages cannot drift into describing the same operation differently. Only
  the file-size half lives in this file, and it mirrors `CompressPdfUI`'s
  outcome handling deliberately: the same engine has to produce the same
  honest answer on both pages.
*/

type Mode = "dimensions" | "size";

export function PdfResizerUI() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("dimensions");

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (f) setFile(f);
  }, []);

  const handleReset = useCallback(() => setFile(null), []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  /*
    The switch is rendered by whichever half is mounted, at the top of the
    rail, rather than above the canvas — the doc puts every control in the
    rail, and this is the control that decides what all the others mean.

    The FILE is owned here, so flipping between the two halves keeps it; only
    the half's own settings and its finished output are dropped, which is
    correct because neither survives a change of operation anyway.
  */
  const railHeader = (
    <ToolAsideSection label="WHAT TO RESIZE">
      <ToolChoice
        label="What to resize"
        fill
        value={mode}
        onChange={(v: Mode) => setMode(v)}
        options={[
          { value: "dimensions", label: "Page size" },
          { value: "size", label: "File size" },
        ]}
      />
      <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
        {mode === "dimensions"
          ? "Change the physical size of every page — A4, Letter, Legal and the rest."
          : "Rewrite the file to make it smaller without touching how any page looks."}
      </span>
    </ToolAsideSection>
  );

  if (mode === "dimensions") {
    return <PdfPageSizeTool file={file} onReset={handleReset} railHeader={railHeader} />;
  }

  return <PdfFileSizePanel file={file} onReset={handleReset} railHeader={railHeader} />;
}

/**
 * The file-size half.
 *
 * Everything the copy claims below was read out of `compressPdf` in
 * `pdf-engine-core.ts` before it was written: it drops objects nothing
 * references any more, deflates the streams that arrived with NO `/Filter`
 * (anything already filtered is skipped by design), and re-saves with the
 * objects packed into object streams behind a cross-reference stream. There
 * is no image re-encoder, no downsampler, no quality control and no target
 * size — so this UI must not offer or imply any of them.
 *
 * Measured here, against this exact engine: a 7.4 MB PDF of eight full-page
 * JPEGs came back byte-for-byte the same size (0.000%), and so did both of
 * the repo's checked-in sample documents; a 28 KB vector document saved with
 * a plain cross-reference table came back 29.3% smaller. That is the shape of
 * the tool — structural wins, no photographic ones — and the copy says so
 * rather than quoting a hopeful average.
 */
function PdfFileSizePanel({
  file,
  onReset,
  railHeader,
}: {
  file: File;
  onReset: () => void;
  railHeader: ReactNode;
}) {
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();
    try {
      const bytes = await compressPdf(await file.arrayBuffer());
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
  }, [file]);

  /*
    Lifted from CompressPdfUI unchanged, because the same engine has to give
    the same answer on both pages.

    A rewrite is not guaranteed to be smaller than what it was given, and
    handing back a bigger file under a "-smaller" name is a lie. So the smaller
    of the two ships, and every readout below describes THAT file rather than
    the discarded rewrite. Two different outcomes hide behind `grew`: a file
    that is already garbage-collected, already deflated and already packed into
    object streams comes back the SAME size — which is the ordinary no-win
    outcome, and the one both checked-in samples produce — while a genuine
    increase is a different sentence. Telling the first user their file "would
    be larger" while the readout shows two identical numbers is exactly the
    kind of claim this project treats as a bug.
  */
  const grew = result !== null && result.size >= file.size;
  const noSmaller = result !== null && result.size === file.size;
  const output = result === null ? null : grew ? file : result;
  const savedLabel = !output
    ? "—"
    : grew
      ? "0%"
      : `${((1 - output.size / file.size) * 100).toFixed(1)}%`;

  return (
    <>
      {/* ── Canvas: the document, and what the rewrite did to it ─ */}
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
            // "—" reads as "not measured"; the honest answer when the rewrite
            // does not help is that nothing was saved.
            { label: "SAVED", value: savedLabel, tone: grew ? "neutral" : "ok" },
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

        {!result && (
          <CanvasFootnote>
            STRUCTURAL ONLY — IMAGES ARE NEVER RE-ENCODED, SO A PDF MADE OF PHOTOGRAPHS OR SCANS
            MAY COME BACK EXACTLY THE SAME SIZE
          </CanvasFootnote>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress phase="COMPRESSING" percent={null} label="Compressing PDF" />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {output ? (
              // The name stays stable whichever blob wins, so the download is
              // predictable however the comparison came out.
              <DownloadButton
                blob={output}
                fileName={file.name.replace(/\.pdf$/i, "-compressed.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Compressing…" : "Shrink file"}
                primaryDisabled={status === "processing"}
                onPrimary={handleRun}
              />
            )}
            <ToolResetLink onClick={onReset} label="CHANGE FILE" />
          </>
        }
      >
        {railHeader}

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", formatFileSize(file.size)],
              ["Out", output ? formatFileSize(output.size) : "—"],
              ["Saved", savedLabel],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT THIS DOES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Objects nothing references are dropped, streams that arrived uncompressed are
            deflated, and the file is repacked into object streams. Every page comes out looking
            identical because nothing about the content is touched.
          </span>
          {/*
            The P1 honesty line. `compressPdf` has no image codec at all: a
            stream that already declares a /Filter — which is every embedded
            JPEG — is skipped by design. Measured against this engine, a 7.4 MB
            PDF of full-page JPEGs came back byte-for-byte identical.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Images are <strong>never</strong> re-encoded or downsampled, so a PDF that is mostly
            photographs or scanned pages often comes back the same size to the byte. The savings
            here are structural — they come from files that arrived with wasted objects or
            uncompressed streams, where the same rewrite can take off a third or more.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            There is no quality slider and no target size: you cannot ask this for &ldquo;under
            500 KB&rdquo;. It does one pass and reports what that was worth, and if the rewrite
            does not come out smaller you get your original bytes back.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
