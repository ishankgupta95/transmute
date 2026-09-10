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
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  convertSubtitles,
  FALLBACK_ENCODING,
  FRAME_RATES,
  decodeSubtitleBytes,
  formatDuration,
  frameRate,
  parseOffset,
  SUBTITLE_ACCEPT,
  SUBTITLE_ENCODINGS,
  SUBTITLE_FORMAT_NAME,
  subtitleFileName,
  type ConvertResult,
  type FrameRateId,
  type SubtitleFormat,
} from "@/lib/tools/subtitles";

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
 * The one field box the redesign doc specifies, shared by the offset input and
 * the two frame-rate selects. Same shape `RangeField` and the cron builder use.
 */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * How much of either pane is drawn.
 *
 * A feature film's subtitles are ~1 500 cues and ~60 KB, which a `<pre>`
 * handles without noticing. A concatenated season pack is not, and a `<pre>`
 * lays out every character it is given. The download and the copy button carry
 * the whole file either way, and the footnote says so whenever the cap bites.
 */
const PREVIEW_LIMIT = 40_000;

/** Correct types, so a saved file opens in the right thing. */
const MIME: Record<SubtitleFormat, string> = {
  srt: "application/x-subrip",
  vtt: "text/vtt",
  ass: "text/x-ssa",
};

const FORMAT_OPTIONS = [
  { value: "srt" as const, label: "SRT" },
  { value: "vtt" as const, label: "VTT" },
  { value: "ass" as const, label: "ASS" },
];

