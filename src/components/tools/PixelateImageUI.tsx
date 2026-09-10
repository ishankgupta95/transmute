"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import { OutputFormatPicker } from "./OutputFormatPicker";
import {
  drawEdit,
  editDestRect,
  editOutputSize,
  needsOpaqueFill,
  MAX_PIXELATE_BLOCK,
  MIN_PIXELATE_BLOCK,
} from "@/lib/tools/image-edit-core";
import { fillBackground, imageHasTransparency } from "@/lib/tools/canvas-utils";
import { editImage } from "@/lib/workers/image-client";
import type {
  EditOutputFormat,
  EditRect,
  ImageEditOptions,
} from "@/lib/workers/image-protocol";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { cn } from "@/lib/utils/cn";
import { CANVAS_COLUMN, STAGE_GROW } from "@/components/workspace/shared";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
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

/**
 * The smallest drag that counts as choosing a region, in NATURAL pixels.
 *
 * Anything under it — a tap, a twitch while clicking — is read as "no region",
 * which this tool takes to mean the whole image. That is the only way back to
 * the whole image from the canvas, so it has to be reachable by accident-proof
 * means too: the WHOLE IMAGE button in the rail does the same thing.
 */
const MIN_DRAG_PX = 4;

/*
  `border-neutral-600`, not `border-border`. These four fields are the only
  keyboard path to the region, and their border is the only thing that draws
  them: the fill (`bg-bg-elevated`, #232532) is 1.17:1 against the rail, so
  without a visible edge there is no field. `--color-border`
  (`#e9e9ed` at 16%) resolves to 1.55:1 against the rail and fails WCAG 1.4.11
  (3:1 for user-interface components). `#75798c` (neutral-600) measures 4.12:1
  against the rail and 3.52:1 against the field's own fill.

  The decorative `--color-border` token itself is deliberately left alone — it
  is right for the dozens of quiet hairlines it also draws. Only the
  INTERACTIVE boundary is raised.
*/
const NUMBER_FIELD_CLASS =
  "w-full rounded-md border border-neutral-600 bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-45";

/**
 * The claim this tool is most likely to be believed about, and must not be.
 *
 * The blocks really do replace the pixels in the output — there is no hidden
 * layer to peel off. That is a fact about the FILE, and it is routinely
 * mistaken for a fact about the CONTENT, which it is not: a pixelated region
 * whose original is drawn from a small known set can be matched by re-rendering
 * the candidates at the same block size. Saying so is the whole reason this
 * paragraph is on screen rather than in a FAQ nobody opens.
 */
const NOT_REDACTION_NOTE =
  "The blocks are baked into the file you download — the detail underneath is gone, not hidden " +
  "behind a layer someone can peel off. That still is not a security control. When what was " +
  "covered comes from a small, known set — a six-digit code, a number plate, a date — every " +
  "candidate can be re-rendered at the same block size and matched against these blocks, and " +
  "pixelation has been undone that way before. Anything that has to stay secret should be cropped " +
  "out or covered with a solid shape, not pixelated.";

/** The decoded source, plus the one thing about it the format picker needs. */
interface PreviewSource {
  img: HTMLImageElement;
  hasAlpha: boolean;
}

