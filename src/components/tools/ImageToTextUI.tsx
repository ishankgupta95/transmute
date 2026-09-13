"use client";

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
import { triggerDownload } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import type { OcrResult } from "@/lib/tools/ocr";
import { cn } from "@/lib/utils/cn";

/** Matches PdfToTextUI's pane ring; see the note there for why it needs `outline-solid`. */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

/** As in PdfToTextUI: a `<pre>` lays out every character it is handed. */
const PREVIEW_LIMIT = 20_000;

/** `receipt.jpg` → `receipt.txt`. */
function textFileName(imageName: string): string {
  return `${imageName.replace(/\.[^.]+$/, "")}.txt`;
}

/**
 * The engine's raw status strings, title-cased for the progress strip.
 *
 * Deliberately NOT a lookup table keyed on the statuses tesseract.js emits
 * today: that list is the library's, and a version that renames a step would
 * leave a table showing the wrong phase, or nothing. Whatever it says is what
 * is shown.
 */
function phaseLabel(phase: string): string {
  if (!phase) return "READING";
  return phase.toUpperCase();
}

export function ImageToTextUI({ acceptFormats }: { acceptFormats: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [phase, setPhase] = useState<string>("");
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);
  const { copied, copy, clear: clearCopied } = useCopied();

  /*
    There is no cooperative cancel here, and pretending otherwise would be the
    dishonest option. `worker.recognize` is one call into wasm with no signal
    and no yield point, so a run cannot be stopped part-way; what this ref does
    is mark a run STALE, so a slow first file that lands after the user has
    already dropped a second one cannot overwrite the second one's result.
    The worker is still terminated in `recognizeImage`'s `finally`.
  */
  const runRef = useRef(0);
  useEffect(() => () => void (runRef.current += 1), []);

  const text = result?.text ?? "";
  const blob = useMemo(() => new Blob([text], { type: "text/plain;charset=utf-8" }), [text]);
  const lines = useMemo(() => lineCount(text), [text]);
  const preview = useMemo(
    () => (text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) : text),
    [text],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      const f = files[0];
      if (!f) return;
      const run = (runRef.current += 1);

      setFile(f);
      setResult(null);
      setError(null);
      setElapsed(null);
      setPhase("");
      setPercent(0);
      setStatus("processing");
      clearCopied();

      const startedAt = performance.now();
      try {
        const { recognizeImage } = await import("@/lib/tools/ocr");
        const recognised = await recognizeImage(f, {
          onProgress: ({ phase: p, fraction }) => {
            if (runRef.current !== run) return;
            setPhase(p);
            setPercent(Math.round(fraction * 100));
          },
        });
        if (runRef.current !== run) return;
        setResult(recognised);
        const ms = performance.now() - startedAt;
        setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
        setStatus("done");
      } catch (err) {
        if (runRef.current !== run) return;
        setError(err instanceof Error ? err.message : "Could not read text from this image");
        setStatus("error");
      } finally {
        if (runRef.current === run) setPercent(null);
      }
    },
    [clearCopied],
  );

  const handleReset = useCallback(() => {
    runRef.current += 1;
    setFile(null);
    setResult(null);
    setError(null);
    setElapsed(null);
    setPercent(null);
    setPhase("");
    setStatus("idle");
    clearCopied();
  }, [clearCopied]);

  const handleCopy = useCallback(() => void copy(text), [copy, text]);
  const handleDownload = useCallback(() => {
    if (file) triggerDownload(blob, textFileName(file.name));
  }, [blob, file]);

  if (!file) return <DropZone accept={acceptFormats} onFiles={handleFiles} />;

  return (
    <>
      {/* ── Canvas: the recognised text ─────────────────────────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={result ? `${text.length.toLocaleString()} CHARACTERS` : undefined}
        />

        {/*
          An empty result is the ONE outcome this tool must not dress up. OCR
          always returns — a photo of a wall comes back as the empty string,
          not as an error — so gating the download on `text` being non-empty is
          what stops the tool handing over a 0-byte .txt that looks like a
          successful read. Same rule PdfToTextUI applies to a PDF of scans.
        */}
        {result?.empty && (
          <WarningMessage
            message="No text came out of this image. That usually means there is none to find, but low resolution, heavy skew, handwriting or text over a busy background all look the same from here. This reads printed text; it is not trained on handwriting."
          />
        )}

        <TextPanes columns={1}>
          <TextPane
            tone="out"
            label="Recognised text"
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
              aria-label="Recognised text"
            >
              {preview}
            </pre>
          </TextPane>
        </TextPanes>

        {text.length > PREVIEW_LIMIT && (
          <CanvasFootnote>
            PREVIEWING THE FIRST {PREVIEW_LIMIT.toLocaleString()} OF {text.length.toLocaleString()}{" "}
            CHARACTERS — COPY AND DOWNLOAD CARRY ALL OF IT
          </CanvasFootnote>
        )}

        <CanvasFootnote>
          OCR IS A GUESS, NOT A TRANSCRIPT — CHECK ANYTHING THAT MATTERS AGAINST THE PICTURE
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      {/* ── Controls ────────────────────────────────────────────────── */}
      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress
                phase={phaseLabel(phase)}
                percent={percent}
                label="Reading text from the image"
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
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
            <ToolResetLink onClick={handleReset} label="CHANGE IMAGE" />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Characters", result ? text.length.toLocaleString() : "—"],
              ["Lines", result ? lines.toLocaleString() : "—"],
              /*
                Tesseract's own mean confidence, shown because it is the only
                signal the engine offers about its own output — and shown as a
                number rather than a verdict, because it is not one. A clean
                render scores in the high 90s; a bad photo can score well and
                still be wrong. Nothing gates on it.
              */
              ["Confidence", result ? `${Math.round(result.confidence)}%` : "—"],
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
          {/*
            The same disclosure QpdfToolShell makes, for the same reason: this
            is the one tool on the site that fetches 4.9 MB, and the visitor
            should meet that number here rather than in the network panel. It
            deliberately does NOT claim the engine is already stored — that
            needs a Cache API lookup this component does not make, and
            eviction is per-origin, total and silent.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Tesseract, compiled to WebAssembly — 4.9 MB, fetched from this site the first time you
            read an image and never before. The picture is not uploaded: the engine comes to it.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT YOU GET">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Printed text, in reading order down the page. Columns come out one after another rather
            than side by side, and a table loses its rows and columns — the cells arrive as separate
            lines. Handwriting is not supported at all.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
