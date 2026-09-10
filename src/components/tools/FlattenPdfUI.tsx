"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import type { PdfFormReport } from "@/lib/tools/pdf-engine";
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
  ── Flatten PDF ──────────────────────────────────────────────────────────

  Two engine calls and one button: `readPdfForm` on drop (which parses and
  saves nothing), then `flattenPdfForm` when the user asks for it. There is no
  setting to get wrong, so this page spends its surface on the thing that
  actually decides the outcome — WHAT IS IN THE FORM — and on the refusal.

  MEASURED FACTS this file is built on. Every one was produced by running
  pdf-lib 1.17.1 out of this repo's node_modules against documents built for
  the purpose, not read in a doc:

  1. `flatten()` re-uses each widget's STORED appearance stream: it registers
     it on the page as a `/FlatWidget-…` Form XObject and pushes a `Do` into
     the content stream (pdf-lib/cjs/api/form/PDFForm.js:447-473). Nothing is
     rasterised, and a value that was text is still text afterwards — pdfjs's
     `getTextContent()` on a flattened output returned the typed string
     ("Jane Marie") and `getAnnotations()` returned 0 annotations.

  2. Flattening does NOT shrink a file. Measured on two forms built here:
     5338 → 5409 bytes and 6139 → 6146. The appearances move into the page
     rather than going away, so the copy must never sell this as compression.

  3. An already-flattened document still HAS an /AcroForm. `flatten()` empties
     `/Fields` but leaves the dictionary on the catalog, so `readPdfForm`
     reports `hasForm: true` with zero fields, and `flattenPdfForm` would NOT
     throw `PDF_FORM_NO_FIELDS` for it — it would flatten nothing and hand back
     a re-saved file. That is why `nothingToFlatten` below is its own branch
     with its own sentence instead of being folded into "no form".

  4. `report.flattenBlockedBy` is not an exact oracle in EITHER direction, and
     this component is written knowing that:
       • False positive — a TEXT field or a DROPDOWN whose `/AP` was removed is
         listed as blocked, but pdf-lib's `updateFieldAppearances()` (which
         `flatten()` runs first) regenerates those and the flatten succeeds.
         The refusal is therefore stricter than the engine strictly needs, and
         the copy says so rather than implying the listed fields are impossible.
       • False negative — a RADIO GROUP whose `/AP /N` dictionary exists but
         holds neither the state it is set to nor `/Off` passes the pre-flight
         (`brokenWidgets` is 0, because `/N` is present) and then makes
         `flatten()` throw `Failed to extract appearance ref for: <name>`
         (PDFForm.js:606-622). So a clean pre-flight is not a guarantee, and
         `handleFlatten` translates that specific message into a sentence that
         names the field instead of leaking pdf-lib's wording.
*/

/** The report's own field type, without a second import path to keep in step. */
type FormField = PdfFormReport["fields"][number];

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

/**
 * One field's value as a sentence fragment.
 *
 * `value` is `null` whenever the engine's own read threw — a stored value that
 * does not match the field's declared options is a real shape in the wild
 * (pdf-engine-core.ts:2293-2300) — so that case gets said out loud rather than
 * being drawn as an empty cell that reads like "this field is blank".
 */
function fieldValueLabel(field: FormField): string {
  const { value } = field;
  if (value === null) return "Could not be read";
  if (typeof value === "boolean") return value ? "Checked" : "Not checked";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "Nothing selected";
  if (value.length === 0) return field.kind === "text" ? "Empty" : "Nothing selected";
  // A multiline field's newlines would break the row; collapse rather than
  // clip, and cap the length so one essay-sized answer cannot own the table.
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat;
}

/** "Filled in" for the counter — the same question a person scanning the list asks. */
function hasValue(field: FormField): boolean {
  const { value } = field;
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.length > 0;
  return value.length > 0;
}

interface Badge {
  label: string;
  tone: "muted" | "blocked";
}

