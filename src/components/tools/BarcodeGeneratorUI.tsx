"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolSlider,
} from "@/components/tools/ToolAside";
import {
  CanvasHeader,
  CodeBlock,
  ColorStage,
  lineCount,
  TEXT_PANE_BODY,
  TextPane,
  TextPanes,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN, MONO_LABEL } from "@/components/workspace/shared";
import { useCopied } from "@/hooks/useCopied";
import {
  barcodeFileName,
  checkBarcodeColors,
  checkBarcodeInput,
  ean13Equivalent,
  getSymbology,
  hasBlockingIssue,
  renderBarcodeSvg,
  scannedValue,
  svgDataUrl,
  SYMBOLOGIES,
  type BarcodeSvg,
  type SymbologyId,
} from "@/lib/tools/barcode";
import { canvasToBlob, fillBackground, loadImage } from "@/lib/tools/canvas-utils";
import { cn } from "@/lib/utils/cn";
import { triggerDownload } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";

/** The one field box the redesign doc specifies, shared with the other text tools. */
const FIELD_CLASS =
  "h-[30px] rounded-[7px] border border-border bg-bg-elevated px-2.5 font-mono text-xs leading-none text-text-primary focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Copied verbatim from QrCodeGeneratorUI so every download row on the site matches. */
const SECONDARY_BUTTON =
  "h-9 w-full cursor-pointer rounded-[9px] border border-border font-display text-[13px] leading-none font-medium text-neutral-300 transition-colors duration-200 hover:bg-text-primary/7 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const LINEAR = SYMBOLOGIES.filter((s) => s.kind === "linear");
const MATRIX = SYMBOLOGIES.filter((s) => s.kind === "matrix");

interface Drawn extends BarcodeSvg {
  /** The exact settings this image was drawn from. */
  key: string;
}

