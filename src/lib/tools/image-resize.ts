import Pica from "pica";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { loadImage } from "./canvas-utils";

export interface ResizePreset {
  label: string;
  width: number;
  height: number;
}

export const RESIZE_PRESETS: ResizePreset[] = [
  { label: "Instagram Post (1080×1080)", width: 1080, height: 1080 },
  { label: "Instagram Story (1080×1920)", width: 1080, height: 1920 },
  { label: "Twitter Header (1500×500)", width: 1500, height: 500 },
  { label: "LinkedIn Banner (1584×396)", width: 1584, height: 396 },
  { label: "Passport Photo (600×600)", width: 600, height: 600 },
  { label: "YouTube Thumbnail (1280×720)", width: 1280, height: 720 },
];

export const PERCENTAGE_PRESETS = [25, 50, 75, 150, 200];

export interface ImageResizeOptions {
  mode: "custom" | "preset" | "percentage";
  width: number;
  height: number;
  lockAspect: boolean;
  percentage: number;
  quality: number; // 0–1
}

export async function resizeImage(
  file: File,
  options: ImageResizeOptions,
): Promise<ProcessedResult> {
  const img = await loadImage(file);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;

  let outW: number;
  let outH: number;

  if (options.mode === "percentage") {
    const scale = options.percentage / 100;
    outW = Math.round(srcW * scale);
    outH = Math.round(srcH * scale);
  } else {
    outW = options.width;
    outH = options.height;
  }

  // Clamp to reasonable bounds
  outW = Math.max(1, Math.min(outW, 8192));
  outH = Math.max(1, Math.min(outH, 8192));

  // Source canvas
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) throw new Error("Canvas 2D context not available");
  srcCtx.drawImage(img, 0, 0);

  // Destination canvas
  const destCanvas = document.createElement("canvas");
  destCanvas.width = outW;
  destCanvas.height = outH;

  // Resize with pica (Lanczos3) — disable web workers to avoid
  // worker context issues in static export builds
  const pica = new Pica({ features: ["js"] });
  await pica.resize(srcCanvas, destCanvas, { quality: 3 });

  // Preserve the source format so transparency survives and the file isn't
  // silently turned into a JPEG. (Forcing JPEG turned transparent PNG/WebP
  // logos into black boxes.) JPEG output is only used for already-opaque
  // JPEG inputs, so no background fill is needed.
  const { mime, ext } = outputFormat(file);
  const blob = await pica.toBlob(destCanvas, mime, options.quality);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}-${outW}x${outH}.${ext}`,
    originalSize: file.size,
    newSize: blob.size,
  };
}

/** Map the source extension to an alpha-safe output format. */
function outputFormat(file: File): { mime: string; ext: string } {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
    case "gif": // may carry transparency (first frame) — keep alpha-capable PNG
    case "svg":
      return { mime: "image/png", ext: "png" };
    case "webp":
    case "avif":
      return { mime: "image/webp", ext: "webp" };
    // bmp/jpg/jpeg carry no alpha → JPEG (a resized BMP as lossless PNG would bloat).
    default:
      return { mime: "image/jpeg", ext: "jpg" };
  }
}

