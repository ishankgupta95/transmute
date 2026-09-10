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
  lineCount,
  StatStrip,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import {
  convertLineEndings,
  EOL_NAME,
  EOL_WHERE,
  readUtf8Text,
  TEXT_READ_MESSAGE,
  type Eol,
} from "@/lib/tools/line-tools";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";

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
 * How much of either pane is drawn. A `<pre>` lays out every character it is
 * given, and with the ␍␊ marks on, every line break in the text becomes three
 * of them. The copy button and the download always carry the whole result, and
 * the footnote under the panes says so whenever the cap bites.
 */
const PREVIEW_LIMIT = 40_000;

/** Cut at the last break before the cap, so a preview never stops mid-token. */
function cutPreview(text: string): string {
  if (text.length <= PREVIEW_LIMIT) return text;
  const slice = text.slice(0, PREVIEW_LIMIT);
  const br = slice.lastIndexOf("\n");
  return br > 0 ? slice.slice(0, br + 1) : slice;
}

const TARGETS: { value: Eol; label: string }[] = [
  { value: "lf", label: "LF" },
  { value: "crlf", label: "CRLF" },
  { value: "cr", label: "CR" },
];

/**
 * Every break rendered as a visible token, so the preview shows what a plain
 * `<pre>` cannot: CR and LF look identical on screen otherwise. One `\n` is kept
 * after each token so the line structure of the pane still matches the file.
 */