export function BarcodeGeneratorUI() {
  const [symbologyId, setSymbologyId] = useState<SymbologyId>("code128");
  const [text, setText] = useState("");
  const [includeText, setIncludeText] = useState(true);
  const [includeCheckDigit, setIncludeCheckDigit] = useState(false);
  const [scale, setScale] = useState(3);
  const [barHeight, setBarHeight] = useState(14);
  const [foreground, setForeground] = useState("#000000");
  const [background, setBackground] = useState("#ffffff");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const { copied, copy } = useCopied();

  const symbology = getSymbology(symbologyId);

  const issues = useMemo(
    () => checkBarcodeInput(symbologyId, text, includeCheckDigit),
    [symbologyId, text, includeCheckDigit],
  );
  const blocked = hasBlockingIssue(issues);
  /*
    Colour is checked separately from the text, not because it matters less
    but because a colour fault does not make the DERIVED value wrong: bars too
    pale to read still encode the right number, so the "what a scanner reads
    back" block stays on screen while the error explains why nothing would
    read it. Generation is blocked by either.
  */
  const colorIssues = useMemo(
    () => checkBarcodeColors(foreground, background, symbology.kind),
    [foreground, background, symbology.kind],
  );
  const colorBlocked = hasBlockingIssue(colorIssues);
  const scanned = useMemo(
    () => scannedValue(symbologyId, text, includeCheckDigit),
    [symbologyId, text, includeCheckDigit],
  );
  /*
    UPC-A is the EAN-13 whose leading zero nobody prints, and readers disagree
    about which of the two they report — this site's own reader returns the
    thirteen digits. Both are shown; picking one would be wrong for whoever is
    holding the other kind of reader.
  */
  const alsoEan13 = useMemo(() => ean13Equivalent(symbologyId, text), [symbologyId, text]);

  /*
    Which settings the picture on screen was actually drawn from.

    Clearing the image inside each of the eight change handlers is one
    forgotten handler away from a lit READY header over a barcode for the
    previous number — the single worst bug this page could ship, because a
    barcode nobody can read is obvious and a barcode for the wrong product is
    not. Comparing a key derived from the current state against the key the
    image was drawn with cannot be forgotten.
  */
  const renderKey = useMemo(
    () =>
      JSON.stringify([
        symbologyId,
        text,
        includeText,
        includeCheckDigit,
        scale,
        barHeight,
        foreground,
        background,
      ]),
    [symbologyId, text, includeText, includeCheckDigit, scale, barHeight, foreground, background],
  );
  const fresh = drawn !== null && drawn.key === renderKey;

  /*
    `renderBarcodeSvg` is async because the engine is fetched on first use, so
    a slow first run can resolve AFTER a second click has replaced it. The
    token is bumped by every run; a run whose token is stale drops its result.
  */
  const runToken = useRef(0);

  const handleGenerate = useCallback(async () => {
    setAttempted(true);
    setError("");
    if (blocked || colorBlocked) return;
    const token = ++runToken.current;
    const key = renderKey;
    setBusy(true);
    try {
      const result = await renderBarcodeSvg({
        symbology: symbologyId,
        text,
        scale,
        barHeight,
        includeText,
        includeCheckDigit,
        foreground,
        background,
      });
      if (runToken.current !== token) return;
      setDrawn({ ...result, key });
    } catch (e) {
      if (runToken.current !== token) return;
      setDrawn(null);
      setError(e instanceof Error ? e.message : "The barcode could not be drawn.");
    } finally {
      if (runToken.current === token) setBusy(false);
    }
  }, [
    blocked,
    colorBlocked,
    renderKey,
    symbologyId,
    text,
    scale,
    barHeight,
    includeText,
    includeCheckDigit,
    foreground,
    background,
  ]);

  const handleDownloadSvg = useCallback(() => {
    if (!fresh || !drawn) return;
    triggerDownload(
      new Blob([drawn.svg], { type: "image/svg+xml" }),
      barcodeFileName(symbologyId, text, "svg"),
    );
  }, [fresh, drawn, symbologyId, text]);

  const handleDownloadPng = useCallback(async () => {
    if (!fresh || !drawn) return;
    setError("");
    try {
      /*
        The PNG is rasterised from the SAME SVG the preview shows and the SVG
        button saves — one drawing, three destinations — so the two downloads
        cannot disagree. The background is painted first as insurance: the SVG
        carries its own full-bleed rect, but a PNG that came out transparent
        would be a barcode with no quiet zone, which is a barcode that does not
        scan.
      */
      const image = await loadImage(new Blob([drawn.svg], { type: "image/svg+xml" }));
      const canvas = document.createElement("canvas");
      canvas.width = drawn.width;
      canvas.height = drawn.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser would not give the page a 2D canvas.");
      fillBackground(context, canvas.width, canvas.height, background);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      triggerDownload(
        await canvasToBlob(canvas, "image/png"),
        barcodeFileName(symbologyId, text, "png"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The PNG could not be written.");
    }
  }, [fresh, drawn, background, symbologyId, text]);

  const handleCopyScanned = useCallback(() => {
    if (scanned) void copy(scanned);
  }, [copy, scanned]);

  const handleSymbologyChange = useCallback((next: SymbologyId) => {
    setSymbologyId(next);
    // The check character belongs to Code 39 alone, and leaving it latched on
    // while the picker moves would silently re-arm it on the way back.
    setIncludeCheckDigit(false);
  }, []);

  /*
    Nothing is wrong on a page nobody has typed into. "Enter the number to
    encode" is an instruction, not a failure, and rendering it under a red rule
    before the first keystroke opens every visit on an error.
  */
  const showIssues = attempted || text !== "";
  const allIssues = showIssues ? [...issues, ...colorIssues] : [];
  const errors = allIssues.filter((i) => i.level === "error");
  const warnings = allIssues.filter((i) => i.level === "warning");
  const svgBytes = drawn ? new Blob([drawn.svg]).size : 0;
  /*
    The alt text names what the code encodes, which is the only useful thing to
    say about a picture of a barcode — but a QR payload can be two thousand
    characters and an alt attribute is read aloud in full, so it is clipped.
  */
  const encoded = scanned ?? text;
  const previewLabel = encoded.length > 60 ? `${encoded.slice(0, 60)}…` : encoded;

  return (
    <>
      {/* ── Canvas: what is encoded, then the symbol itself ─────────── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={symbology.name}
          meta={`${symbology.kind === "linear" ? "LINEAR" : "MATRIX"} · ${text.length} CHARS`}
          trailing={
            fresh
              ? `READY · ${drawn.width}×${drawn.height} PNG · SVG`
              : errors.length > 0
                ? "FIX THE ERRORS BELOW"
                : "PRESS GENERATE"
          }
        />

        {errors.map((issue) => (
          <ErrorMessage key={issue.id} message={issue.message} />
        ))}
        {error && <ErrorMessage message={error} />}
        {warnings.map((issue) => (
          <WarningMessage key={issue.id} message={issue.message} />
        ))}

        <TextPanes columns={1}>
          <TextPane
            label={`Encode as ${symbology.name}`}
            lines={lineCount(text)}
            size={formatFileSize(new Blob([text]).size)}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={symbology.placeholder}
              aria-label={`Text to encode as ${symbology.name}`}
              spellCheck={false}
              className={TEXT_PANE_BODY}
            />
          </TextPane>
        </TextPanes>

        {scanned !== null && !blocked && (
          <CodeBlock
            label="What a scanner reads back"
            action={
              <button
                onClick={handleCopyScanned}
                aria-label={copied ? "Copied scanned value" : "Copy scanned value"}
                className="cursor-pointer text-accent transition-colors hover:text-accent-hover"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            }
          >
            {scanned}
            {alsoEan13 !== null && (
              <>
                {"\n"}
                <span className="text-text-muted">
                  {alsoEan13} — the same number as a 13-digit EAN-13, which is what a software
                  reader hands back
                </span>
              </>
            )}
          </CodeBlock>
        )}

        <ColorStage checkered caption={fresh ? `scan target · ${symbology.name}` : "scan target"}>
          {fresh ? (
            /* eslint-disable-next-line @next/next/no-img-element -- an inline data: URL for an SVG we generated; nothing for next/image to optimise under output: "export" */
            <img
              src={svgDataUrl(drawn.svg)}
              alt={`${symbology.name} barcode encoding ${previewLabel}`}
              width={drawn.width}
              height={drawn.height}
              className="max-h-full max-w-full rounded-[10px] object-contain"
            />
          ) : (
            <span className="px-6 text-center font-mono text-[10.5px] leading-[1.6] text-[rgba(22,24,38,.75)]">
              {busy ? "DRAWING…" : "THE BARCODE APPEARS HERE ONCE YOU PRESS GENERATE"}
            </span>
          )}
        </ColorStage>
      </div>

      {/* ── Controls ────────────────────────────────────────────────── */}
      <ToolAside
        footer={
          <>
            {/* Exactly one ToolActions on the page: it binds the global
                Cmd/Ctrl+Enter, and a second one would fight it. */}
            <ToolActions
              primaryLabel={busy ? "Drawing…" : "Generate Barcode"}
              onPrimary={handleGenerate}
              primaryDisabled={busy || text === ""}
            />
            {fresh && (
              <>
                <button type="button" onClick={handleDownloadSvg} className={SECONDARY_BUTTON}>
                  Download SVG
                </button>
                <button type="button" onClick={handleDownloadPng} className={SECONDARY_BUTTON}>
                  Download PNG
                </button>
              </>
            )}
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="SYMBOLOGY">
            <select
              value={symbologyId}
              onChange={(e) => handleSymbologyChange(e.target.value as SymbologyId)}
              aria-label="Symbology"
              className={cn(FIELD_CLASS, "w-full")}
            >
              <optgroup label="Linear — bars">
                {LINEAR.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Matrix — squares">
                {MATRIX.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {symbology.note}
            </span>
          </ToolControl>

          {/* Both checkboxes are rendered only where BWIPP implements the
              option. A checkbox on a symbology that ignores it is a control
              that does nothing, which is worse than no control. */}
          {(symbology.supportsText || symbology.supportsCheckDigit) && (
            <ToolControl label="PRINTED WITH THE CODE">
              {symbology.supportsText && (
                <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
                  <input
                    type="checkbox"
                    checked={includeText}
                    onChange={(e) => setIncludeText(e.target.checked)}
                    className="size-4 rounded-sm border-border accent-accent"
                  />
                  Print the number under the bars
                </label>
              )}
              {symbology.supportsCheckDigit && (
                <>
                  <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
                    <input
                      type="checkbox"
                      checked={includeCheckDigit}
                      onChange={(e) => setIncludeCheckDigit(e.target.checked)}
                      className="size-4 rounded-sm border-border accent-accent"
                    />
                    Add a check character
                  </label>
                  <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                    Code 39&rsquo;s modulo-43 check character is optional and is part of the
                    encoded data, not a hidden extra: a scanner that has not been told to verify
                    it reports it as one more character on the end.
                  </span>
                </>
              )}
            </ToolControl>
          )}
        </ToolControlGroup>

        {/*
          Size and colour sit in a drawer, built like `ToolAdvanced` in
          ToolAside.tsx. None of it has to be touched to get a scannable code,
          and open it costs ~250px of reserved blank space above the fold on a
          phone that ToolPageLayout has to hold empty until this UI mounts.
          Collapsed they are one click away and every word is still in the DOM;
          the summary row shows the values actually in force.
        */}
        <details className="group border-b border-border px-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <span className={cn(MONO_LABEL, "text-text-muted")}>SIZE &amp; COLOUR</span>
            <span className="font-mono text-[10px] leading-none text-text-muted opacity-60">
              {scale}× ·{" "}
              {symbology.kind === "linear" ? `${barHeight} TALL · 4 SETTINGS` : "3 SETTINGS"}
            </span>
            <span
              aria-hidden="true"
              className="ml-auto font-mono text-[15px] leading-none text-text-muted transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none"
            >
              ›
            </span>
          </summary>
          <div className="-mx-4 flex animate-tm-drawer flex-col gap-[9px] border-t border-border bg-text-primary/3 px-4 py-3.5 motion-reduce:animate-none">
            <ToolSlider
              label="Scale"
              display={`${scale}×`}
              min={1}
              max={8}
              step={1}
              value={scale}
              onChange={setScale}
              hint={
                fresh
                  ? `Drawn at ${drawn.width} × ${drawn.height} px, which is the size the PNG is saved at. The SVG is vector and prints crisply at any size.`
                  : "Sets how many pixels one narrow bar or one module is worth. It fixes the PNG's size; the SVG is vector and prints crisply at any size."
              }
            />
            {symbology.kind === "linear" && (
              <ToolSlider
                label="Bar height"
                display={`${barHeight}`}
                min={4}
                max={40}
                step={1}
                value={barHeight}
                onChange={setBarHeight}
                hint="Taller bars survive a scanner swept at an angle. Matrix codes have no such setting — their height is fixed by the data, and stretching one stops it decoding."
              />
            )}
            <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
              Bars
              <input
                type="color"
                value={foreground}
                onChange={(e) => setForeground(e.target.value)}
                aria-label="Bar colour"
                className="size-8 cursor-pointer rounded-sm border border-border"
              />
            </label>
            <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
              Background
              <input
                type="color"
                value={background}
                onChange={(e) => setBackground(e.target.value)}
                aria-label="Background colour"
                className="size-8 cursor-pointer rounded-sm border border-border"
              />
            </label>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Keep the bars much darker than the background: these two colours are checked the way
              everything else on this page is, and a pair that grades F for contrast — under 20%,
              which is where pale bars on white land — is refused rather than drawn, as is an
              inverted linear code, light bars on a dark ground, which nearly every reader turns
              down. QR, Data Matrix and Aztec usually manage inverted, so there it is a warning. A
              laser scanner reads reflected red light alone, so red or yellow bars on white are
              invisible to it however plain they look here and however readily a phone camera reads
              them.
            </span>
          </div>
        </details>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Scans as", scanned && !blocked ? scanned : "—"],
              ...(alsoEan13 !== null && !blocked
                ? ([["As EAN-13", alsoEan13]] as [string, string][])
                : []),
              ["Image", fresh ? `${drawn.width} × ${drawn.height} px` : "—"],
              ["SVG", fresh ? formatFileSize(svgBytes) : "—"],
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Every code is drawn with the quiet zone its spec asks for — the blank margin a scanner
            needs to find the symbol at all: ten narrow bars either side of a linear code, four
            modules around a matrix one. Cropping it off is the commonest reason a printed barcode
            will not read.
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="WHAT A SCANNER SEES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The block on the left is not the text you typed — it is what the code decodes to, worked
            out here. A 12-digit EAN-13 gains its check digit, and a UPC-E is expanded into the full
            UPC-A it compresses, so seven typed digits become twelve. A UPC symbol gets two lines,
            because readers disagree: a till scanner usually transmits the twelve-digit UPC-A, while
            software readers — this site&rsquo;s own included — hand back the same number as a
            thirteen-digit EAN-13, with the leading zero UPC-A never prints. Both are the same
            article number. Where any of them differs from what you expected, the code is right and
            the expectation is wrong, which is much easier to find out now than on a pallet.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The linear symbologies carry bytes, not characters, and their defined alphabet stops at
            ASCII, so anything with an accent or an emoji is refused here rather than drawn as a
            code that scans to <code className="font-mono text-[10.5px] text-neutral-300">Ã©</code>.
            QR, Data Matrix, PDF417 and Aztec declare their encoding and carry any script intact.
            Nothing is uploaded: the symbol is built and drawn in this tab, which matters when the
            number on it is a product you have not launched.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
