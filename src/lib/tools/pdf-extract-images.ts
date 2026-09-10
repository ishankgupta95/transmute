import {
  PDFArray,
  PDFBool,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
} from "pdf-lib";
import type { PDFDict, PDFObject } from "pdf-lib";
import type { PdfImageSkipReason } from "@/lib/workers/pdf-image-protocol";

/**
 * Lift the images a PDF already contains back out as image files.
 *
 * THE DESIGN THAT MAKES THIS HONEST: EXTRACT, DO NOT RE-ENCODE.
 *
 * A `/DCTDecode` stream in a PDF *is* a JPEG bitstream — the same bytes a
 * `.jpg` file holds, wrapped in a dictionary. So the whole operation for the
 * common case is `stream.contents` → a file named `.jpg`. No decode, no
 * re-encode, no colour shift, no second generation of loss: what comes out is
 * byte-for-byte what the document was carrying.
 *
 * That is not merely tidy, it is what makes the tool correct at all, because
 * the decode-and-re-encode alternative walks straight into this repo's worst
 * PDF trap:
 *
 * THE EXIF TRAP (`lib/tools/jpeg-orientation.ts` has the full derivation).
 * `createImageBitmap` APPLIES a JPEG's EXIF Orientation tag. A PDF reader
 * ignores EXIF inside a `/DCTDecode` stream entirely — the image IS the
 * `/Width` × `/Height` sample grid, and where it lands on the page is decided
 * by the content stream's CTM. So anything that decodes and re-encodes writes
 * rotated (and for Orientations 5–8, TRANSPOSED) samples into a dictionary
 * that still describes the original grid, and reports a clean success while
 * doing it. `imageOrientation: "none"` does NOT suppress it — that value is
 * not in the spec and is ignored. Verbatim byte extraction never meets the
 * decoder, so none of this can happen here. DO NOT decode a DCTDecode image.
 *
 * The one case with no bytes to lift is a `/FlateDecode` raw bitmap: the
 * stream holds deflated samples, not an image file, so a PNG has to be built
 * around them. That path handles only the unambiguous shape — DeviceRGB or
 * DeviceGray, 8 bits per component, no `/Decode`, no `/DecodeParms` — and
 * everything else is SKIPPED, counted and named, never guessed at.
 *
 * DOM-FREE. Nothing here touches `document`, `window`, `Image`,
 * `createImageBitmap` or a canvas, so the whole engine — classification, the
 * verbatim lift and the PNG builder alike — runs for real under jsdom. That is
 * deliberate: this repo's documented blind spot is a green unit suite over a
 * pixel path that never executed, and there is no pixel path here to fake.
 * (`CompressionStream` is used for the PNG's IDAT and is not a DOM API; it
 * exists in workers and in Node, and there is a stored-block fallback for
 * anywhere it does not.)
 *
 * WHAT THIS IS NOT, and what the copy therefore has to say: it is not a
 * screenshot of the page. An extracted image arrives at the resolution it is
 * STORED at, which for a picture scaled down on the page is smaller than it
 * looks on screen, and it arrives without the page's text, vector art or
 * placement. Rendering pages as pictures is `pdf-to-jpg`, a different tool.
 */

// ── Loading ────────────────────────────────────────────────────────

/*
  The two load failures users actually hit. Copied verbatim rather than
  imported, for the reason pdf-image-core.ts states at length: both constants
  are module-private there, and a password-protected PDF has to say the SAME
  sentence whichever PDF tool it was dropped on. There are now four homes —
  pdf-engine-core.ts (the canonical one), pdf-image-core.ts, pdf-engine.ts for
  the pdfjs path, and here. If one changes they all change.

  Matching is on message TEXT, not `instanceof`: pdf-lib 1.17.1 is compiled to
  ES5, so `Error.call(this, msg)` never initialises the subclass and
  `err instanceof EncryptedPDFError` is false for every one of its error types.
  Do not "fix" this to an instanceof check; it silently stops matching.
*/
const PASSWORD_MESSAGE =
  "This PDF is password-protected. Run it through Unlock PDF (/unlock-pdf) first — that removes a password you know, or clears an owner-password restriction without one. It cannot crack a password you don't have.";

