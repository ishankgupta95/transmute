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
import { CanvasFootnote, CanvasHeader } from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { isAbortError } from "@/lib/utils/abort";
import { formatFileSize } from "@/lib/utils/file-helpers";
import type { OcrPdfResult } from "@/lib/tools/ocr-pdf";

/** `scan.pdf` → `scan-searchable.pdf`. */
function outputName(pdfName: string): string {
  return `${pdfName.replace(/\.pdf$/i, "")}-searchable.pdf`;
}

/** How many page numbers a warning names before it gives up listing. */
const MAX_LISTED = 12;

function listPages(pages: readonly number[]): string {
  if (pages.length <= MAX_LISTED) return pages.join(", ");
  return `${pages.slice(0, MAX_LISTED).join(", ")} and ${pages.length - MAX_LISTED} more`;
}

export function OcrPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OcrPdfResult | null>(null);
  const [hadTextLayer, setHadTextLayer] = useState<number[]>([]);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ page: number; pageCount: number; percent: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    Cancels BETWEEN pages, not during one. `recognize` is a single call into
    wasm with no yield point, so a page in flight runs to completion; the
    controller stops the run at the next page boundary. The button says
    "Cancel" rather than "Stop now" for that reason.
  */
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const blob = useMemo(
    () => (result ? new Blob([result.bytes as BlobPart], { type: "application/pdf" }) : null),
    [result],
  );

  const meanConfidence = useMemo(() => {
    if (!result || result.pages.length === 0) return null;
    const scored = result.pages.filter((p) => p.words > 0);
    if (scored.length === 0) return null;
    return Math.round(scored.reduce((sum, p) => sum + p.confidence, 0) / scored.length);
  }, [result]);

  const handleFiles = useCallback(async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFile(f);
    setResult(null);
    setHadTextLayer([]);
    setError(null);
    setElapsed(null);
    setProgress(null);
    setStatus("processing");

    const startedAt = performance.now();
    try {
      const buffer = await f.arrayBuffer();

      /*
        PRE-FLIGHT: does this PDF already carry real text?

        Overlaying OCR on a page that already has a text layer makes search and
        copy return everything TWICE, and the layer that was already there is
        the accurate one — it is the characters the file stores, not a guess.
        `extractPdfText` already reports exactly which pages came back empty,
        so the pages that are NOT in `emptyPages` are the ones that would be
        doubled. Worth a warning rather than a refusal: a mixed document (a
        scan bound into a digital report) is a real and reasonable case.
      */
      const { extractPdfText } = await import("@/lib/tools/pdf-text");
      const existing = await extractPdfText(new Uint8Array(buffer.slice(0)), {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const withText = Array.from({ length: existing.pageCount }, (_, i) => i + 1).filter(
        (n) => !existing.emptyPages.includes(n),
      );
      setHadTextLayer(withText);

      const { ocrPdf } = await import("@/lib/tools/ocr-pdf");
      const ocrd = await ocrPdf(new Uint8Array(buffer), {
        signal: controller.signal,
        onProgress: ({ page, pageCount, fraction }) =>
          setProgress({ page, pageCount, percent: Math.round(fraction * 100) }),
      });
      if (controller.signal.aborted) return;

      setResult(ocrd);
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "Could not read this PDF");
      setStatus("error");
    } finally {
      setProgress(null);
    }
  }, []);

  const handleReset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setFile(null);
    setResult(null);
    setHadTextLayer([]);
    setError(null);
    setElapsed(null);
    setProgress(null);
    setStatus("idle");
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  const everyPageEmpty =
    result !== null && result.pages.length > 0 && result.emptyPages.length === result.pages.length;

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={
            result
              ? `${result.pages.length} PAGE${result.pages.length !== 1 ? "S" : ""} · ${formatFileSize(file.size)}`
              : formatFileSize(file.size)
          }
          trailing={result ? `${result.wordCount.toLocaleString()} WORDS` : undefined}
        />

        {/*
          The pre-flight warning. It fires on the INPUT, so it is shown while
          the run is still going — the point is to let someone stop before
          waiting several minutes for an outcome they did not want.
        */}
        {hadTextLayer.length > 0 && (
          <WarningMessage
            message={`${
              hadTextLayer.length === 1 ? "Page" : "Pages"
            } ${listPages(hadTextLayer)} already carry real text. Adding OCR on top means search and copy return those words twice, and the text already there is the accurate one — it is what the file stores rather than a guess at a picture. If the whole document reads like this, you do not need this tool.`}
          />
        )}

        {everyPageEmpty && result && (
          <WarningMessage
            message={`No text came out of any of this PDF's ${result.pages.length} pages, so the file you get back is the file you gave, with nothing added. Most often that means the pages are blank or are artwork rather than a scan of text — but low resolution, heavy skew and handwriting all look the same from here.`}
          />
        )}

        {result && !everyPageEmpty && result.emptyPages.length > 0 && (
          <WarningMessage
            message={`${result.emptyPages.length} of this PDF's ${result.pages.length} pages produced no text (page${
              result.emptyPages.length !== 1 ? "s" : ""
            } ${listPages(result.emptyPages)}). Those pages are unchanged and are still not searchable. Everything else below carries a text layer now.`}
          />
        )}

        {/*
          THE TWO SENTENCES THIS TOOL MUST LEAD WITH.

          The first is the reassurance AND the limit: nothing is re-typeset, so
          nothing can silently reflow — and equally, this is not a conversion
          into an editable document.

          The second is sharper here than on /image-to-text, and deliberately
          worded to say why. There, a misread word is on screen next to the
          picture and you can see it is wrong. Here the OCR text is invisible
          by construction: the reader sees the correct scanned glyph and gets
          the wrong character when they search, copy, or let a screen reader
          read it. The error is real and it is unobservable.
        */}
        <CanvasFootnote>
          THE PAGE IMAGE IS UNCHANGED — THE TEXT IS AN INVISIBLE LAYER OVER IT, NOT A RETYPED
          DOCUMENT
        </CanvasFootnote>
        <CanvasFootnote>
          THE SEARCHABLE TEXT IS AN OCR GUESS — WHAT YOU SEE IS RIGHT, WHAT YOU COPY MAY NOT BE
        </CanvasFootnote>

        <p className="m-0 font-body text-xs leading-[1.6] text-text-muted">
          If this PDF was exported rather than scanned, it already has real text and{" "}
          <Link href="/pdf-to-text" className="text-accent underline hover:text-accent-hover">
            PDF to Text
          </Link>{" "}
          will give you the characters exactly as the file stores them, with no guessing at all.
        </p>

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress
                phase={progress ? `PAGE ${progress.page} OF ${progress.pageCount}` : "READING"}
                percent={progress?.percent ?? null}
                label="Reading text from the pages"
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result && blob && file && result.wordCount > 0 ? (
              <DownloadButton
                blob={blob}
                fileName={outputName(file.name)}
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
              ["Pages", result ? String(result.pages.length) : "—"],
              ["Words found", result ? result.wordCount.toLocaleString() : "—"],
              ["Pages with no text", result ? String(result.emptyPages.length) : "—"],
              /*
                Tesseract's own mean over the pages it found anything on, shown
                because it is the only signal the engine offers about its own
                output — and shown as a number rather than a verdict, because
                it is not one. Nothing gates on it. Same rule /image-to-text
                applies to a single picture.
              */
              ["Confidence", meanConfidence === null ? "—" : `${meanConfidence}%`],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="LANGUAGE">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            English, using the Latin alphabet. Other languages each need their own model file, and
            only the English one is served here.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="THE ENGINE">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Tesseract, compiled to WebAssembly — 4.9 MB, fetched from this site the first time you
            read a document and never before. The same engine Image to Text uses, so if you have
            already used that one this costs nothing. The PDF is not uploaded: the engine comes to
            it.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT YOU GET">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The same PDF, with invisible text laid over each page so it can be searched, selected
            and copied. Reading order runs down the page, so columns come out one after another,
            and a table loses its rows and columns. The file grows a little. Nothing is removed —
            this is not redaction.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
