/**
 * Read and rewrite the print resolution (DPI) a PNG or JPEG declares.
 *
 * WHY THIS IS A BYTE REWRITE AND NOT A CANVAS OPERATION
 *
 * DPI is metadata. It is not in the pixels, and nothing in the image pipeline
 * (`image-convert` / `image-compress` / `image-resize` / the image worker)
 * carries it: every canvas re-encode produces a fresh file with no `pHYs` and
 * no JFIF density at all. So this module never decodes. It edits the header
 * fields in place and hands back the same compressed image data, which is why
 * a DPI change here provably does not touch a single pixel — and why the copy
 * must say the pixel dimensions are unchanged and only the print size moves.
 *
 * THE TRAP: WRITING ONE FIELD IS SILENTLY IGNORED
 *
 * Both containers can carry the resolution in TWO places, and when they
 * disagree the reader believes the EXIF one. Measured against libvips
 * (2026-09-06, `scratchpad/jpeg-dpi.mjs` and `scratchpad/png-exif-probe.mjs`):
 *
 *   JPEG, sample-photo.jpg (Exif APP1 + JFIF APP0):
 *     JFIF density -> 300, EXIF left at 72  =>  reader still says 72
 *   JPEG, sharp density:150 (Exif, no JFIF at all):
 *     JFIF inserted at 600, EXIF left at 150 => reader still says 150
 *   PNG, sharp density:96 (chunks IHDR iCCP pHYs eXIf IDAT IEND):
 *     pHYs -> 300, eXIf left at 96          =>  reader still says 96
 *     pHYs -> 300 AND eXIf -> 300           =>  reader says 300
 *
 * The PNG half of that was recorded as UNVERIFIED by the scout and is measured
 * here: a PNG `eXIf` chunk outranks `pHYs` exactly the way a JPEG's Exif APP1
 * outranks its JFIF APP0. So both containers get both fields written, and the
 * `eXIf` chunk's CRC-32 is recomputed after the value bytes change.
 *
 * THE ONE CASE THIS MODULE WILL NOT DO
 *
 * An EXIF block that carries no XResolution/YResolution entry at all. Adding
 * one grows IFD0 by 12 bytes, which shifts every out-of-line value offset in
 * IFD0, the Exif sub-IFD, the GPS IFD and IFD1 — a relocation pass over the
 * whole block. Rather than attempt it, the JFIF/pHYs field is written and
 * `exifWithoutResolution` is set true so the UI can say so. Writing one field
 * and reporting an unqualified success would be the lie this module exists to
 * avoid.
 *
 * WebP is refused outright: the format has no resolution field, and the
 * VP8X+EXIF chunk libvips writes for `density: 300` it then cannot read back
 * (measured, `scratchpad/base64-webp.mjs`: `density: undefined` both ways).
 *
 * DOM-FREE and TOTAL: every malformed shape returns a typed refusal rather
 * than throwing, because this walks arbitrary user bytes.
 */

/** The two containers that carry a resolution this module can write. */
export type DpiFormat = "png" | "jpeg";

/**
 * A resolution field, named by where it lives.
 *
 * `EXIF` covers the TIFF resolution tags wherever they are stored — a JPEG's
 * Exif APP1 segment or a PNG's `eXIf` chunk. They are the same IFD layout and
 * they take the same in-place rewrite.
 */
export type DpiSegmentName = "pHYs" | "JFIF" | "EXIF";

export interface DpiFieldReading {
  segment: DpiSegmentName;
  /**
   * The resolution this field states, or null — and null is TWO different
   * files, which `aspectRatioOnly` is what separates:
   *
   *   `aspectRatioOnly` true   the field declares no physical unit, so its
   *                            numbers are a ratio and never were a DPI;
   *   `aspectRatioOnly` false  the field declares inches or centimetres and
   *                            the numbers themselves could not be read — an
   *                            EXIF RATIONAL with a zero denominator is the
   *                            case that happens.
   *
   * They need opposite sentences: one file has no unit, the other has one and
   * a broken value. `declaredResolution` below collapses the pair into the
   * single answer a caller can switch on, and exists because reading it off
   * `dpiX === null` alone is what produced the bug it documents.
   */
  dpiX: number | null;
  dpiY: number | null;
  /**
   * True for `pHYs` unit 0, JFIF units 0 and EXIF ResolutionUnit 1. The
   * numbers in the file are then an aspect ratio, not a resolution, and no
   * reader can report a DPI from them. Both repo JPEG fixtures are JFIF
   * units 0, so this is not a corner case.
   *
   * FALSE beside a null `dpiX` is the other story, not the same one — see the
   * comment on `dpiX`.
   */
  aspectRatioOnly: boolean;
}

