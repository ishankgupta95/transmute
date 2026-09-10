"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CodeBlock,
  StatStrip,
  TagGrid,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import {
  decodeImageCodes,
  describeAnimation,
  describeEmptyScan,
  describeSequences,
  formatElapsed,
  QR_IMAGE_ACCEPT,
  scanToText,
  summariseScan,
  ZXING_WASM_BYTES,
  type DecodedSymbol,
  type ScanResult,
  type ScanScope,
} from "@/lib/tools/qr-decode";
import { formatFileSize } from "@/lib/utils/file-helpers";

const SCOPE_OPTIONS = [
  { value: "qr" as const, label: "QR only" },
  { value: "all" as const, label: "Every format" },
];

const MUTED = "font-body text-[10.5px] leading-[1.5] text-text-muted";

/**
 * One decoded symbol.
 *
 * The payload is a `<pre>` inside `CodeBlock` and NEVER an `<a>`. That is the
 * single most important decision on this page: a QR code lifted off a poster,
 * a parking meter or a letter is an anonymous instruction from a stranger, and
 * a reader that renders it as a link has turned "look at this before you
 * decide" into one tap. The host name is broken out into its own row above so
 * it can be read without picking a URL apart by eye.
 */
function SymbolCard({
  symbol,
  copied,
  onCopy,
}: {
  symbol: DecodedSymbol;
  copied: number | null;
  onCopy: (value: string, index: number) => void;
}) {
  const meta: string[] = [];
  if (symbol.ecLevel !== "") meta.push(`EC ${symbol.ecLevel}`);
  meta.push(`${symbol.byteLength} ${symbol.byteLength === 1 ? "byte" : "bytes"}`);
  if (symbol.orientation !== 0) meta.push(`ROTATED ${symbol.orientation}°`);
  if (symbol.mirrored) meta.push("MIRRORED");
  if (symbol.inverted) meta.push("LIGHT ON DARK");
  if (symbol.sequence) meta.push(`PART ${symbol.sequence.index} OF ${symbol.sequence.size}`);

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-neutral-800 bg-bg-primary p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[10px] leading-none text-text-muted">
          {String(symbol.index).padStart(2, "0")}
        </span>
        <span className="font-mono text-[12.5px] leading-none font-medium text-accent-300">
          {symbol.format}
        </span>
        <span className="font-body text-[12px] leading-none text-neutral-300">
          {symbol.payload.label}
        </span>
        <span className="ml-auto font-mono text-[10px] leading-none text-text-muted">
          {meta.join(" · ")}
        </span>
      </div>

      <CodeBlock
        label="Payload, exactly as decoded"
        action={
          <button
            type="button"
            onClick={() => onCopy(symbol.text, symbol.index)}
            aria-label={`Copy payload ${symbol.index}`}
            className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
          >
            {copied === symbol.index ? "Copied!" : "Copy"}
          </button>
        }
      >
        {symbol.text === "" ? "(empty)" : symbol.text}
      </CodeBlock>

      {symbol.payload.fields.length > 0 && (
        <TagGrid
          tags={symbol.payload.fields}
          identifying={(label) => label === "Password" || label === "secret"}
        />
      )}

      {symbol.contentType !== "Text" && (
        <span className={MUTED}>
          zxing classifies this symbol&rsquo;s content as {symbol.contentType}, not plain text. The
          line above is the engine&rsquo;s best rendering of {symbol.byteLength} raw{" "}
          {symbol.byteLength === 1 ? "byte" : "bytes"}, and bytes that are not printable characters
          will not survive a copy intact.
        </span>
      )}

      {symbol.payload.risks.map((risk) => (
        <WarningMessage key={risk.id} message={risk.message} />
      ))}

      {symbol.payload.notes.map((note) => (
        <span key={note} className={MUTED}>
          {note}
        </span>
      ))}
    </div>
  );
}

