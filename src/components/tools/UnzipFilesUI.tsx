"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { CanvasFootnote, CanvasHeader, StatStrip } from "@/components/tools/ToolCanvas";
import { ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN, MONO_LABEL, SCROLL_CLASS } from "@/components/workspace/shared";
import { getToolBySlug } from "@/data/tools";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import { downloadFilesAsZip } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  extractZipEntries,
  readZipDirectory,
  uniqueEntryNames,
  UNSAFE_PATH_REASONS,
  ZipReadError,
  type ZipDirectory,
  type ZipEntry,
} from "@/lib/tools/zip-tools";

/**
 * How many entry rows are drawn.
 *
 * An archive can hold six figures of entries and a table lays out every row it
 * is given. Selection, the counts and the extraction all run over the whole
 * list; only the drawing is capped, and the footnote says so.
 */
const ROW_LIMIT = 300;

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

const listPaths = (paths: string[]): string =>
  paths.length <= 4
    ? paths.join(", ")
    : `${paths.slice(0, 4).join(", ")} and ${paths.length - 4} more`;

/** `a`, `a and b`, `a, b and c` — for the reasons an archive is refused whole. */
const listReasons = (reasons: string[]): string =>
  reasons.length <= 1
    ? (reasons[0] ?? "an entry the reader refuses")
    : `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}`;

/** The mono token at the end of a row: why this entry is or is not coming out. */
function entryState(entry: ZipEntry, loadable: boolean): { label: string; tone: string } {
  if (entry.dir) return { label: "FOLDER", tone: "text-text-muted" };
  if (entry.encrypted || entry.strongEncryption)
    return { label: "ENCRYPTED", tone: "text-warning" };
  if (entry.unsafe) return { label: "REFUSED", tone: "text-error" };
  if (entry.truncated) return { label: "TRUNCATED", tone: "text-error" };
  /*
    A later entry claims the same name. A ZIP addresses an entry by name and
    the reader keeps only the last of each, so asking for this one hands over
    the LATER entry's bytes under this one's name — silent loss with a size
    still printed beside it. It is refused and labelled instead.
  */
  if (entry.shadowed) return { label: "SHADOWED", tone: "text-warning" };
  if (!entry.extractable) return { label: entry.methodLabel, tone: "text-warning" };
  /*
    Nothing is wrong with THIS entry — the archive is what is refused. jszip
    throws while walking the central directory when it meets an encrypted
    entry or a compression it cannot inflate, so one bad entry takes every
    good one with it. Saying "DEFLATE" beside a row with no checkbox would
    read as a bug in the page rather than a property of the file.
  */
  if (!loadable) return { label: "BLOCKED", tone: "text-warning" };
  return { label: entry.methodLabel, tone: "text-text-muted" };
}

const GRID = "grid grid-cols-[18px_1fr_72px_78px] gap-2.5 sm:grid-cols-[18px_1fr_78px_78px_88px]";

