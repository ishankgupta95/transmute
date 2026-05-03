import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { canvasToBlob, loadImage } from "./canvas-utils";

export interface CropData {
  x: number;
  y: number;
  width: number;
  height: number;
  rotate: number;
}

/**
 * Crop an image using Canvas API with the given crop data.
 */
export async function cropImage(
  file: File,
  cropData: CropData,
): Promise<ProcessedResult> {
  const img = await loadImage(file);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cropData.width);
  canvas.height = Math.round(cropData.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  // Handle rotation
  if (cropData.rotate !== 0) {
    const rad = (cropData.rotate * Math.PI) / 180;
    const centerX = img.naturalWidth / 2;
    const centerY = img.naturalHeight / 2;

    // Create a rotated source first
    const rotCanvas = document.createElement("canvas");
    const absCos = Math.abs(Math.cos(rad));
    const absSin = Math.abs(Math.sin(rad));
    rotCanvas.width = Math.round(img.naturalWidth * absCos + img.naturalHeight * absSin);
    rotCanvas.height = Math.round(img.naturalWidth * absSin + img.naturalHeight * absCos);
    const rotCtx = rotCanvas.getContext("2d");
    if (!rotCtx) throw new Error("Canvas 2D context not available");
    rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
    rotCtx.rotate(rad);
    rotCtx.drawImage(img, -centerX, -centerY);

    ctx.drawImage(
      rotCanvas,
      cropData.x,
      cropData.y,
      cropData.width,
      cropData.height,
      0,
      0,
      cropData.width,
      cropData.height,
    );
  } else {
    ctx.drawImage(
      img,
      cropData.x,
      cropData.y,
      cropData.width,
      cropData.height,
      0,
      0,
      cropData.width,
      cropData.height,
    );
  }

  const blob = await canvasToBlob(canvas, "image/png", 1);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}-cropped.png`,
    originalSize: file.size,
    newSize: blob.size,
  };
}

