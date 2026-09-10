"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  StatStrip,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import {
  countLineEndings,
  EOL_NAME,
  readUtf8Text,
  sortDedupeLines,
  splitLines,
  TEXT_READ_MESSAGE,
  utf8ByteLength,
  type DedupeMode,
  type SortMode,
} from "@/lib/tools/line-tools";
import { formatFileSize } from "@/lib/utils/file-helpers";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

/** The one field box the redesign doc specifies, shared across the tool pages. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "none", label: "Leave the order alone" },
  { value: "asc", label: "A → Z" },
  { value: "desc", label: "Z → A" },
  { value: "natural", label: "Natural — file2 before file10" },
  { value: "length", label: "Shortest line first" },
];

/**
 * How much of either pane is drawn. A `<pre>` lays out every character it is
 * given, and a sorted 5,000-host list is over 100,000 of them. The copy button
 * and the download always carry the whole result, and the footnote under the
 * panes says so whenever the cap bites.
 */
const PREVIEW_LIMIT = 40_000;

/** Cut at the last break before the cap, so a preview never stops mid-token. */
function cutPreview(text: string): string {
  if (text.length <= PREVIEW_LIMIT) return text;
  const slice = text.slice(0, PREVIEW_LIMIT);
  const br = slice.lastIndexOf("\n");
  return br > 0 ? slice.slice(0, br + 1) : slice;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function SortDedupeLinesUI() {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState("");
  const [pasted, setPasted] = useState("");
  const [sort, setSort] = useState<SortMode>("asc");
  const [dedupe, setDedupe] = useState<DedupeMode>("first");
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [trim, setTrim] = useState(false);
  const [removeBlank, setRemoveBlank] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [stripBom, setStripBom] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const { copied, copy } = useCopied();

  const source = mode === "paste" ? pasted : fileText;

  const result = useMemo(
    () =>
      source
        ? sortDedupeLines(source, {
            sort,
            caseSensitive,
            trim,
            removeBlank,
            dedupe,
            reverse,
            stripBom,
          })
        : null,
    [source, sort, caseSensitive, trim, removeBlank, dedupe, reverse, stripBom],
  );

  const counts = useMemo(() => countLineEndings(source), [source]);
  const output = result?.text ?? "";

  const blob = useMemo(
    () => new Blob([output], { type: "text/plain;charset=utf-8" }),
    [output],
  );
  /*
    Paste mode never borrows the dropped file's name: the bytes in the blob are
    the pasted text, and saving them as `hosts.sorted.txt` would name the
    download after a file whose content it does not contain.
  */
  const downloadName = useMemo(() => {
    const name = mode === "file" ? (file?.name ?? "lines.txt") : "lines.txt";
    const dot = name.lastIndexOf(".");
    return dot > 0
      ? `${name.slice(0, dot)}.sorted${name.slice(dot)}`
      : `${name}.sorted.txt`;
  }, [file, mode]);

  /*
    A slow first read can resolve after a second file has replaced it. The token
    is bumped by every load and every reset, so a stale read drops its result
    instead of landing under the wrong filename.
  */
  const loadToken = useRef(0);

  const handleFiles = useCallback(async (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    const token = ++loadToken.current;
    setReadError(null);
    setFile(picked);
    setFileText("");
    try {
      const buffer = await picked.arrayBuffer();
      if (loadToken.current !== token) return;
      const read = readUtf8Text(new Uint8Array(buffer));
      if ("failure" in read) {
        setReadError(TEXT_READ_MESSAGE[read.failure]);
        return;
      }
      setFileText(read.text);
    } catch {
      if (loadToken.current !== token) return;
      setReadError("This file could not be read from disk.");
    }
  }, []);

  const handleReset = useCallback(() => {
    loadToken.current++;
    setFile(null);
    setFileText("");
    setReadError(null);
  }, []);

  const handleCopy = useCallback(() => {
    void copy(output);
  }, [copy, output]);

  const preview = cutPreview(output);
  const sourcePreview = cutPreview(source);
  const showDropZone = mode === "file" && !file;

  /*
    What the panes are NOT showing, derived per pane rather than asserted. The
    source pane only draws a preview in file mode — the paste arm is a textarea
    bound to the whole string — so only the file arm can be short there.
  */
  const cuts: string[] = [];
  if (mode === "file" && sourcePreview.length < source.length) {
    cuts.push(
      `SOURCE SHOWS THE FIRST ${sourcePreview.length.toLocaleString()} OF ${source.length.toLocaleString()} CHARACTERS`,
    );
  }
  if (preview.length < output.length) {
    cuts.push(
      `RESULT SHOWS THE FIRST ${preview.length.toLocaleString()} OF ${output.length.toLocaleString()} CHARACTERS — COPY AND DOWNLOAD CARRY ALL OF IT`,
    );
  }

  /**
   * Every line that left the file, as one sentence per cause. Absent when
   * nothing was removed, rather than a row of reassuring zeroes.
   */
  const notes: string[] = [];
  if (result) {
    if (result.trimmedLines > 0) {
      notes.push(
        `${result.trimmedLines} ${plural(result.trimmedLines, "line")} had leading or trailing whitespace stripped.`,
      );
    }
    if (result.blanksRemoved > 0) {
      notes.push(
        `${result.blanksRemoved} blank ${plural(result.blanksRemoved, "line")} removed — empty and whitespace-only lines both count.`,
      );
    }
    if (result.duplicatesRemoved > 0) {
      notes.push(
        `${result.duplicatesRemoved} duplicate ${plural(result.duplicatesRemoved, "line")} removed across ${result.duplicateGroups} repeated ${plural(result.duplicateGroups, "value")}${caseSensitive ? "" : ", compared without regard to case"}.`,
      );
    }
  }

  return (
    <>
      <div className={CANVAS_COLUMN}>
        {showDropZone ? (
          <DropZone
            accept=".txt,.csv,.log"
            onFiles={handleFiles}
            label="Drop a text, CSV or log file"
            acceptLabel="TXT CSV LOG"
          />
        ) : (
          <>
            {mode === "file" && file && (
              <CanvasHeader
                file={file.name}
                meta={formatFileSize(file.size)}
                trailing={
                  result
                    ? `${result.linesIn.toLocaleString()} → ${result.linesOut.toLocaleString()} LINES`
                    : undefined
                }
              />
            )}

            {readError && <ErrorMessage message={readError} />}

            {result?.hadBom && (
              <WarningMessage
                message={
                  result.bomStripped
                    ? `This input began with a UTF-8 byte-order mark — the bytes EF BB BF — and it has been removed. It was taken off before anything was compared or sorted either way: left on line 1 it is invisible content that the sort would carry into the middle of the file, and that makes a marked line unequal to its unmarked twin.`
                    : `This input begins with a UTF-8 byte-order mark — the bytes EF BB BF. It is taken off before anything is compared or sorted and written back at the FRONT of the result, so it never travels with whichever line sorts first, and a marked line still counts as a duplicate of its unmarked twin. Tick "Remove the UTF-8 byte-order mark" to drop it instead.`
                }
              />
            )}

            {result?.mixedEol && (
              <WarningMessage
                message={`This input mixes line endings — ${counts.crlf} CRLF, ${counts.lf} LF and ${counts.cr} CR. Lines are split on all three, and the result is rejoined with ${EOL_NAME[result.eol]} throughout because that is what most of the file already used. If you wanted the other one, run the output through the line ending converter.`}
              />
            )}

            {notes.length > 0 && <WarningMessage message={notes.join(" ")} />}

            {result && (
              <StatStrip
                stats={[
                  {
                    label: "LINES IN",
                    value: result.linesIn.toLocaleString(),
                    tone: "neutral",
                  },
                  { label: "LINES OUT", value: result.linesOut.toLocaleString() },
                  {
                    label: "DUPLICATES",
                    value: result.duplicatesRemoved.toLocaleString(),
                    tone: result.duplicatesRemoved > 0 ? "ok" : "neutral",
                  },
                  {
                    label: "BLANKS",
                    value: result.blanksRemoved.toLocaleString(),
                    tone: result.blanksRemoved > 0 ? "ok" : "neutral",
                  },
                ]}
              />
            )}

            <TextPanes columns={output ? 2 : 1}>
              <TextPane
                label={mode === "paste" ? "Paste your lines" : "Source"}
                lines={result?.linesIn ?? splitLines(source).length}
                size={formatFileSize(utf8ByteLength(source))}
              >
                {mode === "paste" ? (
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={"file10.txt\nfile2.txt\nfile2.txt\n\nfile1.txt"}
                    aria-label="Paste your lines"
                    className={TEXT_PANE_BODY}
                  />
                ) : (
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Source lines"
                  >
                    {sourcePreview}
                  </pre>
                )}
              </TextPane>

              {output && (
                <TextPane
                  tone="out"
                  label="Result"
                  lines={result?.linesOut ?? splitLines(output).length}
                  size={formatFileSize(blob.size)}
                  action={
                    <button
                      onClick={handleCopy}
                      aria-label={copied ? "Copied output" : "Copy output"}
                      className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
                    >
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  }
                >
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Sorted lines"
                  >
                    {preview}
                  </pre>
                </TextPane>
              )}
            </TextPanes>

            {cuts.length > 0 && <CanvasFootnote>{cuts.join(" · ")}</CanvasFootnote>}
          </>
        )}
      </div>

      <ToolAside
        footer={
          <>
            {output && (
              <DownloadButton
                blob={blob}
                fileName={downloadName}
                className="w-full justify-center"
              />
            )}
            {mode === "file" && file && (
              <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="SOURCE">
            <ToolChoice
              label="Input source"
              value={mode}
              onChange={setMode}
              options={[
                { value: "file" as const, label: "File" },
                { value: "paste" as const, label: "Paste" },
              ]}
            />
          </ToolControl>

          <ToolControl label="SORT">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="Sort order"
              className={cn(FIELD_CLASS, "w-full")}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Ordering is the browser&rsquo;s own Unicode collation, not raw code-point
              order — so{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">apple</code>{" "}
              sorts before{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">Banana</code>,
              where a byte comparison would put every capital first. Natural adds numeric
              awareness, which is the only mode where{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">file2</code>{" "}
              comes before{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">file10</code>.
            </span>
          </ToolControl>

          <ToolControl label="DUPLICATES">
            <ToolChoice
              label="Duplicate handling"
              value={dedupe}
              onChange={setDedupe}
              options={[
                { value: "off" as const, label: "Keep all" },
                { value: "first" as const, label: "Keep first" },
                { value: "last" as const, label: "Keep last" },
              ]}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              First and last mean first and last in YOUR file: de-duplication runs before
              the sort, so re-ordering never changes which copy survives. Keep last leaves
              that copy in the position it already occupied.
            </span>
          </ToolControl>

          <ToolControl label="BEFORE COMPARING">
            {[
              {
                id: "trim",
                label: "Trim leading and trailing whitespace",
                checked: trim,
                set: setTrim,
              },
              {
                id: "blank",
                label: "Remove blank lines",
                checked: removeBlank,
                set: setRemoveBlank,
              },
              {
                id: "case",
                label: "Case-sensitive",
                checked: caseSensitive,
                set: setCaseSensitive,
              },
              {
                id: "reverse",
                label: "Reverse the final order",
                checked: reverse,
                set: setReverse,
              },
              {
                id: "bom",
                label: "Remove the UTF-8 byte-order mark",
                checked: stripBom,
                set: setStripBom,
              },
            ].map((row) => (
              <label
                key={row.id}
                className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300"
              >
                <input
                  type="checkbox"
                  checked={row.checked}
                  onChange={(e) => row.set(e.target.checked)}
                  className="size-4 rounded-sm border-border accent-accent"
                />
                {row.label}
              </label>
            ))}
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Case-sensitivity governs both the duplicate test and the sort. Turn it off
              and{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">API</code> and{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">api</code> become
              the same line. Reverse is applied last, after everything else. A leading
              byte-order mark is detached before any of this and written back at the front
              of the result — tick the last box to drop it instead.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Lines in", result ? result.linesIn.toLocaleString() : "—"],
              ["Lines out", result ? result.linesOut.toLocaleString() : "—"],
              [
                "Duplicates removed",
                result ? result.duplicatesRemoved.toLocaleString() : "—",
              ],
              ["Blanks removed", result ? result.blanksRemoved.toLocaleString() : "—"],
              [
                "Byte-order mark",
                result
                  ? result.hadBom
                    ? result.bomStripped
                      ? "Removed"
                      : "Kept at the front"
                    : "None"
                  : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="THE ORDER OF OPERATIONS">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Trim, then drop blanks, then de-duplicate, then sort, then reverse — always in
            that order, so the counts above describe one another rather than compete.
            Trimming first is what makes a padded line equal to an unpadded one; sorting
            last is what keeps &ldquo;keep first&rdquo; meaningful. Every line that leaves
            is counted on screen, so a run that quietly cost you a hundred rows cannot pass
            for a clean one.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
