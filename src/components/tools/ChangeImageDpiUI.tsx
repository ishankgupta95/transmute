"use client";

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
import { CanvasHeader, CanvasStage, StatStrip } from "@/components/tools/ToolCanvas";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useFileProcessor, type ProcessedResult } from "@/hooks/useFileProcessor";
import { MAX_DPI, MIN_DPI, readImageDpi, setImageDpi } from "@/lib/tools/image-dpi";
import type {
  DpiFormat,
  DpiSegmentName,
  ReadImageDpiResult,
  SetImageDpiSuccess,
} from "@/lib/tools/image-dpi";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";

/*
  DPI IS METADATA, AND THAT IS THE WHOLE TOOL.

  A DPI value moves no pixels. It is the number a printer or a layout app reads
  to decide how large to print the pixels that are already there: the same
  3000 x 2000 photo is a 10-inch print at 300 DPI and a 41-inch print at 72.
  People arrive here expecting a resize, so every readout on this page is built
  to show the pixel count staying still while the PRINT SIZE moves.

  Nothing on the output path decodes. A canvas round trip destroys the very
  field this tool sets — a fresh encode carries no `pHYs` and no JFIF density —
  so `image-dpi.ts` edits the header and hands the same compressed image data
  back, and this page never touches `@/lib/workers/image-client`. The preview
  below does decode, for the screen; nothing that decode produces reaches the
  download.

  COPY DISCIPLINE, inherited from `pdf-image-core.ts:41-42` ("Because that is
  what it does, NO copy anywhere may claim a DPI — the tool would be lying"):
  where a file declares no density this page says it declares none, and never
  prints the 72 a reader would have invented on its behalf. "DPI after" comes
  from `SetImageDpiSuccess.after`, which the engine reads back out of the bytes
  it just wrote rather than predicting — so a whole-number rounding artefact
  shows up as itself.
*/

/*
  Typed as plain numbers, not a literal tuple: `ToolChoice` infers its generic
  from the options it is given, and a `72 | 150 | 300 | 600` union would then
  reject every value the Custom field beside it exists to accept.
*/
const DPI_PRESETS: readonly number[] = [72, 150, 300, 600];

/**
 * `photo.jpeg` at 300 → `photo-300dpi.jpeg`.
 *
 * The extension is PRESERVED, not normalised: these are the same bytes in the
 * same container they arrived in, and turning a `.jpeg` into a `.jpg` would be
 * a second change nobody asked for. (`jfif-to-jpg` renames precisely because
 * renaming is the whole point there; here it is not.)
 */
function dpiFileName(name: string, dpi: number, format: DpiFormat): string {
  const stem = name.replace(/\.[^.]+$/, "") || "image";
  const existing = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  const ext =
    format === "png"
      ? "png"
      : existing === "jpeg" || existing === "jpg"
        ? existing
        : "jpg";
  return `${stem}-${dpi}dpi.${ext}`;
}

/** `72` on its own, or `72 × 300` when a file declares the two axes apart. */
function dpiLabel(x: number | null, y: number | null): string | null {
  if (x === null) return null;
  return y === null || y === x ? `${x}` : `${x} × ${y}`;
}

/*
  Inches across and down at a given density, with the metric equivalent.

  THE TWO AXES ARE TWO ARGUMENTS. A file may declare them apart — that is why
  `DpiFieldReading` carries `dpiX` and `dpiY` at all — and dividing the HEIGHT
  by the X density is wrong by exactly the X:Y ratio. It is not a contrived
  case: a fax-shape JPEG at the Group-3 JFIF densities (204 × 98) measuring
  1728 × 1100 px prints 8.47 × 11.22 in, and the single-density form reported
  8.47 × 5.39 — a portrait sheet called a landscape one, printed directly under
  a stat cell reading "204 × 98".

  `dpiY` defaults to `dpiX` for the square density this tool WRITES:
  `setImageDpi(bytes, targetDpi)` takes `dpiY = dpiX`, so the after-print is a
  square-density measurement and says so by passing one number.
*/
function printSize(
  pixels: { w: number; h: number } | null,
  dpiX: number | null,
  dpiY: number | null = dpiX,
): string | null {
  if (!pixels || !dpiX) return null;
  const w = pixels.w / dpiX;
  const h = pixels.h / (dpiY || dpiX);
  return `${w.toFixed(2)} × ${h.toFixed(2)} in · ${(w * 2.54).toFixed(1)} × ${(h * 2.54).toFixed(1)} cm`;
}

