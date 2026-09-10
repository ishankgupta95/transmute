/**
 * Dimension-stepping policy for the compress-to-target-size engine.
 *
 * The KB targeter binary-searches encode QUALITY at fixed dimensions, and
 * quality has a floor: a 4000×3000 photo cannot reach 20 KB at any quality,
 * because JPEG/WebP overhead scales with pixel count. When the full quality
 * search at the current dimensions bottoms out above the target, the engine
 * steps the dimensions down using this module's policy and searches again —
 * the mechanism the Wave 1 resize-image-to-20kb/50kb pages are built on.
 *
 * BOTH image pipelines (image.worker.ts and the lib/tools/image-compress.ts
 * fallback) consume these same functions, so the stepping behaviour — and the
 * exact user-facing "Scaled to …" notice — cannot drift between them.
 *
 * LEAF MODULE — no runtime imports. The image worker bundles this file, and a
 * worker entrypoint whose import chain reaches back to a module that names the
 * worker's own URL hangs the production build.
 */

/** Hard cap on downscale passes; the sqrt heuristic converges in 1–3. */
export const MAX_DIMENSION_STEPS = 6;

/** Never scale the longest side below this — a 63-px "photo" helps nobody. */
export const MIN_LONGEST_SIDE = 64;

/**
 * Per-step scale-factor clamp. ≤ 0.9 guarantees real progress even when the
 * estimate says "almost there"; ≥ 0.5 keeps one wild over-estimate from
 * obliterating detail that a gentler step (plus a fresh quality search at the
 * new size) would have kept.
 */
export const MIN_SCALE_FACTOR = 0.5;
export const MAX_SCALE_FACTOR = 0.9;

/**
 * The linear scale factor for the next dimension step, from how far over the
 * target the smallest achieved encode is. Encoded size tracks pixel COUNT,
 * and pixel count is quadratic in the linear scale, so sqrt(target/current)
 * aims one step straight at the target. Always clamped to
 * [MIN_SCALE_FACTOR, MAX_SCALE_FACTOR]; degenerate inputs get the strongest
 * shrink rather than NaN.
 */
export function nextScale(currentBytes: number, targetBytes: number): number {
  const ratio = targetBytes / currentBytes;
  const factor = Number.isFinite(ratio) && ratio > 0 ? Math.sqrt(ratio) : MIN_SCALE_FACTOR;
  return Math.min(MAX_SCALE_FACTOR, Math.max(MIN_SCALE_FACTOR, factor));
}

/**
 * One dimension step: integer dims, aspect ratio preserved, factor clamped,
 * and the longest side never taken below MIN_LONGEST_SIDE — a step that would
 * cross the floor lands exactly on it instead. Returns null when no further
 * shrink is allowed (already at the floor, or degenerate input), which is the
 * stepping loop's stop signal. The longest side strictly decreases on every
 * non-null step, so the loop always terminates.
 */
export function stepDimensions(
  width: number,
  height: number,
  factor: number,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  const longest = Math.max(width, height);
  if (longest <= MIN_LONGEST_SIDE) return null;
  const clamped = Number.isFinite(factor)
    ? Math.min(MAX_SCALE_FACTOR, Math.max(MIN_SCALE_FACTOR, factor))
    : MIN_SCALE_FACTOR;
  // Land exactly on the floor rather than jumping past it.
  const scale = Math.max(clamped, MIN_LONGEST_SIDE / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The user-facing note attached when a downscale produced the final output.
 * One producer, one exact string — both pipelines emit it through here, and
 * the e2e suite asserts on the wording.
 */
export function scaledToTargetWarning(width: number, height: number): string {
  return `Scaled to ${width}×${height} to reach the target size.`;
}

/**
 * The document-level counterpart to `scaledToTargetWarning`, for the PDF image
 * recompressor: one PDF holds many images at many sizes, so there is no single
 * W×H to name — the honest disclosure is the factor the images were scaled by.
 * One producer, one exact string.
 *
 * The trailing clause is not padding. The factor is applied per image through
 * the same `MIN_LONGEST_SIDE` floor this module owns, so an image whose longest
 * side would fall below it is scaled LESS than the number quoted here (a 40 px
 * bullet icon is not ground to 20 px to save four bytes). Stating the factor
 * flatly would therefore be false for exactly those images, which is the kind
 * of small, checkable inaccuracy this project treats as a bug.
 */
export function scaledImagesWarning(scale: number): string {
  return (
    `Images scaled to ${Math.round(scale * 100)}% of their original size to reach the target — ` +
    `except any that would have fallen below ${MIN_LONGEST_SIDE}px, which were scaled less.`
  );
}
