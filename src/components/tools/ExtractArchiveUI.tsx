"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolDone,
  ToolOutput,
} from "@/components/tools/ToolAside";
import { CanvasFootnote, CanvasHeader, StatStrip } from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { getToolBySlug } from "@/data/tools";
import { CANVAS_COLUMN, MONO_LABEL, SCROLL_CLASS } from "@/components/workspace/shared";
import { cn } from "@/lib/utils/cn";
import { downloadFilesAsZip } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  ARCHIVE_ACCEPT,
  containerLabel,
  extractFromArchive,
  isExtractable,
  readArchive,
  selectionZipName,
  summariseListing,
  unsafeWording,
  type ArchiveEntry,
  type ArchiveListing,
  type ExtractResult,
} from "@/lib/tools/archive-extract";

/*
  The whole archive is copied into the engine's memory in one block, and each
  member you pull out is allocated there again before it reaches the browser.
  That is a real ceiling, so this zone may not print the absolute "NO SIZE
  CAP" — read off the registry rather than retyped, so the spec row on the
  page and the line under the zone cannot drift apart.
*/
const PRACTICAL_LIMIT_NOTE = getToolBySlug("extract-archive")?.practicalLimitNote;

/** Same field box the subtitle converter and the cron builder use. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const ROW_GRID = "grid grid-cols-[26px_1fr_84px_96px] items-center gap-3";

/**
 * The default plural is `${one}s`, which is wrong for a word interpolated
 * into one of the all-caps mono lines: `plural(3, "FILE")` is "FILEs", and
 * `CanvasFootnote` applies no `uppercase` class to cover for it. Pass the
 * plural explicitly whenever the singular is capitalised.
 */
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Name a few, then count the rest — a wall of paths is not a warning. */
function listPaths(paths: string[], limit = 4): string {
  if (paths.length <= limit) return paths.join(", ");
  return `${paths.slice(0, limit).join(", ")} and ${paths.length - limit} more`;
}

/** What a row says about itself, in the right-hand state column. */
function entryState(entry: ArchiveEntry): { label: string; tone: string } {
  if (entry.safePath === null) return { label: "REFUSED", tone: "text-error" };
  if (entry.encrypted) return { label: "ENCRYPTED", tone: "text-warning" };
  if (entry.kind === "directory") return { label: "FOLDER", tone: "text-text-muted" };
  if (entry.kind === "symlink") return { label: "LINK", tone: "text-text-muted" };
  if (entry.nested) return { label: "ARCHIVE", tone: "text-accent-300" };
  return { label: "FILE", tone: "text-text-muted" };
}