const DAMAGED_MESSAGE =
  "This PDF could not be read — the file is damaged or is not a PDF. If it really is a PDF, try Repair PDF (/repair-pdf), which rebuilds a broken cross-reference table. If that fails too, re-export it from the program that produced it.";

async function loadDocument(data: Uint8Array): Promise<PDFDocument> {
  try {
    // `updateMetadata: false` — this operation reads the document and writes
    // nothing back to it, so stamping a fresh /ModDate would be a side effect
    // of looking.
    return await PDFDocument.load(data, { updateMetadata: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/is encrypted/.test(message)) throw new Error(PASSWORD_MESSAGE);
    if (/Failed to parse|Missing catalog|corrupt page tree/i.test(message)) {
      throw new Error(DAMAGED_MESSAGE);
    }
    throw err;
  }
}

// ── Public shapes ──────────────────────────────────────────────────

/** What kind of file one extracted image came out as. */
export type PdfExtractFormat = "jpeg" | "png";

/** One image file lifted out of the document. */
export interface ExtractedPdfImage {
  /** `image-03.jpg` — the name it is saved under, inside the ZIP or alone. */
  name: string;
  bytes: Uint8Array;
  format: PdfExtractFormat;
  /**
   * From the image dictionary, which for a verbatim JPEG lift is also what the
   * bitstream says. This is the STORED resolution — not the size the picture
   * occupies on the page, which comes from the content stream's CTM and is a
   * different number entirely.
   */
  width: number;
  height: number;
}

/**
 * Why one image XObject was left in the document instead of being written out.
 *
 * The reasons are exactly the taxonomy `pdf-image-protocol.ts` already
 * defines and `RecompressPdfImagesUI` already renders, minus `no-smaller`,
 * which is a statement about a re-encode and cannot happen to an extraction.
 * Sharing the vocabulary is the point: the two PDF-image tools disagree about
 * plenty, but "this image is in a colour space we will not guess at" has to
 * mean the same thing on both pages.
 *
 * - `mask` — the image is a transparency mask, or carries one.
 * - `filter` — not a DCTDecode or FlateDecode stream.
 * - `decode-parms` — filter parameters (a predictor, a colour transform) that
 *   change what the samples mean.
 * - `decode-array` — a `/Decode` array remaps the samples on the way out.
 * - `colour-space` — CMYK, Indexed, Separation, Lab and friends.
 * - `bit-depth` — samples that are not 8 bits per component.
 * - `undecodable` — the stream did not hold what its dictionary claimed.
 * - `too-large` — this tool's own ceiling, not a property of the document.
 */
export type PdfExtractSkipReason =
  | Exclude<PdfImageSkipReason, "no-smaller">
  /*
    The one reason that is NOT part of the shared taxonomy, and it is separate
    on purpose: every other member is a fact about the file, this one is a
    fact about THIS TOOL. `MAX_SAMPLE_BYTES` is the PNG builder's memory
    budget, checked from the DECLARED /Width × /Height × components before a
    single byte is decompressed — the stream is never even read.

    It used to be filed under `undecodable`, whose sentence on screen is "DID
    NOT HOLD THE IMAGE ITS DICTIONARY DESCRIBES". That told a user with a
    perfectly good large-format scan that their document was damaged, and sent
    them off to repair a file that has nothing wrong with it. A refusal that
    belongs to the tool has to be named as the tool's.
  */
  | "too-large";

export interface PdfExtractSkip {
  reason: PdfExtractSkipReason;
  count: number;
  /** What was actually found — the filter name, the colour space. */
  detail?: string;
}

export interface PdfExtractImagesResult {
  /** The files, in the order the images appear among the document's objects. */
  images: ExtractedPdfImage[];
  /**
   * Every image XObject the FILE holds — which is not the same as every image
   * a reader DRAWS. An XObject nothing references any more (the picture an
   * editor replaced, an image on a deleted page) is found and extracted like
   * the rest, because it is genuinely still in the document.
   */
  imagesFound: number;
  /** Grouped skip counts. Sums with `images.length` to `imagesFound`. */
  skipped: PdfExtractSkip[];
}

// ── Skip bookkeeping ───────────────────────────────────────────────

/**
 * Display order for the skip list — the classification order below, not
 * encounter order, so the same document produces the same sentence every time.
 */
const SKIP_ORDER: PdfExtractSkipReason[] = [
  "mask",
  "filter",
  "decode-parms",
  "decode-array",
  "colour-space",
  "bit-depth",
  "undecodable",
  // Last, because it is the last gate the classifier applies — and because a
  // sentence about the tool reads better after the sentences about the file.
  "too-large",
];

/** Distinct details kept per reason; past this the list stops being readable. */
const MAX_SKIP_DETAILS = 3;

class SkipTally {
  private readonly counts = new Map<PdfExtractSkipReason, number>();
  private readonly details = new Map<PdfExtractSkipReason, Set<string>>();

  add(reason: PdfExtractSkipReason, detail?: string): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
    if (!detail) return;
    let seen = this.details.get(reason);
    if (!seen) {
      seen = new Set<string>();
      this.details.set(reason, seen);
    }
    seen.add(detail);
  }

  list(): PdfExtractSkip[] {
    const out: PdfExtractSkip[] = [];
    for (const reason of SKIP_ORDER) {
      const count = this.counts.get(reason);
      if (!count) continue;
      // One document can hold several flavours of the same refusal — three
      // JPXDecode images and one CCITTFax is one row naming both, not two.
      const seen = [...(this.details.get(reason) ?? [])];
      const detail =
        seen.length === 0
          ? undefined
          : seen.length > MAX_SKIP_DETAILS
            ? `${seen.slice(0, MAX_SKIP_DETAILS).join(", ")}…`
            : seen.join(", ");
      out.push(detail === undefined ? { reason, count } : { reason, count, detail });
    }
    return out;
  }
}

