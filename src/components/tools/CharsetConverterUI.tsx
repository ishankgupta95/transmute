"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolAside,
  ToolAsideSection,
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
  lineCount,
} from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import { cn } from "@/lib/utils/cn";
import { formatFileSize } from "@/lib/utils/file-helpers";
import {
  CHARSET_ACCEPT,
  CHARSET_ENCODINGS,
  CHARSET_GROUPS,
  FALLBACK_ENCODING,
  decodeBytes,
  encodeUtf8,
  encodingName,
  utf8FileName,
} from "@/lib/tools/charset";

/**
 * Focus ring for the keyboard-focusable text panes below. It cannot live in
 * `TEXT_PANE_BODY` today, and it needs `outline-solid` of its own:
 * `TEXT_PANE_BODY` ends in `focus:outline-none`, which sets
 * `--tw-outline-style: none`, and a bare `focus-visible:outline-2` resolves
 * its style from that same variable — so the ring would compile to nothing.
 */
const PANE_FOCUS =
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";

/** The one field box the redesign doc specifies, shared by every select here. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * How much of the decoded text is drawn.
 *
 * A `<pre>` lays out every character it is given, and a 40 MB log read as
 * Windows-1252 is 40 million of them. The copy button and the download carry
 * the whole file either way, and the footnote says so whenever the cap bites.
 */
const PREVIEW_LIMIT = 40_000;