export function ExtractArchiveUI() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [listing, setListing] = useState<ArchiveListing | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<(ExtractResult & { ms: number }) | null>(null);

  /*
    `arrayBuffer()` and the engine fetch are both async, so a slow first read
    can resolve AFTER a second file has replaced it and hand the tool the
    wrong bytes under the right filename. The token is bumped by every load,
    every re-read and the reset; a run whose token is stale drops its result.
    Same guard, and the same reason, as SubtitleConverterUI's.
  */
  const loadToken = useRef(0);

  /*
    Every number on this page recomputes from `selected`, but the run in
    flight was built from the set as it stood when the button was pressed —
    `handleExtract` takes `[...selected]` once and nothing can reach it after
    that. So a selection change DURING a run cannot alter the download; what
    it alters is every number describing the download. Press "None" halfway
    through and the rail reads "Download 0 files" and the strip reads
    "SELECTED 0" over a ZIP of everything, which is the page lying about its
    own run.

    Freezing therefore has to be a STATE guard, not only a disabled attribute.
    The attribute is the affordance and the guard is the invariant: a disabled
    checkbox is inert in a browser, but the All/None buttons are ordinary
    controls and a keyboard or an extension can reach either. This was
    computed once and used nowhere — the comment described a freeze that was
    not there.
  */
  const extracting = progress !== null;

  const summary = useMemo(() => (listing ? summariseListing(listing) : null), [listing]);

  const openArchive = useCallback(async (data: Uint8Array, name: string, secret: string) => {
    const token = ++loadToken.current;
    setReading(true);
    setError(null);
    setListing(null);
    setResult(null);
    try {
      const next = await readArchive(data, name, { passphrase: secret });
      if (loadToken.current !== token) return;
      setListing(next);
      // Everything writable, ticked. Directories, links and refused paths are
      // not in this set — they are not things that can be written out.
      setSelected(new Set(next.entries.filter(isExtractable).map((e) => e.index)));
    } catch (err) {
      if (loadToken.current !== token) return;
      setError(err instanceof Error ? err.message : "This archive could not be read.");
    } finally {
      if (loadToken.current === token) setReading(false);
    }
  }, []);

  const handleFiles = useCallback(
    async (files: File[]) => {
      const picked = files[0];
      if (!picked) return;
      const token = ++loadToken.current;
      setFile(picked);
      setBytes(null);
      setListing(null);
      setResult(null);
      setError(null);
      let buffer: ArrayBuffer;
      try {
        buffer = await picked.arrayBuffer();
      } catch {
        if (loadToken.current !== token) return;
        setError(
          `Could not read ${picked.name}. The archive has to exist as one buffer before the engine sees it, and this browser would not allocate one that large.`,
        );
        return;
      }
      if (loadToken.current !== token) return;
      const data = new Uint8Array(buffer);
      setBytes(data);
      await openArchive(data, picked.name, passphrase);
    },
    [openArchive, passphrase],
  );

  const handleReset = useCallback(() => {
    loadToken.current++;
    setFile(null);
    setBytes(null);
    setListing(null);
    setSelected(new Set());
    setResult(null);
    setError(null);
    setPassphrase("");
    setReading(false);
    setProgress(null);
  }, []);

  const handleReRead = useCallback(() => {
    if (!bytes || !file) return;
    void openArchive(bytes, file.name, passphrase);
  }, [bytes, file, openArchive, passphrase]);

  const toggle = useCallback(
    (index: number) => {
      if (extracting) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    },
    [extracting],
  );

  const selectAll = useCallback(() => {
    if (extracting) return;
    setSelected(new Set(listing?.entries.filter(isExtractable).map((e) => e.index) ?? []));
  }, [extracting, listing]);

  const selectNone = useCallback(() => {
    if (extracting) return;
    setSelected(new Set());
  }, [extracting]);

  const handleExtract = useCallback(async () => {
    if (!bytes || !listing || !file) return;
    const token = ++loadToken.current;
    const started = performance.now();
    setError(null);
    setResult(null);
    setProgress({ done: 0, total: selected.size });
    try {
      const out = await extractFromArchive(bytes, listing, [...selected], {
        passphrase,
        onProgress: (done, total) => {
          if (loadToken.current === token) setProgress({ done, total });
        },
      });
      if (loadToken.current !== token) return;
      setResult({ ...out, ms: performance.now() - started });
      if (out.files.length > 0) {
        await downloadFilesAsZip(
          out.files.map((f) => ({ blob: f.blob, name: f.name })),
          selectionZipName(file.name),
        );
      }
    } catch (err) {
      if (loadToken.current !== token) return;
      setError(err instanceof Error ? err.message : "Extraction failed.");
    } finally {
      if (loadToken.current === token) setProgress(null);
    }
  }, [bytes, file, listing, passphrase, selected]);

  /* ── Everything the archive is hiding, counted and named ─────────── */

  const warnings = useMemo(() => {
    const notes: { id: string; text: string }[] = [];
    if (!listing || !summary) return notes;

    const refused = listing.entries.filter((e) => e.safePath === null);
    if (refused.length > 0) {
      const reasons = [...new Set(refused.map((e) => unsafeWording(e.unsafeReason!)))];
      notes.push({
        id: "refused",
        text: `${refused.length} ${plural(refused.length, "entry", "entries")} in this archive ${plural(refused.length, "stores", "store")} ${reasons.join(" or ")}, which would land outside the folder you unpack into. ${plural(refused.length, "It is", "They are")} listed and cannot be selected: ${listPaths(refused.map((e) => e.path))}. Nothing here can write outside your downloads folder, but the same archive unpacked by tar or unzip on a shell could, so it is worth knowing the archive tried.`,
      });
    }

    if (summary.encrypted > 0) {
      const names = listing.entries.filter((e) => e.encrypted).map((e) => e.path);
      notes.push({
        id: "encrypted",
        text: `${summary.encrypted} ${plural(summary.encrypted, "entry", "entries")} ${plural(summary.encrypted, "is", "are")} encrypted: ${listPaths(names)}. Type the archive's password in the rail before extracting. Whatever the engine still cannot open, it names — and reading an encrypted RAR is one thing this build reports as unavailable rather than attempting.`,
      });
    }

    if (summary.nested > 0) {
      const names = listing.entries.filter((e) => e.nested).map((e) => e.path);
      notes.push({
        id: "nested",
        text: `${summary.nested} ${plural(summary.nested, "member")} ${plural(summary.nested, "is", "are")} ${plural(summary.nested, "itself an archive", "themselves archives")}: ${listPaths(names)}. ${plural(summary.nested, "It comes", "They come")} out as ${plural(summary.nested, "a file", "files")}, unopened — nothing here unpacks two levels down on its own. Download ${plural(summary.nested, "it", "one")} and drop it back in to go deeper.`,
      });
    }

    if (summary.zeroSizeFiles > 0) {
      notes.push({
        id: "zero-size",
        text: `${summary.zeroSizeFiles} ${plural(summary.zeroSizeFiles, "file")} ${plural(summary.zeroSizeFiles, "declares", "declare")} a size of zero. ${plural(summary.zeroSizeFiles, "That is", "Those are")} either genuinely empty or stored without a recorded length, and either way ${plural(summary.zeroSizeFiles, "it comes", "they come")} out as ${plural(summary.zeroSizeFiles, "an empty file", "empty files")}.`,
      });
    }

    if (listing.viaGzipStream) {
      notes.push({
        id: "gzip",
        text: `This is a single gzip-compressed file, not a multi-file archive. libarchive has no reader for a bare gzip stream — only for a tar inside one — so the browser's own gzip decoder is doing this instead. The size below is the one the file records in its last four bytes, which the format defines modulo 4 GB; the number you get after extracting is measured.`,
      });
    }

    if (listing.incompleteReason) {
      notes.push({
        id: "incomplete",
        text: `The engine stopped reading before the end of the file, so this list is PARTIAL — there may be more in the archive that could not be reached. ${listing.incompleteReason}`,
      });
    }

    return notes;
  }, [listing, summary]);

  const selectedEntries = useMemo(
    () => (listing ? listing.entries.filter((e) => selected.has(e.index)) : []),
    [listing, selected],
  );
  const selectedBytes = selectedEntries.reduce((sum, e) => sum + e.size, 0);

  const stats = useMemo(() => {
    if (!listing || !summary || !file) return null;
    const cells = [
      { label: "ENTRIES", value: String(summary.entries), tone: "neutral" as const },
      { label: "FILES", value: String(summary.files), tone: "neutral" as const },
      {
        label: listing.sizeSource === "gzip-trailer" ? "DECLARED SIZE" : "UNPACKED SIZE",
        value: formatFileSize(summary.declaredBytes),
        tone: "neutral" as const,
      },
      { label: "SELECTED", value: `${selected.size} · ${formatFileSize(selectedBytes)}` },
    ];
    return cells;
  }, [file, listing, selected.size, selectedBytes, summary]);

  /*
    Derived, never asserted: the archive is only "compressed" relative to what
    its own headers say the members weigh, and a store-only ZIP or a tar is
    not compressed at all. Suppressed when there is nothing to compare.
  */
  const ratio =
    file && summary && summary.declaredBytes > 0 && listing?.sizeSource === "archive"
      ? Math.round((file.size / summary.declaredBytes) * 100)
      : null;

  const selectedCount = selected.size;
  const primaryLabel =
    selectedCount > 0
      ? `Download ${selectedCount} ${plural(selectedCount, "file")}`
      : "Download selected files";

  return (
    <>
      {/* ── Canvas: what is inside, and what you have picked ─────────── */}
      <div className={CANVAS_COLUMN}>
        {!file ? (
          <DropZone
            accept={ARCHIVE_ACCEPT}
            onFiles={handleFiles}
            label="Drop an archive to see what is inside"
            acceptLabel="ZIP TAR GZ TGZ BZ2 XZ 7Z RAR"
            practicalLimitNote={PRACTICAL_LIMIT_NOTE}
          />
        ) : (
          <>
            <CanvasHeader
              file={file.name}
              meta={`${formatFileSize(file.size)}${listing ? ` · ${containerLabel(listing.container)}` : ""}`}
              trailing={
                listing
                  ? `${listing.entries.length} ${listing.entries.length === 1 ? "ENTRY" : "ENTRIES"}`
                  : reading
                    ? "READING…"
                    : undefined
              }
              trailingTone="muted"
            />

            {error && <ErrorMessage message={error} />}
            {warnings.map((note) => (
              <WarningMessage key={note.id} message={note.text} />
            ))}
            {result && result.failures.length > 0 && (
              <WarningMessage
                message={`${result.failures.length} ${plural(result.failures.length, "member")} could not be read, and ${plural(result.failures.length, "it was", "they were")} left out of the download. ${result.failures
                  .map((f) => `${f.path} — ${f.reason}`)
                  .join(" ")}`}
              />
            )}

            {stats && <StatStrip stats={stats} />}

            {listing && listing.entries.length > 0 && (
              <div className="flex flex-col overflow-hidden rounded-[10px] border border-neutral-800 bg-bg-primary">
                <div
                  className={cn(
                    ROW_GRID,
                    "border-b border-border px-3.5 py-[9px] font-mono text-[9.5px] leading-none font-medium tracking-[0.1em] text-text-muted",
                  )}
                >
                  <span aria-hidden="true" />
                  <span>PATH IN ARCHIVE</span>
                  <span className="text-right">SIZE</span>
                  <span className="text-right">STATE</span>
                </div>

                <div className={cn("max-h-[26rem] overflow-y-auto", SCROLL_CLASS)}>
                  {listing.entries.map((entry) => {
                    const state = entryState(entry);
                    const selectable = isExtractable(entry);
                    return (
                      <label
                        key={entry.index}
                        className={cn(
                          ROW_GRID,
                          "border-b border-text-primary/6 px-3.5 py-[11px] font-body text-xs leading-none last:border-b-0",
                          selectable ? "cursor-pointer" : "cursor-default opacity-60",
                          extracting && "cursor-default",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(entry.index)}
                          disabled={!selectable || extracting}
                          onChange={() => toggle(entry.index)}
                          aria-label={`Select ${entry.path}`}
                          className="size-4 rounded-sm border-border accent-accent disabled:cursor-not-allowed"
                        />
                        <span className="min-w-0 truncate text-neutral-300" title={entry.path}>
                          {entry.path}
                          {entry.linkTarget ? (
                            <span className="text-text-muted">{" → "}{entry.linkTarget}</span>
                          ) : null}
                        </span>
                        <span className="text-right font-mono text-[11px] text-text-muted">
                          {entry.kind === "file" ? formatFileSize(entry.size) : "—"}
                        </span>
                        <span
                          className={cn(
                            "text-right font-mono text-[9.5px] leading-none font-medium tracking-[0.08em]",
                            state.tone,
                          )}
                        >
                          {state.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {listing && listing.entries.length === 0 && (
              <CanvasFootnote>
                THIS ARCHIVE IS EMPTY — THE ENGINE READ IT WITHOUT ERROR AND FOUND NO ENTRIES
              </CanvasFootnote>
            )}

            {result && result.files.length > 0 && (
              <CanvasFootnote>
                WROTE {result.files.length}{" "}
                {plural(result.files.length, "FILE", "FILES")} · {formatFileSize(result.bytes)}{" "}
                MEASURED ·{" "}
                {result.files.length === 1 ? "AS A SINGLE FILE" : "BUNDLED INTO ONE ZIP"}
              </CanvasFootnote>
            )}
          </>
        )}
      </div>

      {/* ── Controls ───────────────────────────────────────────────── */}
      <ToolAside
        footer={
          file ? (
            <>
              {progress && (
                <ToolProgress
                  phase="EXTRACTING"
                  percent={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null}
                  label={`${progress.done} of ${progress.total}`}
                />
              )}
              {result && result.files.length > 0 && !progress && (
                <ToolDone elapsed={`${(result.ms / 1000).toFixed(1)} s`} savedToRecent />
              )}
              {listing ? (
                <ToolActions
                  primaryLabel={primaryLabel}
                  onPrimary={() => void handleExtract()}
                  primaryDisabled={selectedCount === 0 || progress !== null}
                  onReset={handleReset}
                  resetLabel="CHANGE FILE"
                />
              ) : (
                <ToolActions
                  primaryLabel="Read this archive again"
                  onPrimary={handleReRead}
                  primaryDisabled={reading || !bytes}
                  onReset={handleReset}
                  resetLabel="CHANGE FILE"
                />
              )}
            </>
          ) : null
        }
      >
        {file && (
          <ToolControlGroup>
            {listing && (
              <ToolControl label="SELECTION">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    disabled={extracting}
                    className={cn(
                      FIELD_CLASS,
                      "flex-1 cursor-pointer text-center",
                      "disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    All files
                  </button>
                  <button
                    type="button"
                    onClick={selectNone}
                    disabled={extracting}
                    className={cn(
                      FIELD_CLASS,
                      "flex-1 cursor-pointer text-center",
                      "disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    None
                  </button>
                </div>
                <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                  Folders and symbolic links are never ticked: a folder has no bytes, and a link
                  points at a path on the machine the archive came from. Two files or more download
                  as one ZIP, because a browser cancels a burst of separate downloads.
                </span>
              </ToolControl>
            )}

            <ToolControl label="ARCHIVE PASSWORD">
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Only if the archive is locked"
                aria-label="Archive password"
                autoComplete="off"
                className={cn(FIELD_CLASS, "w-full")}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Stays in this tab: it is passed to the engine running beside this page and is not
                stored, remembered or sent anywhere. If the archive hides its own file list behind
                the password, type it and press{" "}
                <span className="font-mono text-[10.5px] text-neutral-300">
                  Read this archive again
                </span>
                .
              </span>
            </ToolControl>
          </ToolControlGroup>
        )}

        {listing && summary && (
          <ToolAsideSection label="WHAT IS IN HERE">
            <ToolOutput
              rows={[
                ["Files", `${summary.files} of ${summary.entries} entries`],
                ["Folders", String(summary.directories)],
                [
                  listing.sizeSource === "gzip-trailer" ? "Declared size" : "Unpacked size",
                  formatFileSize(summary.declaredBytes),
                ],
                ["Refused paths", String(summary.refused)],
                ["Read by", listing.engine],
              ]}
            />
            {ratio !== null && (
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                The archive on disk is {formatFileSize(file?.size ?? 0)} against{" "}
                {formatFileSize(summary.declaredBytes)}{" "}
                of members — {ratio}% of what it holds.
                Both numbers come from this file: one is its size, the other is the total its own
                headers declare.
              </span>
            )}
            {result && (
              <span className="font-body text-[10.5px] leading-[1.5] text-success">
                Extracted {result.files.length}{" "}
                {plural(result.files.length, "file")} totalling {formatFileSize(result.bytes)}{" "}
                in {(result.ms / 1000).toFixed(1)}{" "}s.
              </span>
            )}
          </ToolAsideSection>
        )}

        {/*
          Reference prose, collapsed. `ToolPageLayout` RESERVES the measured
          initial height of this surface to stop the page shifting as the tool
          mounts, so anything that renders before a file is dropped is paid for
          in blank space on every visit. The ToolAdvanced disclosure pattern,
          with a heading that says what is actually inside it.
        */}
        <details className="group border-b border-border px-4 last:border-b-0">
          <summary
            className={cn(
              "flex cursor-pointer list-none items-center gap-2 py-3",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            )}
          >
            <span className={cn(MONO_LABEL, "text-text-muted")}>ABOUT THIS ENGINE</span>
            <span
              aria-hidden="true"
              className="ml-auto font-mono text-[15px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
            >
              ›
            </span>
          </summary>
          <div className="-mx-4 flex animate-tm-drawer flex-col gap-3 border-t border-border bg-text-primary/3 px-4 py-3.5 motion-reduce:animate-none">
            <span className="font-body text-[11.5px] leading-[1.5] text-text-muted">
              This page runs libarchive, compiled to WebAssembly — 599 KB fetched from this site
              the first time something needs it, then cached by your browser. It is served from
              here rather than a CDN, so opening an archive makes no request to anyone. A bare
              .gz is the one case that never needs it: the browser&rsquo;s own decoder handles
              that file, and the engine is not fetched at all.
            </span>
            <span className="font-body text-[11.5px] leading-[1.5] text-text-muted">
              It cannot create archives, and that is a property of the build rather than a rule
              anyone imposed: the binary contains sixteen format READERS and not one format
              writer. There is nothing here to call. Packing files is what{" "}
              <span className="font-mono text-[11px] text-neutral-300">/create-zip</span> does.
            </span>
            <span className="font-body text-[11.5px] leading-[1.5] text-text-muted">
              For an ordinary .zip,{" "}
              <span className="font-mono text-[11px] text-neutral-300">/unzip-files</span> is the
              lighter page — it uses JSZip, which is already in this site&rsquo;s JavaScript, so it
              fetches no engine at all. Come here for a .tar, .7z, .rar, a tar.gz/tar.xz/tar.bz2,
              or a ZIP whose entries are password-protected, which JSZip cannot decrypt at all.
            </span>
            <span className="font-body text-[11.5px] leading-[1.5] text-text-muted">
              Nothing is restored except the bytes: file permissions, ownership and modification
              times are not carried into what you download, because a browser download cannot set
              them.
            </span>
            <span className="font-body text-[11.5px] leading-[1.5] text-text-muted">
              Member checksums are not verified, and the counts above are a record of what was
              written rather than a clean bill of health. This build exposes no way to ask
              libarchive for the check and does not enforce one itself, so a member whose bytes
              were corrupted without changing its length comes out looking ordinary. The one
              thing that is checked is length: a member that reads back shorter than the size its
              own archive declares is left out and named rather than written out short. If it
              matters,{" "}
              <span className="font-mono text-[11px] text-neutral-300">unzip -t</span> or{" "}
              <span className="font-mono text-[11px] text-neutral-300">7z t</span> is the check.
            </span>
          </div>
        </details>
      </ToolAside>
    </>
  );
}
