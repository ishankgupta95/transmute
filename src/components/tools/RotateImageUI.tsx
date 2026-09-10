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
import { MAX_CANVAS_DIMENSION, editOutputPlan } from "@/lib/tools/image-edit-core";
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
  rotate-image: turn the pixels a quarter, a half, or three quarters and write
  a new file.

  THE ONE COUNTER-INTUITIVE FACT, AND THE REASON THE COPY READS AS IT DOES.
  The decoder is handed `imageOrientation: "from-image"` (`image.worker.ts`),
  so a phone photo's EXIF Orientation tag has ALREADY been applied by the time
  anything here sees pixels — and `imageOrientation: "none"` type-checks but
  does nothing, because the spec defines only "from-image" and "flipY". So the
  turn the user asks for composes on top of the picture AS DISPLAYED. That is
  the deliberate answer, not a limitation: the preview, the `4032 × 3024`
  readout and the download all describe the same picture, which is the only
  arrangement a person can check.

  It also fixes what this page may NOT say. This is not a lossless rotation —
  `rotate-video`'s trick (rewrite a flag, copy every byte) has no equivalent
  here, because a canvas rotate decodes, redraws and re-encodes. A genuinely
  lossless JPEG turn is an EXIF-tag rewrite (`lib/tools/jpeg-orientation.ts`)
  and it is a different tool. Nothing below says "lossless rotation", "the raw
  image" or "the original orientation".

  WHY THE PREVIEW IS NOT CSS-TURNED BEFORE THE RUN. A quarter turn swaps the
  bounding box, and the stage's height is only definite at `xl` — faking the
  turn would either clip the picture inside `CanvasStage`'s `overflow-hidden`
  or letterbox it against a box that does not exist yet. So the canvas shows
  the source until there is a real result, and the turn is stated as the badge
  plus the dimension arithmetic, which the user can check against the download.
  `RotateVideoUI` reaches the same place from the opposite direction.
*/

/** Clockwise, because that is what "rotate right" means to a person. */
const ROTATIONS: readonly { value: 90 | 180 | 270; label: string }[] = [
  { value: 90, label: "90° right" },
  { value: 180, label: "180°" },
  { value: 270, label: "90° left" },
];

/**
 * The one line the EXIF rule earns. Said before the run, from the settings —
 * it describes the pipeline, which is true of every run, not of one result.
 */
const EXIF_NOTE =
  "The turn is applied to the picture as the canvas shows it. A phone photo's own orientation tag was already read and applied when the file was decoded, so the preview and the download agree.";

/** How an angle reads in a stat cell. */
function turnLabel(degrees: number): string {
  return degrees === 180 ? "180°" : degrees === 90 ? "90° RIGHT" : "90° LEFT";
}

/**
 * What the chosen encoder will do to the pixels. Derived from the picker, so
 * it cannot promise losslessness over a JPEG write.
 */
function encodeNote(format: EditOutputFormat): string {
  return format === "png"
    ? "PNG OUTPUT IS A LOSSLESS RE-ENCODE OF THE DECODED PIXELS — NO NEW COMPRESSION ARTEFACTS ARE ADDED, BUT THE ORIGINAL'S EXIF DOES NOT COME THROUGH."
    : `${format.toUpperCase()} OUTPUT RE-ENCODES EVERY PIXEL — THE DOWNLOAD IS ONE COMPRESSION GENERATION FURTHER ON THAN THE FILE YOU DROPPED.`;
}

interface RotateImageUIProps {
  /** `Tool.acceptFormats`, so the zone's list cannot drift from the registry. */
  acceptFormats: string;
}