/** The same measurement, short enough for a stat cell. */
function shortPrintSize(
  pixels: { w: number; h: number } | null,
  dpiX: number | null,
  dpiY: number | null = dpiX,
): string | null {
  if (!pixels || !dpiX) return null;
  return `${(pixels.w / dpiX).toFixed(1)}×${(pixels.h / (dpiY || dpiX)).toFixed(1)} in`;
}

/**
 * How a written field is named in a sentence.
 *
 * The container decides the spelling — a PNG's block is the `eXIf` chunk, a
 * JPEG's is the Exif APP1 — while the WRITTEN table prints `w.segment`, which
 * is the same word ("EXIF") for both.
 */
function segmentPhrase(segment: DpiSegmentName, format: DpiFormat): string {
  if (segment === "pHYs") return "the pHYs chunk";
  if (segment === "JFIF") return "the JFIF density";
  return format === "png" ? "the eXIf resolution" : "the Exif resolution";
}

/*
  THE RUN'S FACTS RIDE ON THE RESULT OBJECT.

  `useFileProcessor` is typed on `ProcessedResult`, so `wrote`, `before`,
  `after` and `sizeDelta` — the facts this page exists to report — would not
  survive the hook. Three audio tools stash them in a ref and match them back
  by blob identity; that reads a ref during render, which `react-hooks/refs`
  rejects (those files escape the rule only because the React Compiler bails
  out of them entirely — verified by planting a `Date.now()` in one and getting
  no purity error either).

  Hanging them on the returned object is both legal and stronger: the hook
  stores the exact object the processor returned, so the detail and the blob
  ARE the same object and a superseded run's facts cannot be read as this
  one's. There is no identity check to get wrong.
*/
interface DpiRun extends ProcessedResult {
  detail: SetImageDpiSuccess;
}

/** The run's own facts, or null before the first run completes. */
function runDetail(result: ProcessedResult | null): SetImageDpiSuccess | null {
  return (result as DpiRun | null)?.detail ?? null;
}

interface ChangeImageDpiUIProps {
  acceptFormats: string;
}

