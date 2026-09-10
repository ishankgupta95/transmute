"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  lineCount,
  StatStrip,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import { downloadFilesAsZip } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  CSV_DELIMITERS,
  csvFileNames,
  csvZipName,
  excelSerialToIsoDate,
  EXAMPLE_DATE_SERIAL,
  readXlsx,
  rowsToCsv,
  XlsxReadError,
  type CsvDelimiter,
  type XlsxSheet,
  type XlsxWorkbook,
} from "@/lib/tools/xlsx";

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
 * How many rows of the selected sheet are drawn.
 *
 * The pane shows the REAL CSV — separators, quoting and all — rather than a
 * prettied table, because the quoting is the thing people come here to check.
 * A 200 000-row export would lay out 200 000 lines in a `<pre>` for no reason;
 * the download and the copy button carry every row either way, and the
 * footnote says so whenever the cap bites.
 */
const PREVIEW_ROWS = 60;

/**
 * The preview is joined with LF while the download uses CRLF (RFC 4180, and
 * what Excel writes). A carriage return is invisible, and letting one into a
 * `<pre>` only risks the browser drawing two breaks where the file has one.
 * The rail states the real line ending.
 */
const PREVIEW_EOL = "\n";

const DELIMITER_OPTIONS = CSV_DELIMITERS.map((d) => ({ value: d.id, label: d.label }));

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * Everything the CSV cannot carry, as one sentence per kind, with every count
 * DERIVED from this workbook rather than written as a standing caveat. Empty
 * when none of it applies — a list of zeroes is reassurance, not disclosure.
 */
function lossNotes(sheets: XlsxSheet[], workbook: XlsxWorkbook): string[] {
  const { styleTableRead, sharedStringsRead, date1904 } = workbook;
  const notes: string[] = [];
  const sum = (pick: (s: XlsxSheet) => number) => sheets.reduce((n, s) => n + pick(s), 0);

  /*
    The epoch and the worked example are both read off THIS workbook. A file
    carrying `<workbookPr date1904="1"/>` counts its serials from 1904-01-01,
    which is 1462 days away from the usual reading of the same number, so a
    hardcoded pair is wrong for those files even when its arithmetic is right.
  */
  const epoch = date1904 ? "1904-01-01" : "1899-12-30";
  const exampleDate = excelSerialToIsoDate(EXAMPLE_DATE_SERIAL, date1904);
  const example = exampleDate ? ` — ${EXAMPLE_DATE_SERIAL} rather than ${exampleDate}` : "";

  const dates = sum((s) => s.dateFormattedCells);
  const numbers = sum((s) => s.numericCells);
  if (!styleTableRead && numbers > 0) {
    // Only worth saying when there is something to be in doubt about: a sheet
    // with no numbers in it has no dates in it either, style table or not.
    notes.push(
      `This workbook has no readable style table, and a date in XLSX is only a date because a style says so. ${numbers} ${plural(numbers, "cell holds", "cells hold")} a plain number and there is no way to tell which of ${plural(numbers, "it is", "them are")} really a date, so ${plural(numbers, "it comes", "they come")} out exactly as stored — a date among them would read as a count of days since ${epoch}.`,
    );
  } else if (styleTableRead && dates > 0) {
    notes.push(
      `${dates} ${plural(dates, "cell")} in the selected ${plural(sheets.length, "sheet")} ${plural(dates, "carries", "carry")} a date or time format, and the raw serial number is what the CSV holds${example}. XLSX stores a date as a plain count of days since ${epoch} and leaves the rendering to a style, and this tool does not re-implement Excel's format language: a date written on the wrong calendar is a silent error, where a bare number is an obvious one.`,
    );
  }

  const unresolved = sum((s) => s.unresolvedSharedStrings);
  if (unresolved > 0) {
    // The worst loss this reader can inflict, and the only one that would
    // otherwise leave the screen looking like a clean conversion.
    notes.push(
      `${unresolved} ${plural(unresolved, "cell")} ${plural(unresolved, "points at", "point at")} a shared string this workbook does not contain, so ${plural(unresolved, "it comes", "they come")} out empty rather than as text${
        sharedStringsRead
          ? " — the string table is there, but those indexes run past the end of it"
          : " — the string table every text cell indexes into (xl/sharedStrings.xml) is missing from the package altogether"
      }. That is a damaged file rather than anything this conversion did; re-export it from Excel if you can.`,
    );
  }

  const formulas = sum((s) => s.formulaCells);
  if (formulas > 0) {
    notes.push(
      `${formulas} ${plural(formulas, "cell")} ${plural(formulas, "is a formula", "are formulas")}. The CSV carries the value Excel last calculated and saved beside ${plural(formulas, "it", "them")}, not the formula, and nothing is recalculated here.`,
    );
  }

  const errors = sum((s) => s.errorCells);
  if (errors > 0) {
    notes.push(
      `${errors} ${plural(errors, "cell")} ${plural(errors, "holds", "hold")} an Excel error value such as #REF! or #DIV/0!, and ${plural(errors, "it comes", "they come")} through as that literal text.`,
    );
  }

  const hidden = sheets.filter((s) => s.hidden).length;
  if (hidden > 0) {
    notes.push(
      `${hidden} of the selected ${plural(sheets.length, "sheet")} ${plural(hidden, "is", "are")} hidden in Excel. Hidden is a display setting rather than a lock, so the rows are exported in full — untick ${plural(hidden, "it", "them")} above if that is not what you want.`,
    );
  }

  return notes;
}

