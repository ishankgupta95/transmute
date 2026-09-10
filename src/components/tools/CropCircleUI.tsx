"use client";

import { useCallback, useMemo, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { OutputFormatPicker } from "@/components/tools/OutputFormatPicker";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  ColorStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN } from "@/components/workspace/shared";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { editImage } from "@/lib/workers/image-client";
import type { EditOutputFormat } from "@/lib/workers/image-protocol";

/*
  Crop a circle out of a picture.

  The whole tool turns on one fact: PNG and WebP carry an alpha channel and
  JPEG does not (`canvas-utils.ts:34` `mimeSupportsAlpha` lists exactly those
  two). A "circle" written as JPEG is a circle painted on a white square —
  which is not what anyone means by the word — so the format picker is handed
  the alpha-capable pair and never offers the third chip. The page says so
  rather than leaving the missing chip to be noticed.

  The second fact worth stating out loud is that the FILE is still a
  rectangle. Every raster format is. The corners are transparent, not absent,
  and a user who drops the result on a coloured background and sees a square
  is looking at their own viewer, not at a bug here.
*/

/** The corners come out transparent, so only the alpha-capable pair is offered. */
const ALPHA_FORMATS: readonly EditOutputFormat[] = ["png", "webp"];

/** The square the circle is inscribed in, in SOURCE pixels. */
interface CircleRect {
  x: number;
  y: number;
  /** Width and height both — a circle's bounding box is square by definition. */
  size: number;
}

/**
 * Resolve the three percentage controls into source pixels.
 *
 * `diameterPct` is measured against the SHORTER edge, so 100% is the largest
 * circle the picture can hold whichever way round it is. The two position
 * controls then run over the SLACK that is left — `w - size` and `h - size` —
 * rather than over the full edge, so the circle can never be asked to sit
 * half outside the picture and no value ever has to be silently clamped back.
 * On the axis where the circle already spans the edge the slack is 0 and the
 * position control is inert; the UI disables it rather than letting it move a
 * readout that cannot change.
 */
export function circleRect(
  width: number,
  height: number,
  diameterPct: number,
  hPct: number,
  vPct: number,
): CircleRect {
  const size = Math.max(1, Math.round((Math.min(width, height) * diameterPct) / 100));
  return {
    x: Math.round((Math.max(0, width - size) * hPct) / 100),
    y: Math.round((Math.max(0, height - size) * vPct) / 100),
    size,
  };
}

interface CropCircleUIProps {
  acceptFormats: string;
}

