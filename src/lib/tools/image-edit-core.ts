import type {
  EditOutputFormat,
  EditRect,
  ImageEditOptions,
} from "@/lib/workers/image-protocol";

/**
 * The geometry of every image EDIT verb — rotate, flip, watermark, pixelate,
 * circular crop, border, split and preset resizing — in one place.
 *
 * ONE implementation, two pipelines. `src/lib/workers/image.worker.ts` draws
 * on an OffscreenCanvas and `src/lib/tools/image-edit.ts` draws on an
 * HTMLCanvasElement, and BOTH call the functions below. That is deliberate:
 * convert/compress/resize each exist twice (see the note at the top of
 * image.worker.ts) and the two copies have to be kept in step by hand. Eight
 * more verbs done that way would be sixteen more places to drift, so the verbs
 * own no pixel maths of their own — the pipelines own the canvas, this file
 * owns the arithmetic.
 *
 * LEAF MODULE — no runtime imports. The image worker bundles this file, and a
 * worker entrypoint whose import chain reaches back to a module that names the
 * worker's own URL hangs the production build. The one import above is
 * `import type` from a types-only module, which erases.
 */

/** A 2D context from either an OffscreenCanvas or an HTMLCanvasElement. */
export type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Anything drawImage accepts and we can read width/height off. */
export interface DrawableSource {
  readonly width: number;
  readonly height: number;
}

/** Clamp a user block size to something that cannot hang the tab. */
export const MAX_PIXELATE_BLOCK = 128;
export const MIN_PIXELATE_BLOCK = 2;
export const MAX_SPLIT_ROWS = 10;
export const MAX_SPLIT_COLS = 10;

/**
 * Ceiling on any single canvas edge. Chromium refuses to allocate a 2D canvas
 * past 16384 on a side and quietly hands back a blank one at the area limit;
 * the resize op already caps at 8192 (image.worker.ts resize()), so the edit
 * verbs use the same number rather than inventing a second answer.
 */
export const MAX_CANVAS_DIMENSION = 8192;

/** One planned output: its canvas size, its filename stem, and whether the
 * canvas ceiling forced it smaller than the geometry asked for. */
export interface EditPlanEntry {
  width: number;
  height: number;
  label: string;
  scaled: boolean;
}

/** Widest border a single side may add, so a typo cannot ask for a 200k canvas. */
export const MAX_BORDER_PX = 2000;

/**
 * A watermark tiled over a large canvas with a short string is thousands of
 * fillText calls. Past this many stamps the spacing is widened instead — the
 * pattern still reads as a repeat, and the draw stays bounded.
 */
export const MAX_TILE_STAMPS = 2000;

/** Every number that reaches a canvas dimension goes through here. */
export function clampDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_CANVAS_DIMENSION, Math.round(value)));
}

/**
 * The uniform factor that fits `width × height` inside the canvas ceiling, or 1
 * when it already fits.
 *
 * This exists because clamping the two axes INDEPENDENTLY is a silent
 * aspect-ratio bug, and it is reachable with ordinary camera files rather than
 * contrived ones. Measured against the shipped plan before this was added: a
 * 9504 × 6336 frame (a 61 MP full-frame camera) flipped came out 8192 × 6336 —
 * the same picture squashed 13.8% along one axis — and an 8688 × 5792 50 MP
 * photo came out 5.7% squashed. Nothing said so. `Math.min` on each edge
 * separately always does this; the only correct answer is one scale for both.
 *
 * The verbs that draw into `outW/outH` (flip, watermark, pixelate, split,
 * presets) then scale the picture down instead of distorting it; the two that
 * draw at natural size (rotate, border) re-derive this factor in `drawEdit` so
 * they scale rather than crop. Either way the caller is told, because a
 * silently smaller output is still a change nobody asked for.
 */
export function canvasFitScale(width: number, height: number): number {
  const longest = Math.max(positiveInt(width), positiveInt(height));
  return longest > MAX_CANVAS_DIMENSION ? MAX_CANVAS_DIMENSION / longest : 1;
}