export function XlsxToCsvUI() {
  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XlsxWorkbook | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
    Selection and preview are keyed by sheet INDEX rather than by name. Excel
    will not let two tabs share a name, but a file written by something else
    can, and a name key would then tick both at once and collide on React's
    reconciliation key.
  */
  const [selected, setSelected] = useState<number[]>([]);
  const [active, setActive] = useState(0);
  const [delimiterId, setDelimiterId] = useState<CsvDelimiter["id"]>("comma");
  const [bom, setBom] = useState(false);
  const { copied, copy } = useCopied();

  const delimiter = useMemo(
    () => CSV_DELIMITERS.find((d) => d.id === delimiterId) ?? CSV_DELIMITERS[0],
    [delimiterId],
  );

  // Memoised so every list derived from it stays referentially stable — the
  // CSV for a large sheet is built inside those memos and must not be rebuilt
  // on an unrelated keystroke.
  const sheets = useMemo(() => workbook?.sheets ?? [], [workbook]);
  const activeSheet = sheets[active] ?? sheets[0] ?? null;
  const selectedSheets = useMemo(
    () => sheets.filter((_, i) => selected.includes(i)),
    [sheets, selected],
  );

  /*
    `arrayBuffer()` is async, so a slow first read can resolve AFTER a second
    file has replaced it and hand the tool the wrong rows under the right
    filename. Every load and the reset bump this token, and a read whose token
    is stale drops its result on the floor.
  */
  const loadToken = useRef(0);

  const handleFiles = useCallback(async (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    const token = ++loadToken.current;
    setFile(picked);
    setWorkbook(null);
    setError(null);
    setSelected([]);
    setActive(0);
    setReading(true);
    try {
      const buffer = await picked.arrayBuffer();
      const parsed = await readXlsx(buffer, picked.name);
      if (loadToken.current !== token) return;
      setWorkbook(parsed);
      setSelected(parsed.sheets.map((_, i) => i));
      setActive(0);
    } catch (err) {
      if (loadToken.current !== token) return;
      // `XlsxReadError` already carries a sentence written for the user — an
      // old .xls, an encrypted package, a truncated ZIP. Anything else is a
      // surprise, and saying so beats inventing a reason.
      setError(
        err instanceof XlsxReadError
          ? err.message
          : err instanceof Error
            ? `This workbook could not be read: ${err.message}`
            : "This workbook could not be read.",
      );
    } finally {
      if (loadToken.current === token) setReading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    loadToken.current++;
    setFile(null);
    setWorkbook(null);
    setError(null);
    setSelected([]);
    setActive(0);
    setReading(false);
  }, []);

  const toggleSheet = useCallback((index: number) => {
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((n) => n !== index) : [...prev, index],
    );
  }, []);

  /** The CSV for one sheet, exactly as it will be saved. */
  const csvFor = useCallback(
    (sheet: XlsxSheet) => rowsToCsv(sheet.rows, { delimiter: delimiter.char, bom }),
    [delimiter, bom],
  );

  const previewCsv = useMemo(() => {
    if (!activeSheet) return "";
    // Drawn without the byte-order mark: it is an invisible character, and
    // rendering it would only put a stray glyph at the top of the pane.
    return rowsToCsv(activeSheet.rows.slice(0, PREVIEW_ROWS), {
      delimiter: delimiter.char,
      eol: PREVIEW_EOL,
    });
  }, [activeSheet, delimiter]);

  const activeBlob = useMemo(
    () =>
      activeSheet
        ? new Blob([csvFor(activeSheet)], { type: "text/csv;charset=utf-8" })
        : null,
    [activeSheet, csvFor],
  );

  const outputFiles = useMemo(() => {
    // Names are allocated for the whole batch at once, because uniqueness is a
    // property of the SET — two sheets sharing a name would otherwise put two
    // identical entries in one ZIP and lose the first.
    const names = csvFileNames(
      file?.name ?? "workbook",
      selectedSheets.map((s) => s.name),
    );
    return selectedSheets.map((sheet, i) => ({
      blob: new Blob([csvFor(sheet)], { type: "text/csv;charset=utf-8" }),
      name: names[i],
    }));
  }, [selectedSheets, csvFor, file]);

  const downloadAll = useCallback(() => {
    if (!file) return;
    // One ZIP rather than N synchronous downloads — browsers throttle those
    // and only the first would save. The helper hands a lone file over bare.
    void downloadFilesAsZip(outputFiles, csvZipName(file.name));
  }, [outputFiles, file]);

  const handleCopy = useCallback(() => {
    if (activeSheet) void copy(csvFor(activeSheet));
  }, [copy, csvFor, activeSheet]);

  const notes =
    workbook && selectedSheets.length > 0 ? lossNotes(selectedSheets, workbook) : [];
  const truncated = (activeSheet?.rowCount ?? 0) > PREVIEW_ROWS;
  const totalRows = selectedSheets.reduce((n, s) => n + s.rowCount, 0);

  return (
    <>
      {/* ── Canvas: the workbook that came in, the CSV going out ─────── */}
      <div className={CANVAS_COLUMN}>
        {!file ? (
          <DropZone
            accept=".xlsx"
            onFiles={handleFiles}
            label="Drop an .xlsx workbook to begin"
            acceptLabel="XLSX"
          />
        ) : (
          <>
            <CanvasHeader
              file={file.name}
              meta={`${formatFileSize(file.size)}${
                sheets.length > 0 ? ` · ${sheets.length} ${plural(sheets.length, "sheet")}` : ""
              }`}
              trailing={activeSheet ? activeSheet.name.toUpperCase() : undefined}
            />

            {error && <ErrorMessage message={error} />}
            {notes.length > 0 && <WarningMessage message={notes.join(" ")} />}

            {activeSheet && (
              <StatStrip
                stats={[
                  { label: "ROWS", value: activeSheet.rowCount.toLocaleString() },
                  { label: "COLUMNS", value: String(activeSheet.columnCount) },
                  {
                    label: "SHEETS OUT",
                    value: `${selectedSheets.length} of ${sheets.length}`,
                    tone: selectedSheets.length === 0 ? "neutral" : "accent",
                  },
                  {
                    label: "DATE CELLS",
                    // "UNKNOWN" only where it is genuinely unknown. With no
                    // style table AND no numbers, zero is a fact, not a guess.
                    value: workbook?.styleTableRead
                      ? activeSheet.dateFormattedCells.toLocaleString()
                      : activeSheet.numericCells === 0
                        ? "0"
                        : "UNKNOWN",
                    tone:
                      (workbook?.styleTableRead && activeSheet.dateFormattedCells === 0) ||
                      (!workbook?.styleTableRead && activeSheet.numericCells === 0)
                        ? "neutral"
                        : "accent",
                  },
                ]}
              />
            )}

            <TextPanes columns={1}>
              <TextPane
                tone="out"
                label={
                  activeSheet
                    ? `${activeSheet.name} · ${delimiter.label}-separated`
                    : reading
                      ? "Reading the workbook"
                      : "Nothing to show"
                }
                lines={lineCount(previewCsv)}
                size={activeBlob ? formatFileSize(activeBlob.size) : undefined}
                action={
                  activeBlob ? (
                    <button
                      onClick={handleCopy}
                      aria-label={copied ? "Copied CSV" : "Copy CSV"}
                      className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  ) : undefined
                }
              >
                <pre
                  tabIndex={0}
                  role="region"
                  className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                  aria-label="CSV preview"
                >
                  {reading
                    ? "Unpacking the workbook…"
                    : previewCsv ||
                      (activeSheet ? "This sheet holds no cells with values in them." : "")}
                </pre>
              </TextPane>
            </TextPanes>

            {truncated && activeSheet && (
              <CanvasFootnote>
                PREVIEWING THE FIRST{" "}
                {PREVIEW_ROWS}{" "}
                OF{" "}
                {activeSheet.rowCount.toLocaleString()}{" "}
                ROWS — COPY AND DOWNLOAD CARRY ALL OF THEM
              </CanvasFootnote>
            )}
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ────────── */}
      <ToolAside
        footer={
          file ? (
            <>
              {outputFiles.length === 1 ? (
                // One sheet saves as a bare .csv. Routing it through the ZIP
                // helper would save it bare anyway, under a button that had
                // promised a ZIP.
                <DownloadButton
                  blob={outputFiles[0].blob}
                  fileName={outputFiles[0].name}
                  className="w-full justify-center"
                />
              ) : (
                <ToolActions
                  primaryLabel={
                    outputFiles.length > 1
                      ? `Download ${outputFiles.length} CSVs (ZIP)`
                      : "Download CSV"
                  }
                  onPrimary={downloadAll}
                  primaryDisabled={outputFiles.length === 0}
                />
              )}
              <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
            </>
          ) : undefined
        }
      >
        {sheets.length > 0 && (
          <ToolAsideSection label="SHEETS">
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {sheets.map((sheet, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <input
                    id={`xlsx-sheet-${i}`}
                    type="checkbox"
                    checked={selected.includes(i)}
                    onChange={() => toggleSheet(i)}
                    className="size-4 shrink-0 rounded-sm border-border accent-accent"
                  />
                  <label
                    htmlFor={`xlsx-sheet-${i}`}
                    className="min-w-0 flex-1 cursor-pointer truncate font-body text-[12.5px] text-neutral-300"
                  >
                    {sheet.name}
                    {sheet.hidden && (
                      <span className="ml-1.5 font-mono text-[9.5px] tracking-[0.08em] text-text-muted">
                        HIDDEN
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => setActive(i)}
                    aria-label={`Preview ${sheet.name}`}
                    className={cn(
                      "shrink-0 cursor-pointer rounded-sm font-mono text-[10px] leading-none tracking-[0.04em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      i === active
                        ? "text-accent"
                        : "text-text-muted hover:text-accent-200",
                    )}
                  >
                    {sheet.rowCount.toLocaleString()}×{sheet.columnCount}
                  </button>
                </div>
              ))}
            </div>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Every ticked sheet becomes its own CSV. Click a sheet&rsquo;s row × column count
              to preview it. One sheet saves as a{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">.csv</code>; two or
              more come down as a single ZIP, because a browser cancels most of a burst of
              downloads fired at once.
            </span>
          </ToolAsideSection>
        )}

        <ToolControlGroup>
          <ToolControl label="SEPARATOR">
            <ToolChoice
              label="Field separator"
              fill
              value={delimiterId}
              onChange={setDelimiterId}
              options={DELIMITER_OPTIONS}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {delimiter.note}
            </span>
          </ToolControl>

          <ToolControl label="ENCODING">
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={bom}
                onChange={(e) => setBom(e.target.checked)}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Start the file with a UTF-8 byte-order mark
            </label>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              The download is UTF-8 either way. Excel on Windows reads a CSV in the system
              codepage unless the file opens with this three-byte mark, so accented names
              arrive mangled without it. It is off by default because many scripting and
              command-line readers hand the mark back as part of the first column&rsquo;s
              name, and that is a failure you do not see until something downstream breaks.
            </span>
          </ToolControl>
        </ToolControlGroup>

        {file && (
          <ToolAsideSection label="OUTPUT">
            <ToolOutput
              rows={[
                [
                  "Sheets out",
                  sheets.length ? `${selectedSheets.length} of ${sheets.length}` : "—",
                ],
                ["Rows out", sheets.length ? totalRows.toLocaleString() : "—"],
                [
                  "Saves as",
                  outputFiles.length === 0
                    ? "—"
                    : outputFiles.length === 1
                      ? outputFiles[0].name
                      : csvZipName(file.name),
                ],
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Fields are quoted only where RFC 4180 requires it — when a value contains the
              separator, a double quote or a line break — and internal quotes are doubled.
              Rows end with CRLF, which is what Excel writes. Empty cells and empty rows in
              the middle of a sheet are kept as empty fields rather than closed up. Nothing is
              uploaded: the workbook is unzipped and parsed in this tab.
            </span>
          </ToolAsideSection>
        )}
      </ToolAside>
    </>
  );
}
