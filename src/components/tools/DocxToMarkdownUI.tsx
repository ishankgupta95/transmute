"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
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
import { CANVAS_COLUMN, MONO_LABEL } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import { downloadFilesAsZip } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  convertDocxToMarkdown,
  DocxReadError,
  markdownFileName,
  markdownZipName,
  type DocxConversion,
  type ImageMode,
  type TableMode,
} from "@/lib/tools/docx-to-markdown";

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
 * How much of the Markdown is drawn.
 *
 * A `<pre>` lays out every character it is given, and an embedded image is a
 * single ~700 KB "word". The copy button and the download carry the whole file
 * either way, and the footnote says so whenever the cap bites.
 */
const PREVIEW_LIMIT = 40_000;

const IMAGE_OPTIONS = [
  { value: "reference" as const, label: "Link" },
  { value: "embed" as const, label: "Embed" },
  { value: "drop" as const, label: "Drop" },
];

const TABLE_OPTIONS = [
  { value: "pipe" as const, label: "Pipe table" },
  { value: "html" as const, label: "Keep HTML" },
];

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

const RAIL_NOTE = "font-body text-[10.5px] leading-[1.5] text-text-muted";

/** A rail section behind a summary row — `ToolAdvanced`'s shape in ToolAside.tsx. */
function RailDrawer({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <details className="group border-b border-border px-4 last:border-b-0">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 py-3",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        )}
      >
        <span className={cn(MONO_LABEL, "flex-none text-text-muted")}>{label}</span>
        <span className="truncate font-mono text-[10px] leading-none text-text-muted opacity-60">
          {hint}
        </span>
        <span
          aria-hidden="true"
          className="ml-auto flex-none font-mono text-[15px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
        >
          ›
        </span>
      </summary>
      <div className="-mx-4 flex animate-tm-drawer flex-col gap-[9px] border-t border-border bg-text-primary/3 px-4 py-3.5 motion-reduce:animate-none">
        {children}
      </div>
    </details>
  );
}

/**
 * Everything this document lost or had rewritten on the way out, one sentence
 * per kind, with every count DERIVED from the file that was dropped. Empty when
 * none of it applies — a standing list of caveats tells the reader nothing
 * about their own document, and a list of zeroes is reassurance rather than
 * disclosure.
 */
