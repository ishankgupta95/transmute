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
  QueueTable,
  StatStrip,
  type QueueRow,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { getToolBySlug } from "@/data/tools";
import { cn } from "@/lib/utils/cn";
import { formatDelta, formatFileSize } from "@/lib/utils/file-helpers";
import {
  createZip,
  safeEntryName,
  uniqueEntryNames,
  ZIP_LEVELS,
  zipArchiveName,
  zipLevel,
  type CreateZipResult,
  type ZipLevel,
} from "@/lib/tools/zip-tools";

/** The one field box the redesign doc specifies, shared with the other tools. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * How many rows of the file list are drawn.
 *
 * A `QueueTable` lays out every row it is handed, and somebody will select a
 * folder's worth of assets. The archive carries all of them either way, and
 * the footnote says so whenever the cap bites.
 */
const ROW_LIMIT = 200;

const LEVEL_OPTIONS = ZIP_LEVELS.map((l) => ({ value: l.id, label: l.label }));

const DATE_OPTIONS = [
  { value: "keep" as const, label: "Keep each file's" },
  { value: "now" as const, label: "Stamp now" },
];

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

const listNames = (names: string[]): string =>
  names.length <= 4
    ? names.join(", ")
    : `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`;

export function CreateZipUI() {
  const [files, setFiles] = useState<File[]>([]);
  const [levelId, setLevelId] = useState<ZipLevel["id"]>("normal");
  const [dateMode, setDateMode] = useState<"keep" | "now">("keep");
  const [archiveStem, setArchiveStem] = useState("archive");
  const [result, setResult] = useState<CreateZipResult | null>(null);
  const [running, setRunning] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Files the browser handed over and then could not read — a dropped folder. */
  const [unreadable, setUnreadable] = useState<string[]>([]);

  const addInputRef = useRef<HTMLInputElement>(null);
  /*
    A run is async, so a second Create pressed over a changed file list could
    resolve after the first and hand the tool the wrong archive under the right
    settings. Every run and every list change bumps this; a stale run drops its
    result on the floor.
  */
  const runToken = useRef(0);

  const level = zipLevel(levelId);
  const archiveName = zipArchiveName(archiveStem);

  const totalBytes = useMemo(() => files.reduce((n, f) => n + f.size, 0), [files]);

  /*
    The names the archive will actually use, computed from the CURRENT list so
    the table shows the rename before the run rather than after it. The same
    allocator runs inside `createZip`, over the same input order, so the two
    cannot disagree.
  */
  const plannedNames = useMemo(
    () => uniqueEntryNames(files.map((f) => safeEntryName(f.name))),
    [files],
  );

  /*
    Bumping `runToken` INVALIDATES whatever run is in flight, and an invalidated
    run returns early rather than running its own cleanup — so anything that
    bumps the token owns the progress state from that moment on and has to put
    it back. Leaving that to the run is what froze the tool in PACKING with no
    archive and no error.
  */
  const addFiles = useCallback((incoming: File[]) => {
    runToken.current++;
    setRunning(false);
    setPercent(null);
    setResult(null);
    setError(null);
    setUnreadable([]);
    setFiles((prev) => [...prev, ...incoming]);
  }, []);

  const handleAddClick = useCallback(() => addInputRef.current?.click(), []);

  const handleAddInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(Array.from(e.target.files ?? []));
      // Allow picking the same file again by clearing the input value.
      e.target.value = "";
    },
    [addFiles],
  );

  const removeAt = useCallback((index: number) => {
    runToken.current++;
    setRunning(false);
    setPercent(null);
    setResult(null);
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleReset = useCallback(() => {
    runToken.current++;
    setFiles([]);
    setResult(null);
    setError(null);
    setUnreadable([]);
    setRunning(false);
    setPercent(null);
  }, []);

  const handleCreate = useCallback(async () => {
    if (files.length === 0) return;
    const token = ++runToken.current;
    setRunning(true);
    setPercent(0);
    setError(null);
    setResult(null);
    setUnreadable([]);

    try {
      /*
        Read at RUN time rather than on drop. Holding every file's bytes in
        component state from the moment they are picked would keep the whole
        batch alive across every re-render for as long as the page is open;
        this way the copies exist for one run and are collectable after it.
      */
      const inputs: { name: string; data: Uint8Array; lastModified?: number }[] = [];
      const readable: File[] = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          inputs.push({
            name: file.name,
            data: new Uint8Array(await file.arrayBuffer()),
            lastModified: file.lastModified,
          });
          readable.push(file);
        } catch {
          // A folder dragged in arrives as a File the browser refuses to read.
          failed.push(file.name);
        }
      }
      if (runToken.current !== token) return;
      if (inputs.length === 0) {
        setUnreadable(failed);
        setError(
          "None of these could be read back from disk. Dragging a FOLDER in does this — a browser hands the folder over as if it were a file and then refuses to open it. Open the folder and pick the files inside it.",
        );
        return;
      }

      const built = await createZip(inputs, {
        level: levelId,
        keepDates: dateMode === "keep",
        onProgress: (p) => {
          if (runToken.current === token) setPercent(p);
        },
      });
      if (runToken.current !== token) return;
      /*
        Drop what could not be read from the list as well as from the archive.
        `result.entries` is allocated over the READABLE files in order, and the
        table reads it positionally — leaving an unreadable stub in the list
        would slide every row's size onto the wrong file. It also stops the
        list from promising something the archive does not contain. This does
        NOT bump `runToken`: it is this run's own bookkeeping, not a new one.
      */
      if (failed.length > 0) setFiles(readable);
      setUnreadable(failed);
      setResult(built);
    } catch (err) {
      if (runToken.current !== token) return;
      setError(
        err instanceof Error
          ? `The archive could not be built: ${err.message}`
          : "The archive could not be built.",
      );
    } finally {
      if (runToken.current === token) {
        setRunning(false);
        setPercent(null);
      }
    }
  }, [files, levelId, dateMode]);

  const blob = useMemo(
    () =>
      result
        ? new Blob([result.bytes as unknown as BlobPart], { type: "application/zip" })
        : null,
    [result],
  );

  /** One row per file: real sizes after a run, the picked size before one. */
  const rows = useMemo<QueueRow[]>(
    () =>
      files.slice(0, ROW_LIMIT).map((file, i) => {
        const entry = result?.entries[i];
        return {
          name: plannedNames[i] ?? file.name,
          inSize: formatFileSize(file.size),
          outSize: entry ? formatFileSize(entry.compressedSize) : "—",
          pct: entry ? 100 : 0,
          state: entry ? "DONE" : running ? "RUNNING" : "QUEUED",
        };
      }),
    [files, plannedNames, result, running],
  );

  /*
    Everything that happened to the batch on the way in, each with the count
    it actually has. Empty when none of it applies — a standing list of
    caveats is not disclosure.
  */
  const notes = useMemo(() => {
    const out: string[] = [];
    if (result && result.renamed.length > 0) {
      const n = result.renamed.length;
      out.push(
        `${n} ${plural(n, "file")} shared a name with one already in the archive and ${plural(n, "was", "were")} numbered instead of replacing it — ${listNames(result.renamed.map((r) => `${r.from} → ${r.to}`))}. A ZIP entry is addressed by its name, so two files called the same thing would have left one of them out of the archive entirely.`,
      );
    }
    if (result && result.clampedDates > 0) {
      const n = result.clampedDates;
      const { clampedLow: low, clampedHigh: high } = result;
      /*
        The two ends of the DOS window are 128 years apart, so a sentence that
        names one of them has to know which way each date actually moved.
        `createZip` counts them separately for exactly this.
      */
      const written =
        high === 0
          ? `${plural(n, "it was", "they were")} written as 1 January 1980 instead`
          : low === 0
            ? `${plural(n, "it was", "they were")} written as 31 December 2107 instead`
            : `${low} ${plural(low, "was", "were")} written as 1 January 1980 and ${high} as 31 December 2107 instead`;
      out.push(
        `${n} ${plural(n, "file")} had a modified date a ZIP cannot store, and ${written}. A ZIP keeps the year in seven bits counted from 1980, so anything before that date or after 31 December 2107 has nowhere to go — and the alternative is worse than a clamp, because the arithmetic wraps: a 1970 timestamp comes back out of the file reading 2098.`,
      );
    }
    if (unreadable.length > 0) {
      const n = unreadable.length;
      out.push(
        `${n} ${plural(n, "item")} could not be read from disk and ${plural(n, "is", "are")} not in the archive — ${listNames(unreadable)}. Dragging a folder in does this: the browser hands the folder over as though it were a file and then refuses to open it.`,
      );
    }
    return out;
  }, [result, unreadable]);

  const saved = result ? result.uncompressedTotal - result.archiveBytes : 0;

  return (
    <>
      {/* ── Canvas: the files going in, and what each one weighed ────── */}
      <div className={CANVAS_COLUMN}>
        {files.length === 0 ? (
          <DropZone
            multiple
            onFiles={addFiles}
            label="Drop the files you want in one archive"
            acceptLabel="ANY FILE"
            practicalLimitNote={getToolBySlug("create-zip")?.practicalLimitNote}
          />
        ) : (
          <>
            <CanvasHeader
              file={archiveName}
              meta={`${files.length} ${plural(files.length, "file")} · ${formatFileSize(totalBytes)}`}
              trailing={
                result
                  ? `${formatFileSize(result.archiveBytes)} · ${formatDelta(result.uncompressedTotal, result.archiveBytes)}`
                  : level.label.toUpperCase()
              }
            />

            {error && <ErrorMessage message={error} />}
            {notes.length > 0 && <WarningMessage message={notes.join(" ")} />}

            <StatStrip
              stats={[
                { label: "FILES", value: String(files.length), tone: "neutral" },
                { label: "UNCOMPRESSED", value: formatFileSize(totalBytes), tone: "neutral" },
                {
                  label: "ARCHIVE",
                  value: result ? formatFileSize(result.archiveBytes) : "NOT BUILT YET",
                  tone: result ? "accent" : "neutral",
                },
                {
                  label: "SAVED",
                  // Derived from the archive that exists, never predicted. A
                  // batch of JPEGs comes out LARGER and this says so.
                  value: result ? formatDelta(result.uncompressedTotal, result.archiveBytes) : "—",
                  tone: result ? (saved > 0 ? "ok" : "neutral") : "neutral",
                },
              ]}
            />

            <QueueTable
              rows={rows}
              footnote={
                result
                  ? `${formatFileSize(result.compressedTotal)} OF PACKED DATA PLUS ${formatFileSize(result.overheadBytes)} OF HEADERS AND INDEX`
                  : undefined
              }
            />

            {files.length > ROW_LIMIT && (
              <CanvasFootnote>
                SHOWING THE FIRST {ROW_LIMIT}{" "}
                OF{" "}
                {files.length.toLocaleString()}{" "}
                FILES — ALL OF THEM GO INTO THE ARCHIVE
              </CanvasFootnote>
            )}
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ────────── */}
      <ToolAside
        footer={
          files.length > 0 ? (
            <>
              {running && <ToolProgress phase="PACKING" percent={percent} />}
              {result && blob ? (
                <DownloadButton
                  blob={blob}
                  fileName={archiveName}
                  className="w-full justify-center"
                />
              ) : (
                <ToolActions
                  primaryLabel={running ? "Packing…" : `Create ${archiveName}`}
                  onPrimary={() => void handleCreate()}
                  primaryDisabled={running}
                />
              )}
              <ToolResetLink onClick={handleReset} label="START OVER" />
            </>
          ) : undefined
        }
      >
        <ToolControlGroup>
          <ToolControl label="COMPRESSION">
            <ToolChoice
              label="Compression level"
              value={levelId}
              onChange={(id) => {
                setLevelId(id);
                setResult(null);
              }}
              options={LEVEL_OPTIONS}
              disabled={running}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {level.note}
            </span>
          </ToolControl>

          {files.length > 0 && (
            <>
              <ToolControl label="MODIFIED DATES">
                <ToolChoice
                  label="Modified dates"
                  value={dateMode}
                  onChange={(mode) => {
                    setDateMode(mode);
                    setResult(null);
                  }}
                  options={DATE_OPTIONS}
                  disabled={running}
                />
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  A ZIP stores an MS-DOS timestamp, whose seconds count in twos — so a file
                  saved at 14:35:23 comes back out at 14:35:22, and there is no finer setting
                  to choose. That timestamp carries no timezone either: it is written as the
                  clock reading on this machine, which is what Finder, Explorer and{" "}
                  <code className="font-mono text-[10.5px] text-neutral-300">unzip</code> all
                  expect to find. Permissions are a different matter: the browser never sees
                  them, so nothing here can record whether a file was executable.
                </span>
              </ToolControl>

              <ToolControl label="ARCHIVE NAME">
                <input
                  type="text"
                  value={archiveStem}
                  onChange={(e) => setArchiveStem(e.target.value)}
                  placeholder="archive"
                  aria-label="Archive name"
                  className={cn(FIELD_CLASS, "w-full")}
                />
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  Saves as{" "}
                  <code className="font-mono text-[10.5px] text-neutral-300">{archiveName}</code>.
                </span>
              </ToolControl>
            </>
          )}
        </ToolControlGroup>

        {files.length > 0 && (
          <ToolAsideSection label="FILES">
            <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {files.map((file, i) => (
                <div key={`${file.name}-${i}`} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-body text-[12px] text-neutral-300">
                    {plannedNames[i] ?? file.name}
                  </span>
                  <span className="flex-none font-mono text-[10px] text-text-muted">
                    {formatFileSize(file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    disabled={running}
                    aria-label={`Remove ${file.name}`}
                    className="flex-none cursor-pointer rounded-sm font-mono text-[11px] leading-none text-text-muted transition-colors hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleAddClick}
              disabled={running}
              className="cursor-pointer self-start rounded-sm font-mono text-[10px] leading-none tracking-[0.04em] text-accent transition-colors hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              + ADD MORE FILES
            </button>
            {/*
              A second `DropZone` would be a 460px-tall plate under a table the
              user is already reading, so the add affordance is this button and
              its own input. The zone above still handles the first drop.

              `disabled` matters as much here as on the button above it, and for
              a reason `sr-only` hides: that class CLIPS the input, it does not
              remove it, so an undisabled one stays tab-focusable and operable
              from the keyboard while a pack is running. Picking a file there
              bumps `runToken`, which makes the in-flight run skip its own
              cleanup and strands the tool in PACKING for good. `DropZone`
              guards its own `sr-only` input the same way.
            */}
            <input
              ref={addInputRef}
              type="file"
              multiple
              onChange={handleAddInput}
              disabled={running}
              aria-label="Add more files to the archive"
              className="sr-only"
            />
          </ToolAsideSection>
        )}

        {result && (
          <ToolAsideSection label="OUTPUT">
            <ToolOutput
              rows={[
                ["Packed data", formatFileSize(result.compressedTotal)],
                ["Headers and index", formatFileSize(result.overheadBytes)],
                ["Archive", formatFileSize(result.archiveBytes)],
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Every number above was read back out of the finished archive rather than
              predicted from the settings.{" "}
              {saved > 0
                ? `This batch came to ${formatFileSize(result.archiveBytes)}, ${formatFileSize(saved)} less than the ${formatFileSize(result.uncompressedTotal)} that went in.`
                : `This batch came to ${formatFileSize(result.archiveBytes)} against ${formatFileSize(result.uncompressedTotal)} going in — it did not shrink. That is the normal result for photos, video, audio and anything already compressed: the data has no repetition left to find, and the container's own headers cost a little.`}
            </span>
          </ToolAsideSection>
        )}

        {files.length > 0 && (
          <ToolAsideSection label="WHAT IS AND IS NOT KEPT">
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Every file goes in at the top level under its own name. Folder structure does not
              survive, because a browser hands this page a flat list of files with no paths
              attached — and a folder dragged onto the drop zone arrives as an unreadable
              stub rather than its contents. Modified dates are kept to two seconds. POSIX
              permissions, extended attributes, resource forks and symbolic links are not
              recorded at all, so an executable script comes out of this archive without its
              executable bit. Nothing is uploaded: the files are read, packed and saved in
              this tab.
            </span>
          </ToolAsideSection>
        )}
      </ToolAside>
    </>
  );
}
