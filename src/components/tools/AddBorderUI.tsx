"use client";

import { useCallback, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { DropZone } from "@/components/tools/DropZone";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  defaultFormatFor,
  OutputFormatPicker,
  sourceCanCarryAlpha,
} from "./OutputFormatPicker";
import {
  MAX_BORDER_PX,
  MAX_CANVAS_DIMENSION,
  editOutputPlan,
} from "@/lib/tools/image-edit-core";
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
  add-border: paint a solid margin around the picture and write a new file.

  NOTHING IS CROPPED, AND NOTHING IS SCALED UNTIL THE CANVAS CEILING SAYS SO.
  The canvas is made larger than the source, filled with the chosen colour, and
  the source is drawn whole inside it — so every output pixel of the original
  is still an original pixel, and the new dimensions are pure addition. That
  addition is the one thing a user cannot verify by eye, which is why it is
  written out in full on the canvas (`800 × 600 → 840 × 640`) rather than left
  to be discovered in the download.

  The exception is a frame that crosses `MAX_CANVAS_DIMENSION`: an 8000 × 6000
  photo with a 200 px border asks for 8400 × 6400 and a browser canvas cannot
  hold it, so `editOutputPlan` reduces the whole thing to 8192 × 6242. Every
  size on this page is read back off that plan for exactly that reason — the
  arithmetic footnote, the AFTER cell and the Dimensions row all come from the
  planner the engine draws with, so none of them can print a size the file does
  not have.

  THE PREVIEW SHOWS THE SOURCE, NOT A MOCK-UP OF THE BORDER. Drawing a
  to-scale border in CSS needs the stage's own box, and `CanvasStage` only has
  a definite height at `xl` — a border faked from percentages would be right
  on one breakpoint and wrong on the others, and a preview that disagrees with
  the download is worse than no preview (`RotateVideoUI` records the same
  reasoning for the same reason). The arithmetic is the promise; the result
  image, once it exists, is the proof.
*/

/** The four edges, in CSS order, so the readout reads the way a stylesheet does. */
const EDGES = [
  { key: "top", label: "Top" },
  { key: "right", label: "Right" },
  { key: "bottom", label: "Bottom" },
  { key: "left", label: "Left" },
] as const;

type EdgeKey = (typeof EDGES)[number]["key"];
type Edges = Record<EdgeKey, number>;

/**
 * A ceiling on one edge, so a slipped keystroke cannot ask the worker for a
 * canvas the browser will refuse to allocate.
 *
 * It is the engine's own number, not a second answer: `clampBorders` in the
 * edit core clamps every side to `MAX_BORDER_PX` before planning, so a wider
 * field here would only let the page promise a frame the engine would trim.
 *
 * It does NOT on its own keep the result inside the canvas ceiling — 6000 +
 * 2000 + 2000 is 10000, well past `MAX_CANVAS_DIMENSION`. What keeps the page
 * honest there is that the readouts come from `editOutputPlan`, which scales
 * the whole frame down to fit and says it did.
 */
const MAX_EDGE = MAX_BORDER_PX;

/**
 * What the chosen encoder will do to the pixels. Derived from the picker, so
 * it cannot promise losslessness over a JPEG write.
 */
function encodeNote(format: EditOutputFormat): string {
  return format === "png"
    ? "PNG OUTPUT IS A LOSSLESS RE-ENCODE OF THE DECODED PIXELS — NO NEW COMPRESSION ARTEFACTS ARE ADDED, BUT THE ORIGINAL'S EXIF DOES NOT COME THROUGH."
    : `${format.toUpperCase()} OUTPUT RE-ENCODES EVERY PIXEL — THE DOWNLOAD IS ONE COMPRESSION GENERATION FURTHER ON THAN THE FILE YOU DROPPED.`;
}

/** `#RRGGBB` is what `<input type="color">` emits and what the engine reads. */
const HEX = /^#[0-9a-f]{6}$/i;

const NUMBER_FIELD =
  "w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

interface AddBorderUIProps {
  /** `Tool.acceptFormats`, so the zone's list cannot drift from the registry. */
  acceptFormats: string;
}

