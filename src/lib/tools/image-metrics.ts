/**
 * Real SSIM for the compare canvas. The design doc shows an SSIM stat on the
 * compressor; the fidelity bar is "structural + honest", so the number is
 * computed, never seeded.
 *
 * The math lives in pure functions over pixel arrays (unit-testable in jsdom);
 * only `ssimFromBlobs` touches canvas, and callers treat it as decoration —
 * a null simply hides the stat.
 */

/** Rec. 601 luma from RGBA bytes, ignoring alpha. */
export function luma(data: Uint8ClampedArray, width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    out[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  return out;
}

const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
const WINDOW = 8;

/**
 * Mean SSIM over non-overlapping 8×8 windows (partial edge windows are
 * skipped; at the ≤256px scale we compare at, they change nothing visible).
 * Inputs are luma planes of identical dimensions. Returns a value in (0, 1].
 */
export function ssim(a: Float64Array, b: Float64Array, width: number, height: number): number {
  if (a.length !== b.length || a.length !== width * height) {
    throw new Error("ssim: dimension mismatch");
  }
  let total = 0;
  let windows = 0;

  for (let wy = 0; wy + WINDOW <= height; wy += WINDOW) {
    for (let wx = 0; wx + WINDOW <= width; wx += WINDOW) {
      let sumA = 0;
      let sumB = 0;
      let sumA2 = 0;
      let sumB2 = 0;
      let sumAB = 0;
      for (let y = wy; y < wy + WINDOW; y++) {
        for (let x = wx; x < wx + WINDOW; x++) {
          const va = a[y * width + x];
          const vb = b[y * width + x];
          sumA += va;
          sumB += vb;
          sumA2 += va * va;
          sumB2 += vb * vb;
          sumAB += va * vb;
        }
      }
      const n = WINDOW * WINDOW;
      const muA = sumA / n;
      const muB = sumB / n;
      const varA = sumA2 / n - muA * muA;
      const varB = sumB2 / n - muB * muB;
      const cov = sumAB / n - muA * muB;

      total +=
        ((2 * muA * muB + C1) * (2 * cov + C2)) /
        ((muA * muA + muB * muB + C1) * (varA + varB + C2));
      windows++;
    }
  }

  // Degenerate inputs (smaller than one window): fall back to a single
  // whole-image window so tiny previews still get a defined score.
  if (windows === 0) {
    let sumA = 0;
    let sumB = 0;
    let sumA2 = 0;
    let sumB2 = 0;
    let sumAB = 0;
    for (let i = 0; i < a.length; i++) {
      sumA += a[i];
      sumB += b[i];
      sumA2 += a[i] * a[i];
      sumB2 += b[i] * b[i];
      sumAB += a[i] * b[i];
    }
    const n = a.length;
    const muA = sumA / n;
    const muB = sumB / n;
    const varA = sumA2 / n - muA * muA;
    const varB = sumB2 / n - muB * muB;
    const cov = sumAB / n - muA * muB;
    return (
      ((2 * muA * muB + C1) * (2 * cov + C2)) /
      ((muA * muA + muB * muB + C1) * (varA + varB + C2))
    );
  }

  return total / windows;
}

/** Long edge for the comparison raster — SSIM is stable well below full size. */
const COMPARE_EDGE = 256;

function drawScaled(bitmap: ImageBitmap, width: number, height: number): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * SSIM between two encoded images, compared at a shared ≤256px raster.
 * Returns null on any decode/canvas failure — the caller hides the stat.
 */
export async function ssimFromBlobs(before: Blob, after: Blob): Promise<number | null> {
  try {
    const [ba, bb] = await Promise.all([createImageBitmap(before), createImageBitmap(after)]);
    try {
      const scale = Math.min(1, COMPARE_EDGE / Math.max(ba.width, ba.height));
      const width = Math.max(1, Math.round(ba.width * scale));
      const height = Math.max(1, Math.round(ba.height * scale));
      const da = drawScaled(ba, width, height);
      const db = drawScaled(bb, width, height);
      if (!da || !db) return null;
      return ssim(luma(da.data, width, height), luma(db.data, width, height), width, height);
    } finally {
      ba.close();
      bb.close();
    }
  } catch {
    return null;
  }
}