export function RotateImageUI({ acceptFormats }: RotateImageUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [degrees, setDegrees] = useState<90 | 180 | 270>(90);
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
   * download back to the primary. The repo's invariant: a stale blob must
   * never sit under fresh settings.
   */
  const handleDegrees = useCallback((value: 90 | 180 | 270) => {
    setDegrees(value);
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

  const handleRotate = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    try {
      const options: ImageEditJobOptions = {
        edit: { kind: "rotate", degrees },
        format,
        quality,
      };
      setResult(await editImage(file, options));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotate failed");
    }
    setIsProcessing(false);
  }, [file, degrees, format, quality]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
  }, []);

  if (!file) {
    return (
      <DropZone accept={acceptFormats} onFiles={handleFiles} label="Upload an image to rotate" />
    );
  }

  /*
    A quarter turn swaps the sides; a half turn does not. Stated before the run
    so the arithmetic is checkable against the file that comes back — which is
    exactly why it is READ OFF THE PLANNER rather than transposed here.

    `editOutputPlan` is the function the worker and the main-thread mirror both
    size their canvases from, and above `MAX_CANVAS_DIMENSION` it scales the
    whole frame down. A transpose written out here disagreed with it on real
    camera files: a 9504 × 6336 frame turned 90° was printed as 6336 × 9504
    while the download was 5461 × 8192, with the engine's own warning three
    elements away naming the smaller number.
  */
  const plan = sourceDims
    ? editOutputPlan(sourceDims.w, sourceDims.h, { kind: "rotate", degrees })[0]
    : null;
  const outDimsLabel = plan ? `${plan.width} × ${plan.height}` : "—";
  const stageUrl = resultUrl ?? previewUrl;

  return (
    <>
      {/* ── Canvas: the picture, and the turn it is about to take ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(sourceDims, formatFileSize(file.size))}
          trailing={result ? "ROTATED" : turnLabel(degrees)}
        />

        <CanvasStage
          className={cn(STAGE_GROW, "flex items-center justify-center bg-[#0c0e17] p-4")}
        >
          {/* Until there is a result this is the SOURCE, unturned and labelled
              as such — see the header comment for why it is not faked. */}
          {stageUrl && (
            /* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */
            <img
              src={stageUrl}
              alt={result ? "Rotated image" : "Source image, before the turn"}
              className={STAGE_MEDIA}
            />
          )}
          <span className="absolute top-3 right-3.5 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-accent-300">
            {result ? "ROTATED" : `WILL TURN ${turnLabel(degrees)}`}
          </span>
        </CanvasStage>

        <StatStrip
          stats={[
            {
              label: "SOURCE",
              value: sourceDims ? `${sourceDims.w}×${sourceDims.h}` : "—",
              tone: "neutral",
            },
            { label: "AFTER", value: plan ? `${plan.width}×${plan.height}` : "—" },
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            {
              label: "OUT",
              value: result ? formatFileSize(result.newSize) : "—",
              tone: result ? "ok" : "accent",
            },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {/* Engine notices ride on the result, so they clear with it — the same
            lifecycle the download button follows. */}
        {(result?.warnings ?? []).map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}

        {/* The ceiling, disclosed BEFORE the run from the plan's own flag. The
            engine says the same thing afterwards on the result; saying it only
            then would leave the AFTER cell unexplained until the download
            existed, which is the half of this the user cannot check. */}
        {plan?.scaled && !result && (
          <CanvasFootnote>
            {`A BROWSER CANVAS CANNOT HOLD AN EDGE LONGER THAN ${MAX_CANVAS_DIMENSION} PIXELS, SO THE TURNED PICTURE IS REDUCED WHOLE TO ${plan.width} × ${plan.height} RATHER THAN SQUASHED`}
          </CanvasFootnote>
        )}

        <CanvasFootnote>{encodeNote(format)}</CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {isProcessing && (
              // The canvas turn reports no progress: one draw, one encode. A
              // percentage here would be invented.
              <ToolProgress phase="ROTATING" percent={null} label="Rotating image" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel="Rotate"
                onPrimary={handleRotate}
                primaryDisabled={isProcessing}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "ROTATE ANOTHER" : "CLEAR"}
            />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="ROTATION">
            <ToolChoice
              label="Rotation"
              fill
              disabled={isProcessing}
              value={degrees}
              onChange={handleDegrees}
              options={ROTATIONS}
            />
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
              there — the doc highlights what comes out. */}
          <ToolOutput
            rows={[
              ["Format", format.toUpperCase()],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              ["Dimensions", outDimsLabel],
              ["In", formatFileSize(file.size)],
            ]}
          />
        </ToolAsideSection>

        {/* Engine facts, stated only where true. */}
        <ToolAdvanced
          rows={[
            ["EXIF orientation", "APPLIED BEFORE THE TURN"],
            ["EXIF + GPS", "STRIPPED"],
            ["Colour space", "sRGB"],
            ["Transparency", format === "jpeg" ? "WHITE FILL" : "PRESERVED"],
          ]}
        />
      </ToolAside>
    </>
  );
}