function lossNotes(result: DocxConversion, imageMode: ImageMode, tableMode: TableMode): string[] {
  const { docFacts: doc, packageFacts: pkg, images } = result;
  const notes: string[] = [];

  /*
    ── Pictures ─────────────────────────────────────────────────────────
    Keyed off what the download actually carries — `images` — rather than off
    how many pictures Word put in the body. The two differ whenever a picture
    could not be read out of the package, and promising a media folder for one
    that is not in the ZIP is exactly the sentence this page must never write.
    "drop" is the exception: it reads nothing, so nothing can fail, and the
    number of pictures removed is the number the body held.
  */
  const carried = imageMode === "drop" ? doc.images : images.length;
  if (carried > 0) {
    const bytes = images.reduce((n, image) => n + image.bytes.length, 0);
    if (imageMode === "drop") {
      notes.push(
        `${carried} ${plural(carried, "image")} ${plural(carried, "was", "were")} removed. Nothing in the Markdown marks where ${plural(carried, "it", "they")} used to be.`,
      );
    } else if (imageMode === "embed") {
      notes.push(
        `${carried} ${plural(carried, "image")}, ${formatFileSize(bytes)} of picture, ${plural(carried, "is", "are")} written into the Markdown as base64 — four characters of text for every three bytes of file. That makes one self-contained .md, and it is why this one is ${formatFileSize(new Blob([result.markdown]).size)}. GitHub and most editors render a data URI; some Markdown pipelines refuse one that long.`,
      );
    } else {
      notes.push(
        `${carried} ${plural(carried, "image")}, ${formatFileSize(bytes)} in total, ${plural(carried, "was", "were")} written to a media folder beside the Markdown, so the download is a ZIP — a .md file cannot carry a picture inside it. Keep the folder next to the .md or the links break.`,
      );
    }
  }
  if (doc.unreadableImages > 0) {
    const lost = doc.unreadableImages;
    notes.push(
      `${lost} ${plural(lost, "picture")} in the body could not be read out of the package, and ${plural(lost, "is", "are")} in neither the Markdown nor the download: ${plural(lost, "it is", "they are")} LINKED to a file on disk rather than stored inside the .docx, or the picture part is missing from the ZIP. A browser cannot follow a link to your file system. Re-insert ${plural(lost, "it", "them")} in Word with Insert > Picture — not Link to File — and convert again.`,
    );
  }
  // Pictures the body referenced at all, readable or not: what is left over in
  // word/media/ after those is what belongs to a header, a bullet or nothing.
  const bodyImages = doc.images + doc.unreadableImages;
  if (pkg.mediaFiles > bodyImages) {
    const orphans = pkg.mediaFiles - bodyImages;
    notes.push(
      `The package holds ${pkg.mediaFiles} ${plural(pkg.mediaFiles, "file")} under word/media/ but only ${bodyImages} ${plural(bodyImages, "appears", "appear")} in the document body. The other ${orphans} ${plural(orphans, "is", "are")} referenced from somewhere the body is not — a header, a footer, a list bullet, a shape — or left in the package and referenced from nowhere at all. Either way ${plural(orphans, "it does", "they do")} not reach the Markdown.`,
    );
  }

  /* ── Tables ─────────────────────────────────────────────────────────── */
  // The reader's own count of what came out as pipe syntax. Subtracting the
  // HTML tables from the total would count a table nested inside one of them
  // as a pipe table, and it never became one.
  const pipeTables = doc.pipeTables;
  if (pipeTables > 0) {
    notes.push(
      `${pipeTables} ${plural(pipeTables, "table")} ${plural(pipeTables, "became a Markdown pipe table", "became Markdown pipe tables")}, and the first row of each is now the header row — Markdown has no table without one. If your table started with data rather than headings, that first row now reads as a heading.`,
    );
  }
  if (doc.htmlTables > 0) {
    const reasons = [
      doc.rowspanCells > 0
        ? `${doc.rowspanCells} vertically merged ${plural(doc.rowspanCells, "cell")}`
        : "",
      doc.nestedTables > 0 ? `${doc.nestedTables} nested ${plural(doc.nestedTables, "table")}` : "",
    ].filter(Boolean);
    // "because of …" rather than "because they hold …": one of these tables
    // can be a table nested inside another, which holds nothing itself and is
    // written out as HTML because the one around it was.
    const why = reasons.length > 0 ? ` because of ${reasons.join(" and ")}` : "";
    notes.push(
      tableMode === "pipe"
        ? `${doc.htmlTables} ${plural(doc.htmlTables, "table")} ${plural(doc.htmlTables, "is", "are")} written as raw HTML rather than pipe syntax${why} — no pipe table means the same thing, so nothing in ${plural(doc.htmlTables, "it", "them")} was reshaped. Most Markdown renderers display HTML; a plain-text reader will show the tags.`
        : `${doc.htmlTables} ${plural(doc.htmlTables, "table")} ${plural(doc.htmlTables, "is", "are")} left as the HTML ${plural(doc.htmlTables, "it was", "they were")} read as, which is what KEEP HTML asks for. Merged cells survive exactly; a plain-text reader will show the tags.`,
    );
  }
  if (doc.pipeColspanCells > 0) {
    notes.push(
      `${doc.pipeColspanCells} ${plural(doc.pipeColspanCells, "cell")} in ${plural(doc.pipeColspanCells, "a pipe table", "the pipe tables")} ${plural(doc.pipeColspanCells, "spans", "span")} more than one column. A pipe table has no merged cells, so the text sits in the first column and the ones it also covered are left empty, which keeps everything to the right under the right heading.`,
    );
  }
  if (doc.pipeMultilineCells > 0) {
    const flat = doc.pipeMultilineCells;
    const lists = doc.pipeListCells;
    notes.push(
      `${flat} ${plural(flat, "cell")} in ${plural(flat, "a pipe table", "the pipe tables")} came out as more than one line and ${plural(flat, "was", "were")} joined with a <br> tag: a pipe-table row is one line and cannot hold a line break any other way.${
        lists > 0
          ? ` ${lists === flat ? (flat === 1 ? "That one" : "All of them") : `${lists} of them`} held ${plural(lists, "a list", "lists")}: the bullet characters are now plain text in the ${plural(lists, "cell", "cells")}, and nothing there is a list any more.`
          : ""
      }`,
    );
  }

  /* ── Parts mammoth never opens ──────────────────────────────────────── */
  if (pkg.headers + pkg.footers > 0) {
    const parts = [
      pkg.headers > 0 ? `${pkg.headers} page ${plural(pkg.headers, "header")}` : "",
      pkg.footers > 0 ? `${pkg.footers} page ${plural(pkg.footers, "footer")}` : "",
    ].filter(Boolean);
    notes.push(
      `This document defines ${parts.join(" and ")}. Only the body is read, so running heads, page numbers and footer text are not in the Markdown.`,
    );
  }
  if (pkg.comments > 0) {
    notes.push(
      `${pkg.comments} ${plural(pkg.comments, "comment")} ${plural(pkg.comments, "is", "are")} still in this file and ${plural(pkg.comments, "it is", "they are")} not in the Markdown — the commented text comes through, the comment on it does not.`,
    );
  }
  if (pkg.insertions + pkg.deletions > 0) {
    notes.push(
      `This document still carries tracked changes: ${pkg.insertions} ${plural(pkg.insertions, "insertion")} and ${pkg.deletions} ${plural(pkg.deletions, "deletion")}. The Markdown reads as if every one of them had been accepted — inserted text is kept, deleted text is gone, and no mark says which was which.`,
    );
  }
  if (pkg.embeddedObjects + pkg.charts > 0) {
    const parts = [
      pkg.embeddedObjects > 0
        ? `${pkg.embeddedObjects} embedded ${plural(pkg.embeddedObjects, "object")} (a spreadsheet or a file icon dropped into the page)`
        : "",
      pkg.charts > 0 ? `${pkg.charts} ${plural(pkg.charts, "chart")}` : "",
    ].filter(Boolean);
    notes.push(`${parts.join(" and ")} ${parts.length > 1 ? "are" : "is"} dropped: none of it is text, and Markdown has nowhere to put it.`);
  }
  if (pkg.macros) {
    notes.push(
      "This is a macro-enabled document — the package contains word/vbaProject.bin. Nothing here runs the macros or carries them over; they are simply not read.",
    );
  }

  /* ── Formatting with no Markdown equivalent ─────────────────────────── */
  const flat = [
    pkg.underlinedRuns > 0 ? `${pkg.underlinedRuns} underlined` : "",
    pkg.highlightedRuns > 0 ? `${pkg.highlightedRuns} highlighted` : "",
    pkg.colouredRuns > 0 ? `${pkg.colouredRuns} coloured` : "",
  ].filter(Boolean);
  if (flat.length > 0) {
    notes.push(
      `${flat.join(", ")} text ${plural(pkg.underlinedRuns + pkg.highlightedRuns + pkg.colouredRuns, "run")} came out plain. Markdown has no underline, no highlight and no colour. Bold, italic and strikethrough do survive.`,
    );
  }
  if (pkg.fieldRuns > 0) {
    notes.push(
      `${pkg.fieldRuns} field ${plural(pkg.fieldRuns, "code")}${pkg.fields.length > 0 ? ` (${pkg.fields.join(", ")})` : ""} ${plural(pkg.fieldRuns, "was", "were")} replaced by the value Word last calculated and saved. A table of contents, a cross-reference or a page number is frozen at that value and will never update again.`,
    );
  }
  if (pkg.textBoxes > 0) {
    notes.push(
      `${pkg.textBoxes} text ${plural(pkg.textBoxes, "box")} ${plural(pkg.textBoxes, "was", "were")} read, and the words inside ${plural(pkg.textBoxes, "it", "them")} appear inline in the body where the box was anchored — not floating beside the paragraph Word drew ${plural(pkg.textBoxes, "it", "them")} next to.`,
    );
  }

  /* ── Things that came through, where the shape changed ──────────────── */
  if (doc.footnotes + doc.endnotes > 0) {
    const total = doc.footnotes + doc.endnotes;
    notes.push(
      `${doc.footnotes} ${plural(doc.footnotes, "footnote")} and ${doc.endnotes} ${plural(doc.endnotes, "endnote")} became ${total === 1 ? "a" : ""} GFM ${plural(total, "footnote")} at the end of the file, numbered [^1] onward in the order Word numbered them. GitHub, Obsidian and Pandoc render those; a stricter Markdown parser will print the [^1] literally.`,
    );
  }
  if (doc.superscriptRuns + doc.subscriptRuns > 0) {
    const total = doc.superscriptRuns + doc.subscriptRuns;
    notes.push(
      `${total} superscript or subscript ${plural(total, "run")} ${plural(total, "is", "are")} kept as a <sup> or <sub> HTML tag, because Markdown has no syntax for either and dropping the tag would change what the text says.`,
    );
  }

  return notes;
}