function badgesFor(field: FormField): Badge[] {
  const badges: Badge[] = [];
  if (field.brokenWidgets > 0) {
    badges.push({
      label:
        field.brokenWidgets === 1
          ? "NO APPEARANCE"
          : `NO APPEARANCE ×${field.brokenWidgets}`,
      tone: "blocked",
    });
  }
  if (field.readOnly) badges.push({ label: "READ-ONLY", tone: "muted" });
  if (field.required) badges.push({ label: "REQUIRED", tone: "muted" });
  if (field.multiline) badges.push({ label: "MULTILINE", tone: "muted" });
  if (field.maxLength !== null) badges.push({ label: `MAX ${field.maxLength}`, tone: "muted" });
  return badges;
}

/** 0-based page indices → the numbers a reader sees, or "—" when none resolved. */
function pageLabel(field: FormField): string {
  if (field.pageIndices.length === 0) return "—";
  return field.pageIndices.map((index) => index + 1).join(", ");
}

/*
  One grid for the header row and every field row, so the two cannot drift.
  It lives inside a `min-w` box under an `overflow-auto` parent: a narrow
  canvas scrolls the table sideways rather than crushing the value column to
  nothing, which is the rule the whole app follows for wide content.
*/
const FIELD_GRID = "grid grid-cols-[minmax(0,1.5fr)_86px_minmax(0,1.2fr)_44px] gap-3";

