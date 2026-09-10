"use client";

import { useCallback, useRef, useState } from "react";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { recompressPdfImages } from "@/lib/tools/pdf-image";
import { scaledImagesWarning } from "@/lib/tools/target-size";
import { PDF_IMAGE_QUALITY_PRESETS } from "@/lib/workers/pdf-image-protocol";
import type {
  PdfImageMode,
  PdfImageQualityPreset,
  PdfImageSkip,
  PdfImageSkipReason,
  PdfImageStats,
} from "@/lib/workers/pdf-image-protocol";
import {
  ToolActions,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolDone,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  DocCard,
  DocStrip,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { CANVAS_COLUMN } from "@/components/workspace/shared";

/*
  The lossy half of PDF shrinking: this tool decodes the JPEGs embedded in a
  document and writes them back at a lower quality, and — in target mode — at
  smaller pixel dimensions. Nothing about the page layout moves; only the image
  bytes change, and the change cannot be undone from the output.

  The engine is deliberately conservative about WHICH images it will touch
  (`pdf-image-core.ts` classifies every image XObject and skips anything it
  cannot round-trip through a canvas without lying about the result). That
  conservatism is only honest if the user can see it, so the skip counts and
  their reasons are printed on the canvas as a first-class readout rather than
  folded away into a total that would overstate what ran.

  No control here mentions DPI, and none can: v1 scales images by a uniform
  factor, and the effective DPI of an image on a page comes from the on-page
  CTM, which this engine never parses. Claiming DPI-awareness would be a claim
  the code cannot keep.
*/

type Mode = "quality" | "target";

/** Chip labels, derived so they cannot drift from the shared preset table. */
const QUALITY_OPTIONS = (
  Object.keys(PDF_IMAGE_QUALITY_PRESETS) as PdfImageQualityPreset[]
).map((key) => ({
  value: key,
  label: `${key.charAt(0).toUpperCase()}${key.slice(1)}`,
}));

/**
 * Deliberately `number[]` and not a literal tuple: `ToolChoice` infers its
 * option type from this array, and a tuple of literals would refuse the
 * hand-typed KB value the number field beside the chips produces.
 */
const TARGET_PRESETS_KB: number[] = [200, 500, 1024, 2048];

/**
 * The one place the engine's skip reasons become English.
 *
 * Every member of `PdfImageSkipReason` has a row — a missing one would print a
 * raw enum value like `decode-parms` on the canvas — and each row is written to
 * follow a count, so "2" plus `many` reads as a sentence and "1" plus `one`
 * agrees with its verb.
 */
const SKIP_PHRASES: Record<PdfImageSkipReason, { one: string; many: string }> = {
  filter: { one: "IS NOT JPEG", many: "ARE NOT JPEG" },
  mask: { one: "CARRIES A TRANSPARENCY MASK", many: "CARRY A TRANSPARENCY MASK" },
  "decode-parms": {
    one: "CARRIES DECODE PARAMETERS A RE-ENCODE WOULD INVALIDATE",
    many: "CARRY DECODE PARAMETERS A RE-ENCODE WOULD INVALIDATE",
  },
  "decode-array": {
    one: "CARRIES A CUSTOM DECODE ARRAY",
    many: "CARRY A CUSTOM DECODE ARRAY",
  },
  "colour-space": {
    one: "IS IN A COLOUR SPACE THIS TOOL WILL NOT GUESS AT",
    many: "ARE IN COLOUR SPACES THIS TOOL WILL NOT GUESS AT",
  },
  "bit-depth": {
    one: "IS NOT 8 BITS PER CHANNEL",
    many: "ARE NOT 8 BITS PER CHANNEL",
  },
  "no-smaller": {
    one: "CAME BACK BIGGER RE-ENCODED, SO IT WAS KEPT AS IT WAS",
    many: "CAME BACK BIGGER RE-ENCODED, SO THEY WERE KEPT AS THEY WERE",
  },
  undecodable: { one: "COULD NOT BE DECODED", many: "COULD NOT BE DECODED" },
};

function skipPhrase(skip: PdfImageSkip): string {
  const phrase = skip.count === 1 ? SKIP_PHRASES[skip.reason].one : SKIP_PHRASES[skip.reason].many;
  // `detail` is the thing the classifier actually found — the filter name, the
  // colour space — so it is printed verbatim rather than paraphrased away.
  return skip.detail
    ? `${skip.count} ${phrase} (${skip.detail.toUpperCase()})`
    : `${skip.count} ${phrase}`;
}

/**
 * The mandatory disclosure, built as ONE string so the sentence the user reads
 * is the sentence the tests assert — JSX interpolation would let whitespace
 * drift between the two.
 */
function disclosureText(stats: PdfImageStats): string {
  if (stats.imagesFound === 0) {
    return "THIS PDF HAS NO EMBEDDED IMAGES AT ALL, SO THERE WAS NOTHING HERE TO RE-ENCODE";
  }
  const skippedTotal = stats.skipped.reduce((sum, s) => sum + s.count, 0);
  if (skippedTotal === 0) {
    return stats.imagesFound === 1
      ? "THE ONE IMAGE IN THIS PDF WAS RE-ENCODED — NOTHING WAS LEFT OUT"
      : `ALL ${stats.imagesFound} IMAGES WERE RE-ENCODED — NOTHING WAS LEFT OUT`;
  }
  const noun = stats.imagesFound === 1 ? "IMAGE WAS" : "IMAGES WERE";
  return `${skippedTotal} OF ${stats.imagesFound} ${noun} LEFT UNTOUCHED — ${stats.skipped
    .map(skipPhrase)
    .join(", ")}`;
}

export function RecompressPdfImagesUI() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("quality");
  const [preset, setPreset] = useState<PdfImageQualityPreset>("medium");
  const [targetSizeKb, setTargetSizeKb] = useState(500);
  const [status, setStatus] = useState<"idle" | "processing" | "done" | "error">("idle");
  const [result, setResult] = useState<{ blob: Blob; stats: PdfImageStats } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  // The doc pins a "Done in 1.4 s" card above the primary once a run
  // finishes. Timed for real; cleared the moment the inputs change.
  const [elapsed, setElapsed] = useState<string | null>(null);

  /*
    Every control change drops the finished output — the app-wide contract
    golden-paths.spec.ts pins for every tool. Without it the header could read
    "≤ 200 KB" while Download still holds the file built at 500 KB.

    The FILE is deliberately NOT dropped: flipping between the two modes over
    the same document is the idiom `pdf-resizer` established, and re-dropping
    the PDF to change one number would be busywork.
  */
  /*
    Clearing the state above is not enough on its own, because a run is async
    and nothing cancels it. Target mode does up to 24 whole-document rebuilds,
    so there is a real window in which the user swaps the file (or flips a
    control) while a run is still in flight — and when that run resolved it
    called setResult() unconditionally, binding the OLD document's blob and
    stats to the NEW file. The readouts then compared the new file's size
    against the old output, and Download handed over the old bytes under the
    new file's name.

    Every invalidation bumps this token; a run captures it at the start and
    commits nothing unless it still matches. A ref, not state, because the
    check has to see the value at the moment the promise settles rather than
    the one captured when the callback was created.
  */
  const runToken = useRef(0);

  const invalidate = useCallback(() => {
    runToken.current += 1;
    setResult(null);
    setElapsed(null);
    setError(null);
    setPercent(null);
    setStatus("idle");
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

  const handleReset = useCallback(() => {
    setFile(null);
    invalidate();
  }, [invalidate]);

  // A cleared or zeroed KB field must never run: the engine treats a
  // non-positive target as "no target" and falls back to a plain quality pass,
  // which would land under a "≤ 0 KB" header as a targeted success that never
  // happened.
  const targetValid = Number.isFinite(targetSizeKb) && targetSizeKb >= 1;

  const handleRun = useCallback(async () => {
    if (!file) return;
    if (mode === "target" && !targetValid) return;
    // Starting a run is itself an invalidation, and it is what stamps the
    // token this run will be checked against.
    runToken.current += 1;
    const token = runToken.current;
    setStatus("processing");
    setError(null);
    setElapsed(null);
    setResult(null);
    setPercent(null);
    const startedAt = performance.now();
    /*
      In target mode the engine searches quality itself, so the preset is only
      the starting point; the quality that actually won is read back out of the
      stats and shown, rather than the number this component happened to send.
    */
    const job: PdfImageMode =
      mode === "quality"
        ? { kind: "quality", quality: PDF_IMAGE_QUALITY_PRESETS[preset] }
        : { kind: "target", targetSizeKb, quality: PDF_IMAGE_QUALITY_PRESETS[preset] };
    try {
      const out = await recompressPdfImages(await file.arrayBuffer(), job, (value) => {
        // A superseded run must not drive the progress bar of the new one.
        if (runToken.current === token) setPercent(value);
      });
      // Superseded while it ran: the file or a control changed under it, so
      // this output belongs to a document the user is no longer looking at.
      // Drop it on the floor — invalidate() has already reset the surface.
      if (runToken.current !== token) return;
      setResult({
        blob: new Blob([out.bytes as BlobPart], { type: "application/pdf" }),
        stats: out.stats,
      });
      // A small PDF finishes in tens of milliseconds; "Done in 0.0 s" reads
      // like a stopwatch that never started. Sub-second runs report ms.
      const ms = performance.now() - startedAt;
      setElapsed(ms < 950 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
      setStatus("done");
    } catch (err) {
      // Same fence on the failure path: a superseded run's error must not
      // land on the document the user has since loaded.
      if (runToken.current !== token) return;
      setError(err instanceof Error ? err.message : "Failed to recompress the images in this PDF");
      setStatus("error");
    }
  }, [file, mode, preset, targetSizeKb, targetValid]);

  if (!file) {
    return <DropZone accept=".pdf" onFiles={handleFiles} />;
  }

  /*
    The never-grow guard, the same shape `CompressPdfUI` carries: a rebuild is
    not guaranteed to be smaller than what it was given, and handing back a
    bigger file under a "-recompressed" name is a lie. The smaller of the two
    ships and every readout below describes THAT file.

    It fires here for a reason the per-image guard cannot cover: the engine
    already refuses to swap in an image that came back bigger, so the images
    can only shrink — but a document whose images were ALL skipped still gets
    re-serialised, and a file that was already garbage-collected and already
    packed into object streams comes back the same size or a few bytes over.
  */
  const stats = result?.stats ?? null;
  const grew = result !== null && result.blob.size >= file.size;
  const noSmaller = result !== null && result.blob.size === file.size;
  const output = result === null ? null : grew ? file : result.blob;
  const savedLabel = !output
    ? "—"
    : grew
      ? "0%"
      : `${((1 - output.size / file.size) * 100).toFixed(1)}%`;
  const imagesLabel = stats ? `${stats.imagesRecompressed} of ${stats.imagesFound}` : "—";

  return (
    <>
      {/* ── Canvas: the document, and exactly what happened to its images ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={formatFileSize(file.size)}
          trailing={
            output
              ? formatFileSize(output.size)
              : mode === "quality"
                ? `Q${Math.round(PDF_IMAGE_QUALITY_PRESETS[preset] * 100)}`
                : targetValid
                  ? `≤ ${targetSizeKb} KB`
                  : "SET A TARGET"
          }
        />

        <DocStrip>
          <DocCard index={1} name={file.name} meta={formatFileSize(file.size)} badge="PDF" />
        </DocStrip>

        <StatStrip
          stats={[
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: output ? formatFileSize(output.size) : "—" },
            // "—" reads as "not measured"; the honest answer when a re-encode
            // does not help is that nothing was saved.
            { label: "SAVED", value: savedLabel, tone: grew ? "neutral" : "ok" },
            // The one cell that describes the RUN rather than the download. In
            // the rare case where the never-grow guard ships the original, the
            // re-encodes counted here live in the rebuild that was discarded —
            // which is exactly what the footnote under this strip says.
            { label: "IMAGES", value: imagesLabel, tone: "neutral" },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {/*
          The disclosure is the headline readout of this tool, not a footnote of
          apology: it is the only thing on the page that says whether the number
          in SAVED describes the whole document or a fraction of it.
        */}
        {stats && <CanvasFootnote>{disclosureText(stats)}</CanvasFootnote>}

        {/*
          Scaling is a visible change to the images, so it is disclosed through
          the same single producer the image pipelines use — one wording, one
          place, asserted by the e2e suite. `scale < 1` only ever happens in
          target mode; a quality pass never resizes anything.
        */}
        {/*
          Gated on the target actually being MET, because the shared string ends
          "to reach the target" — on a run that missed, that clause is simply
          false. The scale is still disclosed in the missed case: the footnote
          below names it as a percentage of the original dimensions.
        */}
        {stats && stats.scale < 1 && stats.targetMet === true && (
          <WarningMessage message={scaledImagesWarning(stats.scale)} />
        )}

        {stats && stats.targetMet === false && output && (
          <CanvasFootnote>
            {stats.imagesRecompressed === 0
              ? /*
                  Quoting a quality and a scale here would describe a search
                  that never touched a single image, immediately above a
                  footnote saying nothing could be re-encoded. Name only the
                  size actually reached.
                */
                `COULD NOT REACH ${targetSizeKb} KB — THE CLOSEST THIS DOCUMENT GOT IS ${formatFileSize(output.size)}`
              : grew
                ? /*
                    `output` is the ORIGINAL file here, because the never-grow
                    guard shipped it. Calling the user's own input "the smallest
                    this tool could produce" would credit the tool with the file
                    it was handed.
                  */
                  `COULD NOT REACH ${targetSizeKb} KB — EVERY REBUILD CAME BACK NO SMALLER THAN YOUR ORIGINAL ${formatFileSize(output.size)}, SO THAT IS WHAT THE DOWNLOAD IS`
                : /*
                    "UP TO" because the scale is applied per image through the
                    64-px floor: an image that would have fallen below it is
                    scaled less than this number. Quoting the factor flatly
                    would be false for exactly those images.
                  */
                  `COULD NOT REACH ${targetSizeKb} KB — THE CLOSEST THIS TOOL COULD GET IS ${formatFileSize(
                    output.size,
                  )}, WITH IMAGES RE-ENCODED AT QUALITY ${Math.round(
                    stats.quality * 100,
                  )}% AND SCALED DOWN BY UP TO ${100 - Math.round(stats.scale * 100)}%`}
          </CanvasFootnote>
        )}

        {/*
          Two different outcomes hide behind `grew`, and saying the wrong one is
          a claim the user can check against the two sizes printed directly
          above the sentence.
        */}
        {result && grew && (
          <CanvasFootnote>
            {noSmaller
              ? "RE-ENCODING WON NOTHING HERE — THE REBUILT FILE IS EXACTLY THE SAME SIZE, SO THE DOWNLOAD IS YOUR ORIGINAL BYTES"
              : `RE-ENCODING MADE THIS PDF LARGER (${formatFileSize(
                  result.blob.size,
                )}) — YOUR ORIGINAL IS ALREADY SMALLER, SO THE DOWNLOAD HANDS BACK THE ORIGINAL BYTES`}
          </CanvasFootnote>
        )}

        {/*
          A run where nothing was re-encoded must not read as a success. The two
          branches are different facts: a file that came back smaller anyway was
          shrunk by the repack on the way out, and saying "could not be shrunk"
          over a visible saving would be its own lie.

          Gated on `imagesFound > 0` because a document with no images at all is
          a different sentence, and the disclosure above already says it — this
          line would only repeat it in vaguer words.
        */}
        {stats && stats.imagesFound > 0 && stats.imagesRecompressed === 0 && (
          <CanvasFootnote>
            {grew
              ? "NOTHING IN THIS PDF COULD BE RE-ENCODED, SO THIS TOOL HAD NO WAY TO SHRINK IT"
              : "NOTHING IN THIS PDF COULD BE RE-ENCODED — WHAT WAS SAVED CAME FROM REPACKING THE FILE, NOT FROM THE IMAGES"}
          </CanvasFootnote>
        )}

        {!result && (
          <CanvasFootnote>
            LOSSY AND IRREVERSIBLE — THE IMAGES IN THE DOWNLOAD ARE RE-ENCODED, NOT YOUR
            ORIGINALS. KEEP THE SOURCE FILE.
          </CanvasFootnote>
        )}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {status === "processing" && (
              <ToolProgress
                phase="RE-ENCODING IMAGES"
                percent={percent}
                label="Recompressing PDF images"
              />
            )}
            {elapsed && <ToolDone elapsed={elapsed} />}
            {output ? (
              // The name stays stable whichever blob wins, so the download is
              // predictable however the comparison came out.
              <DownloadButton
                blob={output}
                fileName={file.name.replace(/\.pdf$/i, "-recompressed.pdf")}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={status === "processing" ? "Re-encoding…" : "Recompress images"}
                primaryDisabled={status === "processing" || (mode === "target" && !targetValid)}
                onPrimary={handleRun}
              />
            )}
            <ToolResetLink onClick={handleReset} label="CHANGE FILE" />
          </>
        }
      >
        {/*
          The switch decides what every control under it means, so it sits at
          the top of the rail — the same placement `pdf-resizer` uses. It keeps
          the loaded file and drops only the stale output.
        */}
        <ToolAsideSection label="HOW TO SHRINK">
          <ToolChoice
            label="How to shrink"
            fill
            disabled={status === "processing"}
            value={mode}
            onChange={(v: Mode) => {
              invalidate();
              setMode(v);
            }}
            options={[
              { value: "quality", label: "Quality" },
              { value: "target", label: "Target size" },
            ]}
          />
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {mode === "quality"
              ? "One pass at a fixed quality. Image dimensions are never changed."
              : "Quality is searched down towards the ceiling, then the images are scaled if quality alone cannot get there."}
          </span>
        </ToolAsideSection>

        <ToolControlGroup>
          {mode === "quality" ? (
            <ToolControl label="QUALITY">
              <ToolChoice
                label="JPEG quality"
                fill
                disabled={status === "processing"}
                value={preset}
                onChange={(v: PdfImageQualityPreset) => {
                  invalidate();
                  setPreset(v);
                }}
                options={QUALITY_OPTIONS}
              />
              {/* The numbers come out of the shared preset table, so the hint
                  cannot describe a quality the engine is not given. */}
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                {`High re-encodes at ${Math.round(
                  PDF_IMAGE_QUALITY_PRESETS.high * 100,
                )}% quality, Medium at ${Math.round(
                  PDF_IMAGE_QUALITY_PRESETS.medium * 100,
                )}%, Low at ${Math.round(
                  PDF_IMAGE_QUALITY_PRESETS.low * 100,
                )}%. Lower means a smaller file and visibly softer photographs.`}
              </span>
            </ToolControl>
          ) : (
            <ToolControl label="TARGET SIZE">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={102400}
                  value={targetSizeKb}
                  onChange={(e) => {
                    invalidate();
                    setTargetSizeKb(Number(e.target.value));
                  }}
                  aria-label="Target file size in KB"
                  className="w-24 rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  disabled={status === "processing"}
                />
                <span className="text-sm text-text-muted">KB</span>
              </div>
              <ToolChoice
                label="Target size preset"
                fill
                disabled={status === "processing"}
                value={targetSizeKb}
                onChange={(v: number) => {
                  invalidate();
                  setTargetSizeKb(v);
                }}
                options={TARGET_PRESETS_KB.map((kb) => ({
                  value: kb,
                  label: kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`,
                }))}
              />
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                A ceiling, not a promise. Text and vector pages carry a floor this tool cannot
                re-encode past, so if the smallest build is still over the ceiling you get that
                build and a line saying how close it got.
              </span>
            </ToolControl>
          )}
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["In", formatFileSize(file.size)],
              ["Out", output ? formatFileSize(output.size) : "—"],
              ["Saved", savedLabel],
              ["Images re-encoded", imagesLabel],
            ]}
          />
        </ToolAsideSection>

        <ToolAsideSection label="WHAT THIS DOES">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Every JPEG inside the PDF is decoded and re-encoded at a lower quality, and that is
            lossy and <strong>irreversible</strong> — the detail thrown away is gone from the
            download, so keep your original.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Text, vector art and the page layout are not touched — only the image data changes,
            and every page comes out the same size and in the same order.
          </span>
          {/*
            The honesty line. `pdf-image-core.ts` classifies each image XObject
            before touching it and refuses everything it cannot round-trip
            through a canvas truthfully; the counts it returns are what the
            canvas prints. This paragraph is the list that classifier actually
            implements, not a hopeful summary of it.
          */}
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            Some images are left exactly as they arrived, and the canvas says how many and why.
            Skipped by design: anything that is not a plain JPEG (Flate/PNG-style images, JPEG
            2000, fax and JBIG2 scans), anything carrying a transparency mask, a custom decode
            array, a colour space other than RGB or greyscale, or more than 8 bits per channel.
          </span>
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            An image is only swapped in when its re-encode actually comes out smaller, so no
            picture in the file can grow. The document is also repacked on the way out, which is
            why a PDF whose images were all skipped can still come back slightly smaller.
          </span>
        </ToolAsideSection>
      </ToolAside>
    </>
  );
}
