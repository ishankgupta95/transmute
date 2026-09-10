"use client";

import { useCallback, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import type { PdfFormReport, PdfFormValues } from "@/lib/tools/pdf-engine";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN, MONO_LABEL, SCROLL_CLASS, STAGE_GROW } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";

/*
  ── Fill PDF Form ────────────────────────────────────────────────────────

  Two engine calls: `readPdfForm` on drop (it parses and saves nothing), then
  `fillPdfForm(bytes, values, { flatten })` when the user asks for it. The
  surface between them is one editor per field, chosen by the field's KIND, and
  a set of refusals that are stated as sentences rather than thrown as errors.

  MEASURED FACTS this file is built on. Every one was produced by running
  pdf-lib 1.17.1 out of this repo's own node_modules against documents built
  for the purpose — not read in a doc:

  1. ONLY CHANGED FIELDS ARE SENT, and that is not tidiness. `PDFDocument.save()`
     runs `form.updateFieldAppearances()` with an embedded HELVETICA for every
     DIRTY field (pdf-lib/cjs/api/form/PDFForm.js:33-35, 535-545), and the text
     provider REWRITES that field's `/DA` with the font it was handed
     (api/form/appearances.js:212-275). Measured on a field whose producer set
     `/DA` to `1 0 0 rg /Cour 9 Tf`: after one `setText`, the same field's `/DA`
     reads `1 0 0 rg\n/Helvetica 9 Tf` — colour and size kept, FONT REPLACED —
     while a field left untouched in the same document still read
     `1 0 0 rg /Cour 9 Tf`. Re-sending a value the user never edited would
     restyle a field for nothing, so `changedValues()` sends only what moved.

  2. A READ-ONLY FIELD IS NOT PROTECTED BY THE LIBRARY. Measured:
     `setText("changed")` on a field with the read-only flag set neither throws
     nor is ignored — it succeeds and the document saves. `applyFieldValue`
     (pdf-engine-core.ts:2437-2472) does not check the flag either. So the lock
     on a read-only field is THIS component excluding it from the values object,
     and nowhere else. That is why `describeRows()` computes `editable` and why
     `changedValues()` reads the same flag.

  3. THE STANDARD FONT IS WinAnsi-ONLY, and the throw is not catchable in a
     useful place: `save()` fails with `WinAnsi cannot encode "日" (0x65e5)`
     after the values are already in the document. Latin is fine — measured OK
     for `Café — "quote" €10`. `unsupportedCharacters()` below pre-flights it
     so the primary is disabled BEFORE the run rather than after.

  4. `/NeedAppearances` WIDENS THE BLAST RADIUS OF (3). `fillPdfForm` calls
     `markEveryFieldDirty(form)` when that flag is set and flattening was asked
     for (pdf-engine-core.ts:2426-2427), which redraws EVERY field — including
     ones this page never touched. Measured on a document holding a CJK value
     in a field nobody edited: filling a Latin field alone saved fine, and the
     same edit with every field marked dirty threw
     `WinAnsi cannot encode "日"`. So the pre-flight widens to every stored
     value exactly when `flatten && needAppearances`, and not otherwise.

  5. `maxLength` IS ENFORCED BY pdf-lib WITH A THROW:
     `Attempted to set text with length=8 for TextField with maxLength=5`.
     The `maxLength` attribute on the input stops typing past it; the
     `overLimit` guard covers a STORED value that already exceeds the field's
     own limit, which the attribute cannot truncate.

  6. `flattenBlockedBy` OVER-REPORTS, and the copy says so instead of implying
     the listed fields are impossible. Measured by deleting `/AP` from one
     field at a time and calling `flatten()`: a TEXT field, a DROPDOWN and a
     CHECK BOX all flattened fine (pdf-lib regenerates their appearances first),
     while a RADIO GROUP threw `Unexpected N type: undefined` — and the
     subsequent `save()` threw `Expected instance of PDFDict or PDFStream…`,
     because `flatten()` deletes fields as it bakes them and a throw part-way
     leaves the document unsaveable. Filling that same document WITHOUT
     flattening worked and the value read back, so "fill still works" is a
     measured claim and not a hopeful one. A second fill does NOT repair it:
     after a fill-only save the radio widgets were still missing `/AP` and
     `flatten()` threw again, so this page must not suggest that workaround.
*/