interface Point {
  x: number;
  y: number;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Pull a rectangle back inside the image and round it to whole pixels.
 *
 * The rectangle lives in NATURAL image pixels everywhere in this file: in
 * state, in the four number fields, in the readout, and in the options handed
 * to the engine. `pointToNatural` is the ONLY conversion, and it converts INTO
 * that space. Going the other way is the bug `src/lib/tools/image-crop.ts`
 * records at length — a selection measured against the on-screen canvas but
 * reported in unrotated natural pixels cut a region the user had not chosen,
 * and the output still looked like a plausible crop, so nothing caught it.
 */
function normaliseRegion(rect: EditRect, imageW: number, imageH: number): EditRect {
  const x = clampInt(rect.x, 0, Math.max(0, imageW - 1));
  const y = clampInt(rect.y, 0, Math.max(0, imageH - 1));
  return {
    x,
    y,
    width: clampInt(rect.width, 1, imageW - x),
    height: clampInt(rect.height, 1, imageH - y),
  };
}

function rectBetween(a: Point, b: Point): EditRect {
  const x = Math.round(Math.min(a.x, b.x));
  const y = Math.round(Math.min(a.y, b.y));
  return {
    x,
    y,
    width: Math.round(Math.max(a.x, b.x)) - x,
    height: Math.round(Math.max(a.y, b.y)) - y,
  };
}

interface PixelateImageUIProps {
  acceptFormats: string;
}

export function PixelateImageUI({ acceptFormats }: PixelateImageUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<PreviewSource | null>(null);
  const [region, setRegion] = useState<EditRect | null>(null);
  const [blockSize, setBlockSize] = useState(16);
  const [format, setFormat] = useState<EditOutputFormat>("png");
  const [quality, setQuality] = useState(0.9);
  const [result, setResult] = useState<ProcessedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * Which run owns the panel. Dropping the blob is not enough on its own: the
   * run is async and `ToolActions` binds ⌘↵ on the WINDOW (ToolAside.tsx), so
   * a run can be started mid-drag and resolve AFTER the region has moved — at
   * which point its `setResult` puts the Download button back over a rectangle
   * nobody chose. The token is how the completion learns it was superseded,
   * the same shape CompressPngUI uses for a swapped file.
   */
  const runToken = useRef(0);
  /** The token of the newest run that actually STARTED — see the `finally`. */
  const latestRun = useRef(0);

  /**
   * Every control funnels a `stale()` in front of its setter: changing a
   * setting drops the finished blob, which swaps Download back to Pixelate.
   * On this tool that is more than tidiness — a Download button left standing
   * over a moved region would hand back a file that covers the wrong part of
   * the picture. Which is why the DRAG handlers call it too, and not only
   * `handlePointerDown`: a pointerdown is not the only way a region moves.
   */
  const stale = useCallback(() => {
    runToken.current += 1;
    setResult(null);
  }, []);

  // Through `stale()` rather than a bare `setResult(null)`: a file swapped
  // while a run is in flight has to invalidate that run too, or its blob
  // arrives afterwards and the Download button holds the OLD picture.
  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setSource(null);
      setRegion(null);
      stale();
      setError(null);
    },
    [stale],
  );

  // The preview is drawn from a main-thread decode. An <img> applies the
  // file's own EXIF orientation, which is what the worker asks its decoder for
  // (`imageOrientation: "from-image"`), so the region is measured against the
  // same picture the engine will pixelate — the one on screen.
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

  // The engine clamps too; clamping here as well is what lets the rail print
  // the block size that will actually be used instead of the slider's number.
  const block = Math.min(MAX_PIXELATE_BLOCK, Math.max(MIN_PIXELATE_BLOCK, Math.round(blockSize)));

  const edit = useMemo<ImageEditOptions>(
    () => ({ kind: "pixelate", region, blockSize: block }),
    [region, block],
  );

  // The live preview runs the SAME `drawEdit` the engine runs, at the same
  // output size, with the same opaque fill decision — a redraw of the result,
  // not a second implementation that could drift away from it. The selection
  // outline is stroked on top afterwards and is NOT part of that drawing.
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
    // No 2D context: a headless DOM, or a tab out of canvas memory. The rail
    // still reports everything it knows; only the picture is missing.
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (needsOpaqueFill(format)) fillBackground(ctx, width, height);
    drawEdit(ctx, source.img, edit, 0);

    if (!region) return;
    // The region is stored in natural pixels; the bitmap is `width × height`,
    // which is smaller for any source past the canvas ceiling. `editDestRect`
    // is the same mapping `drawEdit` paints the blocks through, so the outline
    // sits on the blocks instead of drifting off them (below the ceiling it is
    // the identity and this changes nothing). The stroke WIDTH still scales
    // with the picture or it vanishes on a 6000px photo shown 600px wide.
    // Drawn last, and never re-read — the download is encoded by the engine
    // from the same options, not from this canvas.
    const outline = editDestRect(
      region,
      source.img.naturalWidth,
      source.img.naturalHeight,
      width,
      height,
    );
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(2, Math.round(Math.max(width, height) / 400));
    ctx.setLineDash([ctx.lineWidth * 4, ctx.lineWidth * 3]);
    ctx.strokeRect(outline.x, outline.y, outline.width, outline.height);
    ctx.restore();
  }, [source, edit, region, format]);

  /**
   * Screen point → natural image pixels. The canvas is sized only by
   * `max-width`/`max-height`, so CSS keeps its intrinsic ratio and the bitmap
   * fills its box edge to edge: the mapping is a single uniform scale with no
   * letterbox to account for.
   */
  const pointToNatural = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>): Point | null => {
      const img = source?.img;
      const canvas = canvasRef.current;
      if (!img || !canvas) return null;
      const box = canvas.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return null;
      return {
        x: ((e.clientX - box.left) / box.width) * img.naturalWidth,
        y: ((e.clientY - box.top) / box.height) * img.naturalHeight,
      };
    },
    [source],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (isProcessing) return;
      const p = pointToNatural(e);
      if (!p) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Not every environment implements pointer capture, and a gesture is
        // not worth refusing over it. What capture actually buys is the
        // `pointerup` — without it a release outside the canvas is never seen
        // here, so the drag ends only at the next `pointerdown`. Every write
        // it makes on the way goes through `stale()`, so the worst case is a
        // region that keeps following the pointer, never a download that
        // stops matching one.
      }
      stale();
      setDragStart(p);
      setRegion(null);
    },
    [isProcessing, pointToNatural, stale],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!dragStart || !source) return;
      const p = pointToNatural(e);
      if (!p) return;
      stale();
      setRegion(
        normaliseRegion(
          rectBetween(dragStart, p),
          source.img.naturalWidth,
          source.img.naturalHeight,
        ),
      );
    },
    [dragStart, pointToNatural, source, stale],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!dragStart || !source) return;
      const p = pointToNatural(e);
      setDragStart(null);
      if (!p) return;
      const raw = rectBetween(dragStart, p);
      stale();
      // A tap, or a drag too small to be meant: back to the whole image.
      if (raw.width < MIN_DRAG_PX || raw.height < MIN_DRAG_PX) {
        setRegion(null);
        return;
      }
      setRegion(
        normaliseRegion(raw, source.img.naturalWidth, source.img.naturalHeight),
      );
    },
    [dragStart, pointToNatural, source, stale],
  );

  /**
   * A gesture the canvas never gets a `pointerup` for — a `pointercancel`, or a
   * browser where `setPointerCapture` threw above. Without this `dragStart`
   * stays set and a later pointer MOVE with no button held keeps rewriting the
   * region, so the "drag" outlives the drag.
   */
  const handleDragCancel = useCallback(() => setDragStart(null), []);

  const setRegionField = useCallback(
    (key: keyof EditRect, value: number) => {
      if (!source) return;
      const w = source.img.naturalWidth;
      const h = source.img.naturalHeight;
      // Editing a field with no region yet starts from the whole image, so the
      // numbers a user types are always relative to something they can see.
      const base = region ?? { x: 0, y: 0, width: w, height: h };
      stale();
      setRegion(normaliseRegion({ ...base, [key]: value }, w, h));
    },
    [region, source, stale],
  );

  const handlePixelate = useCallback(async () => {
    if (!file) return;
    const token = ++runToken.current;
    latestRun.current = token;
    setIsProcessing(true);
    setError(null);
    try {
      const output = await editImage(file, { edit, format, quality });
      // Superseded while this was running — the region or an option changed,
      // and that newer intent owns the panel now. Publishing this blob anyway
      // is precisely the "Download over a moved region" the invariant above
      // forbids, only arriving from behind.
      if (token !== runToken.current) return;
      setResult(output);
    } catch (err) {
      if (token !== runToken.current) return;
      setError(err instanceof Error ? err.message : "Pixelation failed");
    } finally {
      // Guarded on the newest run, NOT on `runToken`: a run superseded by a
      // drag has nobody behind it to clear the bar, and testing the validity
      // token here would leave it spinning for good. Only an actual newer run
      // owns the spinner.
      if (token === latestRun.current) setIsProcessing(false);
    }
  }, [file, edit, format, quality]);

  const handleReset = useCallback(() => {
    setFile(null);
    setSource(null);
    setRegion(null);
    setDragStart(null);
    stale();
    setError(null);
  }, [stale]);

  if (!file) {
    return (
      <DropZone accept={acceptFormats} onFiles={handleFiles} label="Upload an image to pixelate" />
    );
  }

  const dims = source ? { w: source.img.naturalWidth, h: source.img.naturalHeight } : null;
  const sizeLabel = formatFileSize(file.size);
  const regionLabel = region ? `${region.width} × ${region.height}` : "Whole image";
  const flattensAlpha = needsOpaqueFill(format) && Boolean(source?.hasAlpha);

  return (
    <>
      {/* ── Canvas: the live pixelation, with the region drawn on it ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={dims ? `${dims.w} × ${dims.h} · ${sizeLabel}` : sizeLabel}
          trailing={`${block} PX BLOCKS`}
        />

        <CanvasStage
          className={cn(STAGE_GROW, "flex items-center justify-center bg-[#0c0e17] p-4")}
        >
          <canvas
            ref={canvasRef}
            /* An aria-label on a bare canvas element is not reliably exposed:
               the element maps to the generic role, and a name on a generic
               role may be dropped. The role below gives it one that takes a
               name. */
            role="img"
            aria-label="Pixelation preview — drag to select a region"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handleDragCancel}
            onLostPointerCapture={handleDragCancel}
            className="block max-h-full max-w-full touch-none cursor-crosshair"
          />
        </CanvasStage>

        <CanvasFootnote>
          {region
            ? "THE DASHED OUTLINE MARKS THE REGION AND IS NOT DRAWN INTO THE DOWNLOAD"
            : "DRAG ON THE PREVIEW TO PIXELATE ONE REGION — WITH NONE SET, THE WHOLE IMAGE IS PIXELATED"}
        </CanvasFootnote>

        <StatStrip
          stats={[
            { label: "SOURCE", value: dims ? `${dims.w}×${dims.h}` : "—", tone: "neutral" },
            { label: "BLOCK", value: `${block} px` },
            {
              label: "REGION",
              value: region ? `${region.width}×${region.height}` : "WHOLE IMAGE",
            },
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
              <ToolProgress phase="PIXELATING" percent={null} label="Pixelating image" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel={isProcessing ? "Pixelating…" : "Pixelate"}
                onPrimary={handlePixelate}
                primaryDisabled={isProcessing}
              />
            )}
            <ToolResetLink
              onClick={handleReset}
              label={result ? "PIXELATE ANOTHER" : "CLEAR"}
            />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl>
            <ToolSlider
              label="Block size"
              display={`${block} px`}
              hint="Measured in the image's own pixels, so the blocks stay the same size whatever the preview is scaled to."
              min={MIN_PIXELATE_BLOCK}
              max={MAX_PIXELATE_BLOCK}
              step={1}
              value={block}
              onChange={(v) => {
                stale();
                setBlockSize(v);
              }}
              disabled={isProcessing}
            />
          </ToolControl>

          <ToolControl label="REGION">
            {/* The four fields ARE the stored rectangle, in natural image
                pixels. Dragging on the canvas writes the same four numbers,
                which is why the two can never disagree — and why the region is
                reachable without a pointer at all. */}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["x", "X"],
                  ["y", "Y"],
                  ["width", "Width"],
                  ["height", "Height"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex min-w-0 flex-col gap-1">
                  <span className="font-body text-[11px] text-text-muted">{label}</span>
                  <input
                    type="number"
                    min={0}
                    value={region ? region[key] : ""}
                    placeholder="—"
                    onChange={(e) => setRegionField(key, Number(e.target.value))}
                    aria-label={`Region ${label.toLowerCase()} in image pixels`}
                    disabled={isProcessing || !source}
                    className={NUMBER_FIELD_CLASS}
                  />
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                stale();
                setRegion(null);
              }}
              disabled={isProcessing || !region}
              aria-pressed={!region}
              className={cn(
                "cursor-pointer rounded-md border px-3 py-2 text-left font-body text-xs transition-colors duration-200",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                "disabled:cursor-not-allowed",
                region
                  ? "border-border text-neutral-400 hover:border-accent/40 hover:text-accent-200"
                  : "border-accent bg-accent/12 text-accent",
              )}
            >
              Whole image
            </button>
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

        <ToolAsideSection label="PIXELATION IS NOT REDACTION">
          <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
            {NOT_REDACTION_NOTE}
          </span>
        </ToolAsideSection>

        <ToolAsideSection label="OUTPUT">
          {/* `ToolOutput` accents its SECOND row, so the measured output size
              sits there. */}
          <ToolOutput
            rows={[
              ["Format", format.toUpperCase()],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              ["Block", `${block} px`],
              ["Region", regionLabel],
            ]}
          />
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Original pixels", "DISCARDED"],
            ["EXIF + GPS", "STRIPPED"],
            ["Transparency", needsOpaqueFill(format) ? "WHITE FILL" : "PRESERVED"],
          ]}
        />
      </ToolAside>
    </>
  );
}