export function AddBorderUI({ acceptFormats }: AddBorderUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [edges, setEdges] = useState<Edges>({ top: 24, right: 24, bottom: 24, left: 24 });
  // Linked by default: an even frame is what almost everyone wants, and the
  // four-field form is a step someone should have to ask for.
  const [linked, setLinked] = useState(true);
  const [colour, setColour] = useState("#ffffff");
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
  const handleEdge = useCallback(
    (key: EdgeKey, raw: number) => {
      const value = Math.max(0, Math.min(MAX_EDGE, Math.round(raw) || 0));
      setResult(null);
      // While the edges are linked, every field is the same field — writing
      // only the one that was typed in would leave the other three behind and
      // the readout would stop matching the frame.
      setEdges((prev) =>
        linked
          ? { top: value, right: value, bottom: value, left: value }
          : { ...prev, [key]: value },
      );
    },
    [linked],
  );

  const handleColour = useCallback((value: string) => {
    setColour(value);
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

  const handleAddBorder = useCallback(async () => {
    if (!file) return;
    setIsProcessing(true);
    setError(null);
    try {
      const options: ImageEditJobOptions = {
        edit: { kind: "border", ...edges, colour },
        format,
        quality,
      };
      setResult(await editImage(file, options));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adding the border failed");
    }
    setIsProcessing(false);
  }, [file, edges, colour, format, quality]);

  const handleReset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
  }, []);

  if (!file) {
    return (
      <DropZone
        accept={acceptFormats}
        onFiles={handleFiles}
        label="Upload an image to add a border to"
      />
    );
  }

  const stageUrl = resultUrl ?? previewUrl;
  /*
    Pure addition — no scaling, no cropping — until the sum crosses the canvas
    ceiling, and then the whole frame is scaled to fit. Both facts come from
    `editOutputPlan`, the function the worker and the main-thread mirror size
    their canvases from, so the number written out below is the number the
    download has. Re-adding the edges here instead printed 10000 × 8000 for a
    6000 × 4000 photo with a 2000 px frame; the file is 8192 × 6554.
  */
  const plan = sourceDims
    ? editOutputPlan(sourceDims.w, sourceDims.h, { kind: "border", ...edges, colour })[0]
    : null;
  const outDims = plan ? { w: plan.width, h: plan.height } : null;
  const arithmetic =
    sourceDims && outDims
      ? `${sourceDims.w} × ${sourceDims.h} → ${outDims.w} × ${outDims.h}`
      : null;
  const edgeSummary = linked
    ? `${edges.top} PX ON EVERY EDGE`
    : `${edges.top} TOP / ${edges.right} RIGHT / ${edges.bottom} BOTTOM / ${edges.left} LEFT`;

  return (
    <>
      {/* ── Canvas: the picture, and the frame it is about to gain ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(sourceDims, formatFileSize(file.size))}
          trailing={result ? "BORDERED" : outDims ? `${outDims.w} × ${outDims.h}` : undefined}
        />

        <CanvasStage
          className={cn(STAGE_GROW, "flex items-center justify-center bg-[#0c0e17] p-4")}
        >
          {/* Until there is a result this is the SOURCE, unframed and labelled
              as such — see the header comment for why no border is faked. */}
          {stageUrl && (
            /* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */
            <img
              src={stageUrl}
              alt={result ? "Bordered image" : "Source image, before the border"}
              className={STAGE_MEDIA}
            />
          )}
          <span className="absolute top-3 right-3.5 flex items-center gap-1.5 rounded-sm bg-[rgba(12,14,23,.72)] px-[7px] py-1 font-mono text-[9.5px] leading-none font-medium tracking-[0.12em] text-accent-300">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[2px] border border-neutral-700"
              style={{ backgroundColor: HEX.test(colour) ? colour : undefined }}
            />
            {result ? "BORDERED" : edgeSummary}
          </span>
        </CanvasStage>

        <StatStrip
          stats={[
            {
              label: "SOURCE",
              value: sourceDims ? `${sourceDims.w}×${sourceDims.h}` : "—",
              tone: "neutral",
            },
            { label: "AFTER", value: outDims ? `${outDims.w}×${outDims.h}` : "—" },
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

        {/* The arithmetic, in one line, before anything is downloaded. */}
        {arithmetic && <CanvasFootnote>{`${arithmetic} — ${edgeSummary}`}</CanvasFootnote>}

        {/* The one case where the arithmetic above is not pure addition, said
            from the plan's own flag BEFORE the run. The engine repeats it on
            the result; saying it only then would leave the sum unexplained
            until the download existed. */}
        {plan?.scaled && !result && (
          <CanvasFootnote>
            {`A BROWSER CANVAS CANNOT HOLD AN EDGE LONGER THAN ${MAX_CANVAS_DIMENSION} PIXELS, SO THE FRAMED PICTURE IS REDUCED WHOLE TO ${plan.width} × ${plan.height} RATHER THAN SQUASHED`}
          </CanvasFootnote>
        )}

        <CanvasFootnote>{encodeNote(format)}</CanvasFootnote>
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {isProcessing && (
              // One fill, one draw, one encode — nothing reports progress, so
              // the bar stays indeterminate rather than inventing a number.
              <ToolProgress phase="DRAWING THE BORDER" percent={null} label="Adding border" />
            )}
            {result ? (
              <DownloadButton
                blob={result.blob}
                fileName={result.fileName}
                className="w-full justify-center"
              />
            ) : (
              <ToolActions
                primaryLabel="Add border"
                onPrimary={handleAddBorder}
                primaryDisabled={isProcessing}
              />
            )}
            <ToolResetLink onClick={handleReset} label={result ? "BORDER ANOTHER" : "CLEAR"} />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="BORDER">
            <div className="flex items-center justify-between gap-2">
              <span className="font-body text-[11px] text-text-muted">
                {linked ? "One width on every edge" : "A width per edge"}
              </span>
              <button
                type="button"
                onClick={() => {
                  const next = !linked;
                  setLinked(next);
                  setResult(null);
                  // Re-linking has to pick a winner, and the top field is the
                  // one the linked form shows — so the frame the user is about
                  // to see is the number they were already looking at.
                  if (next) {
                    setEdges((prev) => ({
                      top: prev.top,
                      right: prev.top,
                      bottom: prev.top,
                      left: prev.top,
                    }));
                  }
                }}
                disabled={isProcessing}
                className={cn(
                  "cursor-pointer rounded p-1.5 transition-colors",
                  linked ? "text-accent" : "text-text-muted",
                )}
                title={linked ? "Edges linked" : "Edges set separately"}
                aria-label={linked ? "Set each edge separately" : "Use one width for all edges"}
                aria-pressed={linked}
              >
                {linked ? (
                  <Link2 className="size-4" aria-hidden="true" />
                ) : (
                  <Link2Off className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>

            {linked ? (
              <label className="flex flex-col gap-1">
                <span className="font-body text-[11px] text-text-muted">All edges</span>
                <input
                  type="number"
                  min={0}
                  max={MAX_EDGE}
                  value={edges.top}
                  onChange={(e) => handleEdge("top", Number(e.target.value))}
                  aria-label="All edges"
                  className={NUMBER_FIELD}
                  disabled={isProcessing}
                />
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {EDGES.map((edge) => (
                  <label key={edge.key} className="flex min-w-0 flex-col gap-1">
                    <span className="font-body text-[11px] text-text-muted">{edge.label}</span>
                    <input
                      type="number"
                      min={0}
                      max={MAX_EDGE}
                      value={edges[edge.key]}
                      onChange={(e) => handleEdge(edge.key, Number(e.target.value))}
                      aria-label={edge.label}
                      className={NUMBER_FIELD}
                      disabled={isProcessing}
                    />
                  </label>
                ))}
              </div>
            )}
          </ToolControl>

          <ToolControl label="COLOUR">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={HEX.test(colour) ? colour : "#ffffff"}
                onChange={(e) => handleColour(e.target.value)}
                aria-label="Border colour"
                disabled={isProcessing}
                className="h-9 w-12 flex-none cursor-pointer rounded-md border border-border bg-bg-elevated p-1"
              />
              {/* The text field is the one a brand hex gets pasted into; the
                  swatch above cannot accept one. */}
              <input
                type="text"
                value={colour}
                onChange={(e) => handleColour(e.target.value)}
                aria-label="Border colour hex"
                spellCheck={false}
                disabled={isProcessing}
                className={cn(NUMBER_FIELD, "font-mono")}
              />
            </div>
            {!HEX.test(colour) && (
              <span className="font-body text-[10.5px] leading-[1.5] text-warning">
                That is not a six-digit hex colour, so the border would not be the colour you
                asked for. Write it as #rrggbb.
              </span>
            )}
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
              there. The dimensions row carries both sides of the sum, because
              the sum is the whole product. */}
          <ToolOutput
            rows={[
              ["Format", format.toUpperCase()],
              ["Out", result ? formatFileSize(result.newSize) : "—"],
              ["Dimensions", arithmetic ?? "—"],
              ["In", formatFileSize(file.size)],
            ]}
          />
        </ToolAsideSection>

        {/* Engine facts, stated only where true. */}
        <ToolAdvanced
          rows={[
            // Derived: the one thing that can scale the source is the canvas
            // ceiling, and the plan is what knows whether it did.
            [
              "Source pixels",
              plan?.scaled ? "NOT CROPPED — SCALED TO FIT THE CANVAS" : "NOT CROPPED OR SCALED",
            ],
            ["EXIF + GPS", "STRIPPED"],
            ["Colour space", "sRGB"],
            ["Transparency", format === "jpeg" ? "WHITE FILL" : "PRESERVED"],
          ]}
        />
      </ToolAside>
    </>
  );
}
