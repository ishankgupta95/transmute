import type { ProcessedResult } from "@/hooks/useFileProcessor";

export interface ImageConvertOptions {
  targetFormat: "jpeg" | "png" | "webp" | "bmp";
  quality: number; // 0–1
  width?: number;
  height?: number;
}

/**
 * Convert an image file to the target format using Canvas API.
 * Handles HEIC (via heic2any), TIFF (via utif2), SVG, and all
 * browser-native formats.
 */
export async function convertImage(
  file: File,
  options: ImageConvertOptions,
): Promise<ProcessedResult> {
  const { targetFormat, quality, width, height } = options;
  const mimeType = `image/${targetFormat}`;

  // Get a decodable blob — special handling for HEIC and TIFF
  const decodableBlob = await toDecodableBlob(file);

  // Load into an HTMLImageElement
  const img = await loadImage(decodableBlob);

  // Determine output dimensions
  const outWidth = width ?? img.naturalWidth;
  const outHeight = height ?? img.naturalHeight;

  // Draw to canvas and export
  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  ctx.drawImage(img, 0, 0, outWidth, outHeight);

  const blob = await canvasToBlob(canvas, mimeType, quality);
  const ext = targetFormat === "jpeg" ? "jpg" : targetFormat;
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}.${ext}`,
    originalSize: file.size,
    newSize: blob.size,
  };
}

async function toDecodableBlob(file: File): Promise<Blob> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  // HEIC / HEIF
  if (ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif") {
    const heic2any = (await import("heic2any")).default;
    const result = await heic2any({ blob: file, toType: "image/png" });
    return Array.isArray(result) ? result[0] : result;
  }

  // TIFF
  if (ext === "tiff" || ext === "tif" || file.type === "image/tiff") {
    return await decodeTiff(file);
  }

  // SVG — wrap in blob with correct MIME so <img> can decode it
  if (ext === "svg" || file.type === "image/svg+xml") {
    return new Blob([await file.arrayBuffer()], { type: "image/svg+xml" });
  }

  // Everything else (JPEG, PNG, WebP, BMP, AVIF, GIF) — browser decodes natively
  return file;
}

async function decodeTiff(file: File): Promise<Blob> {
  const UTIF = await import("utif2");
  const arrayBuffer = await file.arrayBuffer();
  const ifds = UTIF.decode(arrayBuffer);
  if (ifds.length === 0) throw new Error("Could not decode TIFF file");
  UTIF.decodeImage(arrayBuffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const w = ifds[0].width;
  const h = ifds[0].height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  const imageData = ctx.createImageData(w, h);
  imageData.data.set(new Uint8Array(rgba));
  ctx.putImageData(imageData, 0, 0);

  return await canvasToBlob(canvas, "image/png", 1);
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
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

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
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