export interface ImageDpiReading {
  format: DpiFormat;
  /** Every resolution field found, in the order it appears in the file. */
  fields: DpiFieldReading[];
  /**
   * The field a reader will actually believe, or null when the file declares
   * no usable resolution. EXIF outranks `pHYs` and JFIF — measured, see the
   * module header.
   *
   * Null must be reported as "none declared", never as a number: a reader that
   * finds nothing INVENTS 72 (measured — libvips reports 72 for a PNG with no
   * `pHYs` at all), and printing that would be repeating its guess as if the
   * file had said it.
   */
  effective: DpiFieldReading | null;
  /**
   * True when the file carries an EXIF block that has no XResolution or
   * YResolution entry, which is the one case this module cannot write. The
   * container's own field is still written and the UI must say so.
   */
  exifWithoutResolution: boolean;
}

/**
 * What a whole header amounts to: the one value a caller can switch a sentence
 * on.
 *
 *   "usable"        a reader will report a DPI, and `effective` says which.
 *   "aspect-ratio"  there ARE density numbers and they carry no unit, so no
 *                   reader can turn them into a print size.
 *   "unreadable"    the file declares a unit and the numbers behind it could
 *                   not be read. It is not an aspect ratio and saying so is a
 *                   claim the file contradicts.
 *   "none"          no resolution field of any kind.
 */
export type DeclaredResolution = "usable" | "aspect-ratio" | "unreadable" | "none";

/**
 * WHY THIS EXISTS RATHER THAN A CALLER DERIVING IT.
 *
 * `effective === null && fields.length > 0` looks like "the file declares an
 * aspect ratio" and is not: it is true of BOTH unit-less numbers and a
 * declared unit whose RATIONAL is broken. `ChangeImageDpiUI` derived exactly
 * that expression and printed "this file carries density numbers with no unit
 * attached — an aspect ratio, not a resolution" over a file whose
 * ResolutionUnit byte is 2, inches. The module knew better the whole time —
 * `exifFieldReading` sets `aspectRatioOnly` from the unit tag alone and had
 * already reported `false` — and the knowledge had nowhere to go.
 *
 * The mixed header (one field unit-less, another declaring inches unreadably)
 * answers "unreadable", because that is the specific thing wrong with the file
 * and the aspect-ratio sentence would be the half that is not.
 *
 * Note what "unreadable" does NOT mean: the write path is unaffected. The tags
 * are present and get a valid RATIONAL written over them — measured against
 * libvips, which reports the new DPI on a file it could not read a DPI from
 * before.
 */
export function declaredResolution(reading: ImageDpiReading): DeclaredResolution {
  if (reading.effective !== null) return "usable";
  if (reading.fields.length === 0) return "none";
  return reading.fields.every((f) => f.aspectRatioOnly) ? "aspect-ratio" : "unreadable";
}

export type DpiRefusalReason =
  /** WebP: the format has no resolution field to change. */
  | "webp"
  /** Not PNG or JPEG. */
  | "unsupported"
  /** The magic matched but the container did not parse. */
  | "malformed"
  /** The requested DPI is not an integer in [MIN_DPI, MAX_DPI]. */
  | "dpi-out-of-range";

export interface DpiRefusal {
  ok: false;
  reason: DpiRefusalReason;
  message: string;
}

export type ReadImageDpiResult = ({ ok: true } & ImageDpiReading) | DpiRefusal;

/** One field this run wrote, and whether the field already existed. */
export interface DpiSegmentWrite {
  segment: DpiSegmentName;
  action: "updated" | "inserted";
}

export interface SetImageDpiSuccess {
  ok: true;
  /** A new array — the input is never mutated. */
  bytes: Uint8Array;
  format: DpiFormat;
  /** The DPI that was asked for. */
  dpiX: number;
  dpiY: number;
  /** What the file said before the rewrite. */
  before: ImageDpiReading;
  /**
   * What the file says NOW, read back out of `bytes`. Not a prediction: the
   * UI reports this, so a `pHYs` rounding artefact or a field that could not
   * be written shows up as itself.
   */
  after: ImageDpiReading;
  /** Every field written, in file order. Never empty on success. */
  wrote: DpiSegmentWrite[];
  /** Mirrors `after.exifWithoutResolution`; the honest partial-write case. */
  exifWithoutResolution: boolean;
  /** Byte growth. 0 unless a field had to be inserted (21 for pHYs, 18 for JFIF). */
  sizeDelta: number;
}