export function CharsetConverterUI() {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [encoding, setEncoding] = useState("auto");
  const [addBom, setAddBom] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const { copied, copy } = useCopied();

  /*
    The BYTES are kept, never the decoded string: changing the picker must
    re-decode the ORIGINAL bytes. Decoding the previous result again would be
    decoding mojibake, and every subsequent guess would compound it.
  */
  const report = useMemo(
    () => (bytes ? decodeBytes(bytes, encoding === "auto" ? undefined : encoding) : null),
    [bytes, encoding],
  );

  const encoded = useMemo(
    () => (report ? encodeUtf8(report.text, addBom) : null),
    [report, addBom],
  );

  const blob = useMemo(
    () =>
      encoded
        ? new Blob([encoded.bytes as BlobPart], { type: "text/plain;charset=utf-8" })
        : null,
    [encoded],
  );

  /*
    `arrayBuffer()` is async, so a slow first read can resolve AFTER a second
    file has replaced it and hand the tool the wrong bytes under the right
    filename. Every load and every reset bumps the token; a read whose token is
    stale drops its result on the floor.
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

  const text = report?.text ?? "";
  const handleCopy = useCallback(() => {
    void copy(text);
  }, [copy, text]);

  const preview = text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) : text;

  /*
    Shown when the bytes were NOT valid UTF-8 and the detector fell back to a
    codepage. Suppressed for a BOM, a clean UTF-8 decode and pure ASCII, where
    every candidate encoding agrees byte for byte and there is nothing to be
    uncertain about.
  */
  const guessedCodepage =
    report?.basis === "guess" && report.encoding === FALLBACK_ENCODING && !report.ascii;
  const sniffedUtf16 = report?.basis === "guess" && report.encoding.startsWith("utf-16");
  const damaged = (report?.replacements ?? 0) > 0 && report?.strict === false;

  /*
    The all-bytes-below-0x80 banner is about a SINGLE-BYTE read. Every legacy
    codepage and East Asian encoding on the list maps 0x00–0x7F to the same
    characters, so for those the claim "identical text, identical download"
    holds. UTF-16 is the exception on the same list: it reads the file two bytes
    at a time, so ASCII bytes come out as CJK mojibake and the download is a
    different length. Gating on the bytes alone put the "plain ASCII, byte-for-
    byte identical" banner on top of exactly that case.
  */
  const utf16Read = report?.encoding.startsWith("utf-16") ?? false;
  const asciiSingleByte = (report?.ascii ?? false) && !utf16Read;
  const asciiForcedToUtf16 =
    (report?.ascii ?? false) && utf16Read && report?.basis === "forced";

  return (
    <>
      {/* ── Canvas: the bytes as they read in the chosen encoding ─────── */}
      <div className={CANVAS_COLUMN}>
        {!file ? (
          <DropZone
            accept={CHARSET_ACCEPT}
            onFiles={handleFiles}
            label="Drop a text file to read it in another encoding"
            acceptLabel="TXT CSV LOG SRT MD"
          />
        ) : (
          <>
            <CanvasHeader
              file={file.name}
              meta={`${formatFileSize(file.size)}${report ? ` · READ AS ${report.encoding.toUpperCase()}` : ""}`}
              trailing={report ? (report.basis === "forced" ? "YOUR CHOICE" : report.basis === "bom" ? "FROM THE BOM" : report.basis === "guess" ? "A GUESS" : "VALID UTF-8") : undefined}
            />

            {readError && <ErrorMessage message={readError} />}

            {damaged && report && (
              <ErrorMessage
                message={`${report.replacements.toLocaleString()} ${report.replacements === 1 ? "character" : "characters"} could not be decoded as ${encodingName(report.encoding)} and came out as the replacement character. That is not damage in your file — it means this is the wrong encoding for these bytes. Pick another one below and watch the count go to zero.`}
              />
            )}

            {guessedCodepage && (
              <WarningMessage
                message={`These bytes are not valid UTF-8, so this file is in some older single-byte codepage. It has been read as Windows-1252, the commonest one in the Latin world — but a Cyrillic, Greek, Turkish or Central European file looks exactly the same from here and would come out with the wrong letters and no error at all. Read the accented characters below. If they are wrong, name the real encoding in the rail.`}
              />
            )}

            {sniffedUtf16 && (
              <WarningMessage
                message={`This file is UTF-16 with no byte-order mark, recognised from the pattern of zero bytes rather than from anything the file says about itself. If the text below is readable, the guess was right.`}
              />
            )}

            {asciiSingleByte && (
              <WarningMessage
                message={`Every byte in this file is below 0x80, so it is plain ASCII: every single-byte and East Asian encoding on the list decodes it to exactly the text below, and only the two UTF-16 entries would read it as something else. ASCII is already valid UTF-8, so the download is byte-for-byte the same file unless you add a byte-order mark.`}
              />
            )}

            {asciiForcedToUtf16 && (
              <WarningMessage
                message={`Every byte in this file is below 0x80, so it is a single-byte file being read two bytes at a time. The characters below are your bytes glued together in pairs, not your text, and the UNDECODABLE count cannot warn you about it because those pairs are all valid UTF-16 code units. Read it as UTF-8 — or as any single-byte encoding on the list, which for ASCII all agree — and the text comes back.`}
              />
            )}

            {report && encoded && (
              <StatStrip
                stats={[
                  { label: "BYTES IN", value: report.bytesIn.toLocaleString(), tone: "neutral" },
                  { label: "BYTES OUT", value: encoded.bytesOut.toLocaleString() },
                  {
                    label: "BOM FOUND",
                    value: report.bom ? report.bom.toUpperCase() : "NONE",
                    tone: "neutral",
                  },
                  {
                    label: "UNDECODABLE",
                    value: report.replacements.toLocaleString(),
                    tone: report.replacements > 0 ? "accent" : "ok",
                  },
                ]}
              />
            )}

            <TextPanes columns={1}>
              <TextPane
                tone="out"
                label={report ? `Read as ${encodingName(report.encoding)}` : "Reading…"}
                lines={lineCount(text)}
                size={encoded ? formatFileSize(encoded.bytesOut) : undefined}
                action={
                  text ? (
                    <button
                      onClick={handleCopy}
                      aria-label={copied ? "Copied text" : "Copy text"}
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
                  aria-label="Decoded text"
                >
                  {preview}
                </pre>
              </TextPane>
            </TextPanes>

            {text.length > PREVIEW_LIMIT && (
              <CanvasFootnote>
                PREVIEWING THE FIRST {PREVIEW_LIMIT.toLocaleString()} OF{" "}
                {text.length.toLocaleString()} CHARACTERS — COPY AND DOWNLOAD CARRY ALL OF IT
              </CanvasFootnote>
            )}
          </>
        )}
      </div>

      {/* ── Controls ──────────────────────────────────────────────────── */}
      <ToolAside
        footer={
          <>
            {blob && report && (
              <DownloadButton
                blob={blob}
                fileName={utf8FileName(file?.name ?? "converted.txt")}
                className="w-full justify-center"
              />
            )}
            {file && <ToolResetLink onClick={handleReset} label="CHANGE FILE" />}
          </>
        }
      >
        {file ? (
          <>
            <ToolAsideSection label="READ THE FILE AS">
              <select
                value={encoding}
                onChange={(e) => setEncoding(e.target.value)}
                aria-label="Read the file as"
                className={cn(FIELD_CLASS, "w-full")}
              >
                <option value="auto">Detect automatically</option>
                {CHARSET_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {CHARSET_ENCODINGS.filter((enc) => enc.group === group).map((enc) => (
                      <option key={enc.label} value={enc.label}>
                        {enc.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                Nothing in a plain text file records its own encoding, so detection believes a
                byte-order mark, spots UTF-16 by its zero bytes, and otherwise tests the bytes
                strictly against UTF-8. Bytes that fail that test are read as Windows-1252 and
                flagged as a guess. Reading the preview is the only way to settle it — that is
                what the picker is for.
              </span>
            </ToolAsideSection>

            <ToolAsideSection label="RESULT">
              <ToolOutput
                rows={[
                  ["Read as", report ? encodingName(report.encoding) : "—"],
                  ["Bytes", report && encoded ? `${report.bytesIn} → ${encoded.bytesOut}` : "—"],
                  [
                    "Undecodable",
                    report
                      ? report.replacements === 0
                        ? "None"
                        : `${report.replacements} character${report.replacements === 1 ? "" : "s"}`
                      : "—",
                  ],
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
                The download is UTF-8 either way. Excel on Windows opens a CSV as the system
                codepage unless the file opens with this three-byte mark; most other software
                ignores it, and web pages and browsers do not need it.
              </span>
            </ToolAsideSection>
          </>
        ) : (
          <ToolAsideSection label="ONE DIRECTION">
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              This reads a file in any of 25 encodings and writes UTF-8. It cannot go the other
              way: the browser can decode Shift_JIS, KOI8-R and Windows-1251, but{" "}
              <code className="font-mono text-[10.5px] text-neutral-300">TextEncoder</code> only
              ever writes UTF-8, so producing legacy bytes is not something this page can do.
              Drop a file and the encoding picker appears here.
            </span>
          </ToolAsideSection>
        )}
      </ToolAside>
    </>
  );
}
