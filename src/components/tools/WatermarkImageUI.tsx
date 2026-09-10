"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { OutputFormatPicker } from "./OutputFormatPicker";
import { drawEdit, editOutputSize, needsOpaqueFill } from "@/lib/tools/image-edit-core";
import { fillBackground, imageHasTransparency } from "@/lib/tools/canvas-utils";
import { editImage } from "@/lib/workers/image-client";
import type { EditOutputFormat, ImageEditOptions } from "@/lib/workers/image-protocol";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";
import { CANVAS_COLUMN, STAGE_GROW } from "@/components/workspace/shared";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolChoice,
  ToolOutput,
  ToolResetLink,
  ToolSlider,
} from "@/components/tools/ToolAside";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  StatStrip,
} from "@/components/tools/ToolCanvas";

/** The positions the engine accepts, taken from the protocol rather than retyped. */
type WatermarkPosition = Extract<ImageEditOptions, { kind: "watermark" }>["position"];

const POSITIONS: readonly { value: WatermarkPosition; label: string }[] = [
  { value: "bottom-right", label: "Bottom right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "top-right", label: "Top right" },
  { value: "top-left", label: "Top left" },
  { value: "center", label: "Centre" },
  { value: "tile", label: "Tiled" },
];

const FIELD_CLASS =
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * The sentence this tool exists to keep honest.
 *
 * A watermark drawn into the pixels is an attribution mark and a nuisance to
 * remove. It is not access control and it does not follow the file — the same
 * distinction `crop-image`'s FAQ draws about transparent corners, applied to a
 * claim people actually act on.
 */
const NOT_DRM_NOTE =
  "The text is painted into the pixels, so it survives re-saving, screenshots and a format change. " +
  "It is not protection: anyone can crop it off, clone it out or paint over it, and nothing here " +
  "stops a copy being made. Treat it as a visible credit. Tiling puts the text over the subject " +
  "itself, which is the only version that is genuinely awkward to remove.";

/** The decoded source, plus the one thing about it the format picker needs. */
interface PreviewSource {
  img: HTMLImageElement;
  hasAlpha: boolean;
}

interface WatermarkImageUIProps {
  acceptFormats: string;
}

export function WatermarkImageUI({ acceptFormats }: WatermarkImageUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [text, setText] = useState("© YOUR NAME");
  const [position, setPosition] = useState<WatermarkPosition>("bottom-right");
  const [opacity, setOpacity] = useState(0.35);
  const [scale, setScale] = useState(0.06);
  const [rotationDeg, setRotationDeg] = useState(0);
  const [colour, setColour] = useState("#ffffff");
  const [format, setFormat] = useState<EditOutputFormat>("png");
  const [quality, setQuality] = useState(0.9);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  /**
   * Every control funnels a `stale()` in front of its setter. Changing a
   * setting drops the finished blob, which swaps Download back to Apply — so
   * the Download button can never hand over a file built from settings the
   * rail has stopped showing. `ImageResizerUI` states the same invariant at
   * each of its own setters.
   */
  const stale = useCallback(() => setResult(null), []);

  const handleFiles = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    setFile(f);
    setSource(null);
    setResult(null);
    setError(null);
  }, []);

  // The preview is drawn from a main-thread decode. An <img> applies the
  // file's own EXIF orientation, which is exactly what the worker asks the
  // decoder for (`imageOrientation: "from-image"`), so the picture being
  // watermarked here is the picture that gets watermarked in the download —
  // and "bottom right" means the same corner in both.
  useEffect(() => {
    if (!file) return;
    let live = true;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (live) setSource({ img, hasAlpha: imageHasTransparency(img) });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      if (live) setError("Could not read this image. Try a different file.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const edit = useMemo<ImageEditOptions>(
    () => ({ kind: "watermark", text, scale, opacity, colour, position, rotationDeg }),
    [text, scale, opacity, colour, position, rotationDeg],
  );

  // The live preview runs the SAME `drawEdit` the engine runs, at the same
  // output size, with the same opaque fill decision. It is a redraw of the
  // result, not a second drawing routine that could drift away from it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    const { width, height } = editOutputSize(
      source.img.naturalWidth,
      source.img.naturalHeight,
      edit,
    );
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    // No 2D context: a headless DOM, or a tab that has run out of canvas
    // memory. The rail still reports everything it knows; only the picture
    // is missing.
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (needsOpaqueFill(format)) fillBackground(ctx, width, height);
    drawEdit(ctx, source.img, edit, 0);
  }, [source, edit, format]);

  const handleApply = useCallback(async () => {
    if (!file || !text.trim()) return;
    setIsProcessing(true);
    setError(null);
    try {
      setResult(await editImage(file, { edit, format, quality }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Watermarking failed");
    }
    setIsProcessing(false);
  }, [file, edit, format, quality, text]);

  const handleReset = useCallback(() => {
    setFile(null);
    setSource(null);
    setResult(null);
    setError(null);
  }, []);

  if (!file) {
    return (
      <DropZone
        accept={acceptFormats}
        onFiles={handleFiles}
        label="Upload an image to watermark"
      />
    );
  }

  const dims = source ? { w: source.img.naturalWidth, h: source.img.naturalHeight } : null;
  const sizeLabel = formatFileSize(file.size);
  const positionLabel =
    POSITIONS.find((p) => p.value === position)?.label ?? position;
  // JPEG has no alpha channel, so a source that carries one is flattened onto
  // white before anything is drawn. Probed off the decoded image rather than
  // guessed from the extension.
  const flattensAlpha = needsOpaqueFill(format) && Boolean(source?.hasAlpha);

  return (
    <>
      {/* ── Canvas: the live watermark preview, then the numbers ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={dims ? `${dims.w} × ${dims.h} · ${sizeLabel}` : sizeLabel}
          trailing={positionLabel.toUpperCase()}
        />

        <CanvasStage
          className={cn(STAGE_GROW, "flex items-center justify-center bg-[#0c0e17] p-4")}
        >
          <canvas
            ref={canvasRef}
            aria-label="Watermark preview"
            className="block max-h-full max-w-full"
          />
        </CanvasStage>

        <CanvasFootnote>
          THE PREVIEW REDRAWS AS YOU TYPE — APPLY ENCODES THE FILE
        </CanvasFootnote>

        <StatStrip
          stats={[
            { label: "SOURCE", value: dims ? `${dims.w}×${dims.h}` : "—", tone: "neutral" },
            { label: "MARK", value: `${Math.round(scale * 100)}%` },
            { label: "OPACITY", value: `${Math.round(opacity * 100)}%` },
            {
              label: "OUT",
              value: result ? formatFileSize(result.newSize) : "—",
              tone: result ? "ok" : "accent",
            },
          ]}
        />

        {error && <ErrorMessage message={error} />}

        {/* Warnings ride on the result, so they clear with it on any option
            change — the same lifecycle the download button follows. */}
        {(result?.warnings ?? []).map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}
      </div>

      <ToolAside
        footer={
          <>
            {/* The canvas draw and encode report no progress, so the bar stays
                indeterminate rather than inventing a number. */}
            {isProcessing && (
              <ToolProgress phase="WATERMARKING" percent={null} label="Applying watermark" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={isProcessing ? "Applying…" : "Apply watermark"}
                onPrimary={handleApply}
                primaryDisabled={isProcessing || !text.trim()}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "WATERMARK ANOTHER" : "CLEAR"}
            />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="TEXT">
            <input
              type="text"
              value={text}
              onChange={(e) => {
                stale();
                setText(e.target.value);
              }}
              aria-label="Watermark text"
              placeholder="© Your Name"
              disabled={isProcessing}
              className={FIELD_CLASS}
            />
          </ToolControl>

          <ToolControl label="POSITION">
            <ToolChoice
              label="Watermark position"
              disabled={isProcessing}
              value={position}
              onChange={(v: WatermarkPosition) => {
                stale();
                setPosition(v);
              }}
              options={POSITIONS}
            />
          </ToolControl>

          <ToolControl>
            <ToolSlider
              label="Size"
              display={`${Math.round(scale * 100)}%`}
              hint="Share of the shorter edge, so the mark keeps its proportions whatever the image measures."
              min={0.02}
              max={0.3}
              step={0.005}
              value={scale}
              onChange={(v) => {
                stale();
                setScale(v);
              }}
              disabled={isProcessing}
            />
          </ToolControl>

          <ToolControl>
            <ToolSlider
              label="Opacity"
              display={`${Math.round(opacity * 100)}%`}
              min={0.05}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(v) => {
                stale();
                setOpacity(v);
              }}
              disabled={isProcessing}
            />
          </ToolControl>

          <ToolControl>
            <ToolSlider
              label="Rotation"
              display={`${rotationDeg}°`}
              min={-90}
              max={90}
              step={1}
              value={rotationDeg}
              onChange={(v) => {
                stale();
                setRotationDeg(v);
              }}
              disabled={isProcessing}
            />
          </ToolControl>

          <ToolControl>
            <label className="flex items-center justify-between gap-3 font-body text-[12.5px] text-neutral-300">
              Colour
              <input
                type="color"
                value={colour}
                onChange={(e) => {
                  stale();
                  setColour(e.target.value);
                }}
                aria-label="Watermark colour"
                disabled={isProcessing}
                className="size-8 cursor-pointer rounded-sm border border-border"
              />
            </label>
          </ToolControl>

          {/* `OutputFormatPicker` renders loose `ToolControl`s of its own, so
              it goes straight into the group — a wrapper would draw the format
              chips inside the quality control's box. */}
          <OutputFormatPicker
            value={format}
            onChange={(v) => {
              stale();
              setFormat(v);
            }}
            quality={quality}
            onQualityChange={(q) => {
              stale();
              setQuality(q);
            }}
            disabled={isProcessing}
            alphaWarning={flattensAlpha}
          />
        </ToolControlGroup>

        <ToolAsideSection label="A WATERMARK IS NOT DRM">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {NOT_DRM_NOTE}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          {/* `ToolOutput` accents its SECOND row, so the measured output size
              sits there. */}
          <ToolOutput
            rows={[
              ["Format", format.toUpperCase()],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              ["Position", positionLabel],
              ["In", sizeLabel],
            ]}
          />
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Watermark", "DRAWN INTO THE PIXELS"],
            ["EXIF + GPS", "STRIPPED"],
            ["Transparency", needsOpaqueFill(format) ? "WHITE FILL" : "PRESERVED"],
          ]}
        />
      </ToolAside>
    </>
  );
}
