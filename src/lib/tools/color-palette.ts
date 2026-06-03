import { loadImage } from "./canvas-utils";

export interface ColorInfo {
  hex: string;
  rgb: [number, number, number];
  frequency: number; // 0–1
}

/**
 * Extract dominant colors from an image using median-cut color quantization.
 */
export async function extractColorPalette(
  file: File,
  colorCount: number = 8,
): Promise<ColorInfo[]> {
  const img = await loadImage(file);

  // Sample at reduced resolution for speed
  const maxDim = 200;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const pixels = imageData.data;

  // Collect all pixels as [r, g, b]
  const rgbPixels: [number, number, number][] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue; // skip transparent
    rgbPixels.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }

  if (rgbPixels.length === 0) {
    return [{ hex: "#000000", rgb: [0, 0, 0], frequency: 1 }];
  }

  // Median cut quantization
  const buckets = medianCut(rgbPixels, colorCount);

  // Calculate averages and frequencies
  const totalPixels = rgbPixels.length;
  const colors: ColorInfo[] = buckets
    .map((bucket) => {
      const avg: [number, number, number] = [0, 0, 0];
      for (const px of bucket) {
        avg[0] += px[0];
        avg[1] += px[1];
        avg[2] += px[2];
      }
      avg[0] = Math.round(avg[0] / bucket.length);
      avg[1] = Math.round(avg[1] / bucket.length);
      avg[2] = Math.round(avg[2] / bucket.length);

      return {
        hex: rgbToHex(avg[0], avg[1], avg[2]),
        rgb: avg,
        frequency: bucket.length / totalPixels,
      };
    })
    .sort((a, b) => b.frequency - a.frequency);

  return colors;
}

/**
 * Iterative median-cut quantization. Repeatedly splits the bucket with the
 * widest channel range until we reach `targetCount` buckets (or no bucket can
 * be split further). Returns at most `targetCount` NON-EMPTY buckets — the old
 * recursive version treated the count as a depth, yielding 2^N buckets and
 * empty buckets that rendered as "#NaNNaNNaN" swatches.
 */
function medianCut(
  pixels: [number, number, number][],
  targetCount: number,
): [number, number, number][][] {
  if (pixels.length === 0 || targetCount <= 1) {
    return pixels.length ? [pixels] : [];
  }

  const buckets: [number, number, number][][] = [pixels];

  while (buckets.length < targetCount) {
    let bestIdx = -1;
    let bestRange = -1;
    let bestChannel = 0;

    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (bucket.length < 2) continue; // can't split a single pixel
      for (let c = 0; c < 3; c++) {
        let min = 255;
        let max = 0;
        for (const px of bucket) {
          if (px[c] < min) min = px[c];
          if (px[c] > max) max = px[c];
        }
        const range = max - min;
        // Only split buckets that actually span >1 colour — splitting a uniform
        // bucket would produce duplicate swatches. When no splittable bucket
        // remains we return fewer than targetCount distinct colours.
        if (range > bestRange && range > 0) {
          bestRange = range;
          bestIdx = i;
          bestChannel = c;
        }
      }
    }

    if (bestIdx === -1) break; // nothing left to split

    const bucket = buckets[bestIdx];
    bucket.sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = Math.floor(bucket.length / 2);
    buckets.splice(bestIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
  }

  return buckets.filter((b) => b.length > 0);
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

