"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { isAbortError } from "@/lib/utils/abort";
import { triggerDownload } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import type { PdfTextResult } from "@/lib/tools/pdf-text";
import { cn } from "@/lib/utils/cn";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

/**
 * How much of the extracted text is put on screen.
 *
 * The full string goes to Copy and to the download; only the PREVIEW is
 * capped, because the pane is a `<pre>` and a `<pre>` lays out every character
 * it is given. 500 dense pages is ~2.1 M characters, which is a layout the
 * main thread does not come back from quickly — and nobody proof-reads a
 * 2 M-character block in a 12-rem-tall pane anyway.
 *
 * 20 000 is ~14 pages of the repo's own sample-doc.pdf (measured: 1 450
 * characters per page) or ~5 pages of dense body text (~4 200 each) — enough
 * to see that the extraction worked and what its line breaks look like, which
 * is the whole job of a preview. The footnote below says so whenever the cap
 * bites, so the pane never quietly pretends to be the whole document.
 */
const PREVIEW_LIMIT = 20_000;

/** How many empty page numbers the warning names before it gives up listing. */
const MAX_LISTED_EMPTY_PAGES = 12;

/** `report.pdf` → `report.txt`; anything without an extension just gains one. */
function textFileName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, "")}.txt`;
}

function listPages(pages: number[]): string {
  if (pages.length <= MAX_LISTED_EMPTY_PAGES) return pages.join(", ");
  return `${pages.slice(0, MAX_LISTED_EMPTY_PAGES).join(", ")} and ${
    pages.length - MAX_LISTED_EMPTY_PAGES
  } more`;
}

export function PdfToTextUI() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PdfTextResult | null>(null);
  const [pageMarkers, setPageMarkers] = useState(true);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);
  const { copied, copy, clear: clearCopied } = useCopied();

  /*
    The engine cancels COOPERATIVELY between pages (destroying a pdfjs document
    mid-`getTextContent` leaves that promise pending forever — measured). So a
    new file or a reset aborts the controller and the in-flight run stops at
    the next page boundary instead of racing the one that replaces it.
  */
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Every page came back empty: the document has no text layer at all.
  const noTextLayer =
    result !== null && result.pageCount > 0 && result.emptyPages.length === result.pageCount;

  /*
    The join is re-derived from the per-page text rather than re-extracted, so
    toggling page markers on a 500-page document is instant. This is the whole
    reason `extractPdfText` hands back `pages` alongside `text`.

    A document with NO text layer at all folds to nothing here, not to its own
    page markers. `joinPdfPages` deliberately emits a bare `--- Page N ---` for
    an empty page, so that a scan sitting inside an otherwise digital document
    still leaves a trace in the output; when EVERY page is empty that same rule
    hands back a file consisting of nothing but markers. Everything downstream
    — the copy/download affordances, the pane, and the footer's DownloadButton
    — gates on this string being non-empty, so the tool offered a "successful"
    extraction of a scanned PDF. Caught by an e2e probe against a 2-page
    image-only PDF: a 30-byte `scanned-pages.txt` containing
    "--- Page 1 ---\n\n--- Page 2 ---". Emptying it HERE rather than at each
    gate keeps the one honest definition of "there is text" in one place, and
    makes the header's character count read 0 instead of counting the markers.
  */
  const text = useMemo(() => {
    if (!result || noTextLayer) return "";
    if (pageMarkers) return result.text;
    return result.pages
      .filter((p) => p !== "")
      .join("\n\n")
      .trim();
  }, [result, pageMarkers, noTextLayer]);

  // Memoised together: on a 500-page document each of these walks a
  // 2 M-character string, and a re-render for a copy confirmation must not
  // pay for that again.
  const blob = useMemo(() => new Blob([text], { type: "text/plain;charset=utf-8" }), [text]);
  const lines = useMemo(() => lineCount(text), [text]);
  const preview = useMemo(
    () => (text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) : text),
    [text],
  );

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFile(f);
    setResult(null);
    setError(null);
    setElapsed(null);
    setPercent(0);
    setStatus("processing");
    clearCopied();

    const startedAt = performance.now();
    try {
      const { extractPdfText } = await import("@/lib/tools/pdf-text");
      const data = new Uint8Array(await f.arrayBuffer());
      const extracted = await extractPdfText(data, {
        signal: controller.signal,
        onProgress: (p) => setPercent(Math.round(p)),
      });
      if (controller.signal.aborted) return;
      setResult(extracted);
      // A three-page PDF finishes in tens of milliseconds; "Done in 0.0 s"
      // reads like a stopwatch that never started, so sub-second runs report
      // milliseconds — same rule as the other PDF tools.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // A cancelled run is not a failure: the user replaced the file.
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "Failed to read this PDF");
      setStatus("error");
    } finally {
      setPercent(null);
    }
  }, [clearCopied]);

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null);
    setResult(null);
    setError(null);
    setElapsed(null);
    setPercent(null);
    setStatus("idle");
    clearCopied();
  }, [clearCopied]);

  const handleCopy = useCallback(() => {
    void copy(text);
  }, [copy, text]);

  const handleDownload = useCallback(() => {
    if (!file) return;
    triggerDownload(blob, textFileName(file.name));
  }, [blob, file]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  const emptyCount = result?.emptyPages.length ?? 0;

  return (
    <>
      {/* ── Canvas: the extracted text, and what it could not reach ─── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={
            result
              ? `${result.pageCount} PAGE${result.pageCount !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`
              : formatFileSize(file.size)
          }
          trailing={result ? `${text.length.toLocaleString()} CHARACTERS` : undefined}
        />

        {noTextLayer && result ? (
          <>
            {/*
              MEASURED: the only thing this branch actually knows is that every
              page folded to the empty string. `extractPdfText` populates
              `emptyPages` from `if (text === "") emptyPages.push(i)`
              (pdf-text.ts:322), and that module's own docblock (pdf-text.ts:
              63-68) names the whole set — "a scanned or image-only page, OR a
              genuinely blank one". Driving the shipped extractor over pdf-lib
              fixtures reproduced all three members: a bar chart drawn as pure
              vector paths with the labels converted to outlines, a 1-page
              blank and a 4-page blank all come back with `emptyPages.length
              === pageCount`, identical to a scan. There is no raster detection
              anywhere in this path, so "these pages are scans" was a diagnosis
              the code cannot make. State the observation, then offer the scan
              as the likely cause rather than the only one. The no-OCR
              disclosure stays exactly as load-bearing as it was.
            */}
            <WarningMessage
              message={`No text came out of this PDF: ${
                result.pageCount === 1
                  ? "its only page carries no text layer. Most often that means the page is a scan or an image"
                  : `none of its ${result.pageCount} pages carries a text layer. Most often that means all ${result.pageCount} of its pages are scans or images`
              }, but a page of pure vector artwork, or a genuinely blank one, looks exactly the same from here. This tool reads the text a PDF already carries — it does not run OCR, so a page with no text layer gives it nothing to work with.`}
            />
            <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
              To work with the pages as pictures instead, use{" "}
              <Link href="/pdf-to-jpg" className="text-accent underline hover:text-accent-hover">
                PDF to JPG
              </Link>
              . If the pages really are scans, getting text out of them needs an OCR program,
              which this site does not have.
            </p>
          </>
        ) : (
          <>
            {result && emptyCount > 0 && (
              <WarningMessage
                message={`${emptyCount} of this PDF's ${result.pageCount} pages produced no text (page${
                  emptyCount !== 1 ? "s" : ""
                } ${listPages(result.emptyPages)}) — usually scans or images, though a vector-only or blank page reads the same way, and there is no OCR here either way. Everything below is what the other pages actually carry.`}
              />
            )}

            <TextPanes columns={1}>
              <TextPane
                tone="out"
                label="Extracted text"
                lines={lines}
                size={formatFileSize(blob.size)}
                action={
                  text ? (
                    <>
                      <button
                        onClick={handleCopy}
                        className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                      <button
                        onClick={handleDownload}
                        className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                      >
                        Download
                      </button>
                    </>
                  ) : undefined
                }
              >
                <pre
                  tabIndex={0}
                  role="region"
                  className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                  aria-label="Extracted text"
                >
                  {preview}
                </pre>
              </TextPane>
            </TextPanes>

            {text.length > PREVIEW_LIMIT && (
              <CanvasFootnote>
                PREVIEWING THE FIRST {PREVIEW_LIMIT.toLocaleString()} OF{" "}
                {text.length.toLocaleString()} CHARACTERS — COPY AND DOWNLOAD CARRY ALL OF IT
              </CanvasFootnote>
            )}
          </>
        )}

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress phase="EXTRACTING TEXT" percent={percent} label="Extracting text" />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {/*
              No download offered when there is nothing to download. A PDF of
              scans would otherwise hand over a 0-byte .txt that looks like the
              tool worked; the warning in the canvas says what actually
              happened, and a retry would produce the same empty file, so no
              action is offered there either.
            */}
            {text ? (
              <DownloadButton
                blob={blob}
                fileName={textFileName(file.name)}
                className="w-full justify-center"
              />
            ) : (
              status === "error" && (
                <ToolActions primaryLabel="Try again" onPrimary={() => void handleFiles([file])} />
              )
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Pages", result ? String(result.pageCount) : "—"],
              ["Characters", result ? text.length.toLocaleString() : "—"],
              ["Pages with no text", result ? String(emptyCount) : "—"],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="FORMAT">
          <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
            <input
              type="checkbox"
              checked={pageMarkers}
              onChange={(e) => setPageMarkers(e.target.checked)}
              className="size-4 rounded-sm border-border accent-accent"
            />
            Mark where each page starts
          </label>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Writes a{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">--- Page 2 ---</code> line
            before each page. A one-page PDF never gets one.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT YOU GET">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The text layer the PDF already carries, in the order the file stores it. There is no
            OCR: a scanned page has no text layer and comes back empty. Multi-column pages come out
            one whole column after another, not as you read them, and tables lose their rows and
            columns — the cells arrive as separate lines.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
