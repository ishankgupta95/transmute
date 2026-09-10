import type { ProcessedResult } from "@/hooks/useFileProcessor";
import type { EditOutputFormat } from "@/lib/workers/image-protocol";
import { canvasToBlob, fillBackground, mimeSupportsAlpha } from "./canvas-utils";

/** Canvas mime per offered format. */
const CROP_MIME: Record<EditOutputFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Saved extension per offered format — "jpeg" writes `.jpg`, as it does everywhere else here. */
const CROP_EXT: Record<EditOutputFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

/**
 * Said only when the crop that just ran actually held non-opaque pixels — an
 * unrotated crop of an opaque photo flattens nothing and says nothing.
 */
const FLATTENED_TO_WHITE =
  "Transparent areas were filled with white — JPG carries no alpha channel.";

export interface CropImageOptions {
  format: EditOutputFormat;
  /** 0–1. Canvas ignores it for PNG, which is lossless either way. */
  quality: number;
}

export interface CropResult extends ProcessedResult {
  /** The format that was encoded, so the readout reports the run and not the request. */
  format: EditOutputFormat;
}

/**
 * Encode a cropped region that cropperjs has already rendered.
 *
 * The crop *transform* deliberately lives with the cropper instead of being
 * re-derived here. This module used to take `getData()` — x/y/width/height plus
 * a rotation — rebuild the rotated bitmap by hand onto a bounding-box canvas,
 * and then index into it with those coordinates. The two never lined up:
 * `getData()` measures the selection against the rotated on-screen canvas while
 * reporting it in unrotated natural pixels, and the hand-built canvas is larger
 * than the source by `w·|cos| + h·|sin|` with its own origin. Any non-zero
 * rotation therefore cut a region that was offset from the one the user had
 * selected — silently, since the output was still a plausible-looking crop.
 *
 * `Cropper.getCroppedCanvas()` applies rotation, scale and selection in a single
 * transform, and it is the same one driving the preview the user is looking at,
 * so what they see is what they get.
 *
 * `options` is REQUIRED rather than defaulted. This tool was PNG-only until the
 * picker landed, and a defaulted format would let a future caller silently get
 * PNG back while believing it had asked for something. The user-facing default
 * belongs in the UI's own state, which is where it lives.
 */
export async function cropImage(
  croppedCanvas: HTMLCanvasElement,
  file: File,
  options: CropImageOptions,
): Promise<CropResult> {
  const { format, quality } = options;
  const mime = CROP_MIME[format];

  // JPEG carries no alpha. A rotated crop box leaves the corners the image no
  // longer covers transparent, and handing those to the JPEG encoder unfilled
  // writes them BLACK — the trap `canvas-utils.ts`'s `fillBackground` exists
  // for. The fill runs whenever the format lacks alpha, never gated on the
  // probe below: a probe that cannot read pixels returns false, and the cost of
  // believing it would be black corners in the saved file.
  const needsOpaqueFill = !mimeSupportsAlpha(mime);
  const flattened = needsOpaqueFill && cropHasTransparency(croppedCanvas);
  const surface = needsOpaqueFill ? flattenOntoWhite(croppedCanvas) : croppedCanvas;

  const blob = await canvasToBlob(surface, mime, format === "png" ? 1 : quality);

  // Canvas encoders silently substitute PNG for a type they cannot produce
  // (`image-convert.ts:5-9`), which is how a `.bmp` target once shipped PNG
  // bytes. Safari is the live case for WebP. Only the container tells the
  // truth, so sniff it rather than hand over a mislabelled file.
  if (format === "webp" && !(await isWebpBytes(blob))) {
    throw new Error(
      "This browser can't encode WebP images. Choose PNG or JPG instead, or open this page in Chrome or Edge.",
    );
  }

  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}-cropped.${CROP_EXT[format]}`,
    originalSize: file.size,
    newSize: blob.size,
    format,
    warnings: flattened ? [FLATTENED_TO_WHITE] : undefined,
  };
}

/**
 * Composite the crop over opaque white on a fresh canvas.
 *
 * Order is load-bearing: the background is painted FIRST and the crop drawn
 * over it. Filling afterwards would cover the picture, and not filling at all
 * is the black-corners bug above.
 */
function flattenOntoWhite(source: HTMLCanvasElement): HTMLCanvasElement {
  const flat = document.createElement("canvas");
  flat.width = source.width;
  flat.height = source.height;
  const ctx = flat.getContext("2d");
  // No silent fall back to encoding `source` directly: that is exactly the
  // black-corner output this function exists to prevent.
  if (!ctx) throw new Error("Could not prepare the opaque background this format needs");
  fillBackground(ctx, flat.width, flat.height);
  ctx.drawImage(source, 0, 0);
  return flat;
}

/**
 * True when the crop holds any non-opaque pixel.
 *
 * `canvas-utils`' `imageHasTransparency` answers the same question about a
 * decoded `<img>`; the cropped surface is already a canvas, and wrapping it
 * back in an `<img>` would cost an encode plus a decode to learn nothing new.
 * Probed at reduced resolution for the same reason that one is — a full-res
 * `getImageData` on a 12 MP crop is a costly synchronous main-thread read, and
 * the transparency this tool creates (the corners a rotated crop box does not
 * cover) spans large regions that survive a downsample.
 */
function cropHasTransparency(canvas: HTMLCanvasElement): boolean {
  const { width, height } = canvas;
  if (!width || !height) return false;
  const scale = Math.min(1, 256 / Math.max(width, height));
  const pw = Math.max(1, Math.round(width * scale));
  const ph = Math.max(1, Math.round(height * scale));
  const probe = document.createElement("canvas");
  probe.width = pw;
  probe.height = ph;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(canvas, 0, 0, pw, ph);
  try {
    const { data } = ctx.getImageData(0, 0, pw, ph);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
  } catch {
    // A read that fails claims nothing. The fill has already happened.
    return false;
  }
  return false;
}

/**
 * True when the bytes really are a WebP container ("RIFF" at 0, "WEBP" at 8).
 * Mirrors `pdf-engine.ts`'s `isWebpBytes`, which guards the same encoder lie.
 */
async function isWebpBytes(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return (
    head.length === 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  );
}
