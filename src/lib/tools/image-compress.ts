import type { ProcessedResult } from "@/hooks/useFileProcessor";
import {
  fillBackground,
  imageHasTransparency,
  loadImage,
  mimeSupportsAlpha,
} from "./canvas-utils";

export interface ImageCompressOptions {
  mode: "quality" | "target-size";
  quality: number; // 0–1 for quality mode
  targetSizeKb: number; // target in KB for target-size mode
}

/** Choose an output format that compresses well *and* preserves transparency. */
function chooseOutput(file: File, img: HTMLImageElement): { mime: string; ext: string } {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mightHaveAlpha =
    ["png", "webp", "gif", "avif"].includes(ext) || /(png|webp|gif|avif)/.test(file.type);
  // WebP gives lossy compression (so the quality slider / binary search work)
  // while keeping the alpha channel; JPEG would turn transparency black.
  if (mightHaveAlpha && imageHasTransparency(img)) {
    return { mime: "image/webp", ext: "webp" };
  }
  return { mime: "image/jpeg", ext: "jpg" };
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
  const { mime, ext } = chooseOutput(file, img);
  const baseName = file.name.replace(/\.[^.]+$/, "");
  const fileName = `${baseName}-compressed.${ext}`;

  if (options.mode === "quality") {
    const blob = await encodeImage(img, mime, options.quality);
    return { blob, fileName, originalSize: file.size, newSize: blob.size };
  }

  // Target-size mode: binary search for optimal quality
  const targetBytes = options.targetSizeKb * 1024;
  let lo = 0.01;
  let hi = 1.0;
  let bestBlob = await encodeImage(img, mime, hi);

  // If max quality is already under target, just return it
  if (bestBlob.size <= targetBytes) {
    return { blob: bestBlob, fileName, originalSize: file.size, newSize: bestBlob.size };
  }

  // Track the smallest blob we've seen (fallback if we never get under target)
  let smallestBlob = bestBlob;

  // Binary search: up to 10 iterations
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const candidate = await encodeImage(img, mime, mid);

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

  return { blob: bestBlob, fileName, originalSize: file.size, newSize: bestBlob.size };
}

function encodeImage(img: HTMLImageElement, mime: string, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  // Formats without alpha need an opaque backdrop, otherwise transparent
  // pixels flatten to black.
  if (!mimeSupportsAlpha(mime)) fillBackground(ctx, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas export failed"));
      },
      mime,
      quality,
    );
  });
}