export function DocxToMarkdownUI() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DocxConversion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<ImageMode>("reference");
  const [tableMode, setTableMode] = useState<TableMode>("pipe");
  const { copied, copy } = useCopied();

  /*
    The bytes are kept so that changing IMAGES or TABLES re-reads the ORIGINAL
    package rather than trying to rewrite Markdown that has already been
    written. Mammoth does not detach the buffer, so one copy serves every run.
  */
  const bufferRef = useRef<ArrayBuffer | null>(null);
  /*
    `arrayBuffer()` and the conversion are both async, so a slow first run can
    resolve AFTER a second file — or a second setting — has replaced it, and
    hand the tool the wrong Markdown under the right filename. Every run and the
    reset bump this token, and a run whose token is stale is dropped.
  */
  const runToken = useRef(0);

  const run = useCallback(
    async (buffer: ArrayBuffer, images: ImageMode, tables: TableMode) => {
      const token = ++runToken.current;
      setBusy(true);
      setError(null);
      /*
        Cleared, not kept. IMAGES and TABLES re-run the conversion, and a
        result left on screen through that window would be described by, and
        downloaded under, settings it was not produced with — the ZIP sentence
        over a drop-mode selection, and a live download button handing out the
        previous run's .md with links to images no longer in the download.
      */
      setResult(null);
      try {
        const converted = await convertDocxToMarkdown(buffer, {
          imageMode: images,
          tableMode: tables,
        });
        if (runToken.current !== token) return;
        setResult(converted);
      } catch (err) {
        if (runToken.current !== token) return;
        setResult(null);
        // `DocxReadError` already carries a sentence written for the reader —
        // an old .doc, a password, an .xlsx under the wrong name. Anything else
        // is a surprise, and saying so beats inventing a reason.
        setError(
          err instanceof DocxReadError
            ? err.message
            : err instanceof Error
              ? `This document could not be converted: ${err.message}`
              : "This document could not be converted.",
        );
      } finally {
        if (runToken.current === token) setBusy(false);
      }
    },
    [],
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      const picked = files[0];
      if (!picked) return;
      const token = ++runToken.current;
      setFile(picked);
      setResult(null);
      setError(null);
      setBusy(true);
      let buffer: ArrayBuffer;
      try {
        buffer = await picked.arrayBuffer();
      } catch {
        if (runToken.current !== token) return;
        setBusy(false);
        setError("This file could not be read from disk.");
        return;
      }
      if (runToken.current !== token) return;
      bufferRef.current = buffer;
      await run(buffer, imageMode, tableMode);
    },
    [imageMode, tableMode, run],
  );

  const changeImageMode = useCallback(
    (mode: ImageMode) => {
      setImageMode(mode);
      if (bufferRef.current) void run(bufferRef.current, mode, tableMode);
    },
    [run, tableMode],
  );

  const changeTableMode = useCallback(
    (mode: TableMode) => {
      setTableMode(mode);
      if (bufferRef.current) void run(bufferRef.current, imageMode, mode);
    },
    [run, imageMode],
  );

  const handleReset = useCallback(() => {
    runToken.current++;
    bufferRef.current = null;
    setFile(null);
    setResult(null);
    setError(null);
    setBusy(false);
  }, []);

  const markdown = result?.markdown ?? "";
  const mdFileName = markdownFileName(file?.name ?? "document");

  const mdBlob = useMemo(
    () => new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
    [markdown],
  );

  /** What the download actually contains, in the order it is written. */
  const outputFiles = useMemo(() => {
    if (!result) return [];
    const files = [{ blob: mdBlob, name: mdFileName }];
    if (imageMode !== "reference") return files;
    for (const image of result.images) {
      files.push({
        // A fresh copy per file: `Blob` keeps a reference to the view it was
        // given, and the conversion's arrays are reused across re-runs.
        blob: new Blob([new Uint8Array(image.bytes)], { type: image.contentType }),
        name: image.name,
      });
    }
    return files;
  }, [result, mdBlob, mdFileName, imageMode]);

  const zipName = markdownZipName(file?.name ?? "document");
  const downloadAll = useCallback(() => {
    void downloadFilesAsZip(outputFiles, zipName);
  }, [outputFiles, zipName]);

  const handleCopy = useCallback(() => {
    void copy(markdown);
  }, [copy, markdown]);

  const notes = result ? lossNotes(result, imageMode, tableMode) : [];
  const preview = markdown.length > PREVIEW_LIMIT ? markdown.slice(0, PREVIEW_LIMIT) : markdown;
  const doc = result?.docFacts;

  /*
    Mammoth types its own diagnostics, and the two kinds do not mean the same
    thing. A warning is an unrecognised style — the text survives. An error is
    a part it could not read, and whatever that part held is gone, so it does
    not belong under the reassuring sentence about styles.
  */
  const readerErrors = result?.messages.filter((m) => m.type === "error") ?? [];
  const readerNotes = result?.messages.filter((m) => m.type !== "error") ?? [];
  const said = (messages: typeof readerErrors) =>
    messages.map((m) => m.message.replace(/\.$/, "")).join("; ");

  return (
    <>
      {/* ── Canvas: the Markdown this document turned into ─────────────── */}
      <div className={CANVAS_COLUMN}>
        {!file ? (
          <DropZone
            accept=".docx"
            onFiles={handleFiles}
            label="Drop a Word .docx to begin"
            acceptLabel="DOCX"
          />
        ) : (
          <>
            <CanvasHeader
              file={file.name}
              meta={`${formatFileSize(file.size)}${
                result ? ` · ${result.words.toLocaleString()} ${plural(result.words, "word")}` : ""
              }`}
              trailing={result ? `${formatFileSize(mdBlob.size)} MARKDOWN` : undefined}
            />

            {error && <ErrorMessage message={error} />}
            {readerErrors.length > 0 && (
              <ErrorMessage
                message={`${readerErrors.length} ${plural(readerErrors.length, "part")} of this document could not be read, and ${plural(readerErrors.length, "it is", "they are")} not in the Markdown: ${said(readerErrors)}.`}
              />
            )}
            {notes.length > 0 && <WarningMessage message={notes.join(" ")} />}
            {readerNotes.length > 0 && (
              <WarningMessage
                message={`The reader had ${readerNotes.length} ${plural(readerNotes.length, "thing")} to say about this document: ${said(readerNotes)}. An unrecognised style is the usual one, and it is not a failure: the text is kept and comes out as an ordinary paragraph or an ordinary run, so a custom "Callout" style becomes body text rather than a quote or a heading.`}
              />
            )}

            {doc && (
              <StatStrip
                stats={[
                  { label: "WORDS", value: (result?.words ?? 0).toLocaleString() },
                  {
                    label: "HEADINGS",
                    value: doc.headings.toLocaleString(),
                    tone: doc.headings === 0 ? "neutral" : "accent",
                  },
                  {
                    label: "TABLES",
                    value: doc.tables.toLocaleString(),
                    tone: doc.tables === 0 ? "neutral" : "accent",
                  },
                  {
                    // Pictures the body held, readable or not — a fact about
                    // the document, the way TABLES is. How many of them
                    // reached the download is a sentence, not a stat.
                    label: "IMAGES",
                    value: (doc.images + doc.unreadableImages).toLocaleString(),
                    tone: doc.images + doc.unreadableImages === 0 ? "neutral" : "accent",
                  },
                ]}
              />
            )}

            <TextPanes columns={1}>
              <TextPane
                tone="out"
                label={busy ? "Reading the document" : result ? "Markdown" : "Nothing to show"}
                lines={lineCount(markdown)}
                size={result ? formatFileSize(mdBlob.size) : undefined}
                action={
                  markdown ? (
                    <button
                      onClick={handleCopy}
                      aria-label={copied ? "Copied Markdown" : "Copy Markdown"}
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
                  aria-label="Markdown output"
                >
                  {busy
                    ? "Unpacking the document…"
                    : preview ||
                      (result ? "This document's body has no text in it." : "")}
                </pre>
              </TextPane>
            </TextPanes>

            {markdown.length > PREVIEW_LIMIT && (
              <CanvasFootnote>
                PREVIEWING THE FIRST{" "}
                {PREVIEW_LIMIT.toLocaleString()}{" "}
                OF{" "}
                {markdown.length.toLocaleString()}{" "}
                CHARACTERS — COPY AND DOWNLOAD CARRY ALL OF THEM
              </CanvasFootnote>
            )}
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ─────────── */}
      <ToolAside
        footer={
          file ? (
            <>
              {/* No download control until there is something to download —
                  a button over an empty blob would save a 0-byte .md. */}
              {result &&
                (outputFiles.length > 1 ? (
                  // Several files have to travel as one ZIP: a browser cancels
                  // most of a burst of downloads fired in the same tick.
                  <ToolActions
                    primaryLabel={`Download Markdown + ${outputFiles.length - 1} ${plural(outputFiles.length - 1, "image")} (ZIP)`}
                    onPrimary={downloadAll}
                    primaryDisabled={busy}
                  />
                ) : (
                  <DownloadButton
                    blob={mdBlob}
                    fileName={mdFileName}
                    className="w-full justify-center"
                  />
                ))}
              <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
            </>
          ) : undefined
        }
      >
        <ToolControlGroup>
          <ToolControl label="IMAGES">
            <ToolChoice
              label="What to do with images"
              value={imageMode}
              onChange={changeImageMode}
              options={IMAGE_OPTIONS}
              disabled={busy}
            />
            <span className={RAIL_NOTE}>
              {imageMode === "reference" &&
                "Every picture that can be read out of the package is saved to a media/ folder the Markdown points at, so a document with pictures comes down as a ZIP. Keep the folder beside the .md."}
              {imageMode === "embed" &&
                "Each picture is written into the Markdown itself as a base64 data URI. One self-contained file, roughly a third larger than the pictures were."}
              {imageMode === "drop" &&
                "Pictures are removed and only counted. Nothing in the Markdown marks where they were."}
            </span>
          </ToolControl>

          <ToolControl label="TABLES">
            <ToolChoice
              label="How to write tables"
              value={tableMode}
              onChange={changeTableMode}
              options={TABLE_OPTIONS}
              disabled={busy}
            />
            <span className={RAIL_NOTE}>
              {tableMode === "pipe"
                ? "GFM pipe tables, with the first row as the header. A table with a vertically merged cell or a table inside a cell still falls back to HTML, because no pipe table means the same thing."
                : "Every table is left as the HTML it was read as. Merged cells survive exactly; a plain-text reader sees the tags."}
            </span>
          </ToolControl>
        </ToolControlGroup>

        {result && (
          <ToolAsideSection label="OUTPUT">
            <ToolOutput
              rows={[
                ["Saves as", outputFiles.length > 1 ? zipName : mdFileName],
                ["Markdown", formatFileSize(mdBlob.size)],
                [
                  "Footnotes",
                  result.docFacts.footnotes + result.docFacts.endnotes > 0
                    ? `${result.docFacts.footnotes + result.docFacts.endnotes} as [^n]`
                    : "none",
                ],
              ]}
            />
            <span className={RAIL_NOTE}>
              Headings, bold, italic, strikethrough, links, ordered and unordered lists,
              blockquotes and code all survive. Nothing is uploaded: the .docx is unzipped and
              read in this tab.
            </span>
          </ToolAsideSection>
        )}

        {/*
          Reference prose, folded away. `ToolPageLayout` RESERVES the measured
          initial height of this surface to stop the page shifting as the tool
          mounts, so anything that renders before a file has been dropped is
          billed to that reservation. A closed <details> costs one 40px row.
        */}
        <RailDrawer label="WHAT WORD KEEPS" hint="AND WHAT IT CANNOT">
          <span className={RAIL_NOTE}>
            The reader maps Word&rsquo;s built-in constructs and ignores everything else, which
            is the honest shape for this trip: Markdown has no page, no font, no colour and no
            frame. Headings come from Word&rsquo;s Heading 1–6 styles rather than from text size,
            so a document whose &ldquo;headings&rdquo; are just bold 18pt paragraphs arrives with
            no headings at all.
          </span>
          <span className={RAIL_NOTE}>
            Never carried over: page headers and footers, comments, underline, highlight, text
            colour, fonts, page and section breaks, embedded objects, charts, macros, and the
            position of anything Word floated. Tracked changes are read as accepted. Field codes
            leave behind the value Word last saved.
          </span>
          <span className={RAIL_NOTE}>
            Whatever your document actually contains, the panel above says so with counts taken
            from the file — not from this list.
          </span>
        </RailDrawer>
      </ToolAside>
    </>
  );
}