function visible(text: string): string {
  return text.replace(/\r\n|\r|\n/g, (m) =>
    `${m === "\r\n" ? "␍␊" : m === "\r" ? "␍" : "␊"}\n`,
  );
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

export function CrlfLfUI() {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState("");
  const [pasted, setPasted] = useState("");
  const [target, setTarget] = useState<Eol>("lf");
  const [ensureTrailingNewline, setEnsureTrailingNewline] = useState(false);
  const [stripBom, setStripBom] = useState(false);
  const [showMarks, setShowMarks] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const { copied, copy } = useCopied();

  const source = mode === "paste" ? pasted : fileText;

  const result = useMemo(
    () =>
      source
        ? convertLineEndings(source, { target, ensureTrailingNewline, stripBom })
        : null,
    [source, target, ensureTrailingNewline, stripBom],
  );

  const output = result?.text ?? "";
  const before = result?.before;

  /*
    The Blob is built from the exact string `convertLineEndings` returned. It is
    never round-tripped through a textarea on the way out — the HTML spec has a
    textarea normalise every line ending in its value to LF, which would silently
    undo a CRLF conversion between here and the download.
  */
  const blob = useMemo(
    () => new Blob([output], { type: "text/plain;charset=utf-8" }),
    [output],
  );

  /*
    Paste mode never borrows the dropped file's name: the bytes in the blob are
    the pasted text, and saving them as `report.lf.log` would name the download
    after a file whose content it does not contain.
  */
  const downloadName = useMemo(() => {
    const name = mode === "file" ? (file?.name ?? "text.txt") : "text.txt";
    const dot = name.lastIndexOf(".");
    const tag = EOL_NAME[target].toLowerCase();
    return dot > 0 ? `${name.slice(0, dot)}.${tag}${name.slice(dot)}` : `${name}.${tag}.txt`;
  }, [file, mode, target]);

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

  const shown = showMarks ? visible(output) : output;
  const preview = cutPreview(shown);
  const shownSource = showMarks ? visible(source) : source;
  const sourcePreview = cutPreview(shownSource);
  const showDropZone = mode === "file" && !file;

  /*
    What the panes are NOT showing, derived per pane rather than asserted. The
    counts are of the characters in the PANE, which with the marks on is more
    than the file has — hence the parenthetical. The source pane only draws a
    preview in file mode; the paste arm is a textarea bound to the whole string.
  */
  const marked = showMarks ? " (␍␊ MARKS INCLUDED)" : "";
  const cuts: string[] = [];
  if (mode === "file" && sourcePreview.length < shownSource.length) {
    cuts.push(
      `SOURCE SHOWS THE FIRST ${sourcePreview.length.toLocaleString()} OF ${shownSource.length.toLocaleString()} CHARACTERS${marked}`,
    );
  }
  if (preview.length < shown.length) {
    cuts.push(
      `OUTPUT SHOWS THE FIRST ${preview.length.toLocaleString()} OF ${shown.length.toLocaleString()} CHARACTERS${marked} — COPY AND DOWNLOAD CARRY ALL OF IT`,
    );
  }

  const delta = result ? result.bytesOut - result.bytesIn : 0;

  return (
    <>
      <div className={CANVAS_COLUMN}>
        {showDropZone ? (
          <DropZone
            accept=".txt,.csv,.log,.md,.sh"
            onFiles={handleFiles}
            label="Drop a text file to see what endings it uses"
            acceptLabel="TXT CSV LOG MD SH"
          />
        ) : (
          <>
            {mode === "file" && file && before && (
              <CanvasHeader
                file={file.name}
                meta={formatFileSize(file.size)}
                trailing={
                  result?.mixed
                    ? "MIXED LINE ENDINGS"
                    : before.total === 0
                      ? "NO LINE BREAKS"
                      : `ALL ${EOL_NAME[
                          before.crlf ? "crlf" : before.lf ? "lf" : "cr"
                        ]}`
                }
              />
            )}

            {readError && <ErrorMessage message={readError} />}

            {mode === "paste" && (
              <WarningMessage
                message={`A textarea normalises every line ending in its value to LF — that is the HTML specification, not a choice made here — so whatever you paste arrives as LF and this arm cannot tell you what your original file used. Drop the file instead if detection is what you came for. Pasting is still the right arm for producing CRLF or CR output from text you are writing here.`}
              />
            )}

            {result?.mixed && before && (
              <WarningMessage
                message={`This file mixes line endings: ${before.crlf} CRLF, ${before.lf} LF and ${before.cr} CR. That is the state that makes Git show a whole file as changed, makes a shell script fail with a "\\r: command not found", and makes a diff unreadable. ${result.converted} ${plural(result.converted, "break")} will change to ${EOL_NAME[target]} and ${result.alreadyTarget} ${plural(result.alreadyTarget, "is", "are")} already ${EOL_NAME[target]}.`}
              />
            )}

            {result?.hadBom && (
              <WarningMessage
                message={
                  result.bomStripped
                    ? `This file began with a UTF-8 byte-order mark — the bytes EF BB BF — and all three have been removed. Three bytes of the size change above are that mark; the rest is line endings. Nothing else about the text was touched.`
                    : `This file begins with a UTF-8 byte-order mark — the bytes EF BB BF. It is invisible in an editor and it is why a shell script can fail on its very first line and why a CSV's first column header reads with a stray character in front of it. It is being kept. Tick "Remove the UTF-8 byte-order mark" to take it off.`
                }
              />
            )}

            {result && before && (
              <StatStrip
                stats={[
                  {
                    label: "CRLF",
                    value: before.crlf.toLocaleString(),
                    tone: before.crlf > 0 ? "accent" : "neutral",
                  },
                  {
                    label: "LF",
                    value: before.lf.toLocaleString(),
                    tone: before.lf > 0 ? "accent" : "neutral",
                  },
                  {
                    label: "CR",
                    value: before.cr.toLocaleString(),
                    tone: before.cr > 0 ? "accent" : "neutral",
                  },
                  {
                    label: "LINES",
                    value: result.lines.toLocaleString(),
                    tone: "neutral",
                  },
                  {
                    label: "BYTES",
                    value: `${delta > 0 ? "+" : ""}${delta.toLocaleString()}`,
                    tone: delta === 0 ? "neutral" : "ok",
                  },
                ]}
              />
            )}

            <TextPanes columns={output ? 2 : 1}>
              <TextPane
                label={mode === "paste" ? "Paste your text" : "Source"}
                lines={result?.lines ?? lineCount(source)}
                size={result ? formatFileSize(result.bytesIn) : "0 B"}
              >
                {mode === "paste" ? (
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={"#!/bin/sh\necho one\necho two"}
                    aria-label="Paste your text"
                    className={TEXT_PANE_BODY}
                  />
                ) : (
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Source text"
                  >
                    {sourcePreview}
                  </pre>
                )}
              </TextPane>

              {output && (
                <TextPane
                  tone="out"
                  label={`${EOL_NAME[target]} output`}
                  lines={result?.lines ?? lineCount(output)}
                  size={formatFileSize(result?.bytesOut ?? 0)}
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
                    aria-label="Converted text"
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

          <ToolControl label="CONVERT TO">
            <ToolChoice
              label="Target line ending"
              value={target}
              onChange={setTarget}
              options={TARGETS}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {EOL_NAME[target]} — {EOL_WHERE[target]}.
            </span>
          </ToolControl>

          <ToolControl label="ALSO">
            {[
              {
                id: "trailing",
                label: "End the file with a newline",
                checked: ensureTrailingNewline,
                set: setEnsureTrailingNewline,
              },
              {
                id: "bom",
                label: "Remove the UTF-8 byte-order mark",
                checked: stripBom,
                set: setStripBom,
              },
              {
                id: "marks",
                label: "Show ␍ and ␊ in the panes",
                checked: showMarks,
                set: setShowMarks,
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
              The marks are drawn in the preview only — they are never written to the file
              you download. POSIX defines a line as ending in a newline, which is why{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">wc -l</code> and
              a great many parsers miss the last line of a file that has none.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="WHAT WAS FOUND">
          <ToolOutput
            rows={[
              [
                "CRLF · LF · CR",
                before ? `${before.crlf} · ${before.lf} · ${before.cr}` : "—",
              ],
              ["Breaks converted", result ? result.converted.toLocaleString() : "—"],
              [
                "Byte-order mark",
                result ? (result.hadBom ? (result.bomStripped ? "Removed" : "Kept") : "None") : "—",
              ],
              [
                "Size",
                result
                  ? `${formatFileSize(result.bytesIn)} → ${formatFileSize(result.bytesOut)}`
                  : "—",
              ],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT CHANGES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Line endings, and the byte-order mark and final newline if you ask for them.
            Every other character is copied through untouched, so the byte figure above is
            fully accounted for: one byte per CRLF collapsed to LF, one gained per LF
            expanded to CRLF, three for the mark. The file is written as UTF-8 — which is
            what it already was, because a file that is not valid UTF-8 is refused rather
            than read with substitutions.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            A lone CR followed by an LF is one CRLF, never a CR plus an LF, so the three
            counts add up to the number of line breaks rather than over-reporting a
            Windows file as mixed.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
