"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import {
  CanvasFootnote,
  CanvasHeader,
  CompareStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import {
  optimisePng,
  PNG_OPTIMISE_UNSUPPORTED_MESSAGE,
  supportsPngOptimiser,
} from "@/lib/workers/image-client";
import type { PngOptimiseResult } from "@/lib/workers/image-client";
import type { PngOptimiseOptions } from "@/lib/workers/image-protocol";
/*
  TYPE-ONLY, AND THAT IS THE POINT. `typeof PNG_MEGAPIXEL_LIMIT` pins the
  ceiling below to the engine's, so the two cannot drift; `import type` erases
  at emit, so `png-optimise.ts` — and with it the oxipng wasm-bindgen glue and
  its `new URL(…, import.meta.url)` — stays where it is today, reachable only
  through the worker bundle and never through this page's chunk.
*/
import type { PNG_MEGAPIXEL_LIMIT, PNG_RASTER_BYTE_LIMIT } from "@/lib/tools/png-optimise";
import { getToolBySlug } from "@/data/tools";
import { useIsClient } from "@/hooks/useIsClient";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

/*
  Read from the registry rather than retyped: size-claims.test.ts scans this
  file for `getToolBySlug("…")?.practicalLimitNote` and asserts the registry
  carries a sentence for the slug it finds. This tool reads the whole PNG into
  one ArrayBuffer and hands it to a worker, so the drop zone must say
  MEMORY-BOUND rather than the default absolute "NO SIZE CAP".
*/
const PRACTICAL_LIMIT_NOTE = getToolBySlug("compress-png")?.practicalLimitNote;

/*
  Levels 1–4 only, and that is a measurement, not a preference.

  MEASURED 2026-09-06 on this repo's own public/og-image.png (171,221 B, a
  real Chromium screenshot from scripts/render-og.mjs):

    level 1 → 138,640 B    360 ms
    level 2 → 117,326 B    470 ms
    level 3 → 111,448 B  1,553 ms
    level 4 → 110,876 B  2,328 ms
    level 5 → 110,876 B  4,455 ms   ← byte-identical to level 4
    level 6 → 110,876 B  5,471 ms   ← byte-identical to level 4

  Offering 5 and 6 would sell twice the wait for zero bytes, so they are not
  offered. 2 is the default because it is the best bytes-per-second of the
  four; the note under each option is what that level actually bought on that
  one file, quoted rather than generalised.
*/
const LEVELS: readonly {
  value: PngOptimiseOptions["level"];
  label: string;
  note: string;
}[] = [
  { value: 1, label: "1", note: "Fastest search. Took 19% off this repo's own 1200 × 630 screenshot." },
  { value: 2, label: "2", note: "The default: 31% off that screenshot, and the best bytes per second of the four." },
  { value: 3, label: "3", note: "35% off it, for roughly three times the time level 2 took." },
  { value: 4, label: "4", note: "The knee: 35% off it, for five times level 2's time. Levels 5 and 6 return the identical bytes, so they are not offered." },
];

/*
  The two hard input ceilings, both enforced in the engine before oxipng is
  called and both stated here before the click.

  MEASURED: wasm linear memory tracks the DECODED image at roughly 8× its size
  and NEVER shrinks — a 4000×3000 8-bit RGB PNG (34.3 MB decoded) left a 298 MB
  high-water mark that was still 298 MB after a 1.3 KB image was optimised
  immediately afterwards (wasm32 cannot give linear memory back).

  Pixels alone do not predict that, which is why there are two numbers: the
  same 12.00 megapixels as 16-bit RGBA is four times the decoded size, and two
  real 4000×3000 exports MEASURED 372 MB and 751 MB — inside the pixel cap and
  far outside the memory it was chosen for. So the pixel count bounds the WAIT
  (≈570 ms per megapixel) and the decoded size bounds the memory.

  Both annotations are drift guards: `png-optimise.ts` checks these same two
  numbers out of the IHDR before oxipng is touched, and if either moves, the
  literal here stops compiling.
*/
const MAX_MEGAPIXELS: typeof PNG_MEGAPIXEL_LIMIT = 12;
const MAX_RASTER_BYTES: typeof PNG_RASTER_BYTE_LIMIT = 48_000_000;
/** The raster ceiling as the copy says it: 48, not 45.8 — these are MB, not MiB. */
const MAX_RASTER_MB = Math.round(MAX_RASTER_BYTES / 1_000_000);

