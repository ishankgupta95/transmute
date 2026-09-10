import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef } from "pdf-lib";
import type { PDFContext, PDFDict, PDFObject } from "pdf-lib";
import { MIN_LONGEST_SIDE, nextScale } from "@/lib/tools/target-size";
import type {
  PdfImageJobResult,
  PdfImageMode,
  PdfImageSkip,
  PdfImageSkipReason,
} from "@/lib/workers/pdf-image-protocol";

/**
 * The lossy PDF image recompressor: it re-encodes the JPEG images inside a
 * document at a lower quality (and optionally smaller dimensions) and writes
 * the document back out.
 *
 * This is a DIFFERENT operation from `compressPdf` in pdf-engine-core.ts,
 * which is lossless and structural — it sweeps unreachable objects, deflates
 * raw streams and repacks the file, and deliberately leaves every pixel
 * byte-identical (which is why a PDF that is mostly photographs barely moves).
 * That is exactly the file this module is for, and the trade is stated plainly
 * everywhere it is offered: the pixels are thrown away and cannot be restored
 * from the output.
 *
 * DOM-FREE BY CONTRACT, the same rule pdf-engine-core.ts follows so it can run
 * inside a pool worker — with one addition. Decoding and re-encoding a JPEG
 * needs `createImageBitmap` + `OffscreenCanvas`, which are DOM APIs, so the
 * pixel work arrives through an injected `recode` callback instead. Nothing
 * here may reference `OffscreenCanvas`, `createImageBitmap`, `document`,
 * `window` or `Image`. Two things follow from that, and both are the point:
 * the classification and rebuild logic below is testable in jsdom with a stub
 * recode (this repo's documented blind spot is unit suites that go green over
 * a pixel path that never ran), and the same core drives both the worker and
 * the main-thread fallback.
 *
 * DELIBERATE v1 NON-GOALS — do not implement these without a fresh decision:
 *
 * - **No DPI-aware scaling.** The size a picture is actually printed at comes
 *   from the on-page CTM, not from the image dictionary: the same 3000 × 2000
 *   XObject is 300 DPI on one page and 72 DPI on another, and finding out
 *   needs a content-stream operator walk (q/Q/cm/Do) per page per placement.
 *   v1 scales every image by one uniform factor instead. Because that is what
 *   it does, NO copy anywhere may claim a DPI — the tool would be lying.
 * - No SMask resampling (a mask and its parent must stay in step), no CMYK
 *   (see the `colour-space` rule below), no 1/2/4/16-bit samples, no JPX —
 *   decoding JPEG 2000 needs openjpeg.wasm, which is precisely the multi-MB
 *   payload the MuPDF removal was meant to shed — no CCITTFax, and no
 *   Flate-image transcode.
 */

/**
 * Decode `jpegBytes`, redraw at `scale`, re-encode as JPEG at `quality`.
 * Returns null when the image cannot be decoded at all.
 */
export type PdfImageRecode = (
  jpegBytes: Uint8Array,
  opts: { scale: number; quality: number },
) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>;

function toUint8Array(buf: ArrayBuffer | Uint8Array): Uint8Array {
  return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
}

// ── Loading and saving ─────────────────────────────────────────────

/*
  The two load failures users actually hit, and the save options, are copied
  from pdf-engine-core.ts rather than imported: both are module-private there,
  and exporting them would widen that module's public surface for one caller.
  The MESSAGES are copied verbatim on purpose — a password-protected PDF must
  say the same sentence whichever PDF tool the user dropped it on. There are
  three homes: pdf-engine-core.ts (the canonical one), here, and pdf-engine.ts
  for the pdfjs path. If either string changes in one, change it in all three.

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
    // `updateMetadata: false` stops pdf-lib stamping its own /Producer and a
    // fresh /ModDate on the way in — this op rewrites the user's images, not
    // their document description.
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

/*
  The same save options `compressPdf` uses, replicated here for the reason
  above (SAVE_OPTIONS is module-private in pdf-engine-core.ts and stays that
  way). `addDefaultPage: false` keeps pdf-lib from inventing a blank sheet for
  a pathological document with no pages; `useObjectStreams: true` packs the
  non-stream objects into compressed object streams, so the structural win
  compress-pdf would have given comes along with the image win for free.
*/
const SAVE_OPTIONS = { addDefaultPage: false, useObjectStreams: true } as const;

