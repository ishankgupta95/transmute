import type { ProcessedResult } from "@/hooks/useFileProcessor";

/**
 * JFIF → JPG: an honest rename, not a conversion.
 *
 * A .jfif file already IS a JPEG — JFIF (JPEG File Interchange Format) is the
 * container most JPEGs on disk use; some Windows software just saves it under
 * the older extension. The only thing broken about a .jfif is that upload
 * validators reject the name, so the only honest fix is to hand back the SAME
 * bytes under a .jpg name. No canvas, no re-encode, EXIF untouched — the
 * output is byte-identical to the input.
 *
 * The one real check: the bytes must actually start with the JPEG SOI marker
 * (FF D8 — same precedent as `removeApp1Segments` in exif-viewer.ts). A PNG
 * wearing a .jfif name would survive a blind rename and then fail wherever it
 * was headed; rejecting it here is the tool's entire value over Finder.
 */
export const NOT_JPEG_MESSAGE =
  "This file isn't JPEG data underneath — only real JPEGs can be renamed to .jpg.";

export async function jfifToJpg(file: File): Promise<ProcessedResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error(NOT_JPEG_MESSAGE);
  }

  // "photo.jfif" → "photo"; a name with no extension keeps itself; a bare
  // ".jfif" (extension-only name) falls back rather than emitting ".jpg".
  const stripped = file.name.replace(/\.[^.]+$/, "");
  const base = stripped || "image";

  const blob = new Blob([bytes as BlobPart], { type: "image/jpeg" });
  return {
    blob,
    fileName: `${base}.jpg`,
    originalSize: file.size,
    newSize: blob.size, // equal by construction — the bytes are the bytes
  };
}