/** The report's own field type, so there is no second definition to keep in step. */
type FormField = PdfFormReport["fields"][number];
type FieldValue = string | string[] | boolean;

/**
 * The five kinds `applyFieldValue` actually writes.
 *
 * Mirrors the switch at pdf-engine-core.ts:2437-2472 exactly: everything else
 * falls to its `default`, which returns without touching the field. Offering a
 * control for a push button or a signature field would therefore be a control
 * that does nothing at all.
 */
const EDITABLE_KINDS = new Set<FormField["kind"]>([
  "text",
  "checkbox",
  "radio",
  "dropdown",
  "optionlist",
]);

/** Shared with the sibling flatten page so the two never name a kind differently. */
const KIND_LABEL: Record<FormField["kind"], string> = {
  text: "TEXT",
  checkbox: "CHECK BOX",
  radio: "RADIO",
  dropdown: "DROPDOWN",
  optionlist: "LIST BOX",
  button: "BUTTON",
  signature: "SIGNATURE",
  unknown: "UNKNOWN",
};

/** Why a kind has no editor. Only the three `applyFieldValue` ignores appear here. */
const UNEDITABLE_NOTE: Partial<Record<FormField["kind"], string>> = {
  button:
    "A push button runs an action in a reader — it holds no value, so there is nothing here to fill in.",
  signature:
    "A signature field. This page writes no value into one and places no signature; it is listed so you can see it is there.",
  unknown:
    "This engine could not tell what kind of field this is from the document's own /FT entry, so it offers no control and writes nothing to it.",
};

const FIELD_INPUT = cn(
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 font-body text-[12.5px]",
  "text-text-primary placeholder:text-text-muted",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  "disabled:cursor-not-allowed disabled:opacity-45",
);

const ROW_NOTE = "font-body text-[10.5px] leading-[1.5] text-text-muted";
const RAIL_NOTE = "font-body text-[10.5px] leading-[1.5] text-text-muted";

/**
 * The characters a standard PDF font can draw, as a character class.
 *
 * DERIVED, NOT GUESSED. `unsupportedStampCharacters` in `pdf-engine-core`
 * answers the same question by probing an embedded pdf-lib font — which is
 * exactly the 705 KB import a tool component must not make, and it cannot be
 * asked during render anyway. So the set was enumerated once from that very
 * font: every code point from U+0000 to U+FFFF plus a handful of astral ones
 * was pushed through `Helvetica.widthOfTextAtSize`, and the 218 that encode
 * are the ranges below. Re-checked against the font afterwards — 63,492 code
 * points, ZERO disagreements in either direction.
 *
 * What that means in words: the Latin alphabet, Latin-1 accents, curly quotes,
 * dashes, the euro and a few typographic odds and ends. Not CJK, not Cyrillic,
 * not Greek, not Arabic, not emoji.
 */
const WINANSI =
  /[\u0020-\u007E\u00A0-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018-\u201A\u201C-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/;

/**
 * The characters in `text` that cannot be drawn, in the order they appear.
 *
 * Whitespace is skipped for the same reason `unsupportedStampCharacters` skips
 * newlines: pdf-lib's own layout normalises it before any glyph is asked for —
 * `cleanText` turns a tab into spaces — and measured, a value carrying `\n`,
 * `\r\n` or `\t` saves fine in both a single-line and a multiline field.
 */
function unsupportedCharacters(text: string): string[] {
  const bad: string[] = [];
  for (const character of text) {
    if (character === "\n" || character === "\r" || character === "\t") continue;
    if (WINANSI.test(character)) continue;
    if (!bad.includes(character)) bad.push(character);
  }
  return bad;
}

/*
  The engine's `value` is `string | string[] | boolean | null` and the shape
  varies by kind in ways worth pinning down rather than assuming: pdf-lib's
  `PDFDropdown.getSelected()` and `PDFOptionList.getSelected()` both return an
  ARRAY, `PDFRadioGroup.getSelected()` returns a string, and `null` is what
  `fieldValue` returns when its own read threw — a stored value that does not
  match the field's declared options is a real shape in the wild
  (pdf-engine-core.ts:2293-2300). These two coercions absorb all of that.
*/
function asString(value: FieldValue | null | undefined): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return "";
}

function asStringArray(value: FieldValue | null | undefined): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.length > 0 ? [value] : [];
  return [];
}

