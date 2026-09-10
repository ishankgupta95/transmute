import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { writtenFormat } from "./image-convert";
import {
  fillBackground,
  imageHasTransparency,
  loadImage,
  mimeSupportsAlpha,
} from "./canvas-utils";
import { fileFirstFrameWarning } from "./image-frames";
import {
  MAX_DIMENSION_STEPS,
  nextScale,
  scaledToTargetWarning,
  stepDimensions,
} from "./target-size";

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
 * In "target-size" mode, binary-searches the quality that lands at or under
 * the target size — and when no quality at the current dimensions can get
 * there, steps the dimensions down (policy in target-size.ts) and searches
 * again, telling the user via the "Scaled to …" warning.
 */
/**
 * A "compressor" must never hand back a bigger file. Re-encoding an
 * already-optimised JPEG can grow it (Safari's canvas encoder does this at
 * moderate quality) — in that case the original, unchanged, IS the smallest
 * faithful result.
 */
function neverGrow(file: File, blob: Blob, fileName: string): ProcessedResult {
  if (blob.size >= file.size) {
    return { blob: file, fileName: file.name, originalSize: file.size, newSize: file.size };
  }
  return { blob, fileName, originalSize: file.size, newSize: blob.size };
}

/**
 * The quality half of the target-size engine: binary-search encode quality
 * for the largest result at or under `targetBytes`. Returns that under-target
 * blob (null when quality alone cannot get there) plus the smallest blob
 * seen, which drives the dimension step and is the honest fallback when
 * nothing fits. Mirrored in workers/image.worker.ts.
 */
async function searchQuality(
  encode: (quality: number) => Promise<Blob>,
  targetBytes: number,
): Promise<{ under: Blob | null; smallest: Blob }> {
  let lo = 0.01;
  let hi = 1.0;
  let smallest = await encode(hi);
  if (smallest.size <= targetBytes) return { under: smallest, smallest };

  let under: Blob | null = null;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const candidate = await encode(mid);
    if (candidate.size < smallest.size) smallest = candidate;
    if (candidate.size <= targetBytes) {
      under = candidate;
      lo = mid;
      // Close enough (within 5% of target) — stop refining.
      if (candidate.size > targetBytes * 0.95) break;
    } else {
      hi = mid;
    }
  }
  return { under, smallest };
}

export async function compressImage(
  file: File,
  options: ImageCompressOptions,
): Promise<ProcessedResult> {
  // Canvas re-encoding keeps only the first frame of an animated GIF/WebP —
  // sniff up front so the re-encoded result can say so (the mirror of the
  // worker pipeline's behaviour).
  const frameWarning = await fileFirstFrameWarning(file);
  // Loss warnings attach only to re-encoded outputs: never-grow handing back
  // the untouched original delivers every frame, unscaled — so BOTH notices
  // (frame drop and "Scaled to …") would be false on it, and neither rides.
  const withWarnings = (
    result: ProcessedResult,
    scaledNote: string | null = null,
  ): ProcessedResult => {
    if (result.blob === file) return result;
    const notes = [
      ...(frameWarning ? [frameWarning] : []),
      ...(scaledNote ? [scaledNote] : []),
    ];
    return notes.length > 0 ? { ...result, warnings: notes } : result;
  };

  const img = await loadImage(file);
  const { mime, ext } = chooseOutput(file, img);
  const baseName = file.name.replace(/\.[^.]+$/, "");
  // The extension is settled per encode rather than up front: toBlob
  // substitutes PNG for a type it cannot write, and this path picks WebP for
  // a transparent source, so on a browser without WebP encoding the name has
  // to follow the bytes. See `writtenFormat` for why compress follows the
  // encoder where convert refuses.
  const nameFor = (blob: Blob) =>
    `${baseName}-compressed.${writtenFormat(blob, mime, ext).ext}`;

  if (options.mode === "quality") {
    const blob = await encodeImage(img, mime, options.quality);
    return withWarnings(neverGrow(file, blob, nameFor(blob)));
  }

  // Target-size mode: binary-search quality at the source dimensions first.
  // Stepping (below) only engages when that search bottoms out above the
  // target — a target reachable by quality alone must leave the dims alone.
  const targetBytes = options.targetSizeKb * 1024;
  // Degenerate target (cleared field, 0, NaN): stepping toward it would grind
  // the image to the 64-px floor and present that as success. Encode at the
  // requested quality instead — mirrored in workers/image.worker.ts.
  if (!Number.isFinite(targetBytes) || targetBytes <= 0) {
    const blob = await encodeImage(img, mime, options.quality);
    return withWarnings(neverGrow(file, blob, nameFor(blob)));
  }
  const first = await searchQuality((q) => encodeImage(img, mime, q), targetBytes);
  if (first.under) return withWarnings(neverGrow(file, first.under, nameFor(first.under)));

  // Quality alone cannot reach the target at these dimensions: step the dims
  // down (shared policy in target-size.ts) and search again — the mirror of
  // the worker pipeline's compress(). The sqrt heuristic converges in 1–3
  // steps; the cap bounds total encode work.
  let smallest = first.smallest;
  let smallestDims = { width: img.naturalWidth, height: img.naturalHeight, scaled: false };
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  for (let step = 0; step < MAX_DIMENSION_STEPS; step++) {
    const next = stepDimensions(width, height, nextScale(smallest.size, targetBytes));
    if (!next) break; // at the 64-px floor — nothing smaller is worth making
    ({ width, height } = next);
    const [w, h] = [width, height];
    const result = await searchQuality((q) => encodeImage(img, mime, q, w, h), targetBytes);
    if (result.under) {
      return withWarnings(
        neverGrow(file, result.under, nameFor(result.under)),
        scaledToTargetWarning(w, h),
      );
    }
    if (result.smallest.size < smallest.size) {
      smallest = result.smallest;
      smallestDims = { width: w, height: h, scaled: true };
    }
  }

  // Unreachable even at the floor: the smallest achieved is the honest,
  // closest-possible answer — today's behaviour, now across dimensions too.
  return withWarnings(
    neverGrow(file, smallest, nameFor(smallest)),
    smallestDims.scaled
      ? scaledToTargetWarning(smallestDims.width, smallestDims.height)
      : null,
  );
}

function encodeImage(
  img: HTMLImageElement,
  mime: string,
  quality: number,
  width = img.naturalWidth,
  height = img.naturalHeight,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  // Formats without alpha need an opaque backdrop, otherwise transparent
  // pixels flatten to black.
  if (!mimeSupportsAlpha(mime)) fillBackground(ctx, width, height);
  ctx.drawImage(img, 0, 0, width, height);
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