export type SetImageDpiResult = SetImageDpiSuccess | DpiRefusal;

/**
 * A JFIF Xdensity is an unsigned 16-bit integer, which is the tightest of the
 * three encodings (PNG stores pixels-per-metre in a u32, EXIF a u32 rational)
 * and therefore the limit for all of them.
 */
export const MIN_DPI = 1;
export const MAX_DPI = 65535;

const METRES_PER_INCH = 0.0254;
const CM_PER_INCH = 2.54;

/** 21 bytes on the wire: 4 length + 4 type + 9 payload + 4 CRC. */
const PHYS_CHUNK_BYTES = 21;
/** 18 bytes on the wire: 2 marker + 16 declared length (which counts itself). */
const JFIF_SEGMENT_BYTES = 18;

// ── entry points ─────────────────────────────────────────────────

/**
 * Read every resolution field a PNG or JPEG declares, without changing
 * anything.
 *
 * Total: a WebP, a GIF or a corrupt header comes back as a typed refusal with
 * a sentence the UI can put on screen, because this runs on every dropped file
 * before the user has asked for anything.
 */
export function readImageDpi(bytes: Uint8Array): ReadImageDpiResult {
  const format = sniffContainer(bytes);
  if (format === "webp") return { ok: false, reason: "webp", message: WEBP_MESSAGE };
  if (format === null) return { ok: false, reason: "unsupported", message: UNSUPPORTED_MESSAGE };
  const reading = format === "png" ? readPngDpi(bytes) : readJpegDpi(bytes);
  if (!reading) return { ok: false, reason: "malformed", message: malformedMessage(format) };
  return { ok: true, ...reading };
}

/**
 * Write `dpiX`/`dpiY` into every resolution field the file already has, plus
 * the container's native field when it is missing.
 *
 * PNG gains a `pHYs` chunk when it has none; a JPEG gains a JFIF APP0. Neither
 * container ever gains an EXIF block it did not have — inventing a metadata
 * block to hold one number is not this tool's job, and the native field is
 * enough on a file with no EXIF (measured: with the Exif APP1 stripped, a JFIF
 * density of 300 is believed).
 */
export function setImageDpi(
  bytes: Uint8Array,
  dpiX: number,
  dpiY: number = dpiX,
): SetImageDpiResult {
  if (!isWritableDpi(dpiX) || !isWritableDpi(dpiY)) {
    return {
      ok: false,
      reason: "dpi-out-of-range",
      message: `DPI must be a whole number between ${MIN_DPI} and ${MAX_DPI}.`,
    };
  }

  const format = sniffContainer(bytes);
  if (format === "webp") return { ok: false, reason: "webp", message: WEBP_MESSAGE };
  if (format === null) return { ok: false, reason: "unsupported", message: UNSUPPORTED_MESSAGE };

  const before = format === "png" ? readPngDpi(bytes) : readJpegDpi(bytes);
  if (!before) return { ok: false, reason: "malformed", message: malformedMessage(format) };

  const written =
    format === "png" ? writePngDpi(bytes, dpiX, dpiY) : writeJpegDpi(bytes, dpiX, dpiY);
  if (!written) return { ok: false, reason: "malformed", message: malformedMessage(format) };

  /*
    Read the result back rather than describing what we meant to do. This is
    also a self-check: bytes we cannot parse are bytes we must not hand to the
    user, whatever we intended to write.
  */
  const after = format === "png" ? readPngDpi(written.bytes) : readJpegDpi(written.bytes);
  if (!after) return { ok: false, reason: "malformed", message: malformedMessage(format) };

  return {
    ok: true,
    bytes: written.bytes,
    format,
    dpiX,
    dpiY,
    before,
    after,
    wrote: written.wrote,
    exifWithoutResolution: after.exifWithoutResolution,
    sizeDelta: written.bytes.length - bytes.length,
  };
}

export const WEBP_MESSAGE =
  "WebP has no DPI field — the format does not store one, so there is nothing to change.";

export const UNSUPPORTED_MESSAGE =
  "Only PNG and JPEG store a DPI this tool can change — these bytes are neither.";

