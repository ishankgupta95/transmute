/**
 * Message shapes shared by the recompress-pdf-images wrapper (main thread),
 * pdf-image.worker.ts and the UI, plus the quality presets both sides need.
 *
 * LEAF MODULE — no runtime imports at all, for the two reasons pdf-protocol.ts
 * spells out. The UI imports the mode types and the preset table at render
 * time, and a static import that reaches pdf-image-core (or anything
 * re-exporting from it) drags the whole 705 KB pdf-lib chunk into the eager
 * bundle; and a worker entrypoint whose import chain reaches a module naming
 * the worker's own URL hangs `next build` at 0% CPU.
 *
 * The input is structured-cloned, NOT transferred: the UI keeps the loaded
 * PDF's bytes to re-run at another quality, and to hand the original back when
 * the output came out bigger.
 */

/** 0.01–1.0, the JPEG quality handed to the encoder. */
export type PdfImageMode =
  | { kind: "quality"; quality: number }
  | { kind: "target"; targetSizeKb: number; quality: number };

/**
 * Why one image XObject was left exactly as it was found. Skips are a feature,
 * not a failure: each of these is a shape where a canvas round-trip would
 * change what the page LOOKS like, not just how many bytes it takes, so the
 * honest move is to leave the image alone and say so on screen.
 *
 * - `filter` — not a DCTDecode (JPEG) stream. JPX, CCITTFax, JBIG2 and Flate
 *   images all land here; v1 re-encodes JPEG only.
 * - `mask` — the image is a soft/stencil mask, or carries one. Rewriting a
 *   mask to RGB breaks the transparency it describes.
 * - `decode-parms` / `decode-array` — the stream declares filter parameters or
 *   a sample-inversion array that a re-encode would silently invalidate.
 * - `colour-space` — anything but DeviceRGB or DeviceGray, CMYK included.
 * - `bit-depth` — samples that are not 8 bits per component.
 * - `no-smaller` — re-encoding produced MORE bytes, so the original was kept.
 * - `undecodable` — the browser's decoder refused the JPEG.
 */
export type PdfImageSkipReason =
  | "filter"
  | "mask"
  | "decode-parms"
  | "decode-array"
  | "colour-space"
  | "bit-depth"
  | "no-smaller"
  | "undecodable";

export interface PdfImageSkip {
  reason: PdfImageSkipReason;
  count: number;
  /** Human detail, e.g. the filter name that was found. Optional. */
  detail?: string;
}

export interface PdfImageStats {
  /** Every image XObject found in the document. */
  imagesFound: number;
  /** How many were actually replaced with smaller bytes. */
  imagesRecompressed: number;
  /** Grouped skip counts; sums with imagesRecompressed to imagesFound. */
  skipped: PdfImageSkip[];
  /** The JPEG quality of the winning pass. */
  quality: number;
  /** Linear dimension scale of the winning pass; 1 = original dimensions. */
  scale: number;
  /** null in quality mode; in target mode, whether the target was reached. */
  targetMet: boolean | null;
  /** Whole-document rebuild passes performed. */
  passes: number;
}

export type PdfImageJob = {
  op: "recompressPdfImages";
  data: Uint8Array;
  mode: PdfImageMode;
};

export type PdfImageJobResult = { bytes: Uint8Array; stats: PdfImageStats };

/** Quality presets the UI offers. Exported here so UI and engine cannot drift. */
export const PDF_IMAGE_QUALITY_PRESETS = {
  high: 0.75,
  medium: 0.6,
  low: 0.45,
} as const;

export type PdfImageQualityPreset = keyof typeof PDF_IMAGE_QUALITY_PRESETS;