export function CropCircleUI({ acceptFormats }: CropCircleUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [diameterPct, setDiameterPct] = useState(100);
  const [hPct, setHPct] = useState(50);
  const [vPct, setVPct] = useState(50);
  const [format, setFormat] = useState<EditOutputFormat>("png");
  const [quality, setQuality] = useState(0.9);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both hook-owned: revoked on unmount and on every swap, which a
  // createObjectURL in a handler never was.
  const previewUrl = useObjectUrl(file);
  const resultUrl = useObjectUrl(result?.blob);
  const dims = useImageDimensions(file);

  const rect = useMemo(
    () => (dims ? circleRect(dims.w, dims.h, diameterPct, hPct, vPct) : null),
    [dims, diameterPct, hPct, vPct],
  );

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError(null);
    setDiameterPct(100);
    setHPct(50);
    setVPct(50);
  }, []);

  /** Any change to the circle invalidates the blob the download holds. */
  const change = useCallback((apply: () => void) => {
    setResult(null);
    apply();
  }, []);

  const handleCrop = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    try {
      const output = await editImage(file, {
        /*
          `region: null` asks the engine for the largest inscribed circle. It
          is used only when the pixel size could not be read — with dimensions
          in hand the UI sends the rect it is DRAWING on the canvas, so the
          ring the user positioned and the pixels that come back are computed
          from the same three numbers rather than from two implementations
          that agree until one of them rounds differently.
        */
        edit: {
          kind: "crop-circle",
          region: rect ? { x: rect.x, y: rect.y, width: rect.size, height: rect.size } : null,
        },
        format,
        quality,
      });
      setResult(output);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop this image");
    }
    setIsProcessing(false);
  }, [file, rect, format, quality]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
  }, []);

  if (!file) {
    return (
      <DropZone accept={acceptFormats} onFiles={handleFiles} label="Upload an image to crop into a circle" />
    );
  }

  const slackX = dims && rect ? dims.w - rect.size : 0;
  const slackY = dims && rect ? dims.h - rect.size : 0;

  return (
    <>
      {/* ── Canvas: the ring you positioned, then the picture it cut ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(dims, formatFileSize(file.size))}
          trailing={rect ? `${rect.size} × ${rect.size}` : "CIRCLE"}
        />

        {/*
          The checkerboard is switched on only for the RESULT. Behind the
          source it would be a lie about a picture that has no transparency
          yet; behind the output it is the only way to see that the corners
          really are empty rather than white.
        */}
        <ColorStage
          checkered={Boolean(result)}
          caption={result ? "transparent corners, shown over a checkerboard" : "the ring is what gets kept"}
        >
          {result
            ? resultUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
                <img src={resultUrl} alt="The circular crop" className="max-h-full max-w-full object-contain" />
              )
            : previewUrl && (
                /*
                  The overlay is positioned in PERCENTAGES of this box, so the
                  box has to be exactly the rendered picture and nothing more.
                  `h-full` + the source's own aspect ratio + `max-w-full` is
                  the letterbox: height fills the stage, width follows the
                  ratio, and a wide picture hits the width cap which feeds back
                  through `aspect-ratio` to shrink the height. The <img> then
                  fills that box exactly, so 30% across the box is 30% across
                  the picture.
                */
                <div
                  className="relative h-full w-auto max-h-full max-w-full"
                  style={dims ? { aspectRatio: `${dims.w} / ${dims.h}` } : undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */}
                  <img src={previewUrl} alt="Crop preview" className="block size-full object-contain" />
                  {dims && rect && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute rounded-full border-2 border-accent shadow-[0_0_0_9999px_rgba(12,14,23,.55)]"
                      style={{
                        left: `${(rect.x / dims.w) * 100}%`,
                        top: `${(rect.y / dims.h) * 100}%`,
                        width: `${(rect.size / dims.w) * 100}%`,
                        height: `${(rect.size / dims.h) * 100}%`,
                      }}
                    />
                  )}
                </div>
              )}
        </ColorStage>

        <StatStrip
          stats={[
            { label: "SOURCE", value: dims ? `${dims.w}×${dims.h}` : "—", tone: "neutral" },
            { label: "CIRCLE", value: rect ? `${rect.size} PX` : "—" },
            { label: "IN", value: formatFileSize(file.size), tone: "neutral" },
            { label: "OUT", value: result ? formatFileSize(result.newSize) : "—", tone: "ok" },
          ]}
        />

        {/*
          Two standing sentences, both about things the output IS rather than
          about anything that went wrong. The first is the reason a chip is
          missing; the second is the reason the saved file still looks square
          in a file browser.
        */}
        <CanvasFootnote>
          NO JPG HERE — JPEG HAS NO ALPHA CHANNEL, SO A CIRCLE SAVED AS JPEG IS A CIRCLE ON A
          WHITE SQUARE
        </CanvasFootnote>
        <CanvasFootnote>
          THE FILE IS STILL A SQUARE — THE CORNERS ARE TRANSPARENT, NOT ABSENT, BECAUSE EVERY IMAGE
          FORMAT IS A RECTANGLE
        </CanvasFootnote>

        {error && <ErrorMessage message={error} />}

        {/* Warnings live on the result, so they clear with it on any change. */}
        {(result?.warnings ?? []).map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {isProcessing && (
              <ToolProgress phase="CROPPING" percent={null} label="Cropping the circle" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={isProcessing ? "Cropping…" : "Crop circle"}
                onPrimary={handleCrop}
                primaryDisabled={isProcessing}
              />
            )}
            {result && <ToolResetLink onClick={handleCrop} label="CROP AGAIN" />}
            <ToolResetLink onClick={handleReset} label={result ? "CROP ANOTHER" : "CLEAR"} />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="CIRCLE">
            <ToolSlider
              label="Diameter"
              display={rect ? `${rect.size} px` : `${diameterPct}%`}
              hint="Measured against the shorter edge, so 100% is the biggest circle this picture can hold."
              min={10}
              max={100}
              step={1}
              value={diameterPct}
              onChange={(v) => change(() => setDiameterPct(v))}
              disabled={isProcessing}
            />
          </ToolControl>

          <ToolControl label="POSITION">
            <ToolSlider
              label="Horizontal"
              display={rect ? `${rect.x} px from the left` : `${hPct}%`}
              min={0}
              max={100}
              step={1}
              value={hPct}
              onChange={(v) => change(() => setHPct(v))}
              // Inert rather than misleading: with no slack on this axis the
              // circle already spans the edge and the readout cannot move.
              disabled={isProcessing || slackX === 0}
            />
            <ToolSlider
              label="Vertical"
              display={rect ? `${rect.y} px from the top` : `${vPct}%`}
              hint={
                slackX === 0 || slackY === 0
                  ? "The circle already spans the shorter edge, so it can only move along the longer one. Reduce the diameter to move it the other way."
                  : undefined
              }
              min={0}
              max={100}
              step={1}
              value={vPct}
              onChange={(v) => change(() => setVPct(v))}
              disabled={isProcessing || slackY === 0}
            />
          </ToolControl>

          <OutputFormatPicker
            value={format}
            onChange={(v) => change(() => setFormat(v))}
            formats={ALPHA_FORMATS}
            quality={quality}
            onQualityChange={(q) => change(() => setQuality(q))}
            disabled={isProcessing}
          />
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          {/* `ToolOutput` accents its SECOND row, so the measured size sits there. */}
          <ToolOutput
            rows={[
              ["Format", format === "jpeg" ? "JPG" : format.toUpperCase()],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              ["Canvas", rect ? `${rect.size} × ${rect.size}` : "—"],
              ["In", formatFileSize(file.size)],
            ]}
          />
        </ToolAsideSection>

        {/* Engine facts, stated only where true. */}
        <ToolAdvanced
          rows={[
            ["Outside the circle", "TRANSPARENT"],
            ["Output canvas", "SQUARE"],
            ["EXIF + GPS", "STRIPPED"],
          ]}
        />
      </ToolAside>
    </>
  );
}
