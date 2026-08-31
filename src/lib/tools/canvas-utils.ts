export function loadImage(blob: Blob): Promise<HTMLImageElement> {
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
    img.src = URL.createObjectURL(blob);
  });
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas export failed"));
      },
      mimeType,
      quality,
    );
  });
}

/** Only PNG and WebP carry an alpha channel through Canvas encoding. */
export function mimeSupportsAlpha(mimeType: string): boolean {
  return mimeType === "image/png" || mimeType === "image/webp";
}

/**
 * Paint an opaque background. Call this BEFORE drawImage whenever the output
 * format has no alpha channel (JPEG), otherwise transparent pixels are
 * flattened to black instead of the expected white.
 */
export function fillBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color = "#ffffff",
): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
}

/** Returns true if the decoded image contains any non-opaque pixel. */
export function imageHasTransparency(img: HTMLImageElement): boolean {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return false;
  // Probe at reduced resolution — a full-res getImageData read on a large photo
  // is a costly synchronous main-thread op and we only need to know whether any
  // alpha exists (transparency in logos/icons spans large regions).
  const scale = Math.min(1, 256 / Math.max(w, h));
  const pw = Math.max(1, Math.round(w * scale));
  const ph = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, pw, ph);
  try {
    const { data } = ctx.getImageData(0, 0, pw, ph);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
  } catch {
    return false;
  }
  return false;
}
