"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownloadButton } from "@/components/tools/DownloadButton";
import { DropZone } from "@/components/tools/DropZone";
import { ErrorMessage } from "@/components/tools/ErrorMessage";
import {
  OutputFormatPicker,
  sourceCanCarryAlpha,
} from "@/components/tools/OutputFormatPicker";
import { WarningMessage } from "@/components/tools/WarningMessage";
import {
  ToolActions,
  ToolAdvanced,
  ToolAside,
  ToolAsideSection,
  ToolOutput,
  ToolResetLink,
} from "@/components/tools/ToolAside";
import {
  CanvasFootnote,
  CanvasHeader,
  CanvasStage,
  PageDeck,
  StatStrip,
} from "@/components/tools/ToolCanvas";
import { ToolControl, ToolControlGroup, ToolProgress } from "@/components/tools/ToolControls";
import { CANVAS_COLUMN, STAGE_GROW, STAGE_MEDIA } from "@/components/workspace/shared";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { useImageDimensions } from "@/hooks/useImageDimensions";
import { useObjectUrl } from "@/hooks/useObjectUrl";
import { MAX_SPLIT_COLS, MAX_SPLIT_ROWS, editOutputPlan } from "@/lib/tools/image-edit-core";
import { cn } from "@/lib/utils/cn";
import { imageMeta } from "@/lib/utils/canvas-meta";
import { downloadFilesAsZip, triggerDownload } from "@/lib/utils/download";
import { formatFileSize } from "@/lib/utils/file-helpers";
import { editImageToMany } from "@/lib/workers/image-client";
import type { EditOutputFormat } from "@/lib/workers/image-protocol";

/*
  Cut one picture into an R × C grid of separate files.

  THE ARITHMETIC IS THE PRODUCT. A grid whose tiles do not add up to the
  source is not a smaller defect than a crash — reassembled, it is a picture
  with a seam or a missing strip, and nothing on screen would have said so.
  This repo has already shipped that class of bug once, in a letterbox
  calculation that reported 219 + 563 + 219 = 1001 px inside a 1000 px frame,
  because two halves were rounded independently.

  So the footnote under the deck prints the addition itself, term by term,
  beside a header that carries the source's own dimensions. If a rounding rule
  ever drifts, the page says `334 + 333 + 333 = 1001 PX` under a header reading
  `1000 × 1000` and the reader can see it without a debugger.

  The tile sizes come from `editOutputPlan` — the SAME function the engine
  draws from, not a second implementation of the same division — and the tile
  COUNT after a run comes from the results that actually came back, never from
  the R × C the user asked for.
*/

/** "334 + 333 + 333 = 1000" — the addition, shown rather than asserted. */
export function axisSum(sizes: readonly number[]): string {
  const total = sizes.reduce((sum, n) => sum + n, 0);
  return `${sizes.join(" + ")} = ${total}`;
}

/**
 * The grid the engine actually planned, read back out of the tile labels.
 *
 * `editOutputPlan` does not always honour the requested grid: `splitGrid`
 * clamps each axis to the source's own pixel count, so a 5 px wide strip
 * asked for 10 columns is planned as 5. Recomputing that clamp here would be
 * a second implementation of it, and the two would eventually disagree — so
 * the plan's own `r<row>c<col>` labels are the source of truth, and the page
 * says so when the answer differs from the request.
 */
export function gridFromPlan(plan: readonly { label: string }[]): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const entry of plan) {
    const m = /^r(\d+)c(\d+)$/.exec(entry.label);
    if (!m) continue;
    rows = Math.max(rows, Number(m[1]));
    cols = Math.max(cols, Number(m[2]));
  }
  return { rows, cols };
}

/**
 * "250" when every tile on the axis matches, "333–334" when the remainder was
 * spread. Two numbers, because a grid that does not divide evenly has exactly
 * two tile sizes on an axis — the leftover pixels go one per tile.
 */
export function rangeLabel(sizes: readonly number[]): string {
  if (sizes.length === 0) return "—";
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  return min === max ? String(min) : `${min}–${max}`;
}

/** Clamp a typed grid dimension to what the engine will actually honour. */
function clampAxis(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(1, Math.round(value)));
}

/** One produced tile and the object URL its preview is painted from. */
interface SplitTile {
  result: ProcessedResult;
  url: string;
}

