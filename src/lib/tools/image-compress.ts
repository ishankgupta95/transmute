import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { loadImage } from "./canvas-utils";

export interface ImageCompressOptions {
  mode: "quality" | "target-size";
  quality: number; // 0–1 for quality mode
  targetSizeKb: number; // target in KB for target-size mode
}

/**
 * Compress an image via Canvas re-encoding.
 * In "quality" mode, uses the given quality directly.
 * In "target-size" mode, uses binary search to find the quality
 * that produces a file at or under the target size.
 */
export async function compressImage(
  file: File,
  options: ImageCompressOptions,
): Promise<ProcessedResult> {
  const img = await loadImage(file);

  if (options.mode === "quality") {
    const blob = await encodeToJpeg(img, options.quality);
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return {
      blob,
      fileName: `${baseName}-compressed.jpg`,
      originalSize: file.size,
      newSize: blob.size,
    };
  }

  // Target-size mode: binary search for optimal quality
  const targetBytes = options.targetSizeKb * 1024;
  let lo = 0.01;
  let hi = 1.0;
  let bestBlob = await encodeToJpeg(img, hi);

  // If max quality is already under target, just return it
  if (bestBlob.size <= targetBytes) {
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return {
      blob: bestBlob,
      fileName: `${baseName}-compressed.jpg`,
      originalSize: file.size,
      newSize: bestBlob.size,
    };
  }

  // Track the smallest blob we've seen (fallback if we never get under target)
  let smallestBlob = bestBlob;

  // Binary search: up to 10 iterations
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const candidate = await encodeToJpeg(img, mid);

    // Always track the smallest result we've produced
    if (candidate.size < smallestBlob.size) {
      smallestBlob = candidate;
    }

    if (candidate.size <= targetBytes) {
      bestBlob = candidate;
      lo = mid;
    } else {
      hi = mid;
    }

    // Close enough (within 5% of target)
    if (candidate.size <= targetBytes && candidate.size > targetBytes * 0.95) {
      bestBlob = candidate;
      break;
    }
  }

  // If we never got under target, use the smallest blob we found
  if (bestBlob.size > targetBytes) {
    bestBlob = smallestBlob;
  }

  const baseName = file.name.replace(/\.[^.]+$/, "");
  return {
    blob: bestBlob,
    fileName: `${baseName}-compressed.jpg`,
    originalSize: file.size,
    newSize: bestBlob.size,
  };
}


function encodeToJpeg(img: HTMLImageElement, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas export failed"));
      },
      "image/jpeg",
      quality,
    );
  });
}
