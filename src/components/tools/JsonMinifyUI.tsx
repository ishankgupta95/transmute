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
import { minifyJson } from "@/lib/tools/json-format";
import {
  readUtf8Text,
  splitLines,
  TEXT_READ_MESSAGE,
  utf8ByteLength,
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
 * Where the browser's parser stopped, read off its own message. V8 gives a
 * position, SpiderMonkey gives line/column, JavaScriptCore gives neither — so
 * this returns null rather than guessing, and the readout is absent instead of
 * wrong. Same rule as JsonFormatterUI's locator.
 */
function locate(message: string, source: string): string | null {
  const lineCol = message.match(/line (\d+) column (\d+)/i);
  if (lineCol) return `LINE ${lineCol[1]} · COL ${lineCol[2]}`;
  const pos = message.match(/at position (\d+)/i);
  if (!pos) return null;
  const offset = Math.min(Number(pos[1]), source.length);
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  return `LINE ${line} · COL ${offset - before.lastIndexOf("\n")}`;
}

/** How much of either pane is drawn; copy and download always carry all of it. */
const PREVIEW_LIMIT = 40_000;

/** Cut at the last break before the cap, so a preview never stops mid-token. */
function cutPreview(text: string): string {
  if (text.length <= PREVIEW_LIMIT) return text;
  const slice = text.slice(0, PREVIEW_LIMIT);
  const br = slice.lastIndexOf("\n");
  return br > 0 ? slice.slice(0, br + 1) : slice;
}

/*
  `splitLines`, not a `split("\n")` count: a JSON file written on Windows has
  CRLF breaks and one written on a classic Mac has lone CRs, and neither is a
  newline. A trailing break terminates the last line rather than opening an
  empty one, so a 3-line file that ends in a newline is 3 lines, not 4.
*/
const lines = (text: string) => splitLines(text).length;

export function JsonMinifyUI() {
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState("");
  const [pasted, setPasted] = useState("");
  const [dropBom, setDropBom] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const { copied, copy } = useCopied();

  const raw = mode === "paste" ? pasted : fileText;
  const hasBom = raw.startsWith("\uFEFF");
  const bomDropped = hasBom && dropBom;
  const source = bomDropped ? raw.slice(1) : raw;

  const { output, error } = useMemo(() => {
    if (!source.trim()) return { output: "", error: "" };
    try {
      /*
        Parse for VALIDITY only, exactly as JsonFormatterUI does. The output is
        `minifyJson`, which rewrites whitespace over the RAW text — so a 64-bit
        id, a trailing `.0` and a duplicate key all survive as the characters
        you gave it instead of being round-tripped through a double.
      */
      JSON.parse(source);
      return { output: minifyJson(source), error: "" };
    } catch (e) {
      return { output: "", error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [source]);

  const bytesIn = useMemo(() => utf8ByteLength(raw), [raw]);
  const bytesOut = useMemo(() => utf8ByteLength(output), [output]);
  const saved = output ? bytesIn - bytesOut : 0;
  const percent = output && bytesIn > 0 ? (saved / bytesIn) * 100 : 0;
  // The BOM is three bytes and is not whitespace, so it is subtracted out of
  // the whitespace figure rather than quietly inflating it.
  const whitespaceGone = output ? saved - (bomDropped ? 3 : 0) : 0;

  const at = error ? locate(error, source) : null;

  const blob = useMemo(
    () => new Blob([output], { type: "application/json" }),
    [output],
  );
  /*
    Paste mode never borrows the dropped file's name: the bytes in the blob are
    the pasted JSON, and saving them as `invoice-2026.min.json` would name the
    download after a file whose content it does not contain.
  */
  const downloadBase = mode === "file" ? (file?.name ?? "data.json") : "data.json";
  const downloadName = downloadBase.replace(/\.json$/i, "") + ".min.json";

  /*
    `arrayBuffer()` is async, so a slow first read can resolve after a second
    file has replaced it. The token is bumped by every load and every reset, and
    a stale read drops its result rather than landing under the wrong filename.
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
      `MINIFIED SHOWS THE FIRST ${preview.length.toLocaleString()} OF ${output.length.toLocaleString()} CHARACTERS — COPY AND DOWNLOAD CARRY ALL OF IT`,
    );
  }

  return (
    <>
      <div className={CANVAS_COLUMN}>
        {showDropZone ? (
          <DropZone
            accept=".json"
            onFiles={handleFiles}
            label="Drop a .json file to minify"
            acceptLabel="JSON"
          />
        ) : (
          <>
            {mode === "file" && file && (
              <CanvasHeader
                file={file.name}
                meta={formatFileSize(file.size)}
                trailing={output ? `${percent.toFixed(1)}% SMALLER` : undefined}
              />
            )}

            {readError && <ErrorMessage message={readError} />}

            {hasBom && !dropBom && (
              <WarningMessage
                message={`This text starts with a UTF-8 byte-order mark, and RFC 8259 does not allow one at the start of a JSON document — so the browser's parser rejects the file before it reads a single key. Nothing has been removed. Tick "Drop the leading byte-order mark" in the rail and the three bytes come off; leave it and the file is passed through exactly as it arrived, mark and all.`}
              />
            )}

            {error && (
              <ErrorMessage
                message={`${error}${at ? ` — ${at}` : ""}. Nothing was rewritten; the output pane stays empty until the source parses.`}
              />
            )}

            {output && (
              <StatStrip
                stats={[
                  { label: "SOURCE", value: formatFileSize(bytesIn), tone: "neutral" },
                  { label: "MINIFIED", value: formatFileSize(bytesOut) },
                  { label: "SAVED", value: `${percent.toFixed(1)}%`, tone: "ok" },
                  {
                    label: "LINES",
                    value: `${lines(source)} → ${lines(output)}`,
                    tone: "neutral",
                  },
                ]}
              />
            )}

            <TextPanes columns={output ? 2 : 1}>
              <TextPane
                label={mode === "paste" ? "Paste your JSON" : "Source"}
                lines={lines(source)}
                size={formatFileSize(bytesIn)}
              >
                {mode === "paste" ? (
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={'{\n  "id": 12345678901234567890,\n  "rate": 1.0\n}'}
                    aria-label="Paste your JSON"
                    className={TEXT_PANE_BODY}
                  />
                ) : (
                  <pre
                    tabIndex={0}
                    role="region"
                    className={cn(TEXT_PANE_BODY, PANE_FOCUS)}
                    aria-label="Source JSON"
                  >
                    {sourcePreview}
                  </pre>
                )}
              </TextPane>

              {output && (
                <TextPane
                  tone="out"
                  label="Minified"
                  lines={lines(output)}
                  size={formatFileSize(bytesOut)}
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
                    aria-label="Minified JSON"
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

          <ToolControl label="BYTE-ORDER MARK">
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={dropBom}
                onChange={(e) => setDropBom(e.target.checked)}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Drop the leading byte-order mark
            </label>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {hasBom
                ? "This input has one. Until this is ticked it stays, and the parser keeps refusing the file."
                : "This input does not have one, so this changes nothing. It is here for the files written by Windows tools that do."}
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Source", formatFileSize(bytesIn)],
              ["Minified", output ? formatFileSize(bytesOut) : "—"],
              [
                "Whitespace removed",
                output ? `${whitespaceGone.toLocaleString()} bytes` : "—",
              ],
              ["Valid JSON", raw.trim() ? (error ? "No" : "Yes") : "—"],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT CHANGES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Whitespace between tokens, and nothing else. The minifier walks the
            characters you gave it and copies every string, number and keyword
            through byte for byte — it never runs{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">JSON.parse</code>{" "}
            and re-serialises, which is the round trip that turns a 19-digit id into
            the nearest double,{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">1.0</code> into{" "}
            <code className="font-mono text-[10.5px] text-neutral-300">1</code> and two
            keys of the same name into one.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            So it does not shorten or rename keys, does not reorder anything, does not
            drop null or empty fields, and does not touch a byte-order mark unless you
            tick the box above. Parsing happens only to decide whether the input is
            valid; the parser&rsquo;s own message is what the error line shows.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
