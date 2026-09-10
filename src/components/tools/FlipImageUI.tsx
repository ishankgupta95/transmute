"use client";

import { useCallback, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  defaultFormatFor,
  OutputFormatPicker,
  sourceCanCarryAlpha,
} from "./OutputFormatPicker";
import { editImage } from "@/lib/workers/image-client";
import type { EditOutputFormat, ImageEditJobOptions } from "@/lib/workers/image-protocol";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
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
  CanvasStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";

/*
  flip-image: mirror the pixels across one axis and write a new file.

  THE SAME COUNTER-INTUITIVE FACT AS `rotate-image`, AND IT GOVERNS THE COPY.
  The decoder is handed `imageOrientation: "from-image"` (`image.worker.ts`),
  so a phone photo's EXIF Orientation tag has ALREADY been applied before
  anything here sees pixels — and `imageOrientation: "none"` type-checks but
  does nothing, because the spec defines only "from-image" and "flipY". The
  mirror therefore composes on top of the picture AS DISPLAYED, which is the
  deliberate answer: the preview, the readout and the download all describe
  one picture.

  It also fixes what this page may NOT say. A canvas flip decodes, redraws and
  re-encodes; there is no flag to rewrite the way `rotate-video` rewrites one.
  Nothing below says "lossless", "the raw image" or "the original orientation".

  WHY THE PREVIEW *IS* MIRRORED HERE AND IS NOT TURNED ON `rotate-image`.
  `scaleX(-1)` / `scaleY(-1)` leave the bounding box exactly where it was, so
  the mirrored preview needs no measurement and cannot overflow the stage's
  `overflow-hidden`. A quarter turn swaps the box, which is the reason that
  page shows its source straight and states the turn in numbers instead.
*/

const AXES: readonly { value: "horizontal" | "vertical"; label: string }[] = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
];

/** What each axis actually does to the picture, in words a person uses. */
function axisNote(axis: "horizontal" | "vertical"): string {
  return axis === "horizontal"
    ? "Left and right swap — the mirror-selfie fix, and what turns a right-facing subject into a left-facing one."
    : "Top and bottom swap — the picture is reflected in its own horizon, not turned upside down.";
}

/**
 * The one line the EXIF rule earns. Said before the run, from the settings:
 * it describes the pipeline, so it is true of every run rather than of one
 * result.
 */
const EXIF_NOTE =
  "The mirror is applied to the picture as the canvas shows it. A phone photo's own orientation tag was already read and applied when the file was decoded, so the preview and the download agree.";

/**
 * What the chosen encoder will do to the pixels. Derived from the picker, so
 * it cannot promise losslessness over a JPEG write.
 */
function encodeNote(format: EditOutputFormat): string {
  return format === "png"
    ? "PNG OUTPUT IS A LOSSLESS RE-ENCODE OF THE DECODED PIXELS — NO NEW COMPRESSION ARTEFACTS ARE ADDED, BUT THE ORIGINAL'S EXIF DOES NOT COME THROUGH."
    : `${format.toUpperCase()} OUTPUT RE-ENCODES EVERY PIXEL — THE DOWNLOAD IS ONE COMPRESSION GENERATION FURTHER ON THAN THE FILE YOU DROPPED.`;
}

interface FlipImageUIProps {
  /** `Tool.acceptFormats`, so the zone's list cannot drift from the registry. */
  acceptFormats: string;
}