// ── Search budget ──────────────────────────────────────────────────

/**
 * Total whole-document rebuilds allowed for one run.
 *
 * Every pass re-parses the source, re-encodes every eligible image and
 * re-serialises the whole document, so passes are the expensive unit here —
 * unlike the image target-sizer, where a pass is one canvas encode. Four scale
 * levels × six quality probes is exactly this cap, so a target search that
 * uses its full allowance stops on its own; the cap is the belt on top of that.
 */
const MAX_REBUILDS = 24;

/** At most four dimension levels, and at most six quality probes at each. */
const MAX_SCALE_STEPS = 4;
const REBUILDS_PER_SCALE = 6;

/**
 * The quality window the target search bisects. Narrower than the image
 * encoder's [0.01, 1.0]: below ~0.05 a photograph is unrecognisable, and 1.0
 * on a JPEG that has already been through one lossy generation costs bytes for
 * detail that is no longer in the samples.
 */
const QUALITY_FLOOR = 0.05;
const QUALITY_CEILING = 0.95;

// ── Classification ─────────────────────────────────────────────────

/** One image XObject that survived every eligibility rule. */
interface EligibleImage {
  ref: PDFRef;
  dict: PDFDict;
  /** The stream's raw bytes. /Filter is exactly /DCTDecode, so these ARE a JPEG. */
  bytes: Uint8Array;
  /** From the dictionary, not the codestream — see `clampScale`. */
  width: number;
  height: number;
}

/**
 * Skip counts, grouped by reason, in a fixed order.
 *
 * The order is the classification order below rather than encounter order, so
 * the on-screen disclosure reads the same way for the same document every
 * time. Details (the filter name, the colour space) are collected as a
 * distinct set and joined, because one document can hold several flavours of
 * the same refusal — three JPXDecode images and one CCITTFax is "4 are not
 * JPEG (JPXDecode, CCITTFaxDecode)", not four separate rows.
 */
const SKIP_ORDER: PdfImageSkipReason[] = [
  "mask",
  "filter",
  "decode-parms",
  "decode-array",
  "colour-space",
  "bit-depth",
  "no-smaller",
  "undecodable",
];

/** Distinct details kept per reason; past this the list stops being readable. */
const MAX_SKIP_DETAILS = 3;

class SkipTally {
  private readonly counts = new Map<PdfImageSkipReason, number>();
  private readonly details = new Map<PdfImageSkipReason, Set<string>>();