export function UnzipFilesUI() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [directory, setDirectory] = useState<ZipDirectory | null>(null);
  /** Selection is keyed by INDEX: an archive may legally list one path twice. */
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ path: string; reason: string }[]>([]);
  const [reading, setReading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const { copied, copy } = useCopied();

  /*
    `arrayBuffer()` is async, so a slow first read can resolve AFTER a second
    archive has replaced it and hand the tool the wrong listing under the right
    filename. Every load and the reset bump this token; a stale read drops its
    result on the floor.
  */
  const loadToken = useRef(0);

  const entries = useMemo(() => directory?.entries ?? [], [directory]);
  /*
    Selectable is per-entry AND archive-wide: `readZipDirectory` judges each
    entry on its own merits, but jszip opens an archive whole or not at all, so
    an unloadable archive has nothing selectable in it however clean its
    individual entries look.
  */
  const loadable = directory?.loadable ?? false;
  const extractableIndexes = useMemo(
    () => (loadable ? entries.map((e, i) => (e.extractable ? i : -1)).filter((i) => i >= 0) : []),
    [entries, loadable],
  );
  const selectedEntries = useMemo(
    () => selected.map((i) => entries[i]).filter((e): e is ZipEntry => Boolean(e)),
    [selected, entries],
  );
  const selectedBytes = useMemo(
    () => selectedEntries.reduce((n, e) => n + e.uncompressedSize, 0),
    [selectedEntries],
  );

  const handleFiles = useCallback(async (picked: File[]) => {
    const chosen = picked[0];
    if (!chosen) return;
    const token = ++loadToken.current;
    setFile(chosen);
    setBytes(null);
    setDirectory(null);
    setSelected([]);
    setError(null);
    setExtractError(null);
    setFailures([]);
    setReading(true);
    try {
      const buffer = await chosen.arrayBuffer();
      if (loadToken.current !== token) return;
      const raw = new Uint8Array(buffer);
      const dir = readZipDirectory(raw);
      if (loadToken.current !== token) return;
      setBytes(raw);
      setDirectory(dir);
      setSelected(
        dir.loadable
          ? dir.entries.map((e, i) => (e.extractable ? i : -1)).filter((i) => i >= 0)
          : [],
      );
    } catch (err) {
      if (loadToken.current !== token) return;
      // `ZipReadError` already carries a sentence written for the user — a
      // RAR renamed to .zip, a half-finished download, a split volume.
      setError(
        err instanceof ZipReadError
          ? err.message
          : err instanceof Error
            ? `This archive could not be read: ${err.message}`
            : "This archive could not be read.",
      );
    } finally {
      if (loadToken.current === token) setReading(false);
    }
  }, []);

  const handleReset = useCallback(() => {
    loadToken.current++;
    setFile(null);
    setBytes(null);
    setDirectory(null);
    setSelected([]);
    setError(null);
    setExtractError(null);
    setFailures([]);
    setReading(false);
    setExtracting(false);
    setPercent(null);
  }, []);

  const toggle = useCallback((index: number) => {
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((n) => n !== index) : [...prev, index].sort((a, b) => a - b),
    );
  }, []);

  const handleExtract = useCallback(async () => {
    if (!bytes || !file || selectedEntries.length === 0) return;
    const token = loadToken.current;
    setExtracting(true);
    setPercent(0);
    setExtractError(null);
    setFailures([]);
    try {
      const result = await extractZipEntries(
        bytes,
        selectedEntries.map((e) => e.path),
        (done, total) => {
          if (loadToken.current === token) setPercent(Math.round((done / total) * 100));
        },
      );
      if (loadToken.current !== token) return;
      setFailures(result.failures);
      if (result.files.length === 0) {
        setExtractError("Nothing came out of the archive — every selected entry failed to read.");
        return;
      }
      /*
        One file saves under its own bare name, because a browser strips path
        separators out of a download's filename anyway. Two or more go into
        one ZIP, which keeps their folders — and their names are re-allocated
        first, because an archive is allowed to list the same path twice and
        the second would otherwise replace the first on the way out.
      */
      const names =
        result.files.length === 1
          ? [result.files[0].baseName]
          : uniqueEntryNames(result.files.map((f) => f.path));
      const stem = file.name.replace(/\.zip$/i, "") || "archive";
      await downloadFilesAsZip(
        result.files.map((f, i) => ({ blob: new Blob([f.data as BlobPart]), name: names[i] })),
        `${stem}-extracted.zip`,
      );
    } catch (err) {
      if (loadToken.current !== token) return;
      setExtractError(
        err instanceof ZipReadError
          ? err.message
          : err instanceof Error
            ? `Extraction failed: ${err.message}`
            : "Extraction failed.",
      );
    } finally {
      if (loadToken.current === token) {
        setExtracting(false);
        setPercent(null);
      }
    }
  }, [bytes, file, selectedEntries]);

  const handleCopyListing = useCallback(() => {
    const listing = entries
      .map((e) => `${e.path}\t${e.dir ? "" : e.uncompressedSize}\t${e.methodLabel}`)
      .join("\n");
    void copy(listing);
  }, [copy, entries]);

  /*
    Everything about THIS archive that the user has to know before trusting the
    extraction, each with the count it actually has. Empty when none applies.
  */
  const notes = useMemo(() => {
    if (!directory) return [];
    const out: string[] = [];

    const encrypted = directory.entries.filter((e) => e.encrypted || e.strongEncryption);
    if (encrypted.length > 0) {
      out.push(
        `${encrypted.length} ${plural(encrypted.length, "entry", "entries")} ${plural(encrypted.length, "is", "are")} password-protected — ${listPaths(encrypted.map((e) => e.path))}. This page has no decryption in it at all, and the reader it uses refuses an archive outright when it meets an encrypted entry, so nothing at all can be extracted from this file here. Unpack it with 7-Zip, Keka or the ${"`unzip`"} command, where you can supply the password.`,
      );
    }

    const unsafe = directory.entries.filter((e) => e.unsafe !== null);
    if (unsafe.length > 0) {
      const kinds = [...new Set(unsafe.map((e) => e.unsafe!))];
      out.push(
        `${unsafe.length} ${plural(unsafe.length, "entry", "entries")} ${plural(unsafe.length, "is", "are")} refused because ${plural(unsafe.length, "its", "their")} stored path is ${kinds.map((k) => UNSAFE_PATH_REASONS[k]).join(", or ")} — ${listPaths(unsafe.map((e) => e.path))}. That is the shape of a zip-slip attack, and it is refused rather than quietly rewritten to something harmless-looking. The rest of the archive is unaffected.`,
      );
    }

    const unsupported = directory.entries.filter(
      (e) => !e.dir && !e.encrypted && !e.strongEncryption && !e.extractable && !e.unsafe && !e.truncated,
    );
    if (unsupported.length > 0) {
      const methods = [...new Set(unsupported.map((e) => e.methodLabel))];
      out.push(
        `${unsupported.length} ${plural(unsupported.length, "entry", "entries")} ${plural(unsupported.length, "uses", "use")} ${methods.join(" and ")}, and this reader inflates only STORE and DEFLATE. It refuses the whole archive when it meets one, so nothing here can be extracted from this file — 7-Zip and the ${"`unzip`"} command read these.`,
      );
    }

    const truncated = directory.entries.filter((e) => e.truncated);
    if (truncated.length > 0) {
      out.push(
        `${truncated.length} ${plural(truncated.length, "entry", "entries")} ${plural(truncated.length, "points", "point")} at data that runs past the end of this file — ${listPaths(truncated.map((e) => e.path))}. The index survived and the contents did not, which is what an interrupted or resumed download leaves behind. The reader reads every entry's data as it opens the archive, so it fails on this one and nothing at all can be extracted from this file, not even the entries that are whole. Fetch the archive again.`,
      );
    }

    /*
      The archive's own index counted differently from what it holds. Short
      by a couple of records is a damaged index; short by exactly the overflow
      is an archive of more than 65535 entries written without a ZIP64 record,
      where the 16-bit count cannot express the real number. Either way the
      listing below is incomplete, and saying nothing would be silent loss.
    */
    if (directory.declaredEntries !== directory.entries.length) {
      const declared = directory.declaredEntries;
      const found = directory.entries.length;
      out.push(
        declared > found
          ? `This archive's index says it holds ${declared} ${plural(declared, "entry", "entries")} and only ${found} ${plural(found, "was", "were")} found in it, so ${declared - found} ${plural(declared - found, "is", "are")} missing from the list below and cannot be extracted here. That is a damaged index — the archive was truncated in the middle of it, or something rewrote part of it.`
          : `This archive's index counts ${declared} ${plural(declared, "entry", "entries")} and ${found} ${plural(found, "was", "were")} actually found in it. A ZIP counts its entries in sixteen bits, which stops at 65535, so an archive larger than that written without a ZIP64 record under-reports itself. Everything found is listed below.`,
      );
    }

    if (directory.duplicates.length > 0) {
      out.push(
        `${directory.duplicates.length} ${plural(directory.duplicates.length, "path is", "paths are")} listed more than once — ${listPaths(directory.duplicates)}. A ZIP addresses an entry by name, so the reader keeps only the LAST of each; the earlier copies cannot be reached from here at all and are marked SHADOWED rather than offered.`,
      );
    }

    const badNames = directory.entries.filter((e) => e.nameEncodingUnknown);
    if (badNames.length > 0) {
      out.push(
        `${badNames.length} ${plural(badNames.length, "name")} ${plural(badNames.length, "was", "were")} stored without the flag that marks a name as UTF-8. The ZIP specification calls those names CP437 and this reads them as UTF-8, so the accented or non-Latin characters shown may be wrong. Only the names are affected — the file contents are read byte for byte.`,
      );
    }

    if (failures.length > 0) {
      out.push(
        `${failures.length} selected ${plural(failures.length, "entry", "entries")} did not come out: ${failures.map((f) => `${f.path} (${f.reason})`).join("; ")}.`,
      );
    }

    return out;
  }, [directory, failures]);

  /*
    Why the reader refuses this archive whole, named from what it actually
    holds rather than listed as a standing set of possibilities. All three
    throw inside jszip's own walk, so any one of them takes every good entry
    with it.
  */
  const blockingReasons = useMemo(() => {
    if (!directory || directory.loadable) return [];
    const out: string[] = [];
    if (directory.encryptedCount > 0) out.push("an encrypted entry");
    if (directory.unsupportedCount > 0) out.push("a compression it has no decompressor for");
    if (directory.truncatedCount > 0) out.push("an entry whose data is not all in the file");
    return out;
  }, [directory]);

  const modeCount = entries.filter((e) => e.unixMode !== null).length;
  const rows = entries.slice(0, ROW_LIMIT);

  return (
    <>
      {/* ── Canvas: what is inside, before anything is written out ───── */}
      <div className={CANVAS_COLUMN}>
        {!file ? (
          <DropZone
            accept=".zip"
            onFiles={handleFiles}
            label="Drop a .zip archive to look inside it"
            acceptLabel="ZIP"
            practicalLimitNote={getToolBySlug("unzip-files")?.practicalLimitNote}
          />
        ) : (
          <>
            <CanvasHeader
              file={file.name}
              meta={`${formatFileSize(file.size)}${directory ? ` · ${directory.entries.length} ${plural(directory.entries.length, "entry", "entries")}` : ""}`}
              trailing={
                directory
                  ? `${extractableIndexes.length} EXTRACTABLE${directory.zip64 ? " · ZIP64" : ""}`
                  : reading
                    ? "READING"
                    : undefined
              }
            />

            {error && <ErrorMessage message={error} />}
            {extractError && <ErrorMessage message={extractError} />}
            {notes.length > 0 && <WarningMessage message={notes.join(" ")} />}

            {directory && (
              <StatStrip
                stats={[
                  { label: "FILES", value: String(directory.fileCount), tone: "neutral" },
                  { label: "PACKED", value: formatFileSize(directory.totalCompressed), tone: "neutral" },
                  { label: "UNPACKED", value: formatFileSize(directory.totalUncompressed) },
                  {
                    label: "SELECTED",
                    value: `${selectedEntries.length} of ${extractableIndexes.length}`,
                    tone: selectedEntries.length === 0 ? "neutral" : "accent",
                  },
                ]}
              />
            )}

            {directory && directory.entries.length > 0 && (
              <div className="flex flex-col overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary">
                <div
                  className={cn(
                    GRID,
                    "items-center border-b border-border px-3.5 py-[9px] font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-text-muted",
                  )}
                >
                  <span aria-hidden="true" />
                  <span>PATH</span>
                  <span className="text-right">SIZE</span>
                  <span className="hidden text-right sm:inline">PACKED</span>
                  <span className="text-right">
                    <button
                      type="button"
                      onClick={handleCopyListing}
                      aria-label={copied ? "Copied the entry list" : "Copy the entry list"}
                      className="cursor-pointer tracking-[0.1em] text-accent transition-colors hover:text-accent-hover"
                    >
                      {copied ? "COPIED!" : "COPY LIST"}
                    </button>
                  </span>
                </div>

                <div className={cn("max-h-[28rem] overflow-y-auto", SCROLL_CLASS)}>
                  {rows.map((entry, i) => {
                    const state = entryState(entry, directory.loadable);
                    return (
                      <div
                        key={`${entry.path}-${i}`}
                        className={cn(
                          GRID,
                          "items-center border-b border-text-primary/6 px-3.5 py-[9px] font-body text-xs leading-none last:border-b-0",
                        )}
                      >
                        {/*
                          `disabled={extracting}` here and on SELECT ALL /
                          SELECT NONE below: `handleExtract` captured the
                          selection at click time, while every count on screen
                          recomputes from it live — so a tick changed
                          mid-inflation makes the panel describe one set while
                          the file that lands holds another. The selection is
                          frozen for the length of the run instead.
                        */}
                        {entry.extractable && directory.loadable ? (
                          <input
                            id={`zip-entry-${i}`}
                            type="checkbox"
                            checked={selected.includes(i)}
                            onChange={() => toggle(i)}
                            disabled={extracting}
                            className="size-[15px] rounded-sm border-border accent-accent disabled:cursor-not-allowed disabled:opacity-45"
                          />
                        ) : (
                          <span aria-hidden="true" />
                        )}
                        <label
                          htmlFor={
                            entry.extractable && directory.loadable ? `zip-entry-${i}` : undefined
                          }
                          className={cn(
                            "min-w-0 truncate",
                            entry.extractable && directory.loadable
                              ? "cursor-pointer text-neutral-300"
                              : "text-text-muted line-through decoration-text-muted/50",
                          )}
                          title={entry.path}
                        >
                          {entry.path}
                        </label>
                        <span className="text-right font-mono text-[11px] text-text-muted">
                          {entry.dir ? "—" : formatFileSize(entry.uncompressedSize)}
                        </span>
                        <span className="hidden text-right font-mono text-[11px] text-accent-300 sm:inline">
                          {entry.dir ? "—" : formatFileSize(entry.compressedSize)}
                        </span>
                        <span
                          className={cn(
                            "text-right font-mono text-[9.5px] leading-none tracking-[0.08em]",
                            state.tone,
                          )}
                        >
                          {state.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {directory && directory.entries.length === 0 && (
              <CanvasFootnote>
                THIS ARCHIVE IS VALID AND HOLDS NO ENTRIES — IT IS AN EMPTY ZIP
              </CanvasFootnote>
            )}

            {directory && directory.entries.length > ROW_LIMIT && (
              <CanvasFootnote>
                SHOWING THE FIRST {ROW_LIMIT} OF{" "}
                {directory.entries.length.toLocaleString()} ENTRIES — SELECT ALL AND THE COUNTS
                COVER EVERY ONE
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
              {extracting && <ToolProgress phase="INFLATING" percent={percent} />}
              <ToolActions
                primaryLabel={
                  extracting
                    ? "Inflating…"
                    : selectedEntries.length === 1
                      ? "Download 1 file"
                      : `Download ${selectedEntries.length} files (ZIP)`
                }
                onPrimary={() => void handleExtract()}
                primaryDisabled={extracting || selectedEntries.length === 0}
              />
              <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
            </>
          ) : undefined
        }
      >
        {directory && directory.entries.length > 0 && (
          <ToolAsideSection label="SELECTION">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelected(extractableIndexes)}
                disabled={extracting}
                className="cursor-pointer rounded-sm font-mono text-[10px] leading-none tracking-[0.04em] text-accent transition-colors hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              >
                SELECT ALL
              </button>
              <span aria-hidden="true" className="font-mono text-[10px] text-text-muted opacity-40">
                ·
              </span>
              <button
                type="button"
                onClick={() => setSelected([])}
                disabled={extracting}
                className="cursor-pointer rounded-sm font-mono text-[10px] leading-none tracking-[0.04em] text-text-muted transition-colors hover:text-accent-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
              >
                SELECT NONE
              </button>
            </div>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {extractableIndexes.length} of {directory.entries.length}{" "}
              {plural(directory.entries.length, "entry", "entries")} can be written out.{" "}
              {!directory.loadable
                ? `None of them, in this case, and not because of the entries marked BLOCKED: the reader opens an archive whole or refuses it whole, and this one holds ${listReasons(blockingReasons)}. The warning above names the entries responsible.`
                : directory.entries.length - extractableIndexes.length === 0
                  ? "Nothing in this archive is refused or unreadable."
                  : `The other ${directory.entries.length - extractableIndexes.length} are folder markers, refused paths, or names a later entry claims as well — the reason is on each row.`}
            </span>
          </ToolAsideSection>
        )}

        {directory && (
          <ToolAsideSection label="OUTPUT">
            <ToolOutput
              rows={[
                ["Files selected", `${selectedEntries.length} of ${extractableIndexes.length}`],
                ["Unpacked size", formatFileSize(selectedBytes)],
                [
                  "Saves as",
                  selectedEntries.length === 1
                    ? selectedEntries[0].path.split("/").pop() || selectedEntries[0].path
                    : selectedEntries.length === 0
                      ? "—"
                      : `${file?.name.replace(/\.zip$/i, "") || "archive"}-extracted.zip`,
                ],
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              One selected file saves under its own name. Two or more come down as a single
              ZIP that keeps their folder paths, because a browser cancels most of a burst of
              downloads fired at once — so a multi-file extraction is a repack, not a folder
              on your disk. Unpack that one with whatever you normally use.
            </span>
          </ToolAsideSection>
        )}

        {/*
          Reference prose, collapsed: this is the ADVANCED disclosure pattern
          from ToolAside, written out here because these are facts about the
          archive rather than settings, and the shipped `ToolAdvanced` labels
          its drawer "N SETTINGS".
        */}
        <details className="group border-b border-border px-4 last:border-b-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className={cn(MONO_LABEL, "text-text-muted")}>WHAT A DOWNLOAD CANNOT CARRY</span>
            <span
              aria-hidden="true"
              className="ml-auto font-mono text-[15px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
            >
              ›
            </span>
          </summary>
          <div className="-mx-4 flex animate-tm-drawer flex-col gap-3 border-t border-border bg-text-primary/3 px-4 py-3.5 motion-reduce:animate-none">
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              A ZIP written on Linux or macOS records each entry&rsquo;s permission bits, and a
              browser cannot apply them: a file saved from this page arrives with whatever your
              downloads folder gives it, so an executable script comes out not executable.
              {modeCount > 0
                ? ` This archive records mode bits for ${modeCount} of its ${directory?.entries.length ?? 0} entries.`
                : file && directory
                  ? " This archive records no mode bits at all — it was written on a DOS or Windows host."
                  : ""}
            </span>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Symbolic links, extended attributes and resource forks are stored by some writers
              and are not reconstructed here either — a symlink arrives as a small text file
              holding the path it pointed at. Modified dates are read but cannot be applied to a
              downloaded file, and a ZIP stores them to the nearest two seconds in any case.
            </span>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              The archive is read and inflated in this tab. Nothing about it is uploaded, which
              is the point: an archive is exactly the kind of thing you cannot safely hand to a
              website to look inside for you.
            </span>
          </div>
        </details>

        {!file && (
          <ToolAsideSection label="BEFORE YOU EXTRACT">
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Every entry is listed with its real packed and unpacked size before anything is
              written, so you can take one file out of a large archive. Paths that try to escape
              the folder you are extracting into — the ones beginning{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">../</code> or{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">/</code> — are refused
              and named rather than quietly rewritten.
            </span>
          </ToolAsideSection>
        )}
      </ToolAside>
    </>
  );
}