export function QrCodeReaderUI() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<ScanScope>("qr");
  const [denoise, setDenoise] = useState(false);
  const { copied, copy } = useCopied<number>();

  /*
    `createImageBitmap`, the engine fetch and the scan itself are all async, so
    a slow first scan can land after a second image has replaced it and report
    the wrong file's codes under the right file's name. Every run and the reset
    bump the token; a run whose token is stale drops its result on the floor.
    Same shape as FileChecksumUI's.
  */
  const runIdRef = useRef(0);

  const runScan = useCallback(async (picked: File, nextScope: ScanScope, nextDenoise: boolean) => {
    const id = ++runIdRef.current;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const scan = await decodeImageCodes(picked, { scope: nextScope, denoise: nextDenoise });
      if (runIdRef.current !== id) return;
      setResult(scan);
    } catch (err) {
      if (runIdRef.current !== id) return;
      setError(err instanceof Error ? err.message : "This image could not be scanned.");
    } finally {
      if (runIdRef.current === id) setBusy(false);
    }
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const picked = files[0];
      if (!picked) return;
      setFile(picked);
      void runScan(picked, scope, denoise);
    },
    [runScan, scope, denoise],
  );

  const handleScope = useCallback(
    (next: ScanScope) => {
      setScope(next);
      if (file) void runScan(file, next, denoise);
    },
    [file, denoise, runScan],
  );

  const handleDenoise = useCallback(
    (next: boolean) => {
      setDenoise(next);
      if (file) void runScan(file, scope, next);
    },
    [file, scope, runScan],
  );

  const handleReset = useCallback(() => {
    runIdRef.current++;
    setFile(null);
    setResult(null);
    setError(null);
    setBusy(false);
  }, []);

  const handleCopy = useCallback(
    (value: string, index: number) => {
      void copy(value, index);
    },
    [copy],
  );

  const text = result ? scanToText(result) : "";
  const blob = useMemo(() => new Blob([text], { type: "text/plain;charset=utf-8" }), [text]);
  const downloadName = `${(file?.name ?? "image").replace(/\.[^.]+$/, "")}-codes.txt`;

  const symbols = result?.symbols ?? [];
  const sequenceNotes = result ? describeSequences(symbols) : [];
  const downscaled = result !== null && result.scannedWidth !== result.sourceWidth;
  const formats = [...new Set(symbols.map((s) => s.format))];

  return (
    <>
      {/* ── Canvas: the image that came in, and everything read out of it ── */}
      <div className={CANVAS_COLUMN}>
        {!file ? (
          <DropZone
            accept={QR_IMAGE_ACCEPT}
            onFiles={handleFiles}
            label="Drop a photo or screenshot of a code"
            acceptLabel="PNG JPG WEBP GIF BMP"
          />
        ) : (
          <>
            <CanvasHeader
              file={file.name}
              meta={
                result
                  ? `${formatFileSize(file.size)} · ${result.sourceWidth} × ${result.sourceHeight}`
                  : formatFileSize(file.size)
              }
              trailing={
                result
                  ? `${symbols.length} ${symbols.length === 1 ? "CODE" : "CODES"} · ${formatElapsed(result.elapsedMs)}`
                  : busy
                    ? "SCANNING"
                    : undefined
              }
            />

            {error && <ErrorMessage message={error} />}

            {result && (
              <StatStrip
                stats={[
                  {
                    label: "CODES FOUND",
                    value: String(symbols.length),
                    tone: symbols.length > 0 ? "ok" : "neutral",
                  },
                  { label: "FORMAT", value: formats.length > 0 ? formats.join(", ") : "—" },
                  {
                    label: "SCANNED AT",
                    value: `${result.scannedWidth}×${result.scannedHeight}`,
                    tone: downscaled ? "neutral" : "accent",
                  },
                  { label: "TOOK", value: formatElapsed(result.elapsedMs) },
                ]}
              />
            )}

            {downscaled && result && (
              <WarningMessage
                message={`This image is ${result.sourceWidth} × ${result.sourceHeight}, which is more pixels than a browser canvas is guaranteed to hold, so it was scanned at ${result.scannedWidth} × ${result.scannedHeight} — ${Math.round((1 - result.scannedWidth / result.sourceWidth) * 100)}% narrower. A code that is only a few dozen pixels across in the original may have been lost in the resize. Crop the picture down to the code itself and scan that instead if nothing was found.`}
              />
            )}

            {/*
              Shown on EVERY run of a multi-frame file, not only the empty one:
              a code found in frame 1 still leaves the reader believing the
              whole animation was searched.
            */}
            {result?.animation && <WarningMessage message={describeAnimation(result.animation)} />}

            {sequenceNotes.map((note) => (
              <WarningMessage key={note} message={note} />
            ))}

            {/*
              Derived from the RESULT, not from the live `scope`/`denoise`
              state: the message has to describe the run that produced this
              empty answer, and it has to name the animated-image cause first
              when it applies. See `describeEmptyScan`.
            */}
            {result && symbols.length === 0 && <ErrorMessage message={describeEmptyScan(result)} />}

            {symbols.map((symbol) => (
              <SymbolCard key={symbol.index} symbol={symbol} copied={copied} onCopy={handleCopy} />
            ))}

            {result && symbols.length > 0 && (
              <CanvasFootnote>{summariseScan(result).toUpperCase()}</CanvasFootnote>
            )}
          </>
        )}
      </div>

      {/* ── Controls ─────────────────────────────────────────────────── */}
      <ToolAside
        /*
          `undefined`, not an always-truthy fragment: `ToolAside` renders the
          footer's bordered, padded box whenever this prop is truthy, and a
          fragment whose three children are all false is still truthy. Before a
          file exists none of them can render, so passing one would put an empty
          ruled band on the initial surface — height ToolPageLayout then
          RESERVES on every load to avoid a shift.
        */
        footer={
          file ? (
            <>
              {busy && <ToolProgress phase="SCANNING" percent={null} label="Scanning the image" />}
              {text !== "" && (
                <DownloadButton blob={blob} fileName={downloadName} className="w-full justify-center" />
              )}
              <ToolResetLink onClick={handleReset} label="CHANGE IMAGE" />
            </>
          ) : undefined
        }
      >
        <ToolControlGroup>
          <ToolControl label="SCAN FOR">
            <ToolChoice
              label="Symbologies to search for"
              value={scope}
              onChange={handleScope}
              options={SCOPE_OPTIONS}
              disabled={busy}
            />
            <span className={MUTED}>
              Every format also finds Data Matrix, Aztec, PDF417 and the striped retail barcodes,
              and costs real time: measured on a 12-megapixel photo, 0.19 s for QR alone against
              2.9 s for the full set. Each run prints what it actually took.
            </span>
          </ToolControl>

          {/*
            Gated on the FILE, exactly as SubtitleConverterUI gates its encoding
            picker: a re-scan control that appears before there is anything to
            re-scan is height the layout has to reserve before the tool mounts.
          */}
          {file && (
            <ToolControl label="IF IT WILL NOT READ">
              <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
                <input
                  type="checkbox"
                  checked={denoise}
                  onChange={(e) => handleDenoise(e.target.checked)}
                  disabled={busy}
                  className="size-4 rounded-sm border-border accent-accent"
                />
                Run an extra denoising pass
              </label>
              <span className={MUTED}>
                Off by default. It re-runs the search after zxing&rsquo;s morphological closing
                filter, which can recover a blurred or low-contrast square code and does nothing
                at all for the striped ones. Turning it on re-scans the image you already dropped.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="NOTHING HERE IS A LINK">
          <span className={MUTED}>
            A code you did not print is an anonymous instruction, and a square looks identical
            whatever is inside it — which is why QR phishing works. Payloads are printed as text
            here and are never clickable. Embedded credentials, punycode lookalikes and invisible
            characters are named where they occur.
          </span>
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Engine", "zxing-cpp via WebAssembly"],
            /*
              ZXING_WASM_BYTES, never a sum with the JS glue. This row used to
              render the pair as "1.1 MB" while the ENGINES table, the
              developer-tools hub and this page's own FAQ all said 1.0 MB /
              1,093,289 bytes — two answers to one question. The site's ruler is
              the served artifact; see the constant's comment in qr-decode.ts.
            */
            ["Engine download", `${(ZXING_WASM_BYTES / 1024 / 1024).toFixed(1)} MB, on first scan`],
            ["Served from", "this site, never a CDN"],
            ["Image decoding", "the browser's own"],
            ["Symbols per image", "no limit"],
            ["Rotated & mirrored", "read"],
          ]}
        />
      </ToolAside>
    </>
  );
}

/*
  Height note, in the same register as SubtitleConverterUI's.

  The no-file surface is the drop zone, one chip row with its explanation, one
  paragraph of prose and a collapsed ADVANCED drawer. Everything that depends on
  a result — the stat strip, the symbol cards, the denoising re-scan — is gated
  on `file` or on `result`, because ToolPageLayout RESERVES the measured initial
  height to prevent layout shift, and a control that cannot act on anything yet
  is billed to that reservation twice: once as blank space before the tool
  mounts, and once as a control the reader has to skip past.
*/
