/**
 * Icon rasterisation helpers.
 *
 * The favicon/ICO tools paint a source image into square canvases. Drawing it
 * as `drawImage(img, 0, 0, size, size)` STRETCHES a non-square source into the
 * square — an 800×600 photo comes out squashed 4:3 → 1:1 — while the on-screen
 * preview (`object-contain`) letterboxes it. What the user approves has to be
 * what lands in the file, so the draw fits instead of stretching.
 */

/** The minimal surface these helpers need — keeps them testable without a DOM canvas. */
type Drawable = {
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
};

/**
 * Draw `img` centred inside a `size`×`size` box, preserving its aspect ratio.
 * The leftover margin is left untouched — transparent for PNG/ICO frames,
 * since `encodeIcoAsync` embeds each frame as a 32bpp PNG.
 */
export function drawContained(
  ctx: Drawable,
  img: HTMLImageElement,
  size: number,
): void {
  // SVG sources can decode with no intrinsic size; falling back to `size`
  // makes the scale 1 and the draw a plain fill rather than a divide-by-zero.
  const iw = img.naturalWidth || size;
  const ih = img.naturalHeight || size;
  const scale = Math.min(size / iw, size / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
}