// ── Dictionary reading ─────────────────────────────────────────────

/** `/DeviceRGB` → `"DeviceRGB"`. `asString()` keeps the leading slash. */
function nameLabel(name: PDFName): string {
  return name.asString().slice(1);
}

/**
 * True for an image XObject's dictionary.
 *
 * `/Subtype /Image` alone is sufficient: /Type is optional on an XObject and
 * many producers omit it, so requiring it would silently skip most of the
 * images in the wild. A /Type that is PRESENT and says something other than
 * /XObject is a dictionary that is not what we think it is. Both entries are
 * read through `lookup` so an indirect (legal, if rare) spelling resolves;
 * `PDFName.of` pools its instances, so identity is the right comparison.
 */
function isImageXObject(dict: PDFDict): boolean {
  if (dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) return false;
  const type = dict.lookup(PDFName.of("Type"));
  return type === undefined || type === PDFName.of("XObject");
}

/**
 * The single filter name, or null when the stream carries a filter chain, no
 * filter at all, or something unreadable.
 *
 * `/Filter /X` and `/Filter [/X]` are two spellings of the same thing. A CHAIN
 * (`[/ASCII85Decode /DCTDecode]`) is deliberately not unwrapped: the contents
 * are then not a JPEG file, and the whole premise here is that they are.
 */
function soleFilter(dict: PDFDict): string | null {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter instanceof PDFName) return nameLabel(filter);
  if (filter instanceof PDFArray && filter.size() === 1) {
    const only = filter.lookup(0);
    return only instanceof PDFName ? nameLabel(only) : null;
  }
  return null;
}

