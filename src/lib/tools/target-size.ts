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
 * Quality bounds for `searchQuality`'s bisection. The floor is deliberately
 * low: it is a FEASIBILITY probe, not a quality anyone is offered — its only
 * jobs are to answer "can any quality reach this target at these dimensions?"
 * and to stand as the fallback `under` result. The ceiling is the fast path,
 * tried first, for a target that is already satisfied at best quality.
 */
export const QUALITY_FLOOR = 0.01;
export const QUALITY_CEILING = 1.0;

/**
 * Bisection passes after the two bracket encodes. Ten was the historical
 * figure and is kept: with a measured bracket the loop now almost always exits
 * early on the band below, so this is a safety bound rather than a budget.
 */
export const MAX_QUALITY_PASSES = 10;

/**
 * Stop refining once the under-target result is within 5% of the target. Any
 * closer costs another full-resolution encode to win bytes nobody can see.
 */
export const QUALITY_CLOSE_ENOUGH = 0.95;

/**
 * The quality half of the target-size engine: find the largest-quality encode
 * at or under `targetBytes`. Returns that under-target blob (`null` when no
 * quality reaches the target at these dimensions) plus the smallest blob seen,
 * which is what `nextScale` steers the dimension step with and the honest
 * fallback when nothing fits.
 *
 * ONE implementation, called by BOTH pipelines. It used to be copy-pasted into
 * `workers/image.worker.ts` and `tools/image-compress.ts`, each with its own
 * "Mirrored in …" comment pointing at the other — the drift hazard the rest of
 * this module exists to remove, so it lives here with the stepping policy it is
 * interleaved with.
 *
 * ── THE FLOOR PROBE, AND WHY IT IS WORTH AN EXTRA ENCODE ──────────────
 * The search is a bisection on quality, and bisection is the right tool: it is
 * well behaved, it needs nothing but monotonicity, and it lands within the 5%
 * band in a handful of passes. What it cannot do is notice that the target is
 * UNREACHABLE. With `lo` as a bare bound that is never evaluated, every pass
 * overshoots, `under` stays null, and the loop runs its full ten encodes — at
 * full resolution — only to report what one encode at the floor would have
 * said. `compress` then steps the dimensions down and pays it again, per step.
 *
 * So the floor is now measured rather than assumed. MEASURED 2026-11-10 by
 * bundling THIS module and driving it in headless Chromium against a
 * photo-like 4000x3000 source, JPEG, counting real encodes:
 *
 *   target   bisect-only              with floor probe
 *   2000 KB  11 enc  1933134 B        12 enc  1933134 B   4000x3000
 *    500 KB   7 enc   487210 B         8 enc   487210 B   4000x3000
 *    200 KB   6 enc   194811 B         7 enc   194811 B   4000x3000
 *     50 KB  19 enc    48800 B         4 enc    48762 B   2897x2173  ← see below
 *     20 KB  33 enc    17288 B        16 enc    17288 B   1800x1350
 *
 * The chosen DIMENSIONS are identical in all five, and the bytes in four of
 * them. The cost is the one extra encode whenever the target IS reachable and
 * the q=1.0 fast path did not already take it; the saving is the two
 * unreachable rows, which are the expensive ones, and which the
 * /resize-image-to-NNkb ladder pages are built ENTIRELY on — a tiny target on
 * a large photo is their whole premise.
 *
 * The 50 KB row differs by 38 bytes, 0.08%, and is worth understanding rather
 * than smoothing over: at the stepped dimensions the FLOOR encode itself came
 * in at 48762 against a 51200 target, already inside the band below, so it was
 * accepted and no bisection ran. That cannot cost real quality, and the
 * monotonicity of size in quality is why: if the floor is already above
 * `QUALITY_CLOSE_ENOUGH` of the target, every quality that still fits lies in
 * that same 5% of bytes. Accepting it is the same bargain the band has always
 * made — the old code stopped on any under-target candidate inside it too.
 *
 * Interpolating instead of bisecting was tried and rejected: encoded size is
 * strongly convex in quality, so interpolating on size undershoots badly, and
 * on log(size) it still returned 95 KB for a 200 KB target in the measurement
 * above — half the allowed bytes, which is half the picture quality the user
 * asked for. Lower is not better here; the point is to land just under.
 *
 * The probe also closes a real (if narrow) hole. `under` now starts as the
 * floor blob, a measured under-target result, so a target that only a very low
 * quality reaches can no longer fall out of the loop as `under: null`. Ten
 * bisections from [0.01, 1.0] bring `hi` down to about 0.011 and never
 * evaluate the floor itself, so a target reachable only in that last slice
 * used to send a perfectly compressible image off to be downscaled instead.
 */
export async function searchQuality(
  encode: (quality: number) => Promise<Blob>,
  targetBytes: number,
  /** Called once per encode, for the progress bars that count passes. */
  onPass?: () => void,
): Promise<{ under: Blob | null; smallest: Blob }> {
  let hi = QUALITY_CEILING;
  let smallest = await encode(hi);
  onPass?.();
  // Best quality already fits: nothing to search for, and no probe to pay.
  if (smallest.size <= targetBytes) return { under: smallest, smallest };

  let lo = QUALITY_FLOOR;
  const atFloor = await encode(lo);
  onPass?.();
  if (atFloor.size < smallest.size) smallest = atFloor;
  // Not reachable at these dimensions by any quality. Say so now rather than
  // after ten more full-resolution encodes; `compress` steps the dims instead.
  if (atFloor.size > targetBytes) return { under: null, smallest };

  let under = atFloor;
  for (let i = 0; i < MAX_QUALITY_PASSES; i++) {
    // Close enough (within 5% of target) — stop refining.
    if (under.size > targetBytes * QUALITY_CLOSE_ENOUGH) break;
    const mid = (lo + hi) / 2;
    const candidate = await encode(mid);
    onPass?.();
    if (candidate.size < smallest.size) smallest = candidate;
    if (candidate.size <= targetBytes) {
      under = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { under, smallest };
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