function malformedMessage(format: DpiFormat): string {
  return format === "png"
    ? "This file starts like a PNG but its chunk structure does not parse."
    : "This file starts like a JPEG but its segment structure does not parse.";
}

function isWritableDpi(dpi: number): boolean {
  return Number.isInteger(dpi) && dpi >= MIN_DPI && dpi <= MAX_DPI;
}

/**
 * PNG, JPEG, WebP or nothing we can act on. WebP is singled out because it is
 * the one wrong input with an interesting answer — the format genuinely has no
 * DPI field, which is a different sentence from "we do not support this".
 */
function sniffContainer(bytes: Uint8Array): DpiFormat | "webp" | null {
  if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return "jpeg";
  if (matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return "webp";
  }
  return null;
}

function matches(bytes: Uint8Array, at: number, magic: number[]): boolean {
  if (at + magic.length > bytes.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[at + i] !== magic[i]) return false;
  return true;
}

// ── PNG ──────────────────────────────────────────────────────────

interface PngChunk {
  type: string;
  /** Offset of the 4-byte length field. */
  at: number;
  /** Offset of the first payload byte. */
  dataAt: number;
  length: number;
  /** One past the CRC — i.e. the offset of the next chunk. */
  end: number;
}

/**
 * Walk the chunk list. Total: returns null the moment a length runs past the
 * buffer, so a truncated download is a refusal and never a wild read.
 */
function walkPngChunks(bytes: Uint8Array): PngChunk[] | null {
  if (bytes.length < 8) return null;
  const chunks: PngChunk[] = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = read32be(bytes, at);
    const end = at + 12 + length;
    // A length that overflows the buffer (or wraps) is a malformed file.
    if (length < 0 || end > bytes.length || end <= at) return null;
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    chunks.push({ type, at, dataAt: at + 8, length, end });
    if (type === "IEND") return chunks;
    at = end;
  }
  // No IEND: still usable if we found IHDR, but treat a header-only file as
  // malformed rather than guessing where the image data would have been.
  return chunks.length > 0 && chunks[0].type === "IHDR" ? chunks : null;
}

function readPngDpi(bytes: Uint8Array): ImageDpiReading | null {
  const chunks = walkPngChunks(bytes);
  if (!chunks || chunks[0]?.type !== "IHDR") return null;

  const fields: DpiFieldReading[] = [];
  let exifWithoutResolution = false;

  for (const chunk of chunks) {
    if (chunk.type === "pHYs" && chunk.length === 9) {
      const unit = bytes[chunk.dataAt + 8];
      const ppux = read32be(bytes, chunk.dataAt);
      const ppuy = read32be(bytes, chunk.dataAt + 4);
      // Unit 1 is metres; unit 0 means the two numbers are an aspect ratio.
      fields.push(
        unit === 1
          ? { segment: "pHYs", dpiX: ppmToDpi(ppux), dpiY: ppmToDpi(ppuy), aspectRatioOnly: false }
          : { segment: "pHYs", dpiX: null, dpiY: null, aspectRatioOnly: true },
      );
    } else if (chunk.type === "eXIf") {
      // A PNG eXIf payload is a BARE TIFF stream — no "Exif\0\0" prefix.
      const tags = findResolutionTags(bytes, chunk.dataAt, chunk.end - 4);
      if (!tags) continue;
      if (!tags.xResolution || !tags.yResolution) {
        exifWithoutResolution = true;
        continue;
      }
      fields.push(exifFieldReading(bytes, tags));
    }
  }

  return { format: "png", fields, effective: pickEffective(fields), exifWithoutResolution };
}

interface WriteOutcome {
  bytes: Uint8Array;
  wrote: DpiSegmentWrite[];
}

