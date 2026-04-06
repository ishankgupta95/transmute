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

function medianCut(
  pixels: [number, number, number][],
  depth: number,
): [number, number, number][][] {
  if (depth <= 0 || pixels.length === 0) {
    return [pixels];
  }

  // Find channel with greatest range
  let maxRange = 0;
  let splitChannel = 0;
  for (let c = 0; c < 3; c++) {
    let min = 255;
    let max = 0;
    for (const px of pixels) {
      if (px[c] < min) min = px[c];
      if (px[c] > max) max = px[c];
    }
    const range = max - min;
    if (range > maxRange) {
      maxRange = range;
      splitChannel = c;
    }
  }

  // Sort by that channel and split at median
  pixels.sort((a, b) => a[splitChannel] - b[splitChannel]);
  const mid = Math.floor(pixels.length / 2);

  return [
    ...medianCut(pixels.slice(0, mid), depth - 1),
    ...medianCut(pixels.slice(mid), depth - 1),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
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