  add(reason: PdfImageSkipReason, detail?: string): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
    if (!detail) return;
    let seen = this.details.get(reason);
    if (!seen) {
      seen = new Set<string>();
      this.details.set(reason, seen);
    }
    seen.add(detail);
  }

  list(): PdfImageSkip[] {
    const out: PdfImageSkip[] = [];
    for (const reason of SKIP_ORDER) {
      const count = this.counts.get(reason);
      if (!count) continue;
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

/**
 * True for an image XObject's dictionary.
 *
 * `/Subtype /Image` alone is sufficient: /Type is optional on an XObject and a
 * great many producers omit it, so requiring it would silently skip most of
 * the images in the wild. A /Type that is present and says something OTHER
 * than /XObject is a dictionary that is not what we think it is, and is left
 * alone. Both entries are read through `lookup` so an indirect (and legal, if
 * rare) spelling resolves; PDFName instances are pooled by `PDFName.of`, so
 * identity comparison is the right test.
 */
function isImageXObject(dict: PDFDict): boolean {
  if (dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Image")) return false;
  const type = dict.lookup(PDFName.of("Type"));
  return type === undefined || type === PDFName.of("XObject");
}

/**
 * The offending filter name, or null when the stream is exactly a JPEG.
 *
 * `/Filter /DCTDecode` and `/Filter [/DCTDecode]` are the two legal spellings
 * of the same thing. Anything else — a different codec, a filter CHAIN, or no
 * filter at all (raw samples) — means `stream.contents` is not a JPEG file and
 * handing it to an image decoder would be nonsense.
 */
function nonJpegFilter(dict: PDFDict): string | null {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter === PDFName.of("DCTDecode")) return null;
  if (filter instanceof PDFName) return nameLabel(filter);
  if (filter instanceof PDFArray) {
    if (filter.size() === 0) return "uncompressed";
    if (filter.size() === 1) {
      const only = filter.lookup(0);
      if (only === PDFName.of("DCTDecode")) return null;
      return only instanceof PDFName ? nameLabel(only) : "unrecognised";
    }
    const names: string[] = [];
    for (let i = 0; i < filter.size(); i++) {
      const entry = filter.lookup(i);
      names.push(entry instanceof PDFName ? nameLabel(entry) : "unrecognised");
    }
    return names.join(" + ");
  }
  // No /Filter at all: the samples are stored raw.
  return filter === undefined ? "uncompressed" : "unrecognised";
}

/** `/DeviceRGB` → `"DeviceRGB"`. `asString()` keeps the leading slash. */
function nameLabel(name: PDFName): string {
  return name.asString().slice(1);
}

/**
 * What the /ColorSpace entry says, in words, for the on-screen disclosure. An
 * array colour space is named by its family — `[/ICCBased ref]` is "ICCBased",
 * `[/Indexed /DeviceRGB 255 ref]` is "Indexed".
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

/** A dictionary number, or 0 when the entry is missing or malformed. */
function dictNumber(dict: PDFDict, key: string): number {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : 0;
}

interface Classification {
  imagesFound: number;
  eligible: EligibleImage[];
  tally: SkipTally;
  /** Longest side of the largest ELIGIBLE image, in samples; 0 when none. */
  largestLongestSide: number;
}

/**
 * Find every image XObject and decide which ones may be re-encoded.
 *
 * The walk is over `enumerateIndirectObjects()`, not over pages, and that is
 * the whole reason the rebuild is cheap: an image drawn on forty pages is ONE
 * XObject, so it is classified once, re-encoded once and replaced once.
 *
 * Only `PDFRawStream` is considered, which is not a narrowing: pdf-lib's
 * parser builds every stream it reads out of a file as a PDFRawStream (the
 * other stream classes exist for objects the library itself creates, and this
 * module creates none until it replaces one).
 *
 * It is also every image the FILE holds, not every image a reader DRAWS: an
 * XObject nothing references any more — the picture an editor replaced, a page
 * someone deleted — is counted and re-encoded like the rest. That keeps
 * `imagesFound` (which the UI puts on screen) an honest statement about the
 * file, and shrinking dead weight is still shrinking the file. Dropping the
 * orphans outright is `compressPdf`'s separate job, not this one's.
 *
 * THE ORDER OF THE RULES BELOW IS LOAD-BEARING — it decides which reason a
 * user is shown for an image that trips more than one — and the mask ref-set
 * has to be built in a first pass over ALL image XObjects, before any of them
 * is classified, because an image's disqualifying property here belongs to a
 * DIFFERENT object: a perfectly ordinary DeviceGray JPEG is ineligible when
 * some other image names it as its /SMask.
 */
function classifyImages(doc: PDFDocument): Classification {
  const images: { ref: PDFRef; stream: PDFRawStream; dict: PDFDict }[] = [];
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (!isImageXObject(obj.dict)) continue;
    images.push({ ref, stream: obj, dict: obj.dict });
  }

  // First pass: every ref used AS a mask by any image in the document.
  // `get`, not `lookup` — the reference itself is what we are collecting.
  const maskRefs = new Set<string>();
  for (const image of images) {
    for (const key of ["SMask", "Mask"]) {
      const value = image.dict.get(PDFName.of(key));
      if (value instanceof PDFRef) maskRefs.add(value.tag);
    }
  }

  const tally = new SkipTally();
  const eligible: EligibleImage[] = [];
  let largestLongestSide = 0;

  for (const image of images) {
    const { dict } = image;

    /*
      1. Masks, in both directions. A soft mask must stay a single-channel
         DeviceGray image — rewriting it to RGB destroys the alpha channel its
         parent is reading — and re-encoding a MASKED image without touching
         its mask at the same dimensions desynchronises the pair, which paints
         the transparency in the wrong place. Either way the pair is left
         exactly as found.
    */
    if (
      maskRefs.has(image.ref.tag) ||
      dict.get(PDFName.of("SMask")) !== undefined ||
      dict.get(PDFName.of("Mask")) !== undefined
    ) {
      tally.add("mask");
      continue;
    }

    // 2. Not a JPEG. Intended for v1: see the non-goals at the top.
    const filter = nonJpegFilter(dict);
    if (filter !== null) {
      tally.add("filter", filter);
      continue;
    }

    /*
      3. /DecodeParms. Never write beside stale filter parameters — this exact
         defect class was caught once already in this repo (deflateRawStreams
         in pdf-engine-core.ts documents the measurement: a leftover
         `<< /Predictor 12 >>` made pdfjs drop the image from the page
         entirely). A DCTDecode stream has no meaningful parameters to carry,
         so anything here is either stale or something we do not understand.
    */
    if (dict.get(PDFName.of("DecodeParms")) !== undefined) {
      tally.add("decode-parms");
      continue;
    }

    /*
      4. /Decode. It remaps sample values on the way out of the filter —
         `[1 0 1 0 1 0]` on an RGB image is a photographic negative. A canvas
         round-trip bakes the DISPLAYED pixels into the new JPEG, so keeping
         the array would invert the page a second time and dropping it would
         change what a reader that honoured it was showing. Leave it alone.
    */
    if (dict.get(PDFName.of("Decode")) !== undefined) {
      tally.add("decode-array");
      continue;
    }

    /*
      5. Colour space. DeviceCMYK is deliberately refused rather than guessed
         at: `createImageBitmap`'s handling of Adobe-APP14 CMYK JPEGs (the
         inverted-ink convention) is not verified across engines, and getting
         it wrong produces a colour-inverted page that still looks like a
         successful compression. Indexed, ICCBased, Separation, DeviceN and
         Lab land here too — all of them mean the samples are not the sRGB the
         canvas would hand back.
    */
    const cs = dict.lookup(PDFName.of("ColorSpace"));
    if (cs !== PDFName.of("DeviceRGB") && cs !== PDFName.of("DeviceGray")) {
      tally.add("colour-space", colourSpaceLabel(cs));
      continue;
    }

    // 6. Bit depth. A canvas is 8 bits per channel, so anything else would be
    //    quietly requantised.
    if (dict.get(PDFName.of("BitsPerComponent")) !== undefined) {
      const raw = dict.lookup(PDFName.of("BitsPerComponent"));
      const bits = raw instanceof PDFNumber ? raw.asNumber() : undefined;
      if (bits !== 8) {
        tally.add("bit-depth", bits === undefined ? "unreadable" : String(bits));
        continue;
      }
    }

    const width = dictNumber(dict, "Width");
    const height = dictNumber(dict, "Height");
    eligible.push({ ref: image.ref, dict, bytes: image.stream.contents, width, height });
    largestLongestSide = Math.max(largestLongestSide, width, height);
  }

  return { imagesFound: images.length, eligible, tally, largestLongestSide };
}

// ── The rebuild ────────────────────────────────────────────────────

/**
 * The scale to use for ONE image, given the pass's document-wide scale.
 *
 * A single factor applied to every image grinds the small ones away long
 * before it has taken a useful bite out of the big ones: at the 0.5 floor of
 * two dimension steps, a 40 × 40 bullet icon is 10 × 10. So an image whose
 * output would fall below `MIN_LONGEST_SIDE` (the shared floor the image
 * target-sizer already uses) has its own scale clamped back up so its longest
 * side lands exactly on the floor — and never above 1, because an image that
 * is ALREADY smaller than the floor must be left at its own size, not
 * enlarged.
 *
 * The dimensions come from the dictionary rather than the codestream, because
 * this module never decodes anything. A file whose /Width disagrees with its
 * JPEG is malformed; the clamp is then computed from the wrong number, which
 * costs an image that is slightly smaller than intended and nothing else —
 * `recode` reports the size it actually produced and that is what gets written.
 */
function clampScale(width: number, height: number, scale: number): number {
  const safe = Number.isFinite(scale) && scale > 0 ? Math.min(scale, 1) : 1;
  const longest = Math.max(width, height);
  const outLongest = Math.max(1, Math.round(longest * safe));
  if (outLongest >= MIN_LONGEST_SIDE) return safe;
  // `longest` of 0 (a malformed dictionary) gives Infinity here, which
  // Math.min pins at 1 — no division blow-up, and no scaling of a dictionary
  // we could not read.
  return Math.min(1, MIN_LONGEST_SIDE / longest);
}

/**
 * Swap an image XObject's bytes and bring its whole dictionary with them.
 *
 * Every entry that describes the SAMPLES has to move at the same instant the
 * samples do — a /Width left pointing at the old dimensions is a sheared,
 * garbage image, and a /ColorSpace left on DeviceGray beside three-channel
 * data is a page painted in the wrong colours. /ColorSpace is set to
 * /DeviceRGB unconditionally rather than preserved, because a canvas round
 * trip always hands back sRGB: a DeviceGray source comes back as a 3-channel
 * JPEG whatever the source said.
 *
 * The two deletes are belt-and-braces — eligibility already excluded both —
 * and they are cheap insurance against exactly the class of bug that
 * `deflateRawStreams` documents: filter parameters that survive the thing they
 * described.
 *
 * `contents` is readonly on a PDFRawStream, so the object is replaced rather
 * than mutated, carrying the same (now updated) dictionary across.
 */
function replaceImage(
  context: PDFContext,
  ref: PDFRef,
  dict: PDFDict,
  out: { bytes: Uint8Array; width: number; height: number },
): void {
  dict.set(PDFName.of("Width"), context.obj(out.width));
  dict.set(PDFName.of("Height"), context.obj(out.height));
  dict.set(PDFName.of("Length"), context.obj(out.bytes.length));
  dict.set(PDFName.of("BitsPerComponent"), context.obj(8));
  dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
  dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
  dict.delete(PDFName.of("DecodeParms"));
  dict.delete(PDFName.of("Decode"));
  context.assign(ref, PDFRawStream.of(dict, out.bytes));
}

/** One whole-document rebuild at a fixed scale and quality. */
interface Build {
  bytes: Uint8Array;
  imagesFound: number;
  recompressed: number;
  skipped: PdfImageSkip[];
  /** Longest side of the largest eligible image at its ORIGINAL dimensions. */
  largestLongestSide: number;
  quality: number;
  scale: number;
}

/**
 * Re-parse the source, re-encode every eligible image at (`scale`, `quality`),
 * and save.
 *
 * The re-parse is not waste and must not be optimised away: replacing an image
 * MUTATES the document's object graph, so a second pass built on the first
 * one's document would re-encode an already-re-encoded JPEG and stack one
 * generation of loss on another. Each pass starts from the user's own bytes.
 */
async function buildAt(
  source: Uint8Array,
  scale: number,
  quality: number,
  recode: PdfImageRecode,
): Promise<Build> {
  const doc = await loadDocument(source);
  const { imagesFound, eligible, tally, largestLongestSide } = classifyImages(doc);

  let recompressed = 0;
  for (const image of eligible) {
    const out = await recode(image.bytes, {
      scale: clampScale(image.width, image.height, scale),
      quality,
    });
    if (!out) {
      tally.add("undecodable");
      continue;
    }
    /*
      The per-image never-grow guard. It is not a nicety: a DeviceGray scan
      comes back from the canvas as a 3-channel RGB JPEG, so re-encoding it can
      easily produce MORE bytes than the single-channel original. Keeping the
      original bytes for that image is both smaller and lossless.
    */
    if (out.bytes.length >= image.bytes.length) {
      tally.add("no-smaller");
      continue;
    }
    replaceImage(doc.context, image.ref, image.dict, out);
    recompressed++;
  }

  return {
    bytes: await doc.save(SAVE_OPTIONS),
    imagesFound,
    recompressed,
    skipped: tally.list(),
    largestLongestSide,
    quality,
    scale,
  };
}

function toResult(build: Build, targetMet: boolean | null, passes: number): PdfImageJobResult {
  return {
    bytes: build.bytes,
    stats: {
      imagesFound: build.imagesFound,
      imagesRecompressed: build.recompressed,
      skipped: build.skipped,
      quality: build.quality,
      scale: build.scale,
      targetMet,
      passes,
    },
  };
}

// ── The target search ──────────────────────────────────────────────

/**
 * Binary-search quality at fixed dimensions for the LARGEST build at or under
 * the target, and report the smallest build seen either way.
 *
 * Same shape as `searchQuality` in image.worker.ts, deliberately: encode at
 * the ceiling first and take it if it already fits, otherwise bisect, tracking
 * both the best under-target candidate and the smallest overall, and stop
 * refining once a candidate is within 5% of the target. The differences are
 * that an "encode" here is a whole-document rebuild rather than one canvas
 * call, so the probe budget is 6 instead of 11, and that the smallest build is
 * what drives the dimension step below.
 */
async function searchQuality(
  encode: (quality: number) => Promise<Build>,
  targetBytes: number,
  budget: number,
): Promise<{ under: Build | null; smallest: Build }> {
  let lo = QUALITY_FLOOR;
  let hi = QUALITY_CEILING;
  let smallest = await encode(hi);
  let spent = 1;
  if (smallest.bytes.length <= targetBytes) return { under: smallest, smallest };

  /*
    Nothing in this document is eligible, so quality is a no-op: every further
    probe rebuilds byte-identical output. Bisecting the full budget here would
    spend six whole-document parse-and-serialise round trips to learn what the
    first build already established. `largestLongestSide` is only advanced for
    ELIGIBLE images, so 0 means the eligible set is empty — which is the common
    shape of a text-only PDF, or a scan whose images are all CCITTFax.
  */
  if (smallest.largestLongestSide === 0) return { under: null, smallest };

  let under: Build | null = null;
  while (spent < budget) {
    const mid = (lo + hi) / 2;
    const candidate = await encode(mid);
    spent++;
    if (candidate.bytes.length < smallest.bytes.length) smallest = candidate;
    if (candidate.bytes.length <= targetBytes) {
      under = candidate;
      lo = mid;
      // Close enough (within 5% of target) — stop refining.
      if (candidate.bytes.length > targetBytes * 0.95) break;
    } else {
      hi = mid;
    }
  }
  return { under, smallest };
}

// ── Entry point ────────────────────────────────────────────────────

export async function recompressPdfImages(
  data: ArrayBuffer | Uint8Array,
  mode: PdfImageMode,
  recode: PdfImageRecode,
  onProgress?: (percent: number) => void,
): Promise<PdfImageJobResult> {
  const source = toUint8Array(data);

  /*
    One saturating tick per rebuild, the same convention image.worker.ts uses:
    the pass count varies with the search, so progress climbs monotonically and
    parks at 90 rather than overshooting. The caller owns the last 10 — it is
    the one that knows when the bytes have reached the user.
  */
  let passes = 0;
  const build = async (scale: number, quality: number): Promise<Build> => {
    const result = await buildAt(source, scale, quality, recode);
    passes++;
    onProgress?.(Math.min(90, 15 + passes * 7));
    return result;
  };

  if (mode.kind === "quality") {
    return toResult(await build(1, mode.quality), null, passes);
  }

  const targetBytes = mode.targetSizeKb * 1024;
  /*
    Degenerate target (cleared field, 0, NaN): stepping toward it would grind
    every image to the 64-px floor and present that as a success. Encode once
    at the requested quality instead — the same guard, for the same reason, as
    the image worker's target mode.
  */
  if (!Number.isFinite(targetBytes) || targetBytes <= 0) {
    return toResult(await build(1, mode.quality), null, passes);
  }

  let scale = 1;
  let smallestOverall: Build | null = null;

  for (let step = 0; step < MAX_SCALE_STEPS; step++) {
    const budget = Math.min(REBUILDS_PER_SCALE, MAX_REBUILDS - passes);
    if (budget <= 0) break;

    const result = await searchQuality((quality) => build(scale, quality), targetBytes, budget);
    if (result.under) return toResult(result.under, true, passes);

    if (!smallestOverall || result.smallest.bytes.length < smallestOverall.bytes.length) {
      smallestOverall = result.smallest;
    }
    const factor = nextScale(result.smallest.bytes.length, targetBytes);
    /*
      The largest eligible image is already at the floor `clampScale` enforces,
      so a smaller factor would be clamped straight back out and every further
      pass would rebuild the same document for nothing. A file with NO eligible
      images at all reports a largest side of 0 and stops here too, which is
      the case worth naming: there is nothing to re-encode, so no amount of
      searching can move the size.
    */
    const largest = result.smallest.largestLongestSide;
    if (Math.max(1, Math.round(largest * scale)) <= MIN_LONGEST_SIDE) break;
    scale = scale * factor;
  }

  /*
    The target is out of reach. The honest answer is the closest we actually
    got, labelled as not meeting the target — never a silent overshoot
    presented as success, and never the untouched input dressed up as a result.
    `smallestOverall` is non-null here: the loop cannot exit before its first
    `searchQuality`, which always performs at least one rebuild.
  */
  return toResult(smallestOverall!, false, passes);
}