/** How a chain, an absent filter or a malformed one is named on screen. */
function filterLabel(dict: PDFDict): string {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter === undefined) return "uncompressed";
  if (filter instanceof PDFName) return nameLabel(filter);
  if (filter instanceof PDFArray) {
    if (filter.size() === 0) return "uncompressed";
    const names: string[] = [];
    for (let i = 0; i < filter.size(); i++) {
      const entry = filter.lookup(i);
      names.push(entry instanceof PDFName ? nameLabel(entry) : "unrecognised");
    }
    return names.join(" + ");
  }
  return "unrecognised";
}

/**
 * What the /ColorSpace entry says, in words. An array colour space is named by
 * its family — `[/ICCBased ref]` is "ICCBased", `[/Indexed /DeviceRGB 255 ref]`
 * is "Indexed".
 */
function colourSpaceLabel(cs: PDFObject | undefined): string {
  if (cs === undefined) return "absent";
  if (cs instanceof PDFName) return nameLabel(cs);
  if (cs instanceof PDFArray && cs.size() > 0) {
    const family = cs.lookup(0);
    if (family instanceof PDFName) return nameLabel(family);
  }
  return "unrecognised";
}

/**
 * The component count declared by an `[/ICCBased streamRef]` colour space, or
 * null when this is not one (or its /N cannot be read).
 *
 * Worth resolving rather than refusing outright, because ICCBased is what
 * Acrobat, InDesign and every other serious producer tags an ordinary sRGB
 * photograph with. Refusing the family wholesale would skip most of the
 * photographs in most real PDFs and call it caution.
 */
function iccComponents(cs: PDFObject | undefined): number | null {
  if (!(cs instanceof PDFArray) || cs.size() < 2) return null;
  if (cs.lookup(0) !== PDFName.of("ICCBased")) return null;
  const profile = cs.lookup(1);
  if (!(profile instanceof PDFRawStream)) return null;
  const n = profile.dict.lookup(PDFName.of("N"));
  return n instanceof PDFNumber ? n.asNumber() : null;
}

/** A dictionary number, or null when the entry is absent or malformed. */
function dictNumber(dict: PDFDict, key: string): number | null {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : null;
}

// ── Classification ─────────────────────────────────────────────────

/**
 * The largest decompressed bitmap this tool will build a PNG around.
 *
 * A raw sample buffer is width × height × components with no compression at
 * all, and the PNG builder holds that buffer, a filtered copy of it and the
 * deflate output at the same time. 256 MB of samples is a 9000 × 9000 RGB
 * scan — past that the tab is likelier to die than to produce a file, so the
 * image is skipped and NAMED rather than taking the page down with it. The
 * verbatim JPEG path has no such ceiling: it copies the stored bytes and never
 * decompresses anything.
 */
const MAX_SAMPLE_BYTES = 256 * 1024 * 1024;

/** One image XObject, with everything the extractor needs to write it out. */
interface Extractable {
  stream: PDFRawStream;
  dict: PDFDict;
  format: PdfExtractFormat;
  width: number;
  height: number;
  /** 1 for DeviceGray, 3 for DeviceRGB. Only meaningful for the PNG path. */
  components: number;
}

interface Classification {
  imagesFound: number;
  extractable: Extractable[];
  tally: SkipTally;
}

/**
 * Find every image XObject and decide which ones can be written out truthfully.
 *
 * The walk is over `enumerateIndirectObjects()`, NOT over pages, and that is
 * load-bearing: an image drawn on forty pages is ONE XObject, so it is
 * classified once and emitted once. Iterating pages and their /Resources would
 * hand the user forty copies of the same photograph and call it forty images.
 *
 * Only `PDFRawStream` is considered, which is not a narrowing: pdf-lib's
 * parser builds every stream it reads out of a file as a PDFRawStream (the
 * other stream classes exist for objects the library itself creates, and this
 * module creates none).
 *
 * THE ORDER OF THE RULES BELOW IS LOAD-BEARING — it decides which single
 * reason a user is shown for an image that trips more than one — and the mask
 * ref-set has to be built in a first pass over ALL image XObjects, before any
 * of them is classified, because the disqualifying property belongs to a
 * DIFFERENT object: an ordinary DeviceGray JPEG is not a picture anybody wants
 * when some other image names it as its /SMask.
 */
