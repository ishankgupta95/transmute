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
 * Trim float noise without disturbing integers. Coordinates arrive as full
 * double precision (37.825361111111114), which reads as garbage in the UI.
 */
function formatNumeric(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(6)));
}

/**
 * Normalise one tag to a display string, or null if it carries nothing useful.
 *
 * Two shapes have to be handled. Most groups hold `{ description }` tag
 * objects, but with `expanded: true` ExifReader's `gps` group is a *computed*
 * convenience block of plain numbers (`{ Latitude, Longitude, Altitude }`).
 * Only accepting the object shape silently dropped every GPS value.
 */
function readTagValue(data: unknown): string | null {
  if (typeof data === "number") return formatNumeric(data) || null;
  if (typeof data === "string") return data || null;
  if (data && typeof data === "object" && "description" in data) {
    const raw = (data as { description: unknown }).description;
    const desc = typeof raw === "number" ? formatNumeric(raw) : String(raw);
    if (!desc || desc === "undefined" || desc === "[object Object]") return null;
    return desc;
  }
  return null;
}

/**
 * Read all EXIF/metadata from a file and return structured entries.
 */
export async function readExifData(file: File): Promise<ExifEntry[]> {
  const arrayBuffer = await file.arrayBuffer();
  const tags = ExifReader.load(arrayBuffer, { expanded: true });
  const entries: ExifEntry[] = [];

  const groups: Record<string, Record<string, unknown>> = {
    exif: (tags.exif ?? {}) as Record<string, unknown>,
    gps: (tags.gps ?? {}) as Record<string, unknown>,
    iptc: (tags.iptc ?? {}) as Record<string, unknown>,
    xmp: (tags.xmp ?? {}) as Record<string, unknown>,
    icc: (tags.icc ?? {}) as Record<string, unknown>,
  };

  for (const [group, groupTags] of Object.entries(groups)) {
    for (const [tag, data] of Object.entries(groupTags)) {
      const value = readTagValue(data);
      if (value === null) continue;
      // ExifReader files the raw GPS* tags under `exif`. Bucket them with the
      // computed coordinates so everything location-bearing sits under the
      // group that carries the "contains location data" warning.
      const bucket = group === "exif" && tag.startsWith("GPS") ? "gps" : group;
      entries.push({ tag, value, group: bucket });
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

  // Re-encoding through Canvas drops the SOURCE metadata — but Safari's
  // encoder writes its own Exif APP1 into fresh JPEGs, so "re-encode" alone
  // is not the guarantee this tool sells. Sweep APP1 out of the bytes.
  let blob = await canvasToBlob(canvas, mime, quality);
  if (mime === "image/jpeg") {
    const swept = removeApp1Segments(new Uint8Array(await blob.arrayBuffer()));
    blob = new Blob([swept as BlobPart], { type: mime });
  }
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return {
    blob,
    fileName: `${baseName}-clean.${outExt}`,
    originalSize: file.size,
    newSize: blob.size,
  };
}

/**
 * Drop every APP1 segment (Exif, XMP) from an encoded JPEG. JFIF (APP0) and
 * ICC (APP2) stay — they describe rendering, not provenance. Exported for
 * unit tests.
 */
export function removeApp1Segments(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let o = 2;
  while (o + 4 <= bytes.length && bytes[o] === 0xff) {
    const marker = bytes[o + 1];
    // SOS (or EOI): everything from here is entropy-coded data — keep as-is.
    if (marker === 0xda || marker === 0xd9) break;
    const len = (bytes[o + 2] << 8) | bytes[o + 3];
    if (len < 2 || o + 2 + len > bytes.length) break; // malformed; keep the rest
    if (marker !== 0xe1) parts.push(bytes.subarray(o, o + 2 + len));
    o += 2 + len;
  }
  parts.push(bytes.subarray(o));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