function writePngDpi(bytes: Uint8Array, dpiX: number, dpiY: number): WriteOutcome | null {
  const chunks = walkPngChunks(bytes);
  if (!chunks || chunks[0]?.type !== "IHDR") return null;

  const out = new Uint8Array(bytes);
  const wrote: DpiSegmentWrite[] = [];

  /*
    EXIF first, then pHYs. Rewriting eXIf is a 0-byte-delta edit, but INSERTING
    a pHYs chunk shifts every offset after IHDR — including the eXIf chunk this
    walk located. Doing the in-place edits first means the offsets are still
    the ones the walk reported.
  */
  const exif = chunks.find((c) => c.type === "eXIf");
  if (exif) {
    const tags = findResolutionTags(out, exif.dataAt, exif.end - 4);
    if (tags?.xResolution && tags.yResolution) {
      writeResolutionTags(out, tags, dpiX, dpiY);
      // The payload bytes changed, so the chunk's own CRC-32 must be redone.
      write32be(out, exif.end - 4, crc32(out.subarray(exif.at + 4, exif.end - 4)));
      wrote.push({ segment: "EXIF", action: "updated" });
    }
  }

  const phys = chunks.find((c) => c.type === "pHYs" && c.length === 9);
  if (phys) {
    write32be(out, phys.dataAt, dpiToPpm(dpiX));
    write32be(out, phys.dataAt + 4, dpiToPpm(dpiY));
    out[phys.dataAt + 8] = 1; // unit specifier: metre
    write32be(out, phys.end - 4, crc32(out.subarray(phys.at + 4, phys.end - 4)));
    wrote.push({ segment: "pHYs", action: "updated" });
    return { bytes: out, wrote };
  }

  /*
    Insert immediately after IHDR. `pHYs` must precede the first IDAT and also
    PLTE, and IHDR is always the first chunk — so this one position satisfies
    both constraints without inspecting what comes next.
  */
  const insertAt = chunks[0].end;
  const chunk = buildPhysChunk(dpiX, dpiY);
  const grown = new Uint8Array(out.length + PHYS_CHUNK_BYTES);
  grown.set(out.subarray(0, insertAt), 0);
  grown.set(chunk, insertAt);
  grown.set(out.subarray(insertAt), insertAt + PHYS_CHUNK_BYTES);
  wrote.push({ segment: "pHYs", action: "inserted" });
  return { bytes: grown, wrote };
}

function buildPhysChunk(dpiX: number, dpiY: number): Uint8Array {
  const chunk = new Uint8Array(PHYS_CHUNK_BYTES);
  write32be(chunk, 0, 9); // payload length
  chunk[4] = 0x70; // p
  chunk[5] = 0x48; // H
  chunk[6] = 0x59; // Y
  chunk[7] = 0x73; // s
  write32be(chunk, 8, dpiToPpm(dpiX));
  write32be(chunk, 12, dpiToPpm(dpiY));
  chunk[16] = 1; // unit specifier: metre
  // The CRC covers the type and the payload, never the length field.
  write32be(chunk, 17, crc32(chunk.subarray(4, 17)));
  return chunk;
}

/** PNG CRC-32: polynomial 0xEDB88320, init and final-xor 0xFFFFFFFF. */
const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── JPEG ─────────────────────────────────────────────────────────

export interface JpegSegment {
  /** Full 16-bit marker, e.g. 0xffe0 for APP0. */
  marker: number;
  /** Offset of the leading 0xFF. */
  at: number;
  /** The declared length, which counts its own two bytes. */
  length: number;
  /** Offset of the first payload byte (`at` + 4). */
  dataAt: number;
  /** One past the segment — the offset of the next marker. */
  end: number;
}

/**
 * Walk the JPEG segment headers up to the start of scan.
 *
 * A generic walker rather than a fourth private one: `jpeg-orientation.ts`
 * keeps its walk inside `locateOrientation` (it is a leaf module the worker
 * bundles, so it exports nothing it does not have to) and `exif-viewer.ts`'s
 * `removeApp1Segments` is a filter, not an enumerator. Both halves of the DPI
 * write — the JFIF APP0 and the Exif APP1 — read the list this returns.
 *
 * Total, in the same style: every malformed shape ends the walk instead of
 * throwing, and what was parsed so far is still returned.
 */
export function walkJpegSegments(bytes: Uint8Array): JpegSegment[] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const segments: JpegSegment[] = [];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return segments;
    // 0xFF bytes are legal padding between segments; skip to the real marker.
    let markerAt = at;
    while (markerAt + 1 < bytes.length && bytes[markerAt + 1] === 0xff) markerAt++;
    const marker = 0xff00 | bytes[markerAt + 1];
    // SOS starts entropy-coded data and EOI ends the file: no more headers.
    if (marker === 0xffda || marker === 0xffd9) return segments;
    if (markerAt + 4 > bytes.length) return segments;
    const length = (bytes[markerAt + 2] << 8) | bytes[markerAt + 3];
    // Under 2 is malformed and would loop forever on a zero length.
    if (length < 2) return segments;
    const end = markerAt + 2 + length;
    if (end > bytes.length) return segments;
    segments.push({ marker, at: markerAt, length, dataAt: markerAt + 4, end });
    at = end;
  }
  return segments;
}