interface ImageSplitterUIProps {
  acceptFormats: string;
}

export function ImageSplitterUI({ acceptFormats }: ImageSplitterUIProps) {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [format, setFormat] = useState<EditOutputFormat>("png");
  const [quality, setQuality] = useState(0.9);
  const [tiles, setTiles] = useState<SplitTile[] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = useObjectUrl(file);
  const dims = useImageDimensions(file);

  /*
    The plan is what the engine will draw, resolved on the main thread so the
    tile sizes can be shown BEFORE the split runs. It is the same pure
    function the worker calls; a second copy of the division here is exactly
    how the two would come to disagree.
  */
  const plan = useMemo(
    () => (dims ? editOutputPlan(dims.w, dims.h, { kind: "split", rows, cols }) : null),
    [dims, rows, cols],
  );

  /*
    One row of widths and one column of heights: the two axes of the grid.
    The plan is emitted ROW-MAJOR — r1c1, r1c2, … r2c1, which is the order the
    protocol's own `label` example ("r1c2") describes — so the first `cols`
    entries are row 1 and every `cols`-th entry starts a new row. If that order
    ever changed, these two sums would stop matching the source's dimensions
    and the footnote would say so on screen.
  */
  const grid = plan ? gridFromPlan(plan) : null;
  const across = plan && grid?.cols ? plan.slice(0, grid.cols).map((p) => p.width) : [];
  const down =
    plan && grid?.cols ? plan.filter((_, i) => i % grid.cols === 0).map((p) => p.height) : [];
  // The engine reduced the grid because the picture has too few pixels for it.
  const clamped = grid !== null && grid.cols > 0 && (grid.rows !== rows || grid.cols !== cols);

  const isNoOp = rows === 1 && cols === 1;

  /*
    Each tile's object URL is allocated WITH the tile, in the handler that
    produced it, and the pair is one piece of state.

    Mirroring the results into a second `urls` state from an effect is the
    obvious alternative and it is wrong twice over: it is a cascading render
    that `react-hooks/set-state-in-effect` refuses outright, and it splits one
    fact across two states that disagree for a frame. `useObjectUrl` cannot
    serve a LIST, so its two disciplines are kept by hand instead — every URL
    is revoked when the list it belongs to is replaced, and again on unmount,
    and the revoke is deferred a second because a synchronous one aborts an
    <img> still loading the URL the deck has just swapped away from.

    No preview cap is needed here, unlike the PDF image grid:
    `MAX_SPLIT_ROWS × MAX_SPLIT_COLS` bounds this deck at a hundred tiles by
    construction, and each is a fraction of the source's area.
  */
  const liveUrls = useRef<string[]>([]);
  const showTiles = useCallback((produced: ProcessedResult[] | null) => {
    const stale = liveUrls.current;
    const next =
      produced?.map((result) => ({ result, url: URL.createObjectURL(result.blob) })) ?? null;
    liveUrls.current = next?.map((t) => t.url) ?? [];
    setTiles(next);
    if (stale.length > 0) {
      setTimeout(() => {
        for (const url of stale) URL.revokeObjectURL(url);
      }, 1000);
    }
  }, []);

  useEffect(
    () => () => {
      const outstanding = liveUrls.current;
      liveUrls.current = [];
      setTimeout(() => {
        for (const url of outstanding) URL.revokeObjectURL(url);
      }, 1000);
    },
    [],
  );

  const change = useCallback(
    (apply: () => void) => {
      showTiles(null);
      apply();
    },
    [showTiles],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      showTiles(null);
      setError(null);
    },
    [showTiles],
  );

  const handleSplit = useCallback(async () => {
    if (!file || isNoOp) return;
    setIsProcessing(true);
    setError(null);
    try {
      const outputs = await editImageToMany(file, {
        edit: { kind: "split", rows, cols },
        format,
        quality,
      });
      showTiles(outputs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not split this image");
    }
    setIsProcessing(false);
  }, [file, isNoOp, rows, cols, format, quality, showTiles]);

  const handleReset = useCallback(() => {
    setFile(null);
    showTiles(null);
    setError(null);
  }, [showTiles]);

  const downloadAll = useCallback(() => {
    if (!file || !tiles) return;
    void downloadFilesAsZip(
      tiles.map((t) => ({ blob: t.result.blob, name: t.result.fileName })),
      `${file.name.replace(/\.[^.]+$/, "")}-tiles.zip`,
    );
  }, [file, tiles]);

  if (!file) {
    return (
      <DropZone accept={acceptFormats} onFiles={handleFiles} label="Upload an image to split into tiles" />
    );
  }

  // Deduped the way the batch converter does it: every tile carries the same
  // notice about the same source, and the source is only flattened once.
  const warnings = [...new Set((tiles ?? []).flatMap((t) => t.result.warnings ?? []))];

  return (
    <>
      {/* ── Canvas: the grid you asked for, then the tiles it produced ── */}
      <div className={CANVAS_COLUMN}>
        <CanvasHeader
          file={file.name}
          meta={imageMeta(dims, formatFileSize(file.size))}
          // After a run this counts the files that came BACK. Printing
          // `rows × cols` there would be the tool describing its own request.
          trailing={tiles ? `${tiles.length} TILES` : `${grid?.rows ?? rows} × ${grid?.cols ?? cols}`}
        />

        {tiles ? (
          <PageDeck>
            {tiles.map((tile) => (
              <figure key={tile.result.fileName} className="m-0 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => triggerDownload(tile.result.blob, tile.result.fileName)}
                  aria-label={`Download ${tile.result.fileName}`}
                  className="relative flex aspect-square cursor-pointer items-center justify-center overflow-hidden rounded-[5px] border border-neutral-800 bg-[linear-gradient(170deg,#f3f5fe_0%,#dfe3f0_100%)] p-0 transition-opacity duration-200 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise */}
                  <img src={tile.url} alt="" className="size-full object-contain" />
                </button>
                <figcaption className="flex flex-col gap-1">
                  <span className="truncate font-mono text-[9.5px] leading-none text-text-muted">
                    {tile.result.fileName}
                  </span>
                  <span className="font-mono text-[9.5px] leading-none text-accent-300">
                    {formatFileSize(tile.result.newSize)}
                  </span>
                </figcaption>
              </figure>
            ))}
          </PageDeck>
        ) : (
          <CanvasStage className={cn(STAGE_GROW, "flex items-center justify-center bg-[#0c0e17] p-4")}>
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- blob: URL, nothing for next/image to optimise
              <img src={previewUrl} alt="Split preview" className={STAGE_MEDIA} />
            )}
          </CanvasStage>
        )}

        <StatStrip
          stats={[
            { label: "SOURCE", value: dims ? `${dims.w}×${dims.h}` : "—", tone: "neutral" },
            { label: "GRID", value: `${grid?.rows ?? rows} × ${grid?.cols ?? cols}` },
            { label: "TILES", value: tiles ? String(tiles.length) : "—", tone: "neutral" },
            {
              label: "OUT",
              value: tiles ? formatFileSize(tiles.reduce((n, t) => n + t.result.newSize, 0)) : "—",
              tone: "ok",
            },
          ]}
        />

        {/*
          The addition, printed. Beside the header's `1000 × 1000` it is a
          claim the reader can check, which a bare "500 × 500 tiles" never was.
        */}
        {across.length > 0 && (
          <CanvasFootnote>
            ACROSS: {axisSum(across)} PX · DOWN: {axisSum(down)} PX
          </CanvasFootnote>
        )}

        {/*
          Said, not swallowed. A grid the engine reduced is a different answer
          from the one that was asked for, and the tile count below would
          otherwise be the only trace of it.
        */}
        {clamped && grid && (
          <CanvasFootnote>
            THIS PICTURE HAS TOO FEW PIXELS FOR {rows} × {cols} — IT IS BEING CUT INTO{" "}
            {grid.rows} × {grid.cols} INSTEAD, ONE TILE PER PIXEL AT MOST
          </CanvasFootnote>
        )}

        {isNoOp && (
          <CanvasFootnote>
            A 1 × 1 GRID IS THE PICTURE YOU ALREADY HAVE — RAISE THE ROWS OR THE COLUMNS
          </CanvasFootnote>
        )}

        {tiles && (
          <CanvasFootnote>CLICK A TILE TO SAVE IT ON ITS OWN</CanvasFootnote>
        )}

        {error && <ErrorMessage message={error} />}

        {warnings.map((warning) => (
          <WarningMessage key={warning} message={warning} />
        ))}
      </div>

      {/* ── Controls: the doc's right-hand rail / bottom sheet ── */}
      <ToolAside
        footer={
          <>
            {isProcessing && (
              <ToolProgress phase="SPLITTING" percent={null} label="Splitting the image" />
            )}
            {tiles && tiles.length === 1 ? (
              /*
                `downloadFilesAsZip` hands a one-member list over bare, so a
                button promising a ZIP would be a promise the download breaks.
                The 1 × 1 grid is refused before the run, so this branch is
                only reachable if the engine ever returns fewer tiles than the
                grid — in which case the button still names what it saves.
              */
              <DownloadButton
                blob={tiles[0].result.blob}
                fileName={tiles[0].result.fileName}
                className="w-full justify-center"
              />
            ) : tiles ? (
              <ToolActions
                primaryLabel={`Download ${tiles.length} tiles (ZIP)`}
                onPrimary={downloadAll}
              />
            ) : (
              <ToolActions
                primaryLabel={isProcessing ? "Splitting…" : "Split"}
                onPrimary={handleSplit}
                primaryDisabled={isProcessing || isNoOp}
              />
            )}
            {tiles && <ToolResetLink onClick={() => showTiles(null)} label="CHANGE THE GRID" />}
            <ToolResetLink onClick={handleReset} label={tiles ? "SPLIT ANOTHER" : "CLEAR"} />
          </>
        }
      >
        <ToolControlGroup>
          <ToolControl label="GRID">
            <div className="flex items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-body text-[11px] text-text-muted">Rows</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_SPLIT_ROWS}
                  value={rows}
                  onChange={(e) => change(() => setRows(clampAxis(Number(e.target.value), MAX_SPLIT_ROWS)))}
                  className="w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  disabled={isProcessing}
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-body text-[11px] text-text-muted">Columns</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_SPLIT_COLS}
                  value={cols}
                  onChange={(e) => change(() => setCols(clampAxis(Number(e.target.value), MAX_SPLIT_COLS)))}
                  className="w-full rounded-md border border-border bg-bg-elevated px-2.5 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  disabled={isProcessing}
                />
              </label>
            </div>
            {/* The ceiling is the engine's, not a number invented here. */}
            <span className="font-body text-[10.5px] leading-[1.5] text-text-muted">
              Up to {MAX_SPLIT_ROWS} rows by {MAX_SPLIT_COLS} columns. A row that does not divide
              evenly is not padded or stretched: the leftover pixels are handed out one per tile,
              so the tiles still add up to the picture exactly.
            </span>
          </ToolControl>

          {/* `alphaWarning` is the SOURCE half of the question — whether the
              file that was dropped can carry transparency at all; the picker
              owns the "is JPG selected" half. Without it a transparent PNG cut
              into a hundred tiles comes back with every one of them
              white-flattened and nothing on the page says so. */}
          <OutputFormatPicker
            value={format}
            onChange={(v) => change(() => setFormat(v))}
            quality={quality}
            onQualityChange={(q) => change(() => setQuality(q))}
            disabled={isProcessing}
            alphaWarning={sourceCanCarryAlpha(file)}
          />
        </ToolControlGroup>

        <ToolAsideSection label="OUTPUT">
          <ToolOutput
            rows={[
              ["Tiles", tiles ? String(tiles.length) : plan ? String(plan.length) : "—"],
              ["Out", tiles ? formatFileSize(tiles.reduce((n, t) => n + t.result.newSize, 0)) : "—"],
              ["Tile size", plan ? `${rangeLabel(across)} × ${rangeLabel(down)}` : "—"],
              ["In", formatFileSize(file.size)],
            ]}
          />
        </ToolAsideSection>

        <ToolAdvanced
          rows={[
            ["Tile order", "LEFT TO RIGHT, TOP TO BOTTOM"],
            // The naming pattern is stated from a file that exists once one
            // does; before the run it is the engine's documented convention.
            [
              "Filenames",
              tiles ? tiles[0].result.fileName : `NAME-r1c1.${format === "jpeg" ? "jpg" : format}`,
            ],
            ["EXIF + GPS", "STRIPPED"],
          ]}
        />
      </ToolAside>
    </>
  );
}