/** Naming a few beats a wall of numbers. */
function listPositions(positions: number[]): string {
  if (positions.length <= 6) return positions.join(", ");
  return `${positions.slice(0, 6).join(", ")} and ${positions.length - 6} more`;
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/**
 * Everything the conversion had to drop, clamp or reorder, as one sentence per
 * kind. Empty when nothing happened — the warning is not rendered at all then,
 * rather than reassuring the user with a list of zeroes.
 */
function lossNotes(result: ConvertResult): string[] {
  const notes: string[] = [];
  const { parse, timing, sourceFormat, targetFormat } = result;

  if (parse.malformed.length > 0) {
    const n = parse.malformed.length;
    // `parseAss` reports line numbers; the block parsers report block numbers.
    // Calling an ASS line a "block" would send the reader to the wrong place.
    const unit = sourceFormat === "ass" ? plural(n, "line") : plural(n, "block");
    notes.push(
      `${n} ${unit} had no readable timing and ${plural(n, "was", "were")} skipped (${sourceFormat === "ass" ? "line" : "block"} ${listPositions(parse.malformed)}).`,
    );
  }
  if (parse.drawings > 0) {
    const n = parse.drawings;
    notes.push(
      `${n} ${plural(n, "cue")} ${plural(n, "was", "were")} a vector drawing rather than words, and ${plural(n, "was", "were")} dropped instead of being written out as path coordinates.`,
    );
  }
  if (parse.styled > 0 && sourceFormat !== "ass") {
    const n = parse.styled;
    notes.push(
      `${n} ${plural(n, "cue")} carried markup with nowhere to go — colours, classes or speaker names. The words are kept; the markup is not.`,
    );
  }
  if (parse.positioned > 0) {
    const n = parse.positioned;
    /*
      This used to be suppressed for a WebVTT target, on the assumption that
      the one format able to hold positioning would keep it. `writeVtt` writes
      a number, a timing line and text — nothing else — so WebVTT to WebVTT was
      the ONE conversion that dropped the settings without a word about it.
    */
    notes.push(
      targetFormat === "vtt"
        ? `${n} WebVTT ${plural(n, "cue")} carried on-screen positioning — line, position, align or region. This tool reads a file down to its timings and words, so those settings are not written back out, even though WebVTT could hold them.`
        : `${n} WebVTT ${plural(n, "cue")} carried on-screen positioning, which ${SUBTITLE_FORMAT_NAME[targetFormat]} cannot store.`,
    );
  }
  if (parse.vttBlocks > 0) {
    const n = parse.vttBlocks;
    notes.push(
      `${n} WebVTT STYLE or REGION ${plural(n, "block")} ${plural(n, "was", "were")} dropped. ${plural(n, "It decides", "They decide")} how cues are drawn and where, and nothing in the output carries ${plural(n, "it", "them")}.`,
    );
  }
  if (result.blankLineCues > 0) {
    const n = result.blankLineCues;
    notes.push(
      `${n} ${plural(n, "cue")} contained a blank line, and ${SUBTITLE_FORMAT_NAME[targetFormat]} reads a blank line as the END of a cue. ${plural(n, "It was", "They were")} taken out: written through, it would have ended the cue early and left every block after it reading against the wrong timing. All the words are still here.`,
    );
  }
  if (timing.droppedInvalid > 0) {
    const n = timing.droppedInvalid;
    notes.push(
      `${n} ${plural(n, "cue")} ended at or before ${plural(n, "its", "their")} own start time and ${plural(n, "was", "were")} dropped — no player will show a cue like that.`,
    );
  }
  if (timing.droppedBeforeZero > 0) {
    const n = timing.droppedBeforeZero;
    notes.push(
      `${n} ${plural(n, "cue")} ended before 00:00:00 after the shift and ${plural(n, "was", "were")} dropped.`,
    );
  }
  if (timing.clampedToZero > 0) {
    const n = timing.clampedToZero;
    notes.push(
      `${n} ${plural(n, "cue")} would have started before 00:00:00, so ${plural(n, "its start was", "their starts were")} pulled to 00:00:00. The words are intact.`,
    );
  }
  if (timing.reordered > 0) {
    const n = timing.reordered;
    notes.push(
      `${n} ${plural(n, "cue")} appeared out of order in the source and ${plural(n, "was", "were")} sorted by start time.`,
    );
  }
  if (timing.overlaps > 0) {
    const n = timing.overlaps;
    notes.push(
      `${n} ${plural(n, "cue")} ${plural(n, "starts", "start")} before the previous one ends. That is legal — two speakers at once — so the overlap is left exactly as it was.`,
    );
  }
  return notes;
}

export function SubtitleConverterUI() {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [pasted, setPasted] = useState("");
  const [encoding, setEncoding] = useState<string>("auto");
  const [targetFormat, setTargetFormat] = useState<SubtitleFormat>("srt");
  const [offsetText, setOffsetText] = useState("");
  const [retime, setRetime] = useState(false);
  const [sourceFps, setSourceFps] = useState<FrameRateId>("25");
  const [targetFps, setTargetFps] = useState<FrameRateId>("23.976");
  const [addBom, setAddBom] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const { copied, copy } = useCopied();

  /*
    The bytes are kept, not the decoded string: changing the encoding picker
    must re-decode the ORIGINAL bytes. Decoding once and re-decoding the result
    would be decoding mojibake.
  */
  const decoded = useMemo(
    () => (mode === "file" && bytes ? decodeSubtitleBytes(bytes, encoding === "auto" ? undefined : encoding) : null),
    [bytes, encoding, mode],
  );

  const sourceText = mode === "paste" ? pasted : (decoded?.text ?? "");
  const offsetMs = useMemo(() => parseOffset(offsetText), [offsetText]);

  const conversion = useMemo((): { result: ConvertResult | null; error: string | null } => {
    if (!sourceText.trim()) return { result: null, error: null };
    if (offsetMs === null) return { result: null, error: null };
    try {
      return {
        result: convertSubtitles(sourceText, {
          targetFormat,
          offsetMs,
          sourceFps: retime ? frameRate(sourceFps) : undefined,
          targetFps: retime ? frameRate(targetFps) : undefined,
        }),
        error: null,
      };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : "Could not read this file" };
    }
  }, [sourceText, targetFormat, offsetMs, retime, sourceFps, targetFps]);

  const { result, error } = conversion;
  const outputText = result?.text ?? "";
  const fileName = subtitleFileName(mode === "file" ? (file?.name ?? "subtitles") : "subtitles", targetFormat);

  const blob = useMemo(
    () =>
      new Blob([addBom ? `\uFEFF${outputText}` : outputText], {
        type: `${MIME[targetFormat]};charset=utf-8`,
      }),
    [outputText, addBom, targetFormat],
  );

  const notes = result ? lossNotes(result) : [];
  /*
    Shown whenever the bytes were NOT valid UTF-8 and we fell back to a
    codepage. Not shown for a BOM, for a clean UTF-8 decode, or for pure ASCII
    (where every candidate encoding agrees byte for byte), because there is
    nothing uncertain in those cases.
  */
  const guessedCodepage =
    decoded?.basis === "guess" && decoded.encoding === FALLBACK_ENCODING && !decoded.ascii;
  const sniffedUtf16 = decoded?.basis === "guess" && decoded.encoding.startsWith("utf-16");

  /*
    `arrayBuffer()` is async, so a slow first read can resolve AFTER a second
    file has replaced it and hand the tool the wrong bytes under the right
    filename. The token is bumped by every load and by the reset, and a read
    whose token is stale drops its result on the floor.
  */
  const loadToken = useRef(0);

  const handleFiles = useCallback(async (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    const token = ++loadToken.current;
    setReadError(null);
    setFile(picked);
    setBytes(null);
    try {
      const buffer = await picked.arrayBuffer();
      if (loadToken.current !== token) return;
      setBytes(new Uint8Array(buffer));
    } catch {
      if (loadToken.current !== token) return;
      setReadError("This file could not be read from disk.");
    }
  }, []);

  const handleReset = useCallback(() => {
    loadToken.current++;
    setFile(null);
    setBytes(null);
    setReadError(null);
    setEncoding("auto");
  }, []);

  const handleCopy = useCallback(() => {
    void copy(outputText);
  }, [copy, outputText]);

  const preview =
    outputText.length > PREVIEW_LIMIT ? outputText.slice(0, PREVIEW_LIMIT) : outputText;
  const sourcePreview =
    sourceText.length > PREVIEW_LIMIT ? sourceText.slice(0, PREVIEW_LIMIT) : sourceText;

  const showDropZone = mode === "file" && !file;

  return (
    <>
      {/* ── Canvas: the file that came in, and the file going out ────── */}
      <div className={CANVAS_COLUMN}>
        {showDropZone ? (
          <DropZone
            accept={SUBTITLE_ACCEPT}
            onFiles={handleFiles}
            label="Drop a subtitle file to begin"
            acceptLabel="SRT VTT ASS SSA"
          />
        ) : (
          <>
            {mode === "file" && file && (
              <CanvasHeader
                file={file.name}
                meta={`${formatFileSize(file.size)}${decoded ? ` · ${decoded.encoding.toUpperCase()}` : ""}`}
                trailing={
                  result
                    ? `${result.cues.length} ${result.cues.length === 1 ? "CUE" : "CUES"} · ENDS ${formatDuration(result.endMs)}`
                    : undefined
                }
              />
            )}

            {guessedCodepage && (
              <WarningMessage
                message={`These bytes are not valid UTF-8, so this file uses some older single-byte codepage. It has been read as Windows-1252, which is the commonest one for subtitles by a wide margin — but a Cyrillic, Greek, Turkish or Central European file looks exactly the same from here and would come out with the wrong letters. Check the accented characters in the left pane. If they are wrong, pick the right encoding in the rail; nothing else about the file changes.`}
              />
            )}
            {sniffedUtf16 && (
              <WarningMessage
                message={`This file is UTF-16 with no byte-order mark — recognised from the pattern of zero bytes, not from anything the file says about itself. If the text on the left is readable, the guess was right. The file you download is UTF-8.`}
              />
            )}
            {result?.sourceFormat === "ass" && (
              <WarningMessage
                message={`ASS/SSA is a styling language, and this reads only the words and their timings out of it. Fonts, colours, on-screen positions, layers, karaoke timings and every override block are gone from the output, permanently${result.parse.styles.length > 0 ? `, including the ${result.parse.styles.length} named ${plural(result.parse.styles.length, "style")} this file used (${result.parse.styles.join(", ")})` : ""}. This is a one-way trip: converting the result back to ASS will not bring any of it back.`}
              />
            )}
            {notes.length > 0 && <WarningMessage message={notes.join(" ")} />}
            {readError && <ErrorMessage message={readError} />}
            {error && <ErrorMessage message={error} />}
            {offsetMs === null && (
              <ErrorMessage message="That time shift could not be read. Use seconds (2.5, -1.2), milliseconds (250ms) or a timecode (00:00:02,500)." />
            )}

            <TextPanes columns={outputText ? 2 : 1}>
              <TextPane
                label={mode === "paste" ? "Paste your subtitles" : `Source · ${result ? SUBTITLE_FORMAT_NAME[result.sourceFormat] : "not yet read"}`}
                lines={lineCount(sourceText)}
                size={formatFileSize(new Blob([sourceText]).size)}
              >
                {mode === "paste" ? (
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={"1\n00:00:01,000 --> 00:00:04,000\nPaste an SRT, WebVTT or ASS file here."}
                    aria-label="Paste your subtitles"
                    className={TEXT_PANE_BODY}
                  />
                ) : (
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Source subtitles"
                  >
                    {sourcePreview}
                  </pre>
                )}
              </TextPane>

              {outputText && (
                <TextPane
                  tone="out"
                  label={SUBTITLE_FORMAT_NAME[targetFormat]}
                  lines={lineCount(outputText)}
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
                    aria-label="Converted subtitles"
                  >
                    {preview}
                  </pre>
                </TextPane>
              )}
            </TextPanes>

            {outputText.length > PREVIEW_LIMIT && (
              <CanvasFootnote>
                PREVIEWING THE FIRST {PREVIEW_LIMIT.toLocaleString()} OF{" "}
                {outputText.length.toLocaleString()} CHARACTERS — COPY AND DOWNLOAD CARRY ALL OF IT
              </CanvasFootnote>
            )}
          </>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {outputText && <DownloadButton blob={blob} fileName={fileName} className="w-full justify-center" />}
            {mode === "file" && file && <ToolResetLink onClick={handleReset} label="CHANGE FILE" />}
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
              label="Output format"
              value={targetFormat}
              onChange={setTargetFormat}
              options={FORMAT_OPTIONS}
            />
          </ToolControl>

          <ToolControl label="TIME SHIFT">
            <input
              type="text"
              value={offsetText}
              onChange={(e) => setOffsetText(e.target.value)}
              placeholder="+2.5s"
              aria-label="Time shift"
              aria-invalid={offsetMs === null || undefined}
              className={cn(FIELD_CLASS, "w-full", offsetMs === null && "border-error")}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Positive moves subtitles later, negative earlier. Seconds by default
              (<code className="font-mono text-[10.5px] text-neutral-300">-1.2</code>), or say{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">250ms</code> or{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">00:00:02,500</code>.
            </span>
          </ToolControl>

          <ToolControl label="FRAME RATE">
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={retime}
                onChange={(e) => setRetime(e.target.checked)}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Re-time between frame rates
            </label>
            {retime && (
              <div className="flex flex-col gap-2">
                {[
                  { id: "from", text: "Timed for", value: sourceFps, set: setSourceFps },
                  { id: "to", text: "Playing at", value: targetFps, set: setTargetFps },
                ].map((row) => (
                  <div key={row.id} className="flex items-center gap-2">
                    <label
                      htmlFor={`fps-${row.id}`}
                      className="w-[70px] shrink-0 font-body text-[12.5px] leading-[1.2] text-neutral-300"
                    >
                      {row.text}
                    </label>
                    <select
                      id={`fps-${row.id}`}
                      value={row.value}
                      onChange={(e) => row.set(e.target.value as FrameRateId)}
                      className={cn(FIELD_CLASS, "min-w-0 flex-1")}
                    >
                      {FRAME_RATES.map((rate) => (
                        <option key={rate.id} value={rate.id}>
                          {rate.label} fps — {rate.note}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              For a film transferred between PAL and NTSC, where the subtitles drift further out
              the longer you watch. Every cue time is multiplied by{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">timed-for ÷ playing-at</code>
              , and the time shift above is applied afterwards. If the gap is constant from the
              first line, the shift alone is what you want.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Read as", result ? SUBTITLE_FORMAT_NAME[result.sourceFormat] : "—"],
              ["Cues out", result ? `${result.cues.length} of ${result.sourceCueCount}` : "—"],
              ["Last cue ends", result ? formatDuration(result.endMs) : "—"],
            ]}
          />
          <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
            <input
              type="checkbox"
              checked={addBom}
              onChange={(e) => setAddBom(e.target.checked)}
              className="size-4 rounded-sm border-border accent-accent"
            />
            Start the file with a UTF-8 byte-order mark
          </label>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The download is UTF-8 either way. A few Windows players and set-top boxes only treat a
            subtitle file as UTF-8 when it opens with this three-byte mark; most software ignores
            it, and web players and browsers do not need it.
          </span>
        </ToolAsideSection>

        {/*
          Gated on the FILE, not just on the mode. `mode` starts at "file", so
          keying off it alone rendered a 15-option encoding picker and its
          explanation before anything had been dropped — controls that cannot
          act on bytes the tool does not have yet. It also made this the tallest
          initial surface on the site by 43% (1511px at 412px wide), and
          ToolPageLayout RESERVES that height to prevent CLS, so the cost was
          two screens of blank space before the tool mounted.
        */}
        {mode === "file" && file && (
          <ToolAsideSection label="READ THE FILE AS">
            <select
              value={encoding}
              onChange={(e) => setEncoding(e.target.value)}
              aria-label="Read the file as"
              className={cn(FIELD_CLASS, "w-full")}
            >
              <option value="auto">Detect automatically</option>
              {SUBTITLE_ENCODINGS.map((enc) => (
                <option key={enc.label} value={enc.label}>
                  {enc.name}
                </option>
              ))}
            </select>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Detection believes a byte-order mark, spots UTF-16 by its zero bytes, and otherwise
              tests the bytes strictly against UTF-8. Bytes that fail that test are read as
              Windows-1252 and flagged as a guess — this file does not say what it is, so nothing
              can do better than guess. Latin-1 is decoded the same way as Windows-1252, which is
              what the browser&rsquo;s own encoding tables specify.
            </span>
          </ToolAsideSection>
        )}

        <ToolAsideSection label="WHAT CHANGES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The cue timings and the words always survive. So do{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">&lt;i&gt;</code>,{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">&lt;b&gt;</code> and{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">&lt;u&gt;</code> between SRT
            and WebVTT, and they become ASS&rsquo;s own toggles on the way out. Reading an ASS file
            is the one direction that loses formatting, italics included. Cues come out sorted by
            start time, and SRT and WebVTT are renumbered from 1. Nothing is uploaded: the file is
            read, converted and written in this tab.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {targetFormat === "srt" &&
              "SubRip writes its timestamps with a comma before the milliseconds. It has no header, no positioning and no styles beyond the three inline tags."}
            {targetFormat === "vtt" &&
              "WebVTT writes a period before the milliseconds and opens with a WEBVTT line, without which no browser will load it. Ampersands and less-than signs in the text are escaped, as the format requires."}
            {targetFormat === "ass" &&
              "ASS stores time in hundredths of a second, so timings are rounded outward — starts down, ends up — by up to 10 ms, which keeps every cue at least as long as it was. The file is written with one Default style at 1280×720; it is a valid ASS file, not a styled one."}
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