/** The JFIF APP0 that carries the density, skipping `JFXX` extension APP0s. */
function findJfifApp0(bytes: Uint8Array, segments: JpegSegment[]): JpegSegment | null {
  for (const segment of segments) {
    if (segment.marker !== 0xffe0) continue;
    // "JFIF\0". A "JFXX\0" APP0 is a thumbnail extension, not the density.
    if (!matches(bytes, segment.dataAt, [0x4a, 0x46, 0x49, 0x46, 0x00])) continue;
    return segment;
  }
  return null;
}

/** The Exif APP1, skipping the XMP APP1 that often sits beside it. */
function findExifApp1(bytes: Uint8Array, segments: JpegSegment[]): JpegSegment | null {
  for (const segment of segments) {
    if (segment.marker !== 0xffe1) continue;
    // "Exif\0\0", then the TIFF header every IFD offset is relative to.
    if (!matches(bytes, segment.dataAt, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00])) continue;
    return segment;
  }
  return null;
}

function readJpegDpi(bytes: Uint8Array): ImageDpiReading | null {
  const segments = walkJpegSegments(bytes);
  if (!segments) return null;

  const fields: DpiFieldReading[] = [];
  let exifWithoutResolution = false;

  const exif = findExifApp1(bytes, segments);
  if (exif) {
    const tags = findResolutionTags(bytes, exif.dataAt + 6, exif.end);
    if (tags?.xResolution && tags.yResolution) fields.push(exifFieldReading(bytes, tags));
    else exifWithoutResolution = true;
  }

  const jfif = findJfifApp0(bytes, segments);
  if (jfif && jfif.length >= 16) {
    const d = jfif.dataAt;
    const units = bytes[d + 7];
    const x = (bytes[d + 8] << 8) | bytes[d + 9];
    const y = (bytes[d + 10] << 8) | bytes[d + 11];
    // units: 0 = aspect ratio only, 1 = dots per inch, 2 = dots per cm.
    if (units === 1) fields.push({ segment: "JFIF", dpiX: x, dpiY: y, aspectRatioOnly: false });
    else if (units === 2) {
      fields.push({
        segment: "JFIF",
        dpiX: Math.round(x * CM_PER_INCH),
        dpiY: Math.round(y * CM_PER_INCH),
        aspectRatioOnly: false,
      });
    } else fields.push({ segment: "JFIF", dpiX: null, dpiY: null, aspectRatioOnly: true });
  }

  return { format: "jpeg", fields, effective: pickEffective(fields), exifWithoutResolution };
}

function writeJpegDpi(bytes: Uint8Array, dpiX: number, dpiY: number): WriteOutcome | null {
  const segments = walkJpegSegments(bytes);
  if (!segments) return null;

  const out = new Uint8Array(bytes);
  const wrote: DpiSegmentWrite[] = [];

  /*
    EXIF first, for the same reason as PNG: inserting a JFIF APP0 pushes 18
    bytes in at offset 2, which moves the Exif APP1 this walk located. In-place
    edits go in while the offsets are still true.
  */
  const exif = findExifApp1(out, segments);
  if (exif) {
    const tags = findResolutionTags(out, exif.dataAt + 6, exif.end);
    if (tags?.xResolution && tags.yResolution) {
      writeResolutionTags(out, tags, dpiX, dpiY);
      wrote.push({ segment: "EXIF", action: "updated" });
    }
  }

  const jfif = findJfifApp0(out, segments);
  if (jfif) {
    // A JFIF APP0 shorter than its own fixed 16-byte body cannot be edited and
    // must not be replaced by a second one — that is a malformed file.
    if (jfif.length < 16) return null;
    const d = jfif.dataAt;
    out[d + 7] = 1; // units: dots per inch
    out[d + 8] = (dpiX >> 8) & 0xff;
    out[d + 9] = dpiX & 0xff;
    out[d + 10] = (dpiY >> 8) & 0xff;
    out[d + 11] = dpiY & 0xff;
    wrote.push({ segment: "JFIF", action: "updated" });
    return { bytes: out, wrote };
  }

  // JFIF requires APP0 to be the first segment, so it goes straight after SOI.
  const segment = buildJfifApp0(dpiX, dpiY);
  const grown = new Uint8Array(out.length + JFIF_SEGMENT_BYTES);
  grown.set(out.subarray(0, 2), 0);
  grown.set(segment, 2);
  grown.set(out.subarray(2), 2 + JFIF_SEGMENT_BYTES);
  wrote.push({ segment: "JFIF", action: "inserted" });
  return { bytes: grown, wrote };
}

