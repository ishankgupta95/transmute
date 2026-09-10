/**
 * Read and neutralise a JPEG's EXIF Orientation tag.
 *
 * WHY THIS EXISTS — the bug it fixes is silent page corruption.
 *
 * `createImageBitmap` APPLIES the EXIF Orientation tag. That is correct for a
 * standalone photo, and `image.worker.ts` deliberately asks for it
 * (`imageOrientation: "from-image"`). Inside a PDF it is exactly wrong: a
 * reader never looks at EXIF inside a `/DCTDecode` stream — the image IS the
 * `/Width` × `/Height` sample grid, and where it lands on the page is decided
 * by the content stream's CTM.
 *
 * So re-encoding what the decoder handed back writes rotated or mirrored
 * samples into a dictionary that still describes the original grid. For
 * Orientation 6 or 8 the bitmap also comes back TRANSPOSED, so `/Width` and
 * `/Height` get swapped while the `cm` matrix does not — the photo is drawn
 * turned 90° AND stretched to the wrong aspect ratio. Orientation 3 is
 * quieter and worse: same dimensions, page simply upside down. In every case
 * the engine would report a clean success with nothing skipped.
 *
 * Measured in Chromium, WebKit and Firefox: bare `createImageBitmap` on a
 * 400×200 JPEG with Orientation 6 returns a 200×400 bitmap. **Passing
 * `imageOrientation: "none"` does NOT suppress it** — the current spec only
 * defines "from-image" and "flipY", so "none" is an invalid value that gets
 * ignored, leaving the default (honour EXIF) in force. That dead end is why
 * this module patches the bytes instead.
 *
 * Rather than undo the rotation with a canvas transform — eight cases, half of
 * them not self-inverse, all of them easy to get subtly wrong — this rewrites
 * the Orientation tag to 1 BEFORE the decoder sees the bytes. The decoder then
 * has nothing to apply and hands back the stored sample grid, which is the
 * grid the PDF dictionary already describes. No matrices, and the whole thing
 * is pure byte manipulation that a unit test can pin exactly.
 *
 * LEAF MODULE — no imports at all. Both copies of the PDF image `recode` (the
 * worker and the main-thread fallback) import it statically, which a worker
 * entrypoint may only do for a module that reaches nothing else.
 */

/** JPEG start-of-image marker. */
const SOI = 0xffd8;
/** APP1 is where an Exif segment lives. */
const MARKER_APP1 = 0xffe1;
/** Start of scan — entropy-coded data begins, so no more segment headers. */
const MARKER_SOS = 0xffda;
/** TIFF tag number for Orientation. */
const TAG_ORIENTATION = 0x0112;

/**
 * The Orientation value, 1–8, or 1 when the file carries no readable tag.
 *
 * 1 is the honest default: it is what "no rotation" means, and it is what a
 * decoder does with a file that has no Exif segment.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  const found = locateOrientation(bytes);
  return found ? found.value : 1;
}

/**
 * Force Orientation to 1, IN PLACE, and hand the same array back.
 *
 * In place because both callers have already copied the bytes out of the PDF
 * (the parser hands back a view onto the whole document, and re-encoding must
 * not pin it), so a second allocation would buy nothing on inputs that can be
 * tens of megabytes.
 *
 * Returns the array unchanged when there is nothing to do — no Exif segment,
 * or Orientation already 1. Returns `null` when the file declares an
 * orientation this module cannot rewrite; the caller must then leave the image
 * exactly as found, because "we know it is rotated but cannot fix it" is
 * precisely the case that must not silently produce a corrupted page.
 */
export function neutraliseJpegOrientation<T extends Uint8Array>(bytes: T): T | null {
  const found = locateOrientation(bytes);
  if (!found) return bytes;
  if (found.value === 1) return bytes;
  if (found.value < 1 || found.value > 8) return null;

  /*
    A TIFF SHORT occupies the first 2 bytes of the 4-byte value field, in the
    IFD's own byte order. Writing 1 there leaves the padding, the tag, the
    count and every other tag exactly as they were — the segment length never
    changes, so no offset anywhere else in the file is disturbed.
  */
  if (found.littleEndian) {
    bytes[found.valueOffset] = 1;
    bytes[found.valueOffset + 1] = 0;
  } else {
    bytes[found.valueOffset] = 0;
    bytes[found.valueOffset + 1] = 1;
  }
  return bytes;
}

interface OrientationSite {
  /** Absolute offset of the 2-byte SHORT holding the value. */
  valueOffset: number;
  littleEndian: boolean;
  value: number;
}

/**
 * Walk the JPEG segment headers to the Exif IFD0 Orientation tag.
 *
 * Deliberately total: every malformed shape returns null rather than throwing,
 * because this runs over arbitrary bytes lifted out of a user's PDF and a
 * throw here would fail a whole document over one bad image.
 */
function locateOrientation(bytes: Uint8Array): OrientationSite | null {
  if (bytes.length < 4) return null;
  if (read16(bytes, 0, false) !== SOI) return null;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    // Segment headers are 0xFF followed by the marker; fill bytes of 0xFF are
    // legal padding between segments.
    if (bytes[offset] !== 0xff) return null;
    const marker = read16(bytes, offset, false);
    if (marker === MARKER_SOS) return null;
    const length = read16(bytes, offset + 2, false);
    // A segment length counts its own two length bytes, so anything under 2
    // is malformed and would loop forever.
    if (length < 2) return null;
    const segmentStart = offset + 4;
    const segmentEnd = offset + 2 + length;
    if (segmentEnd > bytes.length) return null;

    if (marker === MARKER_APP1 && isExifHeader(bytes, segmentStart)) {
      // "Exif\0\0" then the TIFF header the IFD offsets are relative to.
      return findInTiff(bytes, segmentStart + 6, segmentEnd);
    }
    offset = segmentEnd;
  }
  return null;
}

function isExifHeader(bytes: Uint8Array, at: number): boolean {
  return (
    at + 6 <= bytes.length &&
    bytes[at] === 0x45 && // E
    bytes[at + 1] === 0x78 && // x
    bytes[at + 2] === 0x69 && // i
    bytes[at + 3] === 0x66 && // f
    bytes[at + 4] === 0x00 &&
    bytes[at + 5] === 0x00
  );
}

function findInTiff(bytes: Uint8Array, tiffStart: number, limit: number): OrientationSite | null {
  if (tiffStart + 8 > limit) return null;
  const byteOrder = read16(bytes, tiffStart, false);
  // "II" little-endian, "MM" big-endian; anything else is not a TIFF header.
  let littleEndian: boolean;
  if (byteOrder === 0x4949) littleEndian = true;
  else if (byteOrder === 0x4d4d) littleEndian = false;
  else return null;
  if (read16(bytes, tiffStart + 2, littleEndian) !== 42) return null;

  const ifd0 = tiffStart + read32(bytes, tiffStart + 4, littleEndian);
  if (ifd0 + 2 > limit || ifd0 < tiffStart) return null;
  const count = read16(bytes, ifd0, littleEndian);

  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > limit) return null;
    if (read16(bytes, entry, littleEndian) !== TAG_ORIENTATION) continue;
    // Orientation is a SHORT (type 3); anything else is a malformed writer we
    // decline to interpret.
    if (read16(bytes, entry + 2, littleEndian) !== 3) return null;
    const valueOffset = entry + 8;
    if (valueOffset + 2 > limit) return null;
    return { valueOffset, littleEndian, value: read16(bytes, valueOffset, littleEndian) };
  }
  return null;
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