function classifyImages(doc: PDFDocument): Classification {
  const images: { ref: PDFRef; stream: PDFRawStream; dict: PDFDict }[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (!isImageXObject(obj.dict)) continue;
    images.push({ ref, stream: obj, dict: obj.dict });
  }

  // First pass: every ref used AS a mask by any image in the document.
  // `get`, not `lookup` — the reference itself is what is being collected.
  const maskRefs = new Set<string>();
  for (const image of images) {
    for (const key of ["SMask", "Mask"]) {
      const value = image.dict.get(PDFName.of(key));
      if (value instanceof PDFRef) maskRefs.add(value.tag);
    }
  }

  const tally = new SkipTally();
  const extractable: Extractable[] = [];

  for (const image of images) {
    const { dict } = image;

    /*
      1. Transparency, in both directions.

         An image used AS a soft or stencil mask is not a picture — it is an
         alpha channel, and handing it over as `image-04.png` gives the user a
         white silhouette they never asked for. An image that CARRIES a mask is
         a picture, but the bytes in its stream are the picture WITHOUT its
         transparency: lifting them alone paints back in whatever the mask was
         hiding, so the extracted file shows something the page does not. There
         is no honest fix that does not decode and composite, which this tool
         does not do, so both directions are left alone and counted.

         `/ImageMask true` is the third spelling — a 1-bit stencil drawn in the
         current fill colour, with no colour space of its own.
    */
    if (
      maskRefs.has(image.ref.tag) ||
      dict.get(PDFName.of("SMask")) !== undefined ||
      dict.get(PDFName.of("Mask")) !== undefined ||
      dict.lookup(PDFName.of("ImageMask")) === PDFBool.True
    ) {
      tally.add("mask");
      continue;
    }

    /*
      2. The filter, which decides which of the two paths this image takes.
         DCTDecode is lifted verbatim; FlateDecode is rebuilt as a PNG.
         Everything else — JPX, CCITTFax, JBIG2, LZW, RunLength, a filter
         CHAIN, or no filter at all — has no honest path here and is named.
    */
    const filter = soleFilter(dict);
    if (filter !== "DCTDecode" && filter !== "FlateDecode") {
      tally.add("filter", filterLabel(dict));
      continue;
    }
    const format: PdfExtractFormat = filter === "DCTDecode" ? "jpeg" : "png";

    /*
      3. /DecodeParms. On a Flate image these are the PNG/TIFF predictors, and
         `decodePDFRawStream` does not apply them — un-predicting is a second
         decoding stage this module does not implement, and writing the
         predicted rows out as if they were samples produces a smeared image
         that still looks like a successful extraction. On a DCT image the
         entry is a /ColorTransform, which changes how the components are
         interpreted. Either way it is a parameter that alters what the bytes
         mean, so the image is left alone.
    */
    if (dict.get(PDFName.of("DecodeParms")) !== undefined) {
      tally.add("decode-parms");
      continue;
    }

    /*
      4. /Decode. It remaps sample values on the way out of the filter —
         `[1 0 1 0 1 0]` on an RGB image is a photographic negative. The reader
         applies it; a standalone JPEG or PNG has nowhere to carry it. Writing
         the bytes out would hand back the un-inverted image, which is not what
         the page shows.
    */
    if (dict.get(PDFName.of("Decode")) !== undefined) {
      tally.add("decode-array");
      continue;
    }

    /*
      5. Colour space, and the two paths genuinely have different rules here.

         A JPEG is SELF-DESCRIBING: the file that comes out carries its own
         component count and Adobe marker, and any viewer reads those rather
         than the PDF's dictionary. So the dictionary only has to establish
         that the bitstream is the ordinary greyscale-or-RGB kind — DeviceRGB,
         DeviceGray, or ICCBased with /N 1 or 3 (which is how essentially every
         professional producer tags an sRGB photo). DeviceCMYK is refused
         rather than guessed at: CMYK JPEGs inside PDFs use the inverted-ink
         Adobe convention, most viewers cannot open them at all, and one that
         can may well show a colour-negative.

         A PNG is NOT self-describing until this module describes it — the
         builder writes the colour type and the sample layout itself — so that
         path takes DeviceRGB and DeviceGray only, exactly as found. Anything
         needing a lookup table (Indexed), a tint transform (Separation,
         DeviceN) or a profile to mean anything is skipped.
    */
    const cs = dict.lookup(PDFName.of("ColorSpace"));
    const isGray = cs === PDFName.of("DeviceGray");
    const isRgb = cs === PDFName.of("DeviceRGB");
    let components: number;
    if (isGray) components = 1;
    else if (isRgb) components = 3;
    else {
      const icc = format === "jpeg" ? iccComponents(cs) : null;
      if (icc !== 1 && icc !== 3) {
        tally.add("colour-space", colourSpaceLabel(cs));
        continue;
      }
      components = icc;
    }

    /*
      6. Bit depth. The PNG builder writes 8-bit samples and nothing else, and
         a 12-bit or 16-bit JPEG is a file no browser and few viewers will
         open — extracting one produces a `.jpg` that does not open, which is
         worse than saying it was skipped. /BitsPerComponent is required on
         every image XObject that is not a stencil mask, so an absent entry is
         a dictionary that cannot be trusted about its own samples.
    */
    const bits = dictNumber(dict, "BitsPerComponent");
    if (bits !== 8) {
      tally.add("bit-depth", bits === null ? "absent" : String(bits));
      continue;
    }

    /*
      7. Dimensions. Everything downstream — the PNG header, the sample-buffer
         length check, the readout on screen — is computed from these two
         numbers, so a dictionary that cannot state them is unusable rather
         than merely awkward.
    */
    const width = dictNumber(dict, "Width");
    const height = dictNumber(dict, "Height");
    if (
      width === null ||
      height === null ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      tally.add("undecodable", "no usable dimensions");
      continue;
    }

    /*
      8. The PNG path's memory ceiling. See MAX_SAMPLE_BYTES.

         Its own reason, never `undecodable`: nothing here has read the stream,
         so the tool has learned nothing about whether the image is intact. The
         only honest thing it can say is how big the picture is and that it
         declined — so the detail is the DIMENSIONS, which is a fact, rather
         than a verdict on a stream it never opened.
    */
    if (format === "png" && width * height * components > MAX_SAMPLE_BYTES) {
      tally.add("too-large", `${width} × ${height}`);
      continue;
    }

    extractable.push({ stream: image.stream, dict, format, width, height, components });
  }

  return { imagesFound: images.length, extractable, tally };
}

