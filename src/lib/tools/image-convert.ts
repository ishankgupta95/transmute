import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { canvasToBlob, fillBackground, loadImage, mimeSupportsAlpha } from "./canvas-utils";
import { fileFirstFrameWarning, tiffPageWarning } from "./image-frames";

/**
 * BMP is deliberately absent as a *target*: `canvas.toBlob` is only required to
 * support PNG and silently falls back to it for any type the browser can't
 * encode, so asking for `image/bmp` produced PNG bytes wearing a `.bmp` name.
 * It remains a perfectly good *source* format — the browser decodes it fine.
 */
export interface ImageConvertOptions {
  targetFormat: "jpeg" | "png" | "webp";
  quality: number; // 0–1
  width?: number;
  height?: number;
}

/**
 * Convert an image file to the target format using Canvas API.
 * Handles HEIC (via heic2any), TIFF (via utif2), SVG, and all
 * browser-native formats.
 */
export async function convertImage(
  file: File,
  options: ImageConvertOptions,
): Promise<ProcessedResult> {
  const { targetFormat, quality, width, height } = options;
  const mimeType = `image/${targetFormat}`;

  // Get a decodable blob — special handling for HEIC and TIFF. Warnings ride
  // along: a multi-page TIFF or animated GIF/WebP loses everything past its
  // first raster here, and the result must say so.
  const { blob: decodableBlob, warnings } = await toDecodableSource(file);

  // Load into an HTMLImageElement
  const img = await loadImage(decodableBlob);

  // Determine output dimensions. An SVG without width/height attributes has
  // no intrinsic size — Firefox reports naturalWidth 0 and Chromium invents
  // the CSS replaced-element default (300×150), so the old code produced a
  // 0×0 or 300×150 PNG regardless of the drawing. When the document itself
  // declares no size, its viewBox (scaled to a usable raster) wins over
  // whatever the UA made up.
  let intrinsicWidth = img.naturalWidth;
  let intrinsicHeight = img.naturalHeight;
  if (isSvgSource(file)) {
    const fallback = svgFallbackSize(await file.text());
    if (fallback && (!fallback.explicit || intrinsicWidth === 0 || intrinsicHeight === 0)) {
      intrinsicWidth = fallback.width;
      intrinsicHeight = fallback.height;
    }
  }
  if (intrinsicWidth === 0 || intrinsicHeight === 0) {
    throw new Error("Could not determine the image's dimensions");
  }

  const outWidth = width ?? intrinsicWidth;
  const outHeight = height ?? intrinsicHeight;

  // Draw to canvas and export
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  // JPEG/BMP have no alpha channel: paint white first so transparent regions
  // flatten to white instead of black.
  if (!mimeSupportsAlpha(mimeType)) fillBackground(ctx, outWidth, outHeight);
  ctx.drawImage(img, 0, 0, outWidth, outHeight);

  const blob = await canvasToBlob(canvas, mimeType, quality);
  const ext = targetFormat === "jpeg" ? "jpg" : targetFormat;
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}.${ext}`,
    originalSize: file.size,
    newSize: blob.size,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function isSvgSource(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "svg" || file.type === "image/svg+xml";
}

/**
 * Raster size for an SVG. `explicit: true` means the document declares its
 * own width/height (returned as-is — the browser's naturalWidth agrees, and
 * an author-chosen 240px SVG must not be inflated). `explicit: false` means
 * the size came from the viewBox, scaled so the longest edge is 1024 px —
 * a viewBox of 24×24 units would otherwise rasterise into an unusable
 * thumbnail. Exported for unit tests.
 */
export function svgFallbackSize(
  svgText: string,
): { width: number; height: number; explicit: boolean } | null {
  const attr = (name: string): number | null => {
    const m = svgText.match(new RegExp(`<svg[^>]*\\s${name}="([0-9.]+)(?:px)?"`, "i"));
    return m ? Number(m[1]) : null;
  };
  const w = attr("width");
  const h = attr("height");
  if (w && h && Number.isFinite(w) && Number.isFinite(h)) {
    return { width: Math.round(w), height: Math.round(h), explicit: true };
  }
  const vb = svgText.match(
    /<svg[^>]*\sviewBox="[\s]*([-0-9.]+)[ ,]+([-0-9.]+)[ ,]+([0-9.]+)[ ,]+([0-9.]+)/i,
  );
  if (!vb) return null;
  const vw = Number(vb[3]);
  const vh = Number(vb[4]);
  if (!vw || !vh || !Number.isFinite(vw) || !Number.isFinite(vh)) return null;
  const scale = Math.max(1, 1024 / Math.max(vw, vh));
  return { width: Math.round(vw * scale), height: Math.round(vh * scale), explicit: false };
}

/** A pre-decoded source plus any notices generated while producing it. */
export interface DecodableSource {
  blob: Blob;
  /** User-facing notices (multi-page TIFF, animated GIF/WebP flattened). */
  warnings: string[];
}

/**
 * Return a blob the browser's <img> can decode, plus warnings about what the
 * pre-decode dropped. HEIC/HEIF and TIFF are pre-decoded to PNG; SVG is
 * re-wrapped with the right MIME; everything else is returned as-is (with an
 * animated GIF/WebP sniff — the eventual <img>/createImageBitmap decode keeps
 * only frame 0 and says nothing).
 */
export async function toDecodableSource(file: File): Promise<DecodableSource> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  // HEIC / HEIF
  if (ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif") {
    const heic2any = (await import("heic2any")).default;
    const result = await heic2any({ blob: file, toType: "image/png" });
    return { blob: Array.isArray(result) ? result[0] : result, warnings: [] };
  }

  // TIFF
  if (ext === "tiff" || ext === "tif" || file.type === "image/tiff") {
    return await decodeTiff(file);
  }

  // SVG — wrap in blob with correct MIME so <img> can decode it
  if (ext === "svg" || file.type === "image/svg+xml") {
    return {
      blob: new Blob([await file.arrayBuffer()], { type: "image/svg+xml" }),
      warnings: [],
    };
  }

  // Everything else (JPEG, PNG, WebP, BMP, AVIF, GIF) — browser decodes natively
  const warning = await fileFirstFrameWarning(file);
  return { blob: file, warnings: warning ? [warning] : [] };
}

/** Back-compat wrapper for callers that only need the pixels (exif-viewer). */
export async function toDecodableBlob(file: File): Promise<Blob> {
  return (await toDecodableSource(file)).blob;
}

/**
 * An opened TIFF: page count up front, pixels decoded per page on demand.
 * Pages are decoded lazily and one at a time on purpose — scan/fax TIFFs run
 * to hundreds of pages, and eagerly decoding them all to RGBA would OOM a
 * mobile tab. Wave 1's tiff-to-pdf calls `page(i)` for every page; the
 * converters below only ever ask for page 0.
 */
export interface TiffDocument {
  pageCount: number;
  page(index: number): { rgba: Uint8Array; width: number; height: number };
}

export async function openTiff(arrayBuffer: ArrayBuffer): Promise<TiffDocument> {
  const UTIF = await import("utif2");
  const ifds = UTIF.decode(arrayBuffer);
  if (ifds.length === 0) throw new Error("Could not decode TIFF file");
  return {
    pageCount: ifds.length,
    page(index) {
      const ifd = ifds[index];
      if (!ifd) throw new Error(`This TIFF has no page ${index + 1}`);
      UTIF.decodeImage(arrayBuffer, ifd);
      const result = {
        rgba: new Uint8Array(UTIF.toRGBA8(ifd)),
        width: ifd.width,
        height: ifd.height,
      };
      // utif2 memoizes the decompressed native bitmap on the IFD and the
      // closure keeps every IFD alive, so a per-page sweep (tiff-to-pdf)
      // would otherwise retain ALL pages' bitmaps at once. Dropping it keeps
      // "one page at a time" true; decodeImage re-decodes if asked again.
      delete (ifd as { data?: Uint8Array }).data;
      return result;
    },
  };
}

async function decodeTiff(file: File): Promise<DecodableSource> {
  const doc = await openTiff(await file.arrayBuffer());
  const { rgba, width: w, height: h } = doc.page(0);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  const imageData = ctx.createImageData(w, h);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);

  const warning = tiffPageWarning(doc.pageCount);
  return { blob: await canvasToBlob(canvas, "image/png", 1), warnings: warning ? [warning] : [] };
}

