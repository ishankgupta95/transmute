import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { canvasToBlob, fillBackground, loadImage, mimeSupportsAlpha } from "./canvas-utils";

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

  // Get a decodable blob — special handling for HEIC and TIFF
  const decodableBlob = await toDecodableBlob(file);

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

/**
 * Return a blob the browser's <img> can decode. HEIC/HEIF and TIFF are
 * pre-decoded to PNG; SVG is re-wrapped with the right MIME; everything else
 * is returned as-is.
 */
export async function toDecodableBlob(file: File): Promise<Blob> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  // HEIC / HEIF
  if (ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif") {
    const heic2any = (await import("heic2any")).default;
    const result = await heic2any({ blob: file, toType: "image/png" });
    return Array.isArray(result) ? result[0] : result;
  }

  // TIFF
  if (ext === "tiff" || ext === "tif" || file.type === "image/tiff") {
    return await decodeTiff(file);
  }

  // SVG — wrap in blob with correct MIME so <img> can decode it
  if (ext === "svg" || file.type === "image/svg+xml") {
    return new Blob([await file.arrayBuffer()], { type: "image/svg+xml" });
  }

  // Everything else (JPEG, PNG, WebP, BMP, AVIF, GIF) — browser decodes natively
  return file;
}

async function decodeTiff(file: File): Promise<Blob> {
  const UTIF = await import("utif2");
  const arrayBuffer = await file.arrayBuffer();
  const ifds = UTIF.decode(arrayBuffer);
  if (ifds.length === 0) throw new Error("Could not decode TIFF file");
  UTIF.decodeImage(arrayBuffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const w = ifds[0].width;
  const h = ifds[0].height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  const imageData = ctx.createImageData(w, h);
  imageData.data.set(new Uint8Array(rgba));
  ctx.putImageData(imageData, 0, 0);

  return await canvasToBlob(canvas, "image/png", 1);
}