/*
  The half of the no-worker refusal the engine does not say.

  The first half is `PNG_OPTIMISE_UNSUPPORTED_MESSAGE` — the exact sentence
  `optimisePng` throws when `supportsPngOptimiser()` is false — so the warning
  shown before the upload and the error thrown after a click cannot describe
  one condition two different ways. It lives in `image-client`, which this
  page already imports, so quoting it drags nothing new into the bundle.

  This sentence stays local because it is a claim about THIS tool rather than
  about the browser: every other image tool degrades to a main-thread canvas
  re-encode, and a canvas has no compression level, no filter strategy and no
  palette knob anywhere in its API, so "compressing" a PNG through one would
  hand back a re-encoded file that is routinely LARGER. Refusing is the honest
  branch, and someone who has just been told a tool will not run deserves to
  know it is a decision rather than an omission.
*/
const NO_FALLBACK_NOTE =
  "There is no fallback on purpose: a canvas re-encode has no compression setting at all, so it would not make your PNG smaller.";

interface CompressPngUIProps {
  acceptFormats: string;
}

export function CompressPngUI({ acceptFormats }: CompressPngUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [split, setSplit] = useState(50);
  const [level, setLevel] = useState<PngOptimiseOptions["level"]>(2);
  const [optimiseAlpha, setOptimiseAlpha] = useState(false);
  const [result, setResult] = useState<PngOptimiseResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both URLs are hook-owned: revoked on unmount and when the source changes.
  const previewUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(result?.blob);
  // The pixels never change, so one measurement describes both sides.
  const dims = useImageDimensions(file);

  /*
    The probe is asked after hydration, because `supportsPngOptimiser()` reads
    Worker and WebAssembly off the global scope and the server has neither —
    rendering the refusal during SSR would print it for every browser.

    It is the optimiser's OWN probe, not the pixel pipeline's: this job never
    decodes, so OffscreenCanvas and createImageBitmap are not requirements and
    asking for them refused browsers that run it (measured on the shipped
    worker bundle with both globals deleted).
  */
  const mounted = useIsClient();
  const unsupportedMessage = !mounted
    ? null
    : supportsPngOptimiser()
      ? null
      : `${PNG_OPTIMISE_UNSUPPORTED_MESSAGE} ${NO_FALLBACK_NOTE}`;

  /*
    A run is a multi-SECOND uninterruptible wasm burn — roughly 570 ms per
    megapixel, with no progress callback to cancel against — so the user has
    ample time to hit Reset and drop a different PNG while one is in flight.
    Without this token the earlier run's `setResult` lands afterwards and the
    panel shows file A's SAVED figure beside file B's preview, with A's bytes
    behind the Download button. This repo already keeps a whole e2e describe
    for that class ("PDF stale-result invalidation"); the token is how the
    async completion learns it is no longer the current run.
  */
  const runToken = useRef(0);

  // Any option change invalidates the blob the Download button holds, so the
  // result goes with it and the run action comes back.
  //
  // The spinner is part of that state and not an oversight: bumping the token
  // abandons whatever run is in flight, and the token guard below then refuses
  // to let that run clear its own flag. Without this line, clearing mid-burn
  // (the one control that stays live while processing) leaves `isProcessing`
  // true for good — a permanently disabled "Optimizing…" over the next file.
  const invalidate = useCallback(() => {
    runToken.current += 1;
    setResult(null);
    setElapsedMs(null);
    setError(null);
    setIsProcessing(false);
  }, []);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      invalidate();
    },
    [invalidate],
  );

  const handleOptimise = useCallback(async () => {
    if (!file) return;
    const token = ++runToken.current;
    setIsProcessing(true);
    setError(null);
    const startedAt = performance.now();
    try {
      const output = await optimisePng(file, { level, optimiseAlpha });
      // Superseded while this was running: the file or an option changed, and
      // that newer intent owns the panel now.
      if (token !== runToken.current) return;
      setResult(output);
      // The one honest timing number on the page: what THIS file took here.
      setElapsedMs(performance.now() - startedAt);
    } catch (err) {
      if (token !== runToken.current) return;
      setError(err instanceof Error ? err.message : "Could not optimize this PNG.");
    } finally {
      // The flag belongs to the run that set it; a stale run must not clear
      // the spinner a newer one is relying on.
      if (token === runToken.current) setIsProcessing(false);
    }
  }, [file, level, optimiseAlpha]);

  const handleReset = useCallback(() => {
    setFile(null);
    invalidate();
  }, [invalidate]);

  if (!file) {
    return (
      <>
        {/* Warned before the upload, not after it; the zone stays so the page
            keeps its shape on a browser that cannot run the optimiser. */}
        {unsupportedMessage && <ErrorMessage message={unsupportedMessage} />}
        <DropZone
          accept={acceptFormats}
          practicalLimitNote={PRACTICAL_LIMIT_NOTE}
          onFiles={handleFiles}
          label="Upload a PNG to re-compress"
        />
      </>
    );
  }

  // Megapixels of the SOURCE, once the decode lands. `null` while it is in
  // flight, so nothing is blocked on a measurement that has not happened.
  const megapixels = dims ? (dims.w * dims.h) / 1_000_000 : null;
  const overCap = megapixels !== null && megapixels > MAX_MEGAPIXELS;

  const savedBytes = result ? file.size - result.newSize : 0;
  const savedPercent = result && file.size > 0 ? (savedBytes / file.size) * 100 : 0;
  // oxipng rewrites the pixel FORMAT while keeping every pixel — RGBA/8 →
  // Gray/1 is a measured real case on this repo's own sample-qr.png. A user
  // who inspects the output deserves to be told before they wonder.
  const formatRewritten = result !== null && result.colourBefore !== result.colourAfter;

  return (
    <>
      {/* ── Canvas: the picture that does NOT change, and the bytes that do ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(dims, formatFileSize(file.size))}
          trailing={result ? `LEVEL ${result.level}` : `LEVEL ${level}`}
        />

        {/*
          The compare stage earns its place here for one reason the other
          image tools cannot claim: its DIFF tab computes a real pixel
          difference between the two blobs and captions it "BLACK MEANS
          IDENTICAL". So the losslessness is not asserted on this page — the
          reader can look at it. The caption says where to look.

          With the alpha rewrite ON, the caption has to say the opposite, and
          the reason is structural rather than a bug in the diff: ToolCanvas's
          DIFF draws both sides on a 2D canvas and compares getImageData RGB,
          canvas 2D stores premultiplied alpha, so a pixel with alpha 0 reads
          back as (0,0,0,0) whatever its colour was. MEASURED: two PNGs whose
          alpha-0 halves differ by 255 in two channels produce a diff whose
          maximum channel value is 0. That is exactly and only the pixels this
          switch rewrites, so the honest caption points at the black and says
          why it is black — not at a check that cannot succeed.
        */}
        <CompareStage
          beforeUrl={previewUrl}
          afterUrl={resultUrl}
          inLabel="ORIGINAL"
          outLabel="OPTIMIZED"
          split={split}
          onSplitChange={setSplit}
          busy={isProcessing}
          caption={
            !result
              ? "optimize to see the result"
              : optimiseAlpha
                ? "open DIFF — black end to end here too: the pixels this switch can rewrite are invisible, and a canvas cannot show them"
                : "open DIFF — every pixel matches, so it is black end to end"
          }
        />

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—" },
            {
              label: "SAVED",
              // "NONE" rather than "0%" when oxipng returned the input: the
              // number is not a rounding artefact, it is the whole outcome.
              value: !result ? "—" : savedBytes > 0 ? `${savedPercent.toFixed(1)}%` : "NONE",
              tone: result && savedBytes > 0 ? "ok" : "neutral",
            },
            {
              label: "TOOK",
              value: elapsedMs === null ? "—" : `${(elapsedMs / 1000).toFixed(1)}s`,
              tone: "neutral",
            },
          ]}
        />

        {/*
          The pre-flight refusal, and it can only be the PIXEL half: this page
          measures the source by decoding it, which yields width and height and
          nothing about bit depth. The engine reads the IHDR and enforces the
          decoded-size ceiling too, so the sentence says so rather than
          implying the megapixel number is the whole guard.
        */}
        {overCap && megapixels !== null && (
          <ErrorMessage
            message={`This PNG is ${megapixels.toFixed(1)} megapixels and the optimizer stops at ${MAX_MEGAPIXELS}. oxipng's memory tracks the decoded image at roughly eight times its size and the tab never gets it back, so both are capped: ${MAX_MEGAPIXELS} megapixels, and ${MAX_RASTER_MB} MB decoded — what ${MAX_MEGAPIXELS} megapixels of 8-bit RGBA comes to, or half as many pixels at 16 bits per channel.`}
          />
        )}

        {error && <ErrorMessage message={error} />}

        {/*
          The engine's own notices, rendered from the result so they clear
          with it. The "already optimal" case arrives here as a warning the
          run produced — this component never infers it from a zero delta,
          and the rail explains what it means rather than repeating it.
        */}
        {(result?.warnings ?? []).map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}

        {result && formatRewritten && (
          <WarningMessage
            message={`Pixel format rewritten: ${result.colourBefore} → ${result.colourAfter}. Every pixel still round-trips — oxipng drops channels and bit depth the image never used (an all-opaque RGBA image has no use for its alpha channel). Anything downstream that expects a specific PNG color type should be told.`}
          />
        )}

        {/*
          The standing claim, and it has to follow the one switch that
          qualifies it. With the alpha rewrite off this tool is lossless
          without a footnote; with it on, pixels whose alpha is zero can
          change colour, and saying "every pixel identical" over that setting
          would be false in exactly the case the checkbox exists for.
        */}
        <CanvasFootnote>
          {optimiseAlpha
            ? "LOSSLESS WHEREVER ANYTHING IS VISIBLE — THE ONLY PIXELS THAT CAN CHANGE ARE THE FULLY TRANSPARENT ONES"
            : "LOSSLESS — EVERY PIXEL COMES OUT IDENTICAL. ONLY THE ENCODING CHANGES"}
        </CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {/*
              Indeterminate, and it has to be. oxipng is ONE synchronous call
              with no progress callback in its API, so a percentage here would
              be invented. The phase says what is happening and the label says
              it cannot be broken up.
            */}
            {isProcessing && (
              <ToolProgress phase="OPTIMIZING" percent={null} label="Re-compressing PNG" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={isProcessing ? "Optimizing…" : "Optimize PNG"}
                onPrimary={handleOptimise}
                primaryDisabled={isProcessing || overCap || unsupportedMessage !== null}
              />
            )}
            {result && !isProcessing && (
              <ToolResetLink onClick={handleOptimise} label="OPTIMIZE AGAIN" />
            )}
            <ToolResetLink onClick={handleReset} label={result ? "OPTIMIZE ANOTHER" : "CLEAR"} />
          </>
        }
      >
        {/* The refusal follows the file in, because it is what explains a
            primary that will not run. */}
        {unsupportedMessage && <ErrorMessage message={unsupportedMessage} />}

        <ToolControlGroup>
          <ToolControl label="EFFORT">
            <ToolChoice
              label="Optimization level"
              fill
              disabled={isProcessing}
              value={level}
              onChange={(v: PngOptimiseOptions["level"]) => {
                invalidate();
                setLevel(v);
              }}
              options={LEVELS.map((l) => ({ value: l.value, label: l.label }))}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {LEVELS.find((l) => l.value === level)?.note}
            </span>
          </ToolControl>

          <ToolControl label="TRANSPARENT PIXELS">
            <label className="flex cursor-pointer items-center gap-2.5 font-body text-[12.5px] text-neutral-300">
              <input
                type="checkbox"
                checked={optimiseAlpha}
                onChange={(e) => {
                  invalidate();
                  setOptimiseAlpha(e.target.checked);
                }}
                disabled={isProcessing}
                className="size-4 rounded-sm border-border accent-accent"
              />
              Rewrite fully-transparent pixels
            </label>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Off by default, and the one switch here that touches pixel values — but only
              pixels whose alpha is zero, which nothing can display. It earns its keep on
              images whose invisible areas carry leftover colour: one measured fixture went
              from 5,922 B to 912 B with it on. On every other fixture measured it changed the
              output by five bytes or fewer.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          {/* ToolOutput accents its SECOND row, so the measured output size
              sits there — the doc highlights what comes out. */}
          <ToolOutput
            rows={[
              ["Format", "PNG"],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              [
                "Saved",
                !result ? "—" : savedBytes > 0 ? `${formatFileSize(savedBytes)}` : "0 B",
              ],
              [
                "Pixel format",
                !result
                  ? "—"
                  : formatRewritten
                    ? `${result.colourBefore} → ${result.colourAfter}`
                    : result.colourAfter,
              ],
              ["In", formatFileSize(file.size)],
            ]}
          />
          {/*
            The other half of the honest claim, and the one a percentage range
            alone would hide. It renders off `identical`, which the run set —
            not off a zero byte delta, which would also fire on a file that
            genuinely came back one byte smaller.
          */}
          {result?.identical && (
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Nothing was saved, and nothing went wrong. oxipng returns a PNG byte for byte
              when there is nothing left to win — which is the normal outcome for a file
              already run through pngcrush, through oxipng itself, or through an exporter set
              to maximum compression. 0–3% is the whole range available on a PNG in that
              state, and the download below is your original file.
            </span>
          )}

          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {/* `{n}{" "}megapixels` and not `{n} megapixels`: JSX drops the
                space between an expression and the next word when the chunk
                wraps, and this repo shipped "at most 300frames" that way. */}
            {megapixels !== null && (
              <>
                This one is {megapixels.toFixed(1)}{" "}
                megapixels.{" "}
              </>
            )}
            A PNG exported from a browser, a screenshot tool or a design app typically comes
            down 20–35%. One that has already been optimized comes down 0–3% and is handed
            back untouched. A photograph saved as PNG is the worst case measured here, at
            8.5–9.6% — if that is what you have,{" "}
            <Link
              href="/png-to-webp"
              className="text-accent underline hover:text-accent-hover"
            >
              PNG to WebP
            </Link>{" "}
            or{" "}
            <Link
              href="/png-to-jpg"
              className="text-accent underline hover:text-accent-hover"
            >
              PNG to JPG
            </Link>{" "}
            is the real answer, at the cost of no longer being lossless.
          </span>
        </ToolAsideSection>

        {/* Engine facts only, stated where true — the reference prose sits
            behind the disclosure so the first paint stays lean. */}
        <ToolAdvanced
          rows={[
            ["Engine", "OXIPNG 9.1.1 (WASM)"],
            // Tracks the switch, because the footnote above it does: with the
            // alpha rewrite on, a flat "UNCHANGED" in the same DOM at the same
            // moment contradicts the retraction three elements up.
            ["Pixel data", optimiseAlpha ? "UNCHANGED WHERE ALPHA > 0" : "UNCHANGED"],
            ["DPI (pHYs)", "PRESERVED"],
            ["Throughput", "≈570 MS PER MEGAPIXEL AT LEVEL 2"],
            ["Ceiling", `${MAX_MEGAPIXELS} MEGAPIXELS AND ${MAX_RASTER_MB} MB DECODED, BOTH ENFORCED`],
            ["Progress", "NONE — ONE UNINTERRUPTIBLE PASS"],
          ]}
        />

        <ToolAsideSection label="HOW LONG IT TAKES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Measured at roughly 570 ms per megapixel at level 2, so a 12-megapixel PNG — the
            largest this tool accepts — is about a five-second job, and levels 3 and 4 take
            several times longer again. There is no progress bar with a number on it because
            oxipng is a single call that reports nothing until it returns; the bar you get is
            honest about that.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            The DPI written by{" "}
            <Link
              href="/change-image-dpi"
              className="text-accent underline hover:text-accent-hover"
            >
              Change image DPI
            </Link>{" "}
            survives this tool — the pHYs chunk was measured intact on four fixtures. Other
            ancillary chunks were not tested, so nothing is claimed about them.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
