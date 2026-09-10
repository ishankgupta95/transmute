/**
 * EXIF Orientation for the two formats whose bytes go into a PDF unchanged.
 *
 * WHY THIS IS SEPARATE FROM `jpeg-orientation.ts`. That module exists to
 * NEUTRALISE the tag — it rewrites Orientation to 1 before a decoder sees the
 * bytes, which is the right move for `recompress-pdf-images`, where the image
 * is re-encoded and the sample grid is what ends up in the dictionary. This
 * module exists for the opposite job: images→PDF embeds the ORIGINAL bytes
 * with `embedJpg`/`embedPng` and never decodes them, so the tag cannot be
 * neutralised — it has to be READ and answered with a placement transform.
 * Two different cures for one fact, and conflating them is what produced the
 * bug this module fixes.
 *
 * THE FACT: a PDF reader never looks at EXIF inside a `/DCTDecode` stream. The
 * image IS the `/Width` × `/Height` sample grid and where it lands is decided
 * by the content stream's CTM. Every image viewer, meanwhile, DOES apply the
 * tag. So a phone photo carrying Orientation 6 shows upright everywhere else
 * and lands sideways — and at the wrong aspect ratio — in a PDF built from its
 * stored grid.
 *
 * PNG IS NOT EXEMPT. A PNG `eXIf` chunk carries the same IFD, and Chrome
 * applies it: measured, a 40×20 PNG with `eXIf` Orientation 6 decodes to 20×40
 * and reports `naturalWidth/Height` as 20×40. pdf-lib's PNG path takes width
 * and height straight from the IHDR via UPNG and never looks at `eXIf`, so
 * `png-to-pdf` has the identical bug. This repo can even produce such a file
 * itself: `change-image-dpi` writes an `eXIf` chunk.
 *
 * LEAF MODULE — its only import is `jpeg-orientation.ts`, which itself imports
 * nothing, so a worker entrypoint may reach it. Keep it that way.
 */

import { readJpegOrientation } from "./jpeg-orientation";

/** TIFF tag number for Orientation. */
const TAG_ORIENTATION = 0x0112;
/** TIFF type 3, a u16 stored inline in the entry's 4-byte value field. */
const TYPE_SHORT = 3;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The Orientation value 1–8 for a PNG's `eXIf` chunk, or 1 when there is none.
 *
 * 1 is the honest default: it is what "no rotation" means and what a decoder
 * does with a file carrying no tag. Every malformed shape also returns 1
 * rather than throwing — this runs over arbitrary user bytes, and refusing a
 * whole document over one odd chunk would be the worse failure.
 */
export function readPngOrientation(bytes: Uint8Array): number {
  if (bytes.length < 8) return 1;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return 1;
  }

  // Chunks are: length (u32 BE), type (4 ASCII), data, CRC-32 (u32).
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    if (length < 0) return 1;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return 1;

    if (type === "eXIf") {
      // A PNG eXIf payload is a BARE TIFF stream — no "Exif\0\0" prefix, which
      // is the one way it differs from the JPEG APP1 case.
      return readTiffOrientation(bytes, dataStart, dataEnd);
    }
    // IDAT means the header block is over; IEND means the file is.
    if (type === "IDAT" || type === "IEND") return 1;

    offset = dataEnd + 4;
  }
  return 1;
}

/**
 * The Orientation a viewer will apply to these bytes, by format.
 *
 * `type` is the MIME type the caller already has. Anything that is not JPEG or
 * PNG returns 1, which is correct for every other path images→PDF takes: the
 * WebP/HEIC/TIFF arm decodes through `createImageBitmap` and re-encodes
 * through a canvas, so the orientation is already baked into the samples and
 * the re-encoded bytes carry no EXIF at all.
 */
export function readImageOrientation(bytes: Uint8Array, type: string): number {
  if (type === "image/png") return readPngOrientation(bytes);
  if (type === "image/jpeg" || type === "image/jpg") return readJpegOrientation(bytes);
  return 1;
}

function readU32(bytes: Uint8Array, at: number): number {
  if (at + 4 > bytes.length) return -1;
  return (
    ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
  );
}

function readTiffOrientation(bytes: Uint8Array, tiffStart: number, limit: number): number {
  if (tiffStart + 8 > limit) return 1;

  const byteOrder = (bytes[tiffStart] << 8) | bytes[tiffStart + 1];
  let littleEndian: boolean;
  if (byteOrder === 0x4949) littleEndian = true; // "II"
  else if (byteOrder === 0x4d4d) littleEndian = false; // "MM"
  else return 1;

  if (read16(bytes, tiffStart + 2, littleEndian) !== 42) return 1;

  const ifd0 = tiffStart + read32(bytes, tiffStart + 4, littleEndian);
  if (ifd0 + 2 > limit || ifd0 < tiffStart) return 1;
  const count = read16(bytes, ifd0, littleEndian);

  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > limit) return 1;
    if (read16(bytes, entry, littleEndian) !== TAG_ORIENTATION) continue;
    if (read16(bytes, entry + 2, littleEndian) !== TYPE_SHORT) return 1;
    const value = read16(bytes, entry + 8, littleEndian);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}

function read16(bytes: Uint8Array, at: number, littleEndian: boolean): number {
  if (at + 2 > bytes.length) return -1;
  return littleEndian ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
}

function read32(bytes: Uint8Array, at: number, littleEndian: boolean): number {
  if (at + 4 > bytes.length) return -1;
  return littleEndian
    ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
    : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}
