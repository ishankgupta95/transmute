import type { ProcessedResult } from "@/hooks/useFileProcessor";
import type { ImageEditJobOptions } from "@/lib/workers/image-protocol";
import { canvasToBlob, loadImage } from "./canvas-utils";
import { toDecodableSource } from "./image-convert";
import {
  drawEdit,
  canvasCeilingWarning,
  editOutputPlan,
  editVerbSuffix,
  isMultiOutputEdit,
  needsOpaqueFill,
} from "./image-edit-core";

/**
 * Main-thread mirror of the image worker's `edit` op — the eight verbs on an
 * HTMLCanvasElement instead of an OffscreenCanvas.
 *
 * When this runs: a browser without OffscreenCanvas/createImageBitmap, and SVG
 * sources, which need the DOM's <img> to rasterise at all
 * (workers/image-client.ts decides). Everywhere else the worker copy is what
 * ships — see project_dual_image_impl in the notes.
 *
 * The duplication convert/compress/resize suffer is NOT repeated here: every
 * size, rectangle and draw call comes from image-edit-core.ts, which the worker
 * calls too. What is left in this file is the part that genuinely differs — how
 * a canvas is created, filled and encoded on this side of the boundary.
 *
 * NOT importable from a worker entrypoint: canvas-utils.ts uses `new Image()`
 * and `document`, and image-convert.ts reaches for libheif.
 */

/** Rotate / flip / watermark / pixelate / circle crop / border — one output. */
export async function editImage(
  file: File,
  options: ImageEditJobOptions,
): Promise<ProcessedResult> {
  if (isMultiOutputEdit(options.edit)) {
    // Same refusal as image-client.editImage: split and presets produce a
    // list, and returning only the first of it would silently drop the rest.
    throw new Error(`The ${options.edit.kind} edit produces several files — use editImageToMany.`);
  }
  const results = await editImageToMany(file, options);
  const only = results[0];
  if (!only) throw new Error("Nothing to produce — no output sizes were selected");
  return only;
}

/** split / presets, and the single-output verbs as a one-element list. */
export async function editImageToMany(
  file: File,
  options: ImageEditJobOptions,
): Promise<ProcessedResult[]> {
  const { edit, format, quality } = options;

  // Same refusal as the worker: a circular crop is cut with "destination-in",
  // which would erase the opaque background an alpha-less format needs and
  // leave a black square with a picture in the middle of it.
  if (edit.kind === "crop-circle" && needsOpaqueFill(format)) {
    throw new Error(
      "A circular crop needs a format that can carry transparency. Choose PNG or WebP.",
    );
  }

  // Same front door image-convert.ts uses: it re-wraps SVG with the MIME an
  // <img> needs, pre-decodes HEIC/TIFF, and sniffs the container for the
  // animated-source notice (from the bytes, not the extension — an animated
  // GIF renamed .png still loses every frame past the first here).
  const { blob, warnings } = await toDecodableSource(file);
  const image = await loadImage(blob);
  // `width`/`height` on an <img> that is not being rendered and carries no
  // width/height content attribute ARE the intrinsic dimensions, so these are
  // the same numbers naturalWidth/naturalHeight report — and they are what
  // drawEdit reads off the source.
  const srcWidth = image.naturalWidth;
  const srcHeight = image.naturalHeight;
  if (srcWidth === 0 || srcHeight === 0) {
    throw new Error("Could not determine the image's dimensions");
  }

  const mime = `image/${format}`;
  const ext = format === "jpeg" ? "jpg" : format;
  const stem = file.name.replace(/\.[^.]+$/, "");
  const multi = isMultiOutputEdit(edit);
  const plan = editOutputPlan(srcWidth, srcHeight, edit);
  // Same disclosure the worker path makes, from the same plan flag, so the two
  // pipelines cannot tell a user different things about the same file.
  const shrunk = plan.find((entry) => entry.scaled);
  const notices = shrunk
    ? [...warnings, canvasCeilingWarning(shrunk.width, shrunk.height)]
    : warnings;

  const results: ProcessedResult[] = [];
  for (let index = 0; index < plan.length; index++) {
    const { width, height, label } = plan[index];
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context not available");
    if (needsOpaqueFill(format)) {
      // Alpha-less formats flatten transparency to black without this.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }
    drawEdit(ctx, image, edit, index);

    const blob = await canvasToBlob(canvas, mime, quality);
    // toBlob silently serialises PNG for a type the browser cannot write
    // (image-convert.ts:5-9 records the same trap), so the Blob's own type is
    // checked rather than trusted — a mislabelled file never leaves here.
    if (blob.type && blob.type !== mime) {
      throw new Error(`This browser cannot write ${format.toUpperCase()} images.`);
    }
    results.push({
      blob,
      fileName: `${stem}-${multi ? label : editVerbSuffix(edit)}.${ext}`,
      originalSize: file.size,
      newSize: blob.size,
      // The notices describe the SOURCE, not any one output, so a multi-output
      // run states them once rather than N times.
      ...(index === 0 && notices.length > 0 ? { warnings: notices } : {}),
    });
  }
  return results;
}