export function FlattenPdfUI() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<PdfFormReport | null>(null);
  const [status, setStatus] = useState<"idle" | "reading" | "processing" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the file changes.
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    The stale-result fence every tool here carries. This page has no settings,
    so the only way to invalidate a finished run is to swap the file or reset —
    but both of those can happen while a flatten is still in the worker, and a
    run that resolved unconditionally would bind the OLD document's bytes to
    the NEW file's name. A run claims the token before its first await and
    writes nothing if it no longer holds it.
  */
  const runToken = useRef(0);
  /*
    "A read pass is in flight, or has finished, for this file." Cleared by the
    effect's teardown as well as by a new file, so StrictMode's double mount
    and Fast Refresh both re-read instead of leaving the canvas empty forever —
    the same rule the thumbnail decks use.
  */
  const reportLoadedRef = useRef(false);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    runToken.current += 1;
    setFile(f);
    setReport(null);
    setResult(null);
    setElapsed(null);
    setError(null);
    reportLoadedRef.current = false;
  }, []);

  /*
    Read the form once per file. `readPdfForm` parses the document and returns;
    it never saves, so dropping a PDF here cannot change it — which matters,
    because `getForm()` CREATES an /AcroForm on a document that has none
    (measured: catalog key undefined before the call, `5 0 R` after) and the
    only reason that is harmless is that nothing is written back.
  */
  useEffect(() => {
    if (!file || reportLoadedRef.current) return;
    reportLoadedRef.current = true;
    let cancelled = false;
    setStatus("reading");
    (async () => {
      try {
        const { readPdfForm } = await import("@/lib/tools/pdf-engine");
        const next = await readPdfForm(await file.arrayBuffer());
        if (cancelled) return;
        setReport(next);
        setStatus("idle");
      } catch (err) {
        if (cancelled) return;
        // The engine turns an encrypted or damaged document into a sentence of
        // its own (pdf-engine-core.ts:126-137); render it rather than a
        // house-brand "something went wrong".
        setError(err instanceof Error ? err.message : "Could not read this PDF's form");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
      reportLoadedRef.current = false;
    };
  }, [file]);

  const handleFlatten = useCallback(async () => {
    if (!file) return;
    const token = (runToken.current += 1);
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    const startedAt = performance.now();
    try {
      const { flattenPdfForm } = await import("@/lib/tools/pdf-engine");
      const bytes = await flattenPdfForm(await file.arrayBuffer());
      if (runToken.current !== token) return;
      setResult(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      // A small PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // A superseded run's failure belongs to a file the user has already
      // replaced; putting it on screen would cover a perfectly good new one.
      if (runToken.current !== token) return;
      const message = err instanceof Error ? err.message : "Could not flatten this form";
      /*
        The pre-flight's blind spot, caught here rather than shown raw.
        MEASURED: a radio group whose `/AP /N` dictionary holds neither the
        state it is set to nor `/Off` reports `brokenWidgets: 0` — `/N` is
        present, which is all the engine's check asks — and then pdf-lib throws
        this exact string from `findWidgetAppearanceRef`. "Failed to extract
        appearance ref for: plan" is a sentence about pdf-lib's internals; the
        field name in it is the only part that helps.
      */
      const missed = /^Failed to extract appearance ref for: (.+)$/.exec(message);
      setError(
        missed
          ? `Flattening stopped at the field named ${missed[1]}. The appearance stored for it is not one this engine can point at — a radio group or check box whose stored states do not include the one it is currently set to does exactly this, and the check before the run cannot see it. Nothing was written and your file is untouched.`
          : message,
      );
      setStatus("error");
    }
  }, [file]);

  const handleReset = useCallback(() => {
    runToken.current += 1;
    setFile(null);
    setReport(null);
    setResult(null);
    setElapsed(null);
    setStatus("idle");
    setError(null);
    reportLoadedRef.current = false;
  }, []);

  if (!file) return <DropZone accept=".pdf" onFiles={handleFiles} />;

  const fields = report?.fields ?? [];
  const blockedNames = report?.flattenBlockedBy ?? [];
  const filledCount = fields.filter(hasValue).length;
  const readOnlyCount = fields.filter((field) => field.readOnly).length;
  const pagesWithFields = new Set(fields.flatMap((field) => field.pageIndices)).size;

  /* The three states that are not "there is a form here to flatten". */
  const noForm = report !== null && !report.hasForm;
  // Measured: `flatten()` empties /Fields but leaves the /AcroForm dictionary,
  // so a file that has already been through this tool arrives with a form and
  // no fields. The engine would happily "flatten" it and hand back a re-saved
  // copy that differs in nothing but its object numbering.
  const nothingToFlatten = report !== null && report.hasForm && fields.length === 0;
  const blocked = blockedNames.length > 0;
  const canFlatten = report !== null && report.hasForm && fields.length > 0 && !blocked;

  const blockedSentence = blocked
    ? `${
        blockedNames.length === 1
          ? "One field has no appearance stored in the file"
          : `${blockedNames.length} fields have no appearance stored in the file`
      }, so flattening would leave ${
        blockedNames.length === 1 ? "it" : "them"
      } blank: ${blockedNames.join(", ")}. A signature field, or a radio group whose buttons were never drawn, is what usually gets you here. The whole run is refused rather than half-done — pdf-lib deletes each field as it bakes it, so a failure part-way through leaves a document that cannot even be saved. The check is deliberately strict, and it will sometimes stop a document that would in fact have come through.`
    : null;

  const trailing = report
    ? fields.length === 0
      ? "NO FIELDS"
      : `${fields.length} FIELD${fields.length === 1 ? "" : "S"}`
    : status === "reading"
      ? "READING"
      : "—";

  return (
    <>
      {/* ── Canvas: what this form actually contains ───────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader file={file.name} meta={formatFileSize(file.size)} trailing={trailing} />

        <CanvasStage className={cn(STAGE_GROW, "flex flex-col p-3.5")}>
          {fields.length > 0 ? (
            <div className={cn("min-h-0 flex-1 overflow-auto", SCROLL_CLASS)}>
              <div className="min-w-[500px]">
                <div
                  className={cn(
                    FIELD_GRID,
                    MONO_LABEL,
                    "sticky top-0 z-10 border-b border-border bg-bg-primary px-1 pb-2 text-text-muted",
                  )}
                >
                  <span>FIELD</span>
                  <span>TYPE</span>
                  <span>VALUE</span>
                  <span className="text-right">PAGE</span>
                </div>
                {fields.map((field, index) => {
                  const badges = badgesFor(field);
                  return (
                    <div
                      key={`${field.name}-${index}`}
                      className={cn(
                        FIELD_GRID,
                        "items-baseline border-b border-text-primary/6 px-1 py-2.5 last:border-b-0",
                        field.brokenWidgets > 0 && "bg-error/6",
                      )}
                    >
                      <span className="flex min-w-0 flex-col gap-1.5">
                        <span
                          title={field.name}
                          className="truncate font-body text-[11.5px] leading-[1.3] text-neutral-300"
                        >
                          {field.name}
                        </span>
                        {badges.length > 0 && (
                          <span className="flex flex-wrap gap-1">
                            {badges.map((badge) => (
                              <span
                                key={badge.label}
                                className={cn(
                                  "rounded-[4px] border px-1.5 py-[3px] font-mono text-[9px] leading-none tracking-[0.08em]",
                                  badge.tone === "blocked"
                                    ? "border-error/40 text-error"
                                    : "border-border text-text-muted",
                                )}
                              >
                                {badge.label}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] leading-none tracking-[0.08em] text-text-muted">
                        {KIND_LABEL[field.kind]}
                      </span>
                      <span
                        title={fieldValueLabel(field)}
                        className={cn(
                          "truncate font-mono text-[11px] leading-[1.3]",
                          hasValue(field) ? "text-accent-300" : "text-text-muted",
                        )}
                      >
                        {fieldValueLabel(field)}
                      </span>
                      <span className="text-right font-mono text-[11px] leading-none text-text-muted">
                        {pageLabel(field)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[180px] flex-1 items-center justify-center px-8 text-center">
              <span className="font-body text-xs leading-[1.55] text-text-muted">
                {/*
                  Ordered so nothing states a fact it does not have yet: the
                  file is set one commit before the reading effect runs, and
                  "No form fields in this document" rendered in that gap would
                  be a claim made before the document was opened.
                */}
                {status === "error"
                  ? "This document could not be read."
                  : report === null
                    ? "Reading the form…"
                    : "No form fields in this document."}
              </span>
            </div>
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            { label: "FIELDS", value: report ? `${fields.length}` : "—", tone: "neutral" },
            { label: "FILLED IN", value: report ? `${filledCount}` : "—" },
            {
              label: "BLOCKED",
              value: report ? (blocked ? `${blockedNames.length}` : "NONE") : "—",
              // Nothing has been checked before the report lands, so the cell
              // stays neutral rather than painting an unread "—" success-green.
              tone: report === null ? "neutral" : blocked ? "accent" : "ok",
            },
            {
              label: "OUT",
              value: result ? formatFileSize(result.size) : "—",
              tone: "neutral",
            },
          ]}
        />

        {noForm && (
          <WarningMessage
            message="This PDF has no form fields, so there is nothing to flatten. A document that only looks like a form — ruled lines and empty boxes drawn straight onto the page — carries no fields for any tool to bake down."
          />
        )}

        {nothingToFlatten && (
          <WarningMessage
            message="This PDF carries a form dictionary with no fields left in it, which is exactly what a document that has already been flattened looks like. There is nothing here to bake into the page, so the run would only re-save the file."
          />
        )}

        {blockedSentence && <WarningMessage message={blockedSentence} />}

        {error && <ErrorMessage message={error} />}

        {/*
          The line that has to be next to the button rather than buried in the
          rail: this is the one-way door. `flatten()` deletes each field after
          drawing it (PDFForm.js:453-472) and nothing on this site reverses
          that.
        */}
        <CanvasFootnote>
          FLATTENING IS PERMANENT — THE FIELDS ARE DELETED AND THEIR VALUES BECOME PAGE CONTENT.
          KEEP THE ORIGINAL IF THE ANSWERS MIGHT NEED TO CHANGE.
        </CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {(status === "reading" || status === "processing") && (
              <ToolProgress
                phase={status === "reading" ? "READING FORM" : "FLATTENING"}
                percent={null}
                label={status === "reading" ? "Reading the form" : "Flattening the form"}
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {result ? (
              <DownloadButton
                blob={result}
                fileName={file.name.replace(/\.pdf$/i, "-flattened.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Flattening…" : "Flatten form"}
                onPrimary={handleFlatten}
                primaryDisabled={!canFlatten || status === "processing" || status === "reading"}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Form fields", report ? `${fields.length}` : "—"],
              ["Filled in", report ? `${filledCount}` : "—"],
              ["Read-only", report ? `${readOnlyCount}` : "—"],
              ["Pages with fields", report ? `${pagesWithFields}` : "—"],
              ["Out", result ? formatFileSize(result.size) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            There is nothing to set. Flattening takes the whole form at once — every field on
            every page.
          </span>
        </ToolAsideSection>

        {blocked && (
          <ToolAsideSection label="BLOCKED BY">
            <div className="flex flex-col gap-1">
              {blockedNames.map((name) => (
                <span
                  key={name}
                  className="truncate rounded-[5px] border border-error/40 px-2 py-1.5 font-mono text-[11px] leading-none text-error"
                  title={name}
                >
                  {name}
                </span>
              ))}
            </div>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Each of these fields is missing the appearance stream a flatten draws from. Nothing
              on this page can create one, so the run is refused instead of producing a document
              with those fields silently blank.
            </span>
          </ToolAsideSection>
        )}

        <ToolAsideSection label="WHAT FLATTENING DOES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Each field&apos;s stored appearance is drawn into the page, and the field is then
            deleted. The document looks the same and there is nothing left to type into.
          </span>
          {/*
            MEASURED, and the reason this can be said at all: `flatten()`
            registers the widget's existing appearance stream on the page as a
            Form XObject and draws it (PDFForm.js:460-469) — no canvas, no
            image. pdfjs read the typed string back out of a flattened page as
            text and reported zero annotations on it.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Nothing is turned into a picture. The appearance already in the file is re-used as a
            drawing on the page, so text that was typed into a field stays real text you can
            select and search.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Annotations that are not form fields — sticky notes, comments, stamps — are left
            exactly where they were. Only fields are touched.
          </span>
          {/*
            MEASURED: 5338 → 5409 bytes and 6139 → 6146 on two forms built for
            the test. Flattening moves the appearances into the page instead of
            discarding them, so selling this as a size win would be a lie the
            user can check against the two numbers in the stat strip.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            It is not a way to make a PDF smaller. The appearances move into the page rather than
            going away, so the result comes back about the same size and can be slightly larger.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHEN IT REFUSES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A flatten draws from the appearance stream stored with each field. Some fields have
            none — an unsigned signature field is the classic example — and this page names them
            and stops, instead of writing a document where those fields have quietly gone blank.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            It stops before touching anything for a reason: fields are deleted as they are baked,
            so a failure half-way through leaves a document that cannot be saved at all. The
            trade is that the check is strict, and a form it refuses may be one that would have
            flattened fine.
          </span>
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Form dictionary", report ? (report.hasForm ? "PRESENT" : "ABSENT") : "—"],
            ["Fields", report ? `${fields.length}` : "—"],
            /*
              The producer's own flag, stated as the flag rather than as an
              outcome. When it is set the engine marks every field dirty before
              flattening (pdf-engine-core.ts:2489-2490) so appearances are
              redrawn from the values; when it is not, what is stored is what
              gets drawn.
            */
            ["/NeedAppearances", report ? (report.needAppearances ? "SET" : "NOT SET") : "—"],
            ["Blocked fields", report ? `${blockedNames.length}` : "—"],
            ["Engine", "PDF-LIB"],
          ]}
        />
      </ToolAside>
    </>
  );
}