export function FlipImageUI({ acceptFormats }: FlipImageUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [axis, setAxis] = useState<"horizontal" | "vertical">("horizontal");
  const [format, setFormat] = useState<EditOutputFormat>("png");
  const [quality, setQuality] = useState(0.9);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both URLs are hook-owned, so they are revoked on unmount and on swap.
  const previewUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(result?.blob);
  const sourceDims = useImageDimensions(file);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setFormat(defaultFormatFor(f));
    setResult(null);
    setError(null);
  }, []);

  /**
   * Any settings change drops the result, which flips the footer from the
   * download back to the primary. A stale blob must never sit under fresh
   * settings.
   */
  const handleAxis = useCallback((value: "horizontal" | "vertical") => {
    setAxis(value);
    setResult(null);
  }, []);

  const handleFormat = useCallback((value: EditOutputFormat) => {
    setFormat(value);
    setResult(null);
  }, []);

  const handleQuality = useCallback((value: number) => {
    setQuality(value);
    setResult(null);
  }, []);

  const handleFlip = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    try {
      const options: ImageEditJobOptions = {
        edit: { kind: "flip", axis },
        format,
        quality,
      };
      setResult(await editImage(file, options));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Flip failed");
    }
    setIsProcessing(false);
  }, [file, axis, format, quality]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
  }, []);

  if (!file) {
    return (
      <DropZone accept={acceptFormats} onFiles={handleFiles} label="Upload an image to flip" />
    );
  }

  const stageUrl = resultUrl ?? previewUrl;
  const dimsLabel = sourceDims ? `${sourceDims.w} × ${sourceDims.h}` : "—";
  // A mirror moves no edge, so the CSS preview is exact rather than
  // indicative. Dropped once a real result exists — that file is already
  // mirrored, and transforming it again would show the flip twice.
  const mirror = result ? undefined : axis === "horizontal" ? "scaleX(-1)" : "scaleY(-1)";

  return (
    <>
      {/* ── Canvas: the picture, mirrored live ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(sourceDims, formatFileSize(file.size))}
          trailing={result ? "FLIPPED" : axis.toUpperCase()}
        />

        <CanvasStage
          className={cn(STAGE_GROW, "flex items-center justify-center bg-[#0c0e17] p-4")}
        >
          {stageUrl && (
            /* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */
            <img
              src={stageUrl}
              alt={result ? "Flipped image" : "Source image, previewed with the flip applied"}
              className={STAGE_MEDIA}
              style={mirror ? { transform: mirror } : undefined}
            />
          )}
          <span className="absolute top-3 right-3.5 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-accent-300">
            {result ? "FLIPPED" : `${axis.toUpperCase()} PREVIEW`}
          </span>
        </CanvasStage>

        <StatStrip
          stats={[
            { label: "AXIS", value: axis.toUpperCase(), tone: "neutral" },
            { label: "DIMENSIONS", value: sourceDims ? `${sourceDims.w}×${sourceDims.h}` : "—" },
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            {
              label: "OUT",
              value: result ? formatFileSize(result.newSize) : "—",
              tone: result ? "ok" : "accent",
            },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {/* Engine notices ride on the result, so they clear with it. */}
        {(result?.warnings ?? []).map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}

        <CanvasFootnote>{encodeNote(format)}</CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {isProcessing && (
              // One draw, one encode, no progress to report — so the bar stays
              // indeterminate rather than inventing a number.
              <ToolProgress phase="FLIPPING" percent={null} label="Flipping image" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel="Flip"
                onPrimary={handleFlip}
                primaryDisabled={isProcessing}
              />
            )}
            <ToolResetLink onClick={handleReset} label={result ? "FLIP ANOTHER" : "CLEAR"} />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="AXIS">
            <ToolChoice
              label="Flip axis"
              fill
              disabled={isProcessing}
              value={axis}
              onChange={handleAxis}
              options={AXES}
            />
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {axisNote(axis)}
            </span>
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              {EXIF_NOTE}
            </span>
          </ToolControl>

          {/* The picker brings its own `ToolControl label="FORMAT"` and its own
              quality slider, so it goes straight into the group unwrapped —
              wrapping it would draw the heading twice. `alphaWarning` is the
              SOURCE half of the question; the picker owns the "is JPG
              selected" half. */}
          <OutputFormatPicker
            value={format}
            onChange={handleFormat}
            quality={quality}
            onQualityChange={handleQuality}
            disabled={isProcessing}
            alphaWarning={sourceCanCarryAlpha(file)}
          />
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          {/* `ToolOutput` accents its SECOND row, so the measured output sits
              there. A mirror changes no dimension, which is why one row covers
              both sides of the run. */}
          <ToolOutput
            rows={[
              ["Format", format.toUpperCase()],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              ["Dimensions", dimsLabel],
              ["In", formatFileSize(file.size)],
            ]}
          />
        </ToolAsideSection>

        {/* Engine facts, stated only where true. */}
        <ToolAdvanced
          rows={[
            ["EXIF orientation", "APPLIED BEFORE THE FLIP"],
            ["EXIF + GPS", "STRIPPED"],
            ["Colour space", "sRGB"],
            ["Transparency", format === "jpeg" ? "WHITE FILL" : "PRESERVED"],
          ]}
        />
      </ToolAside>
    </>
  );
}
