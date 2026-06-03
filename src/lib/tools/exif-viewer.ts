import ExifReader from "exifreader";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { canvasToBlob, fillBackground, loadImage, mimeSupportsAlpha } from "./canvas-utils";
import { toDecodableBlob } from "./image-convert";

export interface ExifEntry {
  tag: string;
  value: string;
  group: string;
}

/**
 * Read all EXIF/metadata from a file and return structured entries.
 */
export async function readExifData(file: File): Promise<ExifEntry[]> {
  const arrayBuffer = await file.arrayBuffer();
  const tags = ExifReader.load(arrayBuffer, { expanded: true });
  const entries: ExifEntry[] = [];

  const groups: Record<string, Record<string, { description: string }>> = {
    exif: (tags.exif ?? {}) as Record<string, { description: string }>,
    gps: (tags.gps ?? {}) as Record<string, { description: string }>,
    iptc: (tags.iptc ?? {}) as Record<string, { description: string }>,
    xmp: (tags.xmp ?? {}) as Record<string, { description: string }>,
    icc: (tags.icc ?? {}) as Record<string, { description: string }>,
  };

  for (const [group, groupTags] of Object.entries(groups)) {
    for (const [tag, data] of Object.entries(groupTags)) {
      if (data && typeof data === "object" && "description" in data) {
        const desc = String(data.description);
        if (desc && desc !== "undefined" && desc !== "[object Object]") {
          entries.push({ tag, value: desc, group });
        }
      }
    }
  }

  return entries;
}

/**
 * Strip all metadata by re-encoding through Canvas.
 */
export async function stripExifData(
  file: File,
  quality: number = 0.92,
): Promise<ProcessedResult> {
  // HEIC/HEIF/TIFF can't be decoded by a plain <img>; pre-decode them. This is
  // the tool's headline use case (stripping GPS from iPhone HEIC photos).
  const decodable = await toDecodableBlob(file);
  const img = await loadImage(decodable);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  // Preserve transparency for PNG/WebP; photos (JPEG/HEIC/TIFF) re-encode to JPEG.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const { mime, outExt } =
    ext === "png"
      ? { mime: "image/png", outExt: "png" }
      : ext === "webp"
        ? { mime: "image/webp", outExt: "webp" }
        : { mime: "image/jpeg", outExt: "jpg" };

  if (!mimeSupportsAlpha(mime)) fillBackground(ctx, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  // Re-encoding through Canvas strips all metadata.
  const blob = await canvasToBlob(canvas, mime, quality);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}-clean.${outExt}`,
    originalSize: file.size,
    newSize: blob.size,
  };
}