function buildJfifApp0(dpiX: number, dpiY: number): Uint8Array {
  const segment = new Uint8Array(JFIF_SEGMENT_BYTES);
  segment[0] = 0xff;
  segment[1] = 0xe0;
  segment[2] = 0x00;
  segment[3] = 0x10; // declared length 16, counting these two bytes
  segment.set([0x4a, 0x46, 0x49, 0x46, 0x00], 4); // "JFIF\0"
  segment[9] = 0x01; // version 1.02
  segment[10] = 0x02;
  segment[11] = 0x01; // units: dots per inch
  segment[12] = (dpiX >> 8) & 0xff;
  segment[13] = dpiX & 0xff;
  segment[14] = (dpiY >> 8) & 0xff;
  segment[15] = dpiY & 0xff;
  segment[16] = 0; // no embedded thumbnail
  segment[17] = 0;
  return segment;
}

// ── the TIFF resolution tags, shared by JPEG APP1 and PNG eXIf ────

const TAG_X_RESOLUTION = 0x011a;
const TAG_Y_RESOLUTION = 0x011b;
const TAG_RESOLUTION_UNIT = 0x0128;
/** TIFF type 5: two u32s, numerator then denominator. Always out of line. */
const TYPE_RATIONAL = 5;
/** TIFF type 3: a u16, stored inline in the entry's 4-byte value field. */
const TYPE_SHORT = 3;

interface TiffEntrySite {
  /** Absolute offset of the value bytes, inline or not. */
  valueAt: number;
}

interface ResolutionTags {
  littleEndian: boolean;
  xResolution: TiffEntrySite | null;
  yResolution: TiffEntrySite | null;
  resolutionUnit: TiffEntrySite | null;
  /** The stored ResolutionUnit, or 2 (inches) — the TIFF default when absent. */
  unit: number;
}

/**
 * Locate XResolution / YResolution / ResolutionUnit in IFD0.
 *
 * `tiffStart` is the byte order mark ("II"/"MM"); every IFD offset in the
 * block is relative to it. Only entries of the expected type are accepted —
 * a writer that stored XResolution as something other than a RATIONAL is one
 * we decline to interpret rather than guess at.
 */
function findResolutionTags(
  bytes: Uint8Array,
  tiffStart: number,
  limit: number,
): ResolutionTags | null {
  if (tiffStart + 8 > limit || limit > bytes.length) return null;
  const byteOrder = (bytes[tiffStart] << 8) | bytes[tiffStart + 1];
  let littleEndian: boolean;
  if (byteOrder === 0x4949) littleEndian = true;
  else if (byteOrder === 0x4d4d) littleEndian = false;
  else return null;
  if (read16(bytes, tiffStart + 2, littleEndian) !== 42) return null;

  const ifd0 = tiffStart + read32(bytes, tiffStart + 4, littleEndian);
  if (ifd0 < tiffStart || ifd0 + 2 > limit) return null;
  const count = read16(bytes, ifd0, littleEndian);

  const tags: ResolutionTags = {
    littleEndian,
    xResolution: null,
    yResolution: null,
    resolutionUnit: null,
    unit: 2,
  };

  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > limit) break;
    const tag = read16(bytes, entry, littleEndian);
    if (tag !== TAG_X_RESOLUTION && tag !== TAG_Y_RESOLUTION && tag !== TAG_RESOLUTION_UNIT) {
      continue;
    }
    const type = read16(bytes, entry + 2, littleEndian);
    if (tag === TAG_RESOLUTION_UNIT) {
      if (type !== TYPE_SHORT) continue;
      // A SHORT fits in the entry's 4-byte value field, so it is stored inline.
      tags.resolutionUnit = { valueAt: entry + 8 };
      tags.unit = read16(bytes, entry + 8, littleEndian);
      continue;
    }
    if (type !== TYPE_RATIONAL) continue;
    // A RATIONAL is 8 bytes, so the value field holds an offset instead.
    const valueAt = tiffStart + read32(bytes, entry + 8, littleEndian);
    if (valueAt < tiffStart || valueAt + 8 > limit) continue;
    if (tag === TAG_X_RESOLUTION) tags.xResolution = { valueAt };
    else tags.yResolution = { valueAt };
  }

  return tags;
}