/**
 * Fit a size inside the canvas ceiling without changing its shape, and say
 * whether it had to. `scaled` is what the UI reports — derived from the run,
 * not asserted, the same rule `RemuxResult.streamCopied` follows.
 */
function fitWithinCanvas(
  width: number,
  height: number,
): { width: number; height: number; scaled: boolean } {
  const scale = canvasFitScale(width, height);
  return scale === 1
    ? { width: clampDimension(width), height: clampDimension(height), scaled: false }
    : {
        width: clampDimension(width * scale),
        height: clampDimension(height * scale),
        scaled: true,
      };
}

/**
 * The one wording for "we had to shrink this to fit the canvas". Shared so the
 * worker and the main-thread mirror cannot drift, the way `target-size.ts`
 * owns `scaledToTargetWarning` for the compressor.
 */
export function canvasCeilingWarning(width: number, height: number): string {
  return `Scaled to ${width} × ${height} — a browser canvas cannot hold an edge longer than ${MAX_CANVAS_DIMENSION} pixels, so the whole picture was reduced to fit rather than squashed.`;
}

/** True when the format cannot carry alpha and the canvas needs a white fill first. */
export function needsOpaqueFill(format: EditOutputFormat): boolean {
  return format !== "png" && format !== "webp";
}

/**
 * The filename stem a single-output verb earns, e.g. `photo-rotated.png`.
 * image-client.ts and image-edit.ts both name files from this, so the worker
 * path and the fallback path cannot produce differently-named downloads.
 */
export function editVerbSuffix(edit: ImageEditOptions): string {
  switch (edit.kind) {
    case "rotate":
      return "rotated";
    case "flip":
      return "flipped";
    case "watermark":
      return "watermarked";
    case "pixelate":
      return "pixelated";
    case "crop-circle":
      return "circle";
    case "border":
      return "bordered";
    case "split":
      return "tile";
    case "presets":
      return "preset";
  }
}

/** True for the verbs whose result is a LIST of outputs, not one image. */
export function isMultiOutputEdit(edit: ImageEditOptions): boolean {
  return edit.kind === "split" || edit.kind === "presets";
}

// ── planning ─────────────────────────────────────────────────────

/**
 * For split/presets: the N output sizes and labels, in order. Every other verb
 * returns exactly one entry, so callers can loop uniformly.
 *
 * Split tiles are planned against the TRUE source width/height, not the clamped
 * one — a 12000px panorama cut into three columns must still tile the whole
 * panorama. Only the per-output canvas size is clamped.
 */
export function editOutputPlan(
  srcWidth: number,
  srcHeight: number,
  edit: ImageEditOptions,
): EditPlanEntry[] {
  const w = positiveInt(srcWidth);
  const h = positiveInt(srcHeight);
  const label = editVerbSuffix(edit);

  switch (edit.kind) {
    case "rotate": {
      // 90 and 270 transpose the frame; 180 does not.
      const turned = edit.degrees === 90 || edit.degrees === 270;
      return [{ ...fitWithinCanvas(turned ? h : w, turned ? w : h), label }];
    }
    case "flip":
    case "watermark":
    case "pixelate":
      return [{ ...fitWithinCanvas(w, h), label }];
    case "crop-circle": {
      const frame = circleFrame(w, h, edit.region);
      return [{ ...fitWithinCanvas(frame.width, frame.height), label }];
    }
    case "border": {
      const b = clampBorders(edit);
      return [{ ...fitWithinCanvas(w + b.left + b.right, h + b.top + b.bottom), label }];
    }
    case "split": {
      const { rows, cols } = splitGrid(w, h, edit);
      const plan: EditPlanEntry[] = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cell = splitCell(w, h, rows, cols, row, col);
          plan.push({
            ...fitWithinCanvas(cell.width, cell.height),
            // Row/column numbering is 1-based because it becomes a filename a
            // person reads: "photo-r2c3.png".
            label: `r${row + 1}c${col + 1}`,
          });
        }
      }
      return plan;
    }
    case "presets":
      return edit.outputs.map((spec, index) => ({
        ...fitWithinCanvas(spec.width, spec.height),
        label: labelToStem(spec.label) || `preset-${index + 1}`,
      }));
  }
}

