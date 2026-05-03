import ExifReader from "exifreader";
import type { ProcessedResult } from "@/hooks/useFileProcessor";
import { canvasToBlob, loadImage } from "./canvas-utils";

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
  const img = await loadImage(file);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  ctx.drawImage(img, 0, 0);

  // Re-encode as JPEG (strips all metadata)
  const blob = await canvasToBlob(canvas, "image/jpeg", quality);
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}-clean.jpg`,
    originalSize: file.size,
    newSize: blob.size,
  };
}