// ── The verbatim JPEG lift ─────────────────────────────────────────

/** JPEG start-of-image marker. Every JPEG file begins with these two bytes. */
const JPEG_SOI = [0xff, 0xd8];

/**
 * The stored bytes, copied out of the parsed document.
 *
 * `.slice()` rather than handing back `stream.contents` directly: that is a
 * VIEW onto the whole parsed PDF, so keeping it alive to put in a Blob would
 * pin the entire document in memory for as long as the extracted thumbnail
 * exists. Copying a few hundred KB is the cheaper end of that trade.
 */
function liftJpeg(stream: PDFRawStream): Uint8Array | null {
  const bytes = stream.contents;
  // A /DCTDecode stream that does not start with SOI is not a JPEG, whatever
  // its dictionary says — writing it out would produce a `.jpg` that no viewer
  // opens, which is a failure disguised as a file.
  if (bytes.length < 4 || bytes[0] !== JPEG_SOI[0] || bytes[1] !== JPEG_SOI[1]) return null;
  return bytes.slice();
}

// ── The PNG builder ────────────────────────────────────────────────

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG colour types: 0 is greyscale, 2 is truecolour (RGB). */
const PNG_COLOUR_TYPE: Record<number, number> = { 1: 0, 3: 2 };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

/** One PNG chunk: length, four-byte type, payload, CRC over type + payload. */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  writeUint32BE(out, 0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  writeUint32BE(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Adler-32, batched at the standard NMAX so the modulo is not per byte. */
function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  let i = 0;
  while (i < data.length) {
    const end = Math.min(i + 5552, data.length);
    for (; i < end; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * A zlib stream of STORED (uncompressed) deflate blocks.
 *
 * The fallback for an environment with no `CompressionStream`. It is a real,
 * spec-valid zlib stream that every PNG decoder reads — it just does not
 * compress, so the file is the size of its samples plus ~0.03%. Producing a
 * large PNG beats producing no PNG, and this is the only branch that can
 * fail-safe: everything else about the extraction is byte copying.
 */
function zlibStored(raw: Uint8Array): Uint8Array {
  const MAX_BLOCK = 0xffff;
  const blocks = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  // 0x78 0x01: deflate, 32 KB window, no dictionary, fastest compression
  // level — the standard "stored data" header pair, and its FCHECK is valid
  // (0x7801 % 31 === 0).
  out[0] = 0x78;
  out[1] = 0x01;
  let at = 2;
  let read = 0;
  for (let block = 0; block < blocks; block++) {
    const len = Math.min(MAX_BLOCK, raw.length - read);
    out[at++] = block === blocks - 1 ? 1 : 0;
    out[at++] = len & 0xff;
    out[at++] = (len >>> 8) & 0xff;
    out[at++] = ~len & 0xff;
    out[at++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(read, read + len), at);
    at += len;
    read += len;
  }
  writeUint32BE(out, at, adler32(raw));
  return out;
}

/**
 * Deflate `raw` into the zlib wrapper a PNG's IDAT chunk expects.
 *
 * `CompressionStream("deflate")` is RFC 1950 (zlib), not RFC 1951 (raw) — the
 * raw variant is spelled "deflate-raw" — so its output is exactly an IDAT
 * payload. The write is deliberately NOT awaited before the reader starts:
 * a transform stream's writable queue is one chunk deep, so awaiting a
 * multi-megabyte write with nothing draining the readable end deadlocks.
 */
// `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`, for the reason
// `deflate` in pdf-engine-core.ts documents: `CompressionStream` accepts only a
// view onto a plain ArrayBuffer, and the wider `ArrayBufferLike` a parser
// hands out could in principle be a SharedArrayBuffer. The only caller builds
// this buffer itself, so narrowing the parameter costs nothing — whereas
// copying to satisfy the type would duplicate up to `MAX_SAMPLE_BYTES`.
async function zlibDeflate(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if (typeof CompressionStream === "undefined") return zlibStored(raw);
  try {
    const stream = new CompressionStream("deflate");
    const writer = stream.writable.getWriter();
    const pump = (async () => {
      await writer.write(raw);
      await writer.close();
    })();
    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    await pump;
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  } catch {
    // A compressor that refuses the job must not cost the user the image.
    return zlibStored(raw);
  }
}

/**
 * Build a PNG around raw 8-bit samples.
 *
 * Every scanline is prefixed with filter byte 0 ("None"), which is what makes
 * this an honest rebuild rather than a re-encode: the sample values written
 * into the file are bit-for-bit the sample values the PDF stored. Choosing a
 * real PNG filter per row would shrink the output and change nothing about the
 * pixels, but it would also be the first place a bug could alter them, and the
 * point of this whole module is that it cannot.
 */
async function buildPng(
  samples: Uint8Array,
  width: number,
  height: number,
  components: number,
): Promise<Uint8Array> {
  const stride = width * components;
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    filtered.set(samples.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, width);
  writeUint32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = PNG_COLOUR_TYPE[components];
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method: adaptive, the only one defined
  ihdr[12] = 0; // interlace: none

  const idat = await zlibDeflate(filtered);
  const parts = [
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ── Naming ─────────────────────────────────────────────────────────

const EXTENSIONS: Record<PdfExtractFormat, string> = { jpeg: "jpg", png: "png" };

/**
 * `image-03.jpg`. Numbered in the order the images were found among the
 * document's objects, and padded so a ZIP of them sorts the way it reads.
 *
 * Not numbered by page, deliberately: the walk is over objects precisely
 * because one image can be drawn on many pages, so there is no single page
 * number to name it after.
 *
 * Naming happens after the whole run rather than during it, for two reasons.
 * The numbers are CONTIGUOUS — an image that failed to decode leaves no gap,
 * because a ZIP holding image-01, image-03, image-04 reads as a tool that lost
 * something — and the padding is computed from the count actually produced, so
 * ten files are image-01…image-10 even if fifty candidates were considered.
 */
function nameImages(
  produced: { bytes: Uint8Array; format: PdfExtractFormat; width: number; height: number }[],
): ExtractedPdfImage[] {
  const width = Math.max(2, String(produced.length).length);
  return produced.map((image, index) => ({
    name: `image-${String(index + 1).padStart(width, "0")}.${EXTENSIONS[image.format]}`,
    ...image,
  }));
}

// ── Entry point ────────────────────────────────────────────────────

function toUint8Array(buf: ArrayBuffer | Uint8Array): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

/**
 * Extract every image this document carries that can be written out truthfully,
 * and account for every one that cannot.
 *
 * `onProgress` receives a monotonically non-decreasing integer percent that
 * saturates at 90; the caller owns the last 10, because it is the one that
 * knows when the files have reached the user.
 */
export async function extractPdfImages(
  data: ArrayBuffer | Uint8Array,
  onProgress?: (percent: number) => void,
): Promise<PdfExtractImagesResult> {
  const doc = await loadDocument(toUint8Array(data));
  onProgress?.(10);

  const { imagesFound, extractable, tally } = classifyImages(doc);
  const produced: { bytes: Uint8Array; format: PdfExtractFormat; width: number; height: number }[] =
    [];

  for (let i = 0; i < extractable.length; i++) {
    const candidate = extractable[i];
    const { format, width, height, components } = candidate;

    let bytes: Uint8Array | null;
    if (format === "jpeg") {
      bytes = liftJpeg(candidate.stream);
    } else {
      /*
        The only decompression in the module, and it can genuinely fail on a
        truncated or corrupt stream — pdf-lib's inflater throws rather than
        returning a short buffer. A sample buffer SHORTER than the dictionary
        promises is the quieter failure and is caught explicitly: building a
        PNG around it would emit garbage rows at the bottom of an image that
        otherwise looks fine.
      */
      let samples: Uint8Array | null = null;
      try {
        samples = decodePDFRawStream(candidate.stream).decode();
      } catch {
        samples = null;
      }
      const needed = width * height * components;
      bytes =
        samples && samples.length >= needed
          ? await buildPng(samples.subarray(0, needed), width, height, components)
          : null;
    }

    if (!bytes) {
      tally.add("undecodable", "stream does not hold the image its dictionary describes");
    } else {
      produced.push({ bytes, format, width, height });
    }
    onProgress?.(Math.min(90, 10 + Math.round(((i + 1) / extractable.length) * 80)));
  }

  onProgress?.(90);
  return { images: nameImages(produced), imagesFound, skipped: tally.list() };
}