/**
 * The output canvas size a given edit needs, before any drawing happens. For
 * the multi-output verbs this is the FIRST entry of `editOutputPlan` — those
 * callers want the plan, not a single size. An empty preset list has no first
 * entry; the source size is the only non-invented answer there.
 */
export function editOutputSize(
  srcWidth: number,
  srcHeight: number,
  edit: ImageEditOptions,
): { width: number; height: number } {
  const first = editOutputPlan(srcWidth, srcHeight, edit)[0];
  if (first) return { width: first.width, height: first.height };
  return { width: clampDimension(srcWidth), height: clampDimension(srcHeight) };
}

/**
 * The rectangle of the SOURCE that output `index` is drawn from. Full frame
 * for the verbs that redraw the whole picture; the tile for split, the square
 * frame for the circular crop, the centre crop for a "cover" preset.
 *
 * The split case is the one with a real invariant: across a row, the cells'
 * `x + width` chain has no gaps and the widths sum to exactly the source width
 * (same down a column for height). Cumulative rounding — round(c·W/cols) as the
 * left edge of every cell — is what guarantees it; rounding each cell's width
 * independently leaves a seam or a one-pixel overhang, which is the class of
 * bug this repo has already shipped once in the letterbox maths.
 */
export function editSourceRect(
  srcWidth: number,
  srcHeight: number,
  edit: ImageEditOptions,
  index: number,
): EditRect {
  const w = positiveInt(srcWidth);
  const h = positiveInt(srcHeight);
  const whole: EditRect = { x: 0, y: 0, width: w, height: h };

  switch (edit.kind) {
    case "rotate":
    case "flip":
    case "watermark":
    case "border":
      return whole;
    case "pixelate":
      // The pixelated REGION, not the drawn frame — the rest of the picture is
      // copied through untouched.
      return edit.region ? clampRect(edit.region, w, h) : whole;
    case "crop-circle":
      return circleFrame(w, h, edit.region);
    case "split": {
      const { rows, cols } = splitGrid(w, h, edit);
      const count = rows * cols;
      if (count === 0) return whole;
      const i = Math.min(Math.max(0, Math.trunc(index)), count - 1);
      return splitCell(w, h, rows, cols, Math.floor(i / cols), i % cols);
    }
    case "presets": {
      const spec = edit.outputs[Math.trunc(index)];
      if (!spec) return whole;
      // "contain" letterboxes the WHOLE picture into the frame, so it reads
      // every source pixel; only "cover" crops.
      if (edit.fit === "contain") return whole;
      return coverRect(w, h, clampDimension(spec.width), clampDimension(spec.height));
    }
  }
}

/**
 * Where a SOURCE rectangle lands on the output canvas, for the verbs that
 * redraw the whole picture into `outW × outH`.
 *
 * `drawEdit`'s pixelate arm paints the background with
 * `drawImage(source, 0, 0, outW, outH)`, so the source→output mapping is one
 * factor per axis — `outW / srcW` and `outH / srcH`, which are the ratios
 * `fitWithinCanvas` actually produced after its rounding, not the unrounded
 * `canvasFitScale`. Anything drawn on top has to go through the same mapping.
 *
 * It is not decoration. Measured before this existed, on a 9504 × 6336 frame
 * (a 61 MP full-frame camera, the same file `canvasFitScale` cites) planned to
 * 8192 × 5461: a region at (8000, 5000) 800 × 600 had its blocks painted at
 * (8000, 5000) on an 8192-wide canvas — zero overlap with the content the user
 * had selected, which came out of a redaction-shaped tool fully legible, while
 * a block patch was stamped over a different part of the picture. Below the
 * ceiling `outW === srcW`, the scale is 1 and nothing moves, which is why the
 * defect only ever appeared on large files.
 *
 * The edges round OUTWARD — floor the near edge, ceil the far one. Rounding to
 * nearest can fall half a pixel short and leave a hairline of the original
 * along an edge of the covered area; over-covering by up to a pixel of the
 * neighbours is the safe direction for a verb whose whole job is hiding
 * something.
 */