function exifFieldReading(bytes: Uint8Array, tags: ResolutionTags): DpiFieldReading {
  const x = readRational(bytes, tags.xResolution!.valueAt, tags.littleEndian);
  const y = readRational(bytes, tags.yResolution!.valueAt, tags.littleEndian);
  // ResolutionUnit: 1 = none (aspect ratio), 2 = inches, 3 = centimetres.
  if (tags.unit === 1 || x === null || y === null) {
    return { segment: "EXIF", dpiX: null, dpiY: null, aspectRatioOnly: tags.unit === 1 };
  }
  const scale = tags.unit === 3 ? CM_PER_INCH : 1;
  return {
    segment: "EXIF",
    dpiX: Math.round(x * scale),
    dpiY: Math.round(y * scale),
    aspectRatioOnly: false,
  };
}

function writeResolutionTags(
  bytes: Uint8Array,
  tags: ResolutionTags,
  dpiX: number,
  dpiY: number,
): void {
  const le = tags.littleEndian;
  // dpi/1 as a RATIONAL: exact, so nothing rounds on the EXIF side.
  write32(bytes, tags.xResolution!.valueAt, dpiX, le);
  write32(bytes, tags.xResolution!.valueAt + 4, 1, le);
  write32(bytes, tags.yResolution!.valueAt, dpiY, le);
  write32(bytes, tags.yResolution!.valueAt + 4, 1, le);
  // Normalise to inches. A file left saying "centimetres" beside an inch
  // value reads back as 2.54× the number the user asked for.
  if (tags.resolutionUnit) write16(bytes, tags.resolutionUnit.valueAt, 2, le);
}

function readRational(bytes: Uint8Array, at: number, littleEndian: boolean): number | null {
  const numerator = read32(bytes, at, littleEndian);
  const denominator = read32(bytes, at + 4, littleEndian);
  if (numerator < 0 || denominator <= 0) return null;
  return numerator / denominator;
}

// ── shared helpers ───────────────────────────────────────────────

/**
 * The field a reader will believe: EXIF first — measured on both containers,
 * see the module header — then the container's own field.
 *
 * Fields carrying no physical unit are skipped. What a reader does with an
 * EXIF ResolutionUnit of 1 beside a usable JFIF density is not something this
 * repo has measured, so falling through to the field that does state a unit is
 * the only choice that cannot be wrong about itself.
 */
function pickEffective(fields: DpiFieldReading[]): DpiFieldReading | null {
  const usable = fields.filter((f) => f.dpiX !== null && f.dpiY !== null);
  return usable.find((f) => f.segment === "EXIF") ?? usable[0] ?? null;
}

function dpiToPpm(dpi: number): number {
  return Math.round(dpi / METRES_PER_INCH);
}

/**
 * Pixels-per-metre is an integer, so DPI does not survive the round trip
 * exactly — 300 dpi stores as 11811 ppm, which reads back as 299.9994. Every
 * value in the tool's range rounds back to itself, so rounding here is the
 * honest readout; printing 299.9994 would not be.
 */
function ppmToDpi(ppm: number): number {
  return Math.round(ppm * METRES_PER_INCH);
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

function read32be(bytes: Uint8Array, at: number): number {
  return read32(bytes, at, false);
}

function write16(bytes: Uint8Array, at: number, value: number, littleEndian: boolean): void {
  if (littleEndian) {
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >>> 8) & 0xff;
  } else {
    bytes[at] = (value >>> 8) & 0xff;
    bytes[at + 1] = value & 0xff;
  }
}

function write32(bytes: Uint8Array, at: number, value: number, littleEndian: boolean): void {
  if (littleEndian) {
    bytes[at] = value & 0xff;
    bytes[at + 1] = (value >>> 8) & 0xff;
    bytes[at + 2] = (value >>> 16) & 0xff;
    bytes[at + 3] = (value >>> 24) & 0xff;
  } else {
    bytes[at] = (value >>> 24) & 0xff;
    bytes[at + 1] = (value >>> 16) & 0xff;
    bytes[at + 2] = (value >>> 8) & 0xff;
    bytes[at + 3] = value & 0xff;
  }
}

function write32be(bytes: Uint8Array, at: number, value: number): void {
  write32(bytes, at, value, false);
}