/** The editor's starting value for one field — what the document already says. */
function initialValueFor(field: FormField): FieldValue {
  switch (field.kind) {
    case "checkbox":
      return field.value === true;
    case "optionlist":
      return asStringArray(field.value);
    default:
      return asString(field.value);
  }
}

function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = asStringArray(a);
    const right = asStringArray(b);
    return left.length === right.length && left.every((entry, i) => entry === right[i]);
  }
  return a === b;
}

interface FieldRow {
  field: FormField;
  /**
   * A LATER field carrying a name an earlier one already used.
   *
   * `fillPdfForm` looks a name up with `form.getFields().find(…)`
   * (pdf-engine-core.ts:2419) — `find` stops at the first match, so a value
   * sent under a repeated name reaches exactly one field. Rather than draw two
   * editors that write to one place, the second one is locked and says so.
   */
  duplicate: boolean;
  /** Whether this page will send a value for it at all. */
  editable: boolean;
}

/** The rows the canvas draws, in document order. */
function describeRows(report: PdfFormReport | null): FieldRow[] {
  const seen = new Set<string>();
  return (report?.fields ?? []).map((field) => {
    const duplicate = seen.has(field.name);
    seen.add(field.name);
    return {
      field,
      duplicate,
      editable: !duplicate && !field.readOnly && EDITABLE_KINDS.has(field.kind),
    };
  });
}

function initialValues(report: PdfFormReport): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const row of describeRows(report)) {
    if (row.duplicate) continue;
    out[row.field.name] = initialValueFor(row.field);
  }
  return out;
}

/**
 * The values object handed to the engine: the edited fields, and nothing else.
 *
 * Called from the run handler AND during render, so the count on screen and the
 * payload that is sent can never be two different things.
 */
function changedValues(
  report: PdfFormReport | null,
  values: Record<string, FieldValue>,
): PdfFormValues {
  const out: PdfFormValues = {};
  for (const row of describeRows(report)) {
    if (!row.editable) continue;
    const next = values[row.field.name];
    if (next === undefined) continue;
    if (sameValue(next, initialValueFor(row.field))) continue;
    out[row.field.name] = next;
  }
  return out;
}

/** "PAGE 3" / "PAGES 1, 4" — 0-based in the report, 1-based for a human. */
function pageLabel(field: FormField): string {
  if (field.pageIndices.length === 0) return "";
  const numbers = field.pageIndices.map((index) => index + 1);
  return numbers.length === 1 ? `PAGE ${numbers[0]}` : `PAGES ${numbers.join(", ")}`;
}

function nameList(names: string[]): string {
  return names.length > 6 ? `${names.slice(0, 6).join(", ")} and ${names.length - 6} more` : names.join(", ");
}

/** The run's own facts ride on the result, so a readout can never describe a different run. */
interface FillRun {
  blob: Blob;
  flattened: boolean;
  written: number;
}

