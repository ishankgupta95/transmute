import Pica from "pica";
import type { ProcessedResult } from "@/hooks/useFileProcessor";

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

  const blob = await pica.toBlob(destCanvas, "image/jpeg", options.quality);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}-${outW}x${outH}.jpg`,
    originalSize: file.size,
    newSize: blob.size,
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(file);
  });
}
