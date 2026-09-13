"use client";

import { useCallback, useMemo, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
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
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { triggerDownload } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import type { TabularResult } from "@/lib/tools/contacts-calendar-csv";
import { cn } from "@/lib/utils/cn";

/** Matches PdfToTextUI's pane ring; see the note there for `outline-solid`. */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

const PREVIEW_LIMIT = 20_000;

type Kind = "vcf" | "ics";

const COPY: Record<
  Kind,
  { accept: string; noun: string; plural: string; empty: string; footnote: string }
> = {
  vcf: {
    accept: ".vcf,.vcard",
    noun: "contact",
    plural: "contacts",
    empty:
      "No contacts came out of this file. A .vcf holds one or more BEGIN:VCARD blocks; if this one was exported from something unusual, or is a directory of files rather than a single export, there may be nothing here to read.",
    footnote: "NOTHING LEFT THIS TAB — YOUR ADDRESS BOOK WAS READ IN THE BROWSER",
  },
  ics: {
    accept: ".ics,.ical,.ifb",
    noun: "event",
    plural: "events",
    empty:
      "No events came out of this file. A .ics holds one or more BEGIN:VEVENT blocks; a calendar containing only to-dos, journal entries or free/busy blocks has no events for this to list.",
    footnote: "NOTHING LEFT THIS TAB — YOUR CALENDAR WAS READ IN THE BROWSER",
  },
};

function outputName(name: string): string {
  return `${name.replace(/\.[^.]+$/, "")}.csv`;
}

export function ContactsCalendarCsvUI({ kind }: { kind: Kind }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<TabularResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<string | null>(null);
  const { copied, copy, clear: clearCopied } = useCopied();

  const copyFor = COPY[kind];
  const csv = result?.csv ?? "";
  const blob = useMemo(
    () => new Blob([csv], { type: "text/csv;charset=utf-8" }),
    [csv],
  );
  const preview = useMemo(
    () => (csv.length > PREVIEW_LIMIT ? csv.slice(0, PREVIEW_LIMIT) : csv),
    [csv],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setResult(null);
      setError(null);
      setElapsed(null);
      clearCopied();

      const startedAt = performance.now();
      try {
        const text = await f.text();
        const { vcardToCsv, icsToCsv } = await import("@/lib/tools/contacts-calendar-csv");
        const parsed = kind === "vcf" ? vcardToCsv(text) : icsToCsv(text);
        setResult(parsed);
        const ms = performance.now() - startedAt;
        setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read this file");
      }
    },
    [clearCopied, kind],
  );

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    setElapsed(null);
    clearCopied();
  }, [clearCopied]);

  if (!file) return <DropZone accept={copyFor.accept} onFiles={handleFiles} />;

  const rowCount = result?.rows.length ?? 0;

  return (
    <>
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={
            result
              ? `${rowCount} ${rowCount === 1 ? copyFor.noun.toUpperCase() : copyFor.plural.toUpperCase()}`
              : undefined
          }
        />

        {result && rowCount === 0 && <WarningMessage message={copyFor.empty} />}

        {/*
          The dropped-property list. A converter that quietly discards half a
          contact is the failure mode here — nothing errors, the CSV looks
          fine, and the data is gone. Naming what was left out is the whole
          difference between a conversion and a lossy one, and it is why the
          engine returns `droppedProperties` at all.
        */}
        {result && result.droppedProperties.length > 0 && (
          <WarningMessage
            message={`These properties were in the file and have no column, so they are not in the CSV: ${result.droppedProperties.join(", ")}. Everything else came across.`}
          />
        )}

        {result && result.emptyRecords > 0 && (
          <WarningMessage
            message={`${result.emptyRecords} ${
              result.emptyRecords === 1 ? "record" : "records"
            } parsed but carried nothing this tool reads, so ${
              result.emptyRecords === 1 ? "it is" : "they are"
            } not in the table.`}
          />
        )}

        <TextPanes columns={1}>
          <TextPane
            tone="out"
            label="CSV"
            lines={lineCount(csv)}
            size={formatFileSize(blob.size)}
            action={
              csv ? (
                <>
                  <button
                    onClick={() => void copy(csv)}
                    className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button
                    onClick={() => triggerDownload(blob, outputName(file.name))}
                    className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                  >
                    Download
                  </button>
                </>
              ) : undefined
            }
          >
            <pre tabIndex={0} role="region" className={cn(TEXT_PANE_BODY, PANE_FOCUS)} aria-label="CSV">
              {preview}
            </pre>
          </TextPane>
        </TextPanes>

        {csv.length > PREVIEW_LIMIT && (
          <CanvasFootnote>
            PREVIEWING THE FIRST {PREVIEW_LIMIT.toLocaleString()} OF {csv.length.toLocaleString()}{" "}
            CHARACTERS — COPY AND DOWNLOAD CARRY ALL OF IT
          </CanvasFootnote>
        )}

        <CanvasFootnote>{copyFor.footnote}</CanvasFootnote>

        {error && <ErrorMessage message={error} />}
      </div>

      <ToolAside
        footer={
          <>
            {elapsed && <ToolDone elapsed={elapsed} />}
            {csv && (
              <DownloadButton
                blob={blob}
                fileName={outputName(file.name)}
                className="w-full justify-center"
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              [copyFor.plural.replace(/^./, (c) => c.toUpperCase()), result ? String(rowCount) : "—"],
              ["Columns", result ? String(result.headers.length) : "—"],
              ["Left out", result ? String(result.droppedProperties.length) : "—"],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="COLUMNS">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {kind === "vcf"
              ? "Derived from your file. A contact with three emails gives the sheet three email columns, numbered — not one cell with three addresses crammed in, which no importer can read back."
              : "Derived from your file. Times are written exactly as the calendar stores them, with the time zone in its own column: converting them would mean guessing which zone you wanted."}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT YOU GET">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {kind === "vcf"
              ? "One row per contact, with the name split into its parts and photos left out — a base64 portrait is not something a spreadsheet can use. Anything without a column is named above rather than dropped silently."
              : "One row per event as the file stores it. A repeating event is ONE row carrying its rule, not one row per occurrence: expanding it would mean inventing dates the file does not contain."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