export function ChangeImageDpiUI({ acceptFormats }: ChangeImageDpiUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dpi, setDpi] = useState(300);
  const [reading, setReading] = useState<ReadImageDpiResult | null>(null);

  /*
    Reading the header is asynchronous (the `arrayBuffer()` is) and cannot be
    cancelled, so it carries the run fence every other async readout on this
    site does — `NormalizeAudioUI.waveformRunRef`, `useFileProcessor.runIdRef`.
    Without it a discarded file's declared DPI lands on top of the file the
    user is looking at now.
  */
  const readRunRef = useRef(0);

  const processFn = useCallback(
    async (f: File, targetDpi: number): Promise<DpiRun> => {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const written = setImageDpi(bytes, targetDpi);
      // Every refusal from the engine already carries a sentence naming its
      // reason; re-wording it here would only let the two drift apart.
      if (!written.ok) throw new Error(written.message);
      const blob = new Blob([written.bytes as BlobPart], {
        type: written.format === "png" ? "image/png" : "image/jpeg",
      });
      return {
        blob,
        fileName: dpiFileName(f.name, targetDpi, written.format),
        originalSize: f.size,
        newSize: blob.size,
        detail: written,
      };
    },
    [],
  );

  const { status, result, error, process, reset } = useFileProcessor<number>(processFn);

  const detail = runDetail(result);

  const sourceUrl = useObjectUrl(file);
  const pixels = useImageDimensions(file);

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      const run = ++readRunRef.current;
      setFile(f);
      setReading(null);
      reset();
      // `readImageDpi` is total — a WebP or a corrupt header comes back as a
      // typed refusal carrying its own sentence — so nothing here throws.
      void f.arrayBuffer().then((buffer) => {
        if (readRunRef.current !== run) return;
        setReading(readImageDpi(new Uint8Array(buffer)));
      });
    },
    [reset],
  );

  const handleRun = useCallback(() => {
    if (!file) return;
    process(file, dpi);
  }, [file, dpi, process]);

  const handleReset = useCallback(() => {
    readRunRef.current++;
    setFile(null);
    setReading(null);
    reset();
  }, [reset]);

  const handleDpiChange = useCallback(
    (next: number) => {
      setDpi(next);
      // The download in the footer was written at the OLD density. Leaving it
      // there beside a rail that now says something else is the lie.
      reset();
    },
    [reset],
  );

  if (!file) {
    return (
      <DropZone
        accept={acceptFormats}
        onFiles={handleFiles}
        label="Drop a PNG or JPEG to begin"
      />
    );
  }

  const isProcessing = status === "processing";
  /** The header as read. Refusals name the container; the engine writes both. */
  const declares = reading?.ok ? reading : null;
  const refusal = reading && !reading.ok ? reading.message : null;

  /** What a reader believes today, or null when the file gives it nothing. */
  const currentLabel = declares
    ? dpiLabel(declares.effective?.dpiX ?? null, declares.effective?.dpiY ?? null)
    : null;
  /** What the file says NOW, read back out of the bytes that were written. */
  const writtenDpi = detail?.after.effective?.dpiX ?? null;
  const shownDpi = writtenDpi ?? dpi;

  // Both axes, because the file is allowed to declare them apart — and where
  // it does, this sentence sits directly under a stat cell printing both.
  const beforePrint = printSize(
    pixels,
    declares?.effective?.dpiX ?? null,
    declares?.effective?.dpiY ?? null,
  );
  const afterPrint = printSize(pixels, shownDpi);

  /*
    A density with no unit is an aspect ratio, not a resolution — both repo
    JPEG fixtures are JFIF units 0, so this is not a corner case. The file HAS
    numbers, so "declares none" would be wrong; no reader can print from them,
    so naming a DPI would be wrong too. This is the sentence true of both.
  */
  const aspectOnly =
    declares !== null && declares.effective === null && declares.fields.length > 0;

  const declaredNote = !declares
    ? null
    : aspectOnly
      ? "This file carries density numbers with no unit attached — an aspect ratio, not a resolution, which no reader can turn into a print size. Setting a DPI here gives it one."
      : declares.effective === null
        ? "This file declares no density at all. Nothing is wrong with it — every reader then falls back to its own assumption, which is exactly why the same picture prints at a different size in different apps."
        : beforePrint
          ? `At the density it declares today it prints ${beforePrint}.`
          : null;

  /*
    The one case the engine deliberately will not fix, said out loud rather
    than silently half-done: putting an XResolution into an EXIF block that has
    none grows IFD0 by twelve bytes and shifts every out-of-line value offset
    in IFD0, the Exif sub-IFD, GPS and IFD1. Writing the other field and
    reporting an unqualified success is the option that is not on the table.
  */
  const exifWarning = declares?.exifWithoutResolution
    ? declares.format === "png"
      ? "This PNG carries an eXIf chunk with no resolution tags of its own, so only the pHYs chunk can be written. Adding a tag to the eXIf means growing that block and relocating every offset inside it, which this tool deliberately does not do — and where both carry a resolution, the eXIf is the one a reader believes."
      : "This JPEG carries an Exif block with no resolution tags of its own, so only the JFIF density can be written. Adding a tag to the Exif means growing that block and relocating every offset inside it, which this tool deliberately does not do — and where both carry a resolution, the Exif is the one a reader believes."
    : null;

  /*
    `pHYs` counts pixels per METRE in whole numbers, so not every DPI survives
    the round trip exactly. `after` is read back out of the written bytes, so
    when the two disagree this shows what was actually stored.
  */
  const roundingNote =
    detail && writtenDpi !== null && writtenDpi !== detail.dpiX
      ? `Stored as ${writtenDpi} DPI: the header counts whole units per metre, and ${detail.dpiX} has no exact form in them.`
      : null;

  /*
    A file can carry TWO resolutions, and where they disagree the reader
    believes the EXIF one — measured on both containers, not assumed
    (`image-dpi.ts:17-31`; the PNG half is `scratchpad/png-exif-probe.mjs`,
    where moving `pHYs` alone left libvips still reporting the old density and
    moving both gave the new one). Writing one of a pair is therefore a silent
    no-op, so the engine writes every resolution field the file already has.

    Derived, not asserted: this reads `wrote`, so a PNG with no `eXIf` chunk —
    the common case — never sees the sentence. `DpiSegmentName` permits at most
    two of these per container, which is why the join needs no serial comma.
  */
  const writtenPhrases = detail
    ? detail.wrote.map((w) => segmentPhrase(w.segment, detail.format))
    : [];
  const bothWrittenNote =
    writtenPhrases.length > 1
      ? `Both ${writtenPhrases.join(" and ")} were written, so no reader can find them disagreeing.`
      : null;

  return (
    <>
      {/* ── Canvas: the picture, unchanged, and what its number means ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={
            pixels
              ? `${pixels.w} × ${pixels.h} · ${formatFileSize(file.size)}`
              : formatFileSize(file.size)
          }
          trailing={`${shownDpi} DPI`}
          trailingTone={detail ? "accent" : "muted"}
        />

        {/* One picture, not a before/after wipe: there is nothing to compare.
            The pixels in this preview are the pixels in the download. */}
        <CanvasStage
          className={cn(STAGE_GROW, "flex min-h-[220px] items-center justify-center")}
        >
          {sourceUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
            <img src={sourceUrl} alt="" className={STAGE_MEDIA} />
          ) : (
            <span className="px-6 text-center font-mono text-[10.5px] leading-[1.6] text-text-muted">
              READING THE HEADER…
            </span>
          )}
        </CanvasStage>

        <StatStrip
          stats={[
            {
              label: "DPI NOW",
              value:
                reading === null
                  ? "—"
                  : declares === null
                    ? "N/A"
                    : (currentLabel ?? (aspectOnly ? "NO UNIT" : "NONE")),
              tone: "neutral",
            },
            { label: "DPI AFTER", value: declares ? `${shownDpi}` : "—" },
            {
              // The fact the whole tool turns on: the pixel count never moves.
              label: "PIXELS",
              value: pixels ? `${pixels.w}×${pixels.h}` : "—",
              tone: "ok",
            },
            {
              label: "PRINTS AT",
              value: (declares && shortPrintSize(pixels, shownDpi)) || "—",
            },
          ]}
        />

        <ErrorMessage message={refusal} />
        {status === "error" && <ErrorMessage message={error} />}
        <WarningMessage message={exifWarning} />
      </div>

      {/* ── Controls: one number, and what it does to the print ── */}
      <ToolAside
        footer={
          <>
            {/* A header rewrite is one pass over the chunk or segment list with
                no intermediate state to report, so the bar stays indeterminate
                rather than inventing a percentage. */}
            {isProcessing && (
              <ToolProgress phase="WRITING HEADER" percent={null} label="Writing DPI header" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel="Set DPI"
                onPrimary={handleRun}
                primaryDisabled={isProcessing || declares === null}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "ANOTHER IMAGE" : "CLEAR"}
            />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="TARGET DPI">
            <ToolChoice
              label="Target DPI"
              fill
              disabled={isProcessing || declares === null}
              value={dpi}
              onChange={handleDpiChange}
              options={DPI_PRESETS.map((value) => ({ value, label: String(value) }))}
            />
            <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
              Custom
              <input
                type="number"
                min={MIN_DPI}
                max={MAX_DPI}
                value={dpi}
                disabled={isProcessing || declares === null}
                onChange={(e) => handleDpiChange(Number(e.target.value))}
                aria-label="Custom DPI"
                className="w-24 rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-right text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </label>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              72 and 96 are what screens and browsers assume, 150 is a draft
              print, 300 is the usual commercial print target, and 600 suits
              line art and scanned text.
            </span>
          </ToolControl>
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              [
                "DPI now",
                reading === null
                  ? "—"
                  : declares === null
                    ? "Not stored by this format"
                    : (currentLabel ?? (aspectOnly ? "No unit declared" : "None declared")),
              ],
              ["DPI after", declares ? `${shownDpi}` : "—"],
              ["Pixels", pixels ? `${pixels.w} × ${pixels.h}` : "—"],
              ["Prints at", (declares && afterPrint) || "—"],
              [
                "Size",
                result ? formatFileSize(result.newSize) : formatFileSize(file.size),
              ],
            ]}
          />
          {declaredNote && (
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {declaredNote}
            </span>
          )}
          {roundingNote && (
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {roundingNote}
            </span>
          )}
        </ToolAsideSection>

        {/* WRITTEN exists only after a run, and every row is read back off
            `wrote` — never off what the tool set out to do. A field that could
            not be written is therefore absent here rather than claimed. */}
        {detail && (
          <ToolAsideSection label="WRITTEN">
            <ToolOutput
              rows={[
                ...detail.wrote.map(
                  (w): [string, string] => [
                    w.segment,
                    w.action === "inserted" ? "Inserted" : "Updated",
                  ],
                ),
                ...(detail.exifWithoutResolution
                  ? ([["EXIF", "No tags to rewrite"]] as [string, string][])
                  : []),
                [
                  "Bytes added",
                  detail.sizeDelta === 0 ? "0 — written in place" : `+${detail.sizeDelta}`,
                ],
                ["Pixel data", "Untouched"],
              ]}
            />
            {bothWrittenNote && (
              <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
                {bothWrittenNote}
              </span>
            )}
          </ToolAsideSection>
        )}

        <ToolAdvanced
          rows={[
            // Both containers name both fields: a PNG that carries an eXIf
            // chunk has its resolution tags rewritten alongside pHYs, because
            // eXIf is the one a reader believes when the two disagree.
            ["PNG", "pHYs CHUNK + eXIf RESOLUTION"],
            ["JPEG", "JFIF APP0 + EXIF RESOLUTION"],
            ["Decode / re-encode", "NEVER"],
            ["ICC, XMP and the rest of EXIF", "LEFT AS THEY WERE"],
            ["WebP", "NO DPI FIELD EXISTS"],
          ]}
        />
      </ToolAside>
    </>
  );
}