export function editDestRect(
  region: EditRect,
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
): EditRect {
  const srcW = positiveInt(srcWidth);
  const srcH = positiveInt(srcHeight);
  const outW = positiveInt(outWidth);
  const outH = positiveInt(outHeight);
  const rect = clampRect(region, srcW, srcH);
  const scaleX = outW / srcW;
  const scaleY = outH / srcH;
  const left = Math.max(0, Math.min(outW - 1, Math.floor(rect.x * scaleX)));
  const top = Math.max(0, Math.min(outH - 1, Math.floor(rect.y * scaleY)));
  const right = Math.min(outW, Math.ceil((rect.x + rect.width) * scaleX));
  const bottom = Math.min(outH, Math.ceil((rect.y + rect.height) * scaleY));
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

// ── drawing ──────────────────────────────────────────────────────

/**
 * Draw ONE output. `index` selects which entry of editOutputPlan to draw
 * (always 0 for single-output verbs). The caller has already sized the canvas
 * to that entry and filled the opaque background if the format needs one.
 */
export function drawEdit(
  ctx: AnyCtx,
  source: CanvasImageSource & DrawableSource,
  edit: ImageEditOptions,
  index: number,
): void {
  const srcW = positiveInt(source.width);
  const srcH = positiveInt(source.height);
  const outW = positiveInt(ctx.canvas.width);
  const outH = positiveInt(ctx.canvas.height);

  switch (edit.kind) {
    case "rotate": {
      ctx.save();
      // Rotate about the OUTPUT centre and draw the source centred on it: for
      // 90/270 the frame has already been transposed by editOutputPlan, so the
      // rotated picture lands exactly inside it with no offset arithmetic.
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate((edit.degrees * Math.PI) / 180);
      // Draw at the size the OUTPUT frame implies, not at natural size. When
      // the source is longer than the canvas ceiling, editOutputPlan shrank the
      // frame uniformly; drawing the source at srcW × srcH into it would crop
      // the picture instead — silently, and only for large files.
      const turned = edit.degrees === 90 || edit.degrees === 270;
      const drawW = turned ? outH : outW;
      const drawH = turned ? outW : outH;
      ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
      return;
    }
    case "flip": {
      ctx.save();
      if (edit.axis === "horizontal") {
        ctx.translate(outW, 0);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(0, outH);
        ctx.scale(1, -1);
      }
      ctx.drawImage(source, 0, 0, outW, outH);
      ctx.restore();
      return;
    }
    case "watermark": {
      ctx.drawImage(source, 0, 0, outW, outH);
      drawWatermark(ctx, edit, outW, outH);
      return;
    }
    case "pixelate": {
      ctx.drawImage(source, 0, 0, outW, outH);
      // outW/outH go with it: the region is chosen in the source's natural
      // pixels and has to be PAINTED in the output's, which are not the same
      // space once the canvas ceiling has scaled the frame down (editDestRect).
      drawPixelatedRegion(ctx, source, edit, srcW, srcH, outW, outH);
      return;
    }
    case "crop-circle": {
      const frame = circleFrame(srcW, srcH, edit.region);
      ctx.drawImage(source, frame.x, frame.y, frame.width, frame.height, 0, 0, outW, outH);
      // destination-in keeps only what the new shape covers, so it erases any
      // opaque background the caller painted first. That is why crop-circle
      // refuses the alpha-less formats rather than quietly producing a black
      // square with a picture in it.
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      ctx.beginPath();
      ctx.arc(outW / 2, outH / 2, Math.min(outW, outH) / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }
    case "border": {
      const b = clampBorders(edit);
      ctx.save();
      ctx.fillStyle = edit.colour;
      ctx.fillRect(0, 0, outW, outH);
      ctx.restore();
      // Same reason as rotate: when the framed size was over the canvas
      // ceiling the whole thing was scaled down, so the picture AND the border
      // offsets scale with it. Drawing at natural size into a shrunken frame
      // cropped the photo and lost the right and bottom borders entirely.
      const framedW = srcW + b.left + b.right;
      const scale = framedW > 0 ? outW / framedW : 1;
      ctx.drawImage(source, b.left * scale, b.top * scale, srcW * scale, srcH * scale);
      return;
    }
    case "split": {
      const cell = editSourceRect(srcW, srcH, edit, index);
      ctx.drawImage(source, cell.x, cell.y, cell.width, cell.height, 0, 0, outW, outH);
      return;
    }
    case "presets": {
      if (edit.fit === "contain") {
        ctx.save();
        ctx.fillStyle = edit.padColour;
        ctx.fillRect(0, 0, outW, outH);
        ctx.restore();
        const scale = Math.min(outW / srcW, outH / srcH);
        const drawW = Math.max(1, Math.round(srcW * scale));
        const drawH = Math.max(1, Math.round(srcH * scale));
        ctx.drawImage(
          source,
          0,
          0,
          srcW,
          srcH,
          Math.round((outW - drawW) / 2),
          Math.round((outH - drawH) / 2),
          drawW,
          drawH,
        );
        return;
      }
      const rect = coverRect(srcW, srcH, outW, outH);
      ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, outW, outH);
      return;
    }
  }
}

// ── internals ────────────────────────────────────────────────────

function positiveInt(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** A user-supplied rectangle, forced inside the source and never empty. */
function clampRect(rect: EditRect, srcW: number, srcH: number): EditRect {
  const x = Math.min(Math.max(0, Math.round(rect.x) || 0), srcW - 1);
  const y = Math.min(Math.max(0, Math.round(rect.y) || 0), srcH - 1);
  const width = Math.min(Math.max(1, Math.round(rect.width) || 1), srcW - x);
  const height = Math.min(Math.max(1, Math.round(rect.height) || 1), srcH - y);
  return { x, y, width, height };
}

/**
 * A circle needs a square frame. With no selection that is the largest square
 * centred on the picture; with one it is the largest square that fits inside
 * the selection, centred on it. Fitting a square rather than stretching the
 * selection is what keeps the result a circle instead of an ellipse the user
 * never asked for.
 */
function circleFrame(srcW: number, srcH: number, region: EditRect | null): EditRect {
  const rect = region ? clampRect(region, srcW, srcH) : { x: 0, y: 0, width: srcW, height: srcH };
  const side = Math.max(1, Math.min(rect.width, rect.height));
  return {
    x: rect.x + Math.round((rect.width - side) / 2),
    y: rect.y + Math.round((rect.height - side) / 2),
    width: side,
    height: side,
  };
}

function clampBorders(edit: Extract<ImageEditOptions, { kind: "border" }>): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const side = (value: number) =>
    Number.isFinite(value) ? Math.min(MAX_BORDER_PX, Math.max(0, Math.round(value))) : 0;
  return {
    top: side(edit.top),
    right: side(edit.right),
    bottom: side(edit.bottom),
    left: side(edit.left),
  };
}

/**
 * The grid a split actually uses. Beyond the 10×10 product cap there is a
 * harder one: a grid finer than the image has pixels would ask for zero-width
 * tiles, and a zero-width tile clamped up to 1 breaks the exact-tiling
 * invariant. Cols can never exceed the source width, rows the source height.
 */
function splitGrid(
  srcW: number,
  srcH: number,
  edit: Extract<ImageEditOptions, { kind: "split" }>,
): { rows: number; cols: number } {
  const count = (value: number, max: number, pixels: number) =>
    Number.isFinite(value) ? Math.min(max, pixels, Math.max(1, Math.round(value))) : 1;
  return {
    rows: count(edit.rows, MAX_SPLIT_ROWS, srcH),
    cols: count(edit.cols, MAX_SPLIT_COLS, srcW),
  };
}

/** One tile's source rectangle, from cumulative rounded edges (see editSourceRect). */
function splitCell(
  srcW: number,
  srcH: number,
  rows: number,
  cols: number,
  row: number,
  col: number,
): EditRect {
  const left = Math.round((col * srcW) / cols);
  const right = Math.round(((col + 1) * srcW) / cols);
  const top = Math.round((row * srcH) / rows);
  const bottom = Math.round(((row + 1) * srcH) / rows);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The centre crop of the source that fills a destination frame edge to edge. */
function coverRect(srcW: number, srcH: number, destW: number, destH: number): EditRect {
  const scale = Math.max(destW / srcW, destH / srcH);
  const width = Math.max(1, Math.min(srcW, Math.round(destW / scale)));
  const height = Math.max(1, Math.min(srcH, Math.round(destH / scale)));
  return {
    x: Math.round((srcW - width) / 2),
    y: Math.round((srcH - height) / 2),
    width,
    height,
  };
}

/** Lower-case, hyphenated, filename-safe — preset labels become download names. */
function labelToStem(label: string): string {
  return String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A scratch surface of the same KIND as the destination.
 *
 * Pixelation is a downscale followed by an upscale, and the intermediate
 * cannot live on the destination canvas: the second draw's source rectangle
 * would overlap its own destination rectangle. Cloning the destination's kind —
 * rather than reaching for a global — is what keeps this module usable on the
 * main thread of a browser that has no OffscreenCanvas, which is the only
 * reason lib/tools/image-edit.ts exists at all.
 */
function scratchContext(ctx: AnyCtx, width: number, height: number): AnyCtx {
  const target = ctx.canvas;
  if (typeof HTMLCanvasElement !== "undefined" && target instanceof HTMLCanvasElement) {
    const element = target.ownerDocument.createElement("canvas");
    element.width = width;
    element.height = height;
    const scratch = element.getContext("2d");
    if (!scratch) throw new Error("Canvas 2D context not available");
    return scratch;
  }
  const scratch = new OffscreenCanvas(width, height).getContext("2d");
  if (!scratch) throw new Error("Canvas 2D context not available");
  return scratch;
}

/**
 * Averaging down and point-sampling back up is what makes the blocks read as
 * blocks: the downscale with smoothing ON gives each block the mean colour of
 * the pixels under it, and the upscale with smoothing OFF stops the browser
 * from feathering the edges back into a blur. A per-pixel loop over a
 * 12-megapixel photo is not an option, which is why this is two drawImage
 * calls and a scratch surface instead.
 */
function drawPixelatedRegion(
  ctx: AnyCtx,
  source: CanvasImageSource & DrawableSource,
  edit: Extract<ImageEditOptions, { kind: "pixelate" }>,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
): void {
  const region = edit.region
    ? clampRect(edit.region, srcW, srcH)
    : { x: 0, y: 0, width: srcW, height: srcH };
  // Where those source pixels ended up on the canvas the background was just
  // drawn onto. Identical to `region` whenever the frame fit the ceiling.
  const dest = editDestRect(region, srcW, srcH, outW, outH);
  const block = Number.isFinite(edit.blockSize)
    ? Math.min(MAX_PIXELATE_BLOCK, Math.max(MIN_PIXELATE_BLOCK, Math.round(edit.blockSize)))
    : MIN_PIXELATE_BLOCK;
  // Counted in SOURCE pixels, because that is what the control promises ("the
  // blocks stay the same size whatever the preview is scaled to") — then held
  // to at least one OUTPUT pixel each. A grid finer than the canvas it lands on
  // is a nearest-neighbour downsample of the mosaic: still no original detail,
  // but aliased blocks instead of blocks, and coarser is the safe direction.
  const blocksW = Math.max(1, Math.min(dest.width, Math.ceil(region.width / block)));
  const blocksH = Math.max(1, Math.min(dest.height, Math.ceil(region.height / block)));

  const scratch = scratchContext(ctx, blocksW, blocksH);
  scratch.imageSmoothingEnabled = true;
  scratch.drawImage(
    source,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    blocksW,
    blocksH,
  );

  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    scratch.canvas,
    0,
    0,
    blocksW,
    blocksH,
    // SOURCE rect above, OUTPUT rect here. Reading `region` in both places is
    // the bug editDestRect exists to stop.
    dest.x,
    dest.y,
    dest.width,
    dest.height,
  );
  ctx.imageSmoothingEnabled = smoothing;
}

/**
 * Stamp the text. The font size is a fraction of the SHORTER edge so the same
 * settings look the same on a portrait and a landscape crop of one photo, and
 * the margin is a fraction of that same edge for the same reason.
 *
 * Corner and centre placements rotate about their own anchor, so a rotated
 * bottom-right stamp stays in the bottom-right corner instead of swinging off
 * the canvas.
 */
function drawWatermark(
  ctx: AnyCtx,
  edit: Extract<ImageEditOptions, { kind: "watermark" }>,
  width: number,
  height: number,
): void {
  const text = typeof edit.text === "string" ? edit.text : "";
  if (text.length === 0) return;

  const shorter = Math.min(width, height);
  // 8px is the floor at which a stamp is still legible at all; below it the
  // "watermark" is a smudge the user cannot read back.
  const fontPx = Math.max(8, Math.round(clamp01(edit.scale) * shorter));
  const angle = (Math.max(-90, Math.min(90, edit.rotationDeg || 0)) * Math.PI) / 180;

  ctx.save();
  ctx.globalAlpha = clamp01(edit.opacity);
  ctx.fillStyle = edit.colour;
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textBaseline = "middle";

  if (edit.position === "tile") {
    const textWidth = Math.max(1, ctx.measureText(text).width);
    // Cover the full diagonal from the centre: at any rotation the rotated
    // grid still reaches every corner.
    const reach = Math.ceil(Math.hypot(width, height) / 2);
    let stepX = textWidth + fontPx * 1.5;
    let stepY = fontPx * 2.5;
    const stamps =
      (Math.floor((2 * reach) / stepX) + 1) * (Math.floor((2 * reach) / stepY) + 1);
    if (stamps > MAX_TILE_STAMPS) {
      const spread = Math.sqrt(stamps / MAX_TILE_STAMPS);
      stepX *= spread;
      stepY *= spread;
    }
    ctx.textAlign = "center";
    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle);
    for (let y = -reach; y <= reach; y += stepY) {
      for (let x = -reach; x <= reach; x += stepX) {
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();
    return;
  }

  const margin = Math.round(shorter * 0.04);
  const half = fontPx / 2;
  let anchorX = width / 2;
  let anchorY = height / 2;
  let align: CanvasTextAlign = "center";
  switch (edit.position) {
    case "top-left":
      anchorX = margin;
      anchorY = margin + half;
      align = "left";
      break;
    case "top-right":
      anchorX = width - margin;
      anchorY = margin + half;
      align = "right";
      break;
    case "bottom-left":
      anchorX = margin;
      anchorY = height - margin - half;
      align = "left";
      break;
    case "bottom-right":
      anchorX = width - margin;
      anchorY = height - margin - half;
      align = "right";
      break;
    case "center":
      break;
  }
  ctx.textAlign = align;
  ctx.translate(anchorX, anchorY);
  ctx.rotate(angle);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