export function FillPdfFormUI() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<PdfFormReport | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [flatten, setFlatten] = useState(false);
  const [status, setStatus] = useState<"idle" | "reading" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<FillRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment an input changes.
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    Stale-result invalidation, the contract every tool on this site keeps: a
    control that changes what a run would produce must DROP the finished file,
    not leave it downloadable under settings that no longer describe it.

    A token rather than a boolean, because clearing state is not enough on its
    own — the read and the fill are both async and nothing cancels them. Swap
    the file mid-read and the old document's field list would land on the new
    one; edit a field mid-fill and the old bytes would be published under the
    new edits. A run claims the token before its first await and commits
    nothing unless it still holds it. A ref, not state: the check has to see
    the value at the moment the promise settles.
  */
  const runToken = useRef(0);

  const invalidate = useCallback(() => {
    runToken.current += 1;
    setResult(null);
    setElapsed(null);
    setError(null);
    setStatus((current) => (current === "done" || current === "error" ? "idle" : current));
  }, []);

  const readForm = useCallback(async (source: File, token: number) => {
    try {
      const { readPdfForm } = await import("@/lib/tools/pdf-engine");
      const next = await readPdfForm(await source.arrayBuffer());
      // Superseded: the file this read was for is no longer the loaded one.
      if (runToken.current !== token) return;
      setReport(next);
      setValues(initialValues(next));
      setStatus("idle");
    } catch (err) {
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "Failed to read this PDF's form");
      setStatus("error");
    }
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const incoming = files[0];
      if (!incoming) return;
      const token = (runToken.current += 1);
      setFile(incoming);
      setReport(null);
      setValues({});
      // Reset rather than carry: a document whose flatten is blocked must not
      // inherit a ticked box from the file before it.
      setFlatten(false);
      setResult(null);
      setElapsed(null);
      setError(null);
      setStatus("reading");
      void readForm(incoming, token);
    },
    [readForm],
  );

  const handleReset = useCallback(() => {
    runToken.current += 1;
    setFile(null);
    setReport(null);
    setValues({});
    setFlatten(false);
    setResult(null);
    setElapsed(null);
    setError(null);
    setStatus("idle");
  }, []);

  const setFieldValue = useCallback(
    (name: string, value: FieldValue) => {
      invalidate();
      setValues((current) => ({ ...current, [name]: value }));
    },
    [invalidate],
  );

  const handleRun = useCallback(async () => {
    if (!file || !report) return;
    const payload = changedValues(report, values);
    const token = (runToken.current += 1);
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();
    try {
      const { fillPdfForm } = await import("@/lib/tools/pdf-engine");
      // Re-read the bytes per run, the way every PDF page here does: the file
      // is the source of truth and a run must never build on a buffer another
      // run has been handed.
      const bytes = await fillPdfForm(new Uint8Array(await file.arrayBuffer()), payload, {
        flatten,
      });
      if (runToken.current !== token) return;
      setResult({
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        flattened: flatten,
        written: Object.keys(payload).length,
      });
      // A small form finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      if (runToken.current !== token) return;
      // The engine's refusals are written as sentences for a person to read
      // (PDF_FORM_NO_FIELDS, PDF_FORM_FLATTEN_BLOCKED), so they go through
      // verbatim rather than being paraphrased into something vaguer.
      setError(err instanceof Error ? err.message : "Failed to fill this PDF form");
      setStatus("error");
    }
  }, [file, flatten, report, values]);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  const busy = status === "reading" || status === "processing";
  const rows = describeRows(report);
  const editableRows = rows.filter((row) => row.editable);
  const pending = changedValues(report, values);
  const editedNames = Object.keys(pending);
  const duplicateNames = rows.filter((row) => row.duplicate).map((row) => row.field.name);

  const noForm = report !== null && !report.hasForm;
  // An /AcroForm with an empty /Fields is a real shape, not a theoretical one:
  // `flatten()` empties /Fields and leaves the dictionary on the catalog, so
  // an already-flattened document arrives here as hasForm with zero fields.
  const emptyForm = report !== null && report.hasForm && report.fields.length === 0;
  const blockedNames = report?.flattenBlockedBy ?? [];
  const flattenBlocked = blockedNames.length > 0;

  /*
    Everything that will be DRAWN by this run, which is what the WinAnsi
    pre-flight has to cover — not everything on screen.

    The values being sent, always. Plus EVERY field when flattening a document
    that sets /NeedAppearances, because that is the one path where the engine
    marks every field dirty and pdf-lib redraws fields this page never touched
    (pdf-engine-core.ts:2427).

    In that widened pass a field's drawn string is the one it will HOLD at save
    time, not the one it arrived with: `applyFieldValue` runs before
    `form.flatten()`, so an editable field is redrawn from what is in its editor
    right now. Reading `field.value` there instead was a real bug caught by a
    render test — a document whose only non-Latin value was in a field the user
    had already corrected stayed refused, with the offending characters no
    longer anywhere on screen. A row that is NOT editable keeps `field.value`,
    which includes a duplicate-named row: its editor belongs to the first field
    of that name, and this one is redrawn from its own stored value.
  */
  const drawn: string[] = [];
  for (const value of Object.values(pending)) {
    if (typeof value === "string") drawn.push(value);
    else if (Array.isArray(value)) drawn.push(...value);
  }
  if (flatten && report?.needAppearances) {
    for (const row of rows) {
      const atSaveTime = row.editable ? values[row.field.name] : row.field.value;
      if (typeof atSaveTime === "string") drawn.push(atSaveTime);
      else if (Array.isArray(atSaveTime)) drawn.push(...atSaveTime);
    }
  }
  const unsupported = [...new Set(drawn.flatMap(unsupportedCharacters))];

  // A stored value can already be longer than its own field's limit, and the
  // input's maxLength attribute does not truncate a value it was given.
  const overLimit = editableRows
    .filter((row) => {
      const limit = row.field.maxLength;
      return (
        row.field.kind === "text" && limit !== null && asString(values[row.field.name]).length > limit
      );
    })
    .map((row) => row.field.name);

  /*
    The document's own "required" flag, counted but NOT enforced — and the
    difference is said out loud below rather than left for the user to discover.
    Nothing in `fillPdfForm` looks at it, a reader only checks it on submit, and
    refusing to write a partly-filled form would break the ordinary case of
    saving progress. So the count informs; it never blocks.
  */
  const emptyRequired = editableRows.filter((row) => {
    if (!row.field.required) return false;
    const value = values[row.field.name];
    if (typeof value === "boolean") return !value;
    if (Array.isArray(value)) return value.length === 0;
    return asString(value).length === 0;
  }).length;

  const canRun =
    report !== null &&
    report.hasForm &&
    report.fields.length > 0 &&
    unsupported.length === 0 &&
    overLimit.length === 0 &&
    !(flatten && flattenBlocked) &&
    (editedNames.length > 0 || flatten) &&
    !busy;

  const outputLabel = result
    ? result.flattened
      ? "Filled and flattened"
      : "Filled, still editable"
    : "—";

  const fieldCount = report?.fields.length ?? 0;

  return (
    <>
      {/* ── Canvas: every field in the form, with the editor its kind needs ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={`${
            report === null
              ? "READING FORM"
              : `${fieldCount} FIELD${fieldCount === 1 ? "" : "S"}`
          } · ${formatFileSize(file.size)}`}
          trailing={
            result
              ? result.flattened
                ? "FILLED · FLATTENED"
                : "FILLED"
              : `${editedNames.length} EDITED`
          }
        />

        <CanvasStage className={cn(STAGE_GROW, "flex flex-col bg-bg-primary")}>
          {rows.length === 0 ? (
            <div className="flex min-h-[12rem] flex-1 items-center justify-center px-6 py-10 text-center">
              <span className={cn(MONO_LABEL, "text-text-muted")}>
                {report === null ? "READING THE FORM" : "NO FIELDS TO FILL"}
              </span>
            </div>
          ) : (
            <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", SCROLL_CLASS)}>
              {rows.map((row, index) => {
                const { field } = row;
                const value = values[field.name];
                const disabled = !row.editable || busy;
                const page = pageLabel(field);
                /*
                  The accessible name has to be UNIQUE, and the field name on
                  its own is not: a document with two fields called
                  `full.name` would give two controls the same name, which is
                  exactly the ambiguity a screen-reader user cannot resolve —
                  and which caught this file out in a render test. The locked
                  copy says why it is locked in the name itself.
                */
                const controlLabel = row.duplicate
                  ? `${field.name} — repeated name, locked`
                  : field.name;
                return (
                  <div
                    key={`${field.name} ${index}`}
                    className="flex flex-col gap-2 border-b border-text-primary/6 px-3.5 py-3 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="min-w-0 truncate font-body text-[12.5px] leading-[1.3] text-neutral-300">
                        {field.name}
                      </span>
                      <span className={cn(MONO_LABEL, "text-text-muted")}>
                        {KIND_LABEL[field.kind]}
                      </span>
                      {field.required && (
                        <span className={cn(MONO_LABEL, "text-accent-300")}>REQUIRED</span>
                      )}
                      {field.readOnly && (
                        <span className={cn(MONO_LABEL, "text-warning")}>READ-ONLY</span>
                      )}
                      {field.brokenWidgets > 0 && (
                        <span className={cn(MONO_LABEL, "text-warning")}>NO APPEARANCE</span>
                      )}
                      {page && (
                        <span className="ml-auto font-mono text-[10px] leading-none text-text-muted">
                          {page}
                        </span>
                      )}
                    </div>

                    {field.kind === "text" &&
                      (field.multiline ? (
                        <textarea
                          rows={3}
                          value={asString(value)}
                          disabled={disabled}
                          maxLength={field.maxLength ?? undefined}
                          aria-label={controlLabel}
                          onChange={(e) => setFieldValue(field.name, e.target.value)}
                          className={cn(FIELD_INPUT, "resize-y leading-[1.5]")}
                        />
                      ) : (
                        <input
                          type="text"
                          value={asString(value)}
                          disabled={disabled}
                          maxLength={field.maxLength ?? undefined}
                          aria-label={controlLabel}
                          onChange={(e) => setFieldValue(field.name, e.target.value)}
                          className={FIELD_INPUT}
                        />
                      ))}

                    {field.kind === "checkbox" && (
                      <label
                        className={cn(
                          "flex items-center gap-2.5 font-body text-[12.5px] text-neutral-300",
                          disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={value === true}
                          disabled={disabled}
                          aria-label={controlLabel}
                          onChange={(e) => setFieldValue(field.name, e.target.checked)}
                          className="size-4 rounded-sm border-border accent-accent"
                        />
                        {value === true ? "Checked" : "Not checked"}
                      </label>
                    )}

                    {field.kind === "radio" &&
                      (field.options.length === 0 ? (
                        <span className={ROW_NOTE}>
                          This radio group declares no options, so there is nothing to choose and
                          nothing to write.
                        </span>
                      ) : (
                        <div
                          role="radiogroup"
                          aria-label={controlLabel}
                          className="flex flex-wrap gap-x-4 gap-y-1.5"
                        >
                          {field.options.map((option) => (
                            <label
                              key={option}
                              className={cn(
                                "flex items-center gap-2 font-body text-[12.5px] text-neutral-300",
                                disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
                              )}
                            >
                              <input
                                type="radio"
                                name={`pdf-radio-${index}`}
                                checked={asString(value) === option}
                                disabled={disabled}
                                onChange={() => setFieldValue(field.name, option)}
                                className="size-4 border-border accent-accent"
                              />
                              {option}
                            </label>
                          ))}
                          <label
                            className={cn(
                              "flex items-center gap-2 font-body text-[12.5px] text-text-muted",
                              disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
                            )}
                          >
                            <input
                              type="radio"
                              name={`pdf-radio-${index}`}
                              checked={asString(value) === ""}
                              disabled={disabled}
                              onChange={() => setFieldValue(field.name, "")}
                              className="size-4 border-border accent-accent"
                            />
                            Not set
                          </label>
                        </div>
                      ))}

                    {field.kind === "dropdown" && (
                      <select
                        value={asString(value)}
                        disabled={disabled}
                        aria-label={controlLabel}
                        onChange={(e) => setFieldValue(field.name, e.target.value)}
                        className={FIELD_INPUT}
                      >
                        <option value="">Not set</option>
                        {field.options.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        {/* A stored value that is not one of the field's own
                            options is a real shape; showing the list without it
                            would silently redraw the row as "Not set". */}
                        {asString(value).length > 0 && !field.options.includes(asString(value)) && (
                          <option value={asString(value)}>
                            {asString(value)} — not one of this field&apos;s options
                          </option>
                        )}
                      </select>
                    )}

                    {field.kind === "optionlist" && (
                      <>
                        <select
                          multiple
                          value={asStringArray(value)}
                          disabled={disabled}
                          aria-label={controlLabel}
                          onChange={(e) =>
                            setFieldValue(
                              field.name,
                              Array.from(e.target.selectedOptions, (option) => option.value),
                            )
                          }
                          className={cn(FIELD_INPUT, "min-h-[5.5rem]")}
                        >
                          {field.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <span className={ROW_NOTE}>
                          Hold ⌘ or Ctrl to pick more than one, or arrow to an entry and hold
                          Shift. Selecting nothing clears the field. What this page is told about
                          a list box does not include whether it allows more than one choice, so
                          more than one can always be picked here.
                        </span>
                      </>
                    )}

                    {UNEDITABLE_NOTE[field.kind] && (
                      <span className={ROW_NOTE}>{UNEDITABLE_NOTE[field.kind]}</span>
                    )}

                    {field.readOnly && EDITABLE_KINDS.has(field.kind) && (
                      <span className={ROW_NOTE}>
                        Marked read-only by the document, so it is shown with its stored value and
                        never written to.
                      </span>
                    )}

                    {row.duplicate && (
                      <span className={ROW_NOTE}>
                        Another field in this document already carries this name. A value sent
                        under it would reach only the first one, so this row is locked.
                      </span>
                    )}

                    {field.value === null && EDITABLE_KINDS.has(field.kind) && (
                      <span className={ROW_NOTE}>
                        This field&apos;s stored value could not be read — usually a value that
                        does not match the field&apos;s own options — so the control starts empty.
                        Anything you set here is still written normally.
                      </span>
                    )}

                    {field.kind === "text" && field.maxLength !== null && (
                      <span className={ROW_NOTE}>
                        {`${asString(value).length} of ${field.maxLength} characters. The document sets this limit and the library refuses a longer value outright.`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            { label: "FIELDS", value: report ? String(fieldCount) : "—", tone: "neutral" },
            {
              label: "EDITABLE",
              value: report ? String(editableRows.length) : "—",
              tone: "neutral",
            },
            { label: "EDITED", value: String(editedNames.length) },
            {
              label: "FLATTEN",
              value: flattenBlocked ? "BLOCKED" : flatten ? "ON" : "OFF",
              tone: "neutral",
            },
          ]}
        />

        {noForm && (
          <WarningMessage message="This PDF has no form fields. A document that only looks like a form — lines and boxes drawn on the page — has nothing for any filler to write into, and this tool will not invent a form to put there. Your file was read and not changed." />
        )}

        {emptyForm && (
          <WarningMessage message="This PDF carries a form dictionary with no fields left in it, which is what an already-flattened form looks like. There is nothing here to fill in." />
        )}

        {flattenBlocked && (
          <WarningMessage
            message={`Flattening is not available for this document: ${blockedNames.length} field${
              blockedNames.length === 1 ? " has" : "s have"
            } no stored appearance for the engine to bake — ${nameList(
              blockedNames,
            )}. Filling still works, and the form stays interactive.`}
          />
        )}

        {unsupported.length > 0 && (
          <WarningMessage
            message={`These characters cannot be written into a PDF form field here: ${unsupported.join(
              " ",
            )}. Form text is redrawn in a standard font that covers the Latin alphabet and little else, so remove them before filling.`}
          />
        )}

        {overLimit.length > 0 && (
          <WarningMessage
            message={`Too long for the limit the document sets: ${nameList(
              overLimit,
            )}. The library refuses a value longer than a field's own maximum, so trim it before filling.`}
          />
        )}

        {error && <ErrorMessage message={error} />}

        {duplicateNames.length > 0 && (
          <CanvasFootnote>
            {`${duplicateNames.length} FIELD${
              duplicateNames.length === 1 ? "" : "S"
            } REPEAT A NAME ALREADY USED IN THIS DOCUMENT — ONLY THE FIRST FIELD WITH A GIVEN NAME IS WRITTEN`}
          </CanvasFootnote>
        )}

        {emptyRequired > 0 && (
          <CanvasFootnote>
            {`${emptyRequired} FIELD${
              emptyRequired === 1 ? " THE DOCUMENT MARKS REQUIRED IS" : "S THE DOCUMENT MARKS REQUIRED ARE"
            } STILL EMPTY — NOTHING HERE ENFORCES THAT FLAG, SO THE FILL RUNS ANYWAY`}
          </CanvasFootnote>
        )}

        {!result && (
          <CanvasFootnote>
            ONLY THE FIELDS YOU CHANGE ARE WRITTEN — NO VALUE YOU DID NOT EDIT IS ALTERED
          </CanvasFootnote>
        )}

        {result && (
          <CanvasFootnote>
            {result.flattened
              ? `${result.written} FIELD${
                  result.written === 1 ? "" : "S"
                } WRITTEN, THEN THE WHOLE FORM BAKED INTO THE PAGES — THE DOWNLOAD HAS NO FIELDS LEFT TO EDIT`
              : `${result.written} FIELD${
                  result.written === 1 ? "" : "S"
                } WRITTEN — THE DOWNLOAD IS STILL A FILLABLE FORM`}
          </CanvasFootnote>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {busy && (
              <ToolProgress
                phase={status === "reading" ? "READING FORM" : flatten ? "FILLING · FLATTENING" : "FILLING"}
                percent={null}
                label={status === "reading" ? "Reading the form" : "Filling the form"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={file.name.replace(
                  /\.pdf$/i,
                  result.flattened ? "-filled-flattened.pdf" : "-filled.pdf",
                )}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={
                  status === "processing"
                    ? "Filling…"
                    : flatten
                      ? "Fill and flatten"
                      : "Fill form"
                }
                primaryDisabled={!canRun}
                onPrimary={handleRun}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="AFTER FILLING">
          <label
            className={cn(
              "flex items-center gap-2.5 font-body text-[12.5px] text-neutral-300",
              flattenBlocked || busy ? "cursor-not-allowed opacity-45" : "cursor-pointer",
            )}
          >
            <input
              type="checkbox"
              checked={flatten}
              disabled={flattenBlocked || busy}
              onChange={(e) => {
                invalidate();
                setFlatten(e.target.checked);
              }}
              className="size-4 rounded-sm border-border accent-accent"
            />
            Also flatten the form
          </label>
          <span className={RAIL_NOTE}>
            {flattenBlocked
              ? "Not available for this document — the canvas names the fields that block it. Filling without flattening still works."
              : flatten
                ? "The values are written, then every field is baked into the page and removed. The result is not editable and not re-fillable, and the text stays real text rather than a picture."
                : "Off, the download is still a form: the values are in the fields and anyone with a reader can change them. Tick this to make them permanent."}
          </span>
          {flatten && report?.needAppearances && (
            <span className={RAIL_NOTE}>
              This document asks readers to redraw its fields from their values, so flattening
              redraws <strong>every</strong> field — including ones you never touched. Their
              stored appearance is replaced by a freshly drawn one.
            </span>
          )}
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Fields", report ? String(fieldCount) : "—"],
              ["Editable", report ? String(editableRows.length) : "—"],
              ["Edited", String(editedNames.length)],
              ["Result", outputLabel],
            ]}
          />
          {!result && !canRun && !busy && editedNames.length === 0 && !flatten && report !== null && report.fields.length > 0 && (
            <span className={RAIL_NOTE}>
              Nothing has changed yet. Edit a field, or tick Also flatten the form, and the button
              lights up.
            </span>
          )}
        </ToolAsideSection>

        {report !== null && (
          <ToolAdvanced
            rows={[
              ["Form dictionary", report.hasForm ? "Present" : "None"],
              ["Fields read", String(report.fields.length)],
              ["/NeedAppearances", report.needAppearances ? "Set" : "Not set"],
              ["No stored appearance", String(report.flattenBlockedBy.length)],
            ]}
          />
        )}

        <ToolAsideSection label="WHAT GETS WRITTEN">
          <span className={RAIL_NOTE}>
            Only the fields you actually change are sent. That is not tidiness: writing to a field
            makes this engine redraw it in a standard Helvetica, keeping its colour, size and
            alignment but replacing whatever font the document&apos;s author chose. A field you
            leave alone is not written to at all, so it keeps its own font.
          </span>
          <span className={RAIL_NOTE}>
            Values go in through the library&apos;s own high-level setters, which is what marks a
            field for redrawing — so the value stored in the file and the picture of it on the page
            agree. Pages, images and page text are not touched. The one thing that can change
            without being edited is a field that arrived with <em>no</em> stored appearance at all
            (the canvas badges those): the library may draw one for it on the way out.
          </span>
          <span className={RAIL_NOTE}>
            A field the document marks read-only is listed with its value and locked here. The
            underlying library would let it be overwritten without complaint, so this page is the
            only thing keeping it read-only.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT IT CANNOT DO">
          <span className={RAIL_NOTE}>
            It cannot create a form. A document with lines and boxes drawn on the page has no
            fields, and nothing here adds any — the form dictionary is read and, when there is
            none, the file is handed back untouched.
          </span>
          <span className={RAIL_NOTE}>
            Field text is drawn with a standard PDF font, which covers the Latin alphabet, accents,
            curly quotes, dashes and the euro sign. Chinese, Japanese, Korean, Cyrillic, Greek,
            Arabic and emoji cannot be encoded at all; the page checks what you type and stops the
            run rather than failing halfway through it.
          </span>
          <span className={RAIL_NOTE}>
            It does not sign anything. A signature field is listed so you can see it, and no value
            is written into one — this page places no signature, digital or drawn.
          </span>
          <span className={RAIL_NOTE}>
            Flattening is refused whenever a field has no stored appearance, because the underlying
            flatten deletes fields as it bakes them: one that fails part-way leaves a document that
            will not save at all. The refusal is deliberately stricter than it strictly needs to
            be — a text field or a check box missing its appearance would in fact be redrawn — but
            a radio group or a signature field really does break it, and there is no way to tell
            which is which without leaping.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
