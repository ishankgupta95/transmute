import { describe, it, expect, vi } from "vitest";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";

import { recompressPdfImages, type PdfImageRecode } from "@/lib/tools/pdf-image-core";
import type { PdfImageStats } from "@/lib/workers/pdf-image-protocol";

/*
  `pdf-image-core` is deliberately DOM-free: the pixel work arrives as an
  injected `recode` callback, and everything else — deciding which XObjects may
  be touched, rewriting the ones that may, and the target-size search — is plain
  pdf-lib. That half is where every trap lives, and it is the half jsdom can run
  for real, so these are not shape assertions against a mock: each test builds a
  document whose image dictionaries are written out by hand, runs the engine on
  its bytes, re-parses the bytes that come back and asserts on the state of the
  resulting objects.

  The stub `recode` is what makes that possible AND what makes it strict. A real
  canvas round-trip's output size is an encoder's opinion; a stub's is a
  function this file writes, so "the never-grow guard fired", "the target was
  reached", "this image was handed to the encoder exactly once" are all exact
  claims rather than statistical ones.

  What is NOT covered here, on purpose: the DOM `recode` itself (createImageBitmap
  + OffscreenCanvas, neither of which exists in jsdom) and the worker plumbing.
  Those are exercised against the real fixture by
  `src/__tests__/e2e/conversion/pdf-recompress.spec.ts`.
*/

// ── Fixture builders ──────────────────────────────────────────────

/**
 * One image XObject, written as raw dictionary entries rather than through
 * pdf-lib's embedders — the whole point is to produce the shapes an embedder
 * would never emit (a stale /DecodeParms, a 1-bit scan, a CMYK photo) and see
 * the classifier refuse them.
 *
 * `null` on an optional key means "omit this entry entirely", which is a
 * different document from "present with a default value" for /Filter,
 * /ColorSpace and /BitsPerComponent alike.
 */
interface ImageSpec {
  /** The /XObject resource name, e.g. "Im0" — also how tests address it. */
  key: string;
  bytes?: Uint8Array;
  width?: number;
  height?: number;
  filter?: string | string[] | null;
  colorSpace?: string | string[] | null;
  bitsPerComponent?: number | null;
  decodeParms?: Record<string, number> | null;
  decode?: number[] | null;
  /** Key of another spec in the same document to reference as /SMask. */
  smask?: string;
  /** Key of another spec in the same document to reference as /Mask. */
  mask?: string;
  /** Omit /Type, which is legal and common; or make it something else. */
  type?: string | null;
  subtype?: string | null;
  /** Page indices whose /Resources list this object. Defaults to page 0. */
  pages?: number[];
}

/** Deterministic, recognisable stream bytes — never all-zero, never random. */
function imageBody(seed: number, length = 600): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed * 97 + 11) & 0xff;
  return out;
}

/** The bytes a stub hands back; distinguishable from any `imageBody`. */
function recodedBody(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 7 + 3) & 0xff;
  return out;
}

async function buildImageDoc(specs: ImageSpec[], pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 200]);

  // Refs first: /SMask and /Mask point at sibling objects, so every ref has to
  // exist before any dictionary is written.
  const refs = new Map<string, PDFRef>();
  for (const spec of specs) refs.set(spec.key, doc.context.nextRef());

  specs.forEach((spec, index) => {
    const entries: Record<string, PDFObject | number> = {};
    if (spec.type !== null) entries.Type = PDFName.of(spec.type ?? "XObject");
    if (spec.subtype !== null) entries.Subtype = PDFName.of(spec.subtype ?? "Image");
    entries.Width = spec.width ?? 120;
    entries.Height = spec.height ?? 90;
    if (spec.filter !== null) {
      const filter = spec.filter ?? "DCTDecode";
      entries.Filter = Array.isArray(filter)
        ? doc.context.obj(filter.map((name) => PDFName.of(name)))
        : PDFName.of(filter);
    }
    if (spec.colorSpace !== null) {
      const space = spec.colorSpace ?? "DeviceRGB";
      entries.ColorSpace = Array.isArray(space)
        ? doc.context.obj(space.map((name) => PDFName.of(name)))
        : PDFName.of(space);
    }
    if (spec.bitsPerComponent !== null) entries.BitsPerComponent = spec.bitsPerComponent ?? 8;
    if (spec.decodeParms) entries.DecodeParms = doc.context.obj(spec.decodeParms);
    if (spec.decode) entries.Decode = doc.context.obj(spec.decode);
    if (spec.smask) entries.SMask = refs.get(spec.smask)!;
    if (spec.mask) entries.Mask = refs.get(spec.mask)!;

    const bytes = spec.bytes ?? imageBody(index);
    // pdf-lib recomputes /Length from the contents on every write, so this is
    // only here to keep the document honest between build and save.
    entries.Length = bytes.length;

    doc.context.assign(
      refs.get(spec.key)!,
      PDFRawStream.of(doc.context.obj(entries) as PDFDict, bytes),
    );
  });

  /*
    Every object is listed in a page's /Resources, masks included. A real
    producer lists only the drawn image and leaves its /SMask reachable through
    the parent dictionary alone; listing both here is what lets a test address
    the mask by name in the OUTPUT, and it changes nothing about
    classification, which walks the indirect objects rather than the resources.
  */
  for (let i = 0; i < pageCount; i++) {
    const onPage = specs.filter((spec) => (spec.pages ?? [0]).includes(i));
    const xObject: Record<string, PDFRef> = {};
    for (const spec of onPage) xObject[spec.key] = refs.get(spec.key)!;
    doc
      .getPage(i)
      .node.set(PDFName.of("Resources"), doc.context.obj({ XObject: xObject }));
  }

  return doc.save();
}

// ── Reading the produced document back ────────────────────────────

/** Every image XObject in the output, addressed by its /Resources name. */
async function imagesOf(bytes: Uint8Array): Promise<Map<string, PDFRawStream>> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = new Map<string, PDFRawStream>();
  for (const page of doc.getPages()) {
    const resources = doc.context.lookup(page.node.get(PDFName.of("Resources")));
    if (!(resources instanceof PDFDict)) continue;
    const xObject = doc.context.lookup(resources.get(PDFName.of("XObject")));
    if (!(xObject instanceof PDFDict)) continue;
    for (const [name, value] of xObject.entries()) {
      const stream = doc.context.lookup(value);
      if (stream instanceof PDFRawStream) out.set(name.decodeText(), stream);
    }
  }
  return out;
}

/** The refs a named XObject resolves to, one entry per page that lists it. */
async function refsFor(bytes: Uint8Array, key: string): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const tags: string[] = [];
  for (const page of doc.getPages()) {
    const resources = doc.context.lookup(page.node.get(PDFName.of("Resources")));
    if (!(resources instanceof PDFDict)) continue;
    const xObject = doc.context.lookup(resources.get(PDFName.of("XObject")));
    if (!(xObject instanceof PDFDict)) continue;
    const ref = xObject.get(PDFName.of(key));
    if (ref instanceof PDFRef) tags.push(ref.tag);
  }
  return tags;
}

const nameEntry = (dict: PDFDict, key: string): string | undefined => {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFName ? value.decodeText() : undefined;
};

const numberEntry = (dict: PDFDict, key: string): number | undefined => {
  const value = dict.get(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
};

/** Skip counts as `{ reason: count }`, for readable assertions. */
function skips(stats: PdfImageStats): Record<string, number> {
  const out: Record<string, number> = {};
  for (const skip of stats.skipped) out[skip.reason] = (out[skip.reason] ?? 0) + skip.count;
  return out;
}

/** The invariant the disclosure on screen is built out of. */
function expectCountsAddUp(stats: PdfImageStats): void {
  const skipped = stats.skipped.reduce((sum, skip) => sum + skip.count, 0);
  expect(
    stats.imagesRecompressed + skipped,
    "every image found is either recompressed or accounted for by a skip",
  ).toBe(stats.imagesFound);
}

/** A stub that always succeeds, at a fixed output size. */
function fixedRecode(length: number, dims = { width: 60, height: 45 }) {
  const calls: { bytes: Uint8Array; scale: number; quality: number }[] = [];
  const recode: PdfImageRecode = async (bytes, opts) => {
    calls.push({ bytes, scale: opts.scale, quality: opts.quality });
    return { bytes: recodedBody(length), width: dims.width, height: dims.height };
  };
  return { recode, calls };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("recompressPdfImages", () => {
  // ── the replacement itself ──────────────────────────────────

  describe("replacing an eligible image", () => {
    it("rewrites every dictionary entry the new bytes invalidate, together", async () => {
      /*
        A canvas round-trip returns sRGB, always — so a DeviceGray source comes
        back three-channel and a dictionary that still says /DeviceGray would
        make the reader interpret the first third of the scan as the whole
        image. The source here is DeviceGray precisely so that rewrite is
        falsifiable; a partial update (new bytes, old colour space) is the
        silent-wrong-output this test exists to catch.
      */
      const source = await buildImageDoc([
        { key: "Im0", width: 320, height: 240, colorSpace: "DeviceGray", bytes: imageBody(1, 900) },
      ]);
      const { recode, calls } = fixedRecode(300, { width: 160, height: 120 });

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.6 },
        recode,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].bytes).toEqual(imageBody(1, 900));
      expect(calls[0]).toMatchObject({ scale: 1, quality: 0.6 });

      const image = (await imagesOf(bytes)).get("Im0")!;
      expect(image.getContents()).toEqual(recodedBody(300));
      expect(numberEntry(image.dict, "Width")).toBe(160);
      expect(numberEntry(image.dict, "Height")).toBe(120);
      // /Length is recomputed by pdf-lib on every write, so this pins that the
      // CONTENTS were replaced rather than that the engine set the entry.
      expect(numberEntry(image.dict, "Length")).toBe(300);
      expect(numberEntry(image.dict, "BitsPerComponent")).toBe(8);
      expect(nameEntry(image.dict, "ColorSpace")).toBe("DeviceRGB");
      expect(nameEntry(image.dict, "Filter")).toBe("DCTDecode");
      expect(nameEntry(image.dict, "Subtype")).toBe("Image");

      expect(stats).toMatchObject({
        imagesFound: 1,
        imagesRecompressed: 1,
        quality: 0.6,
        scale: 1,
        targetMet: null,
        passes: 1,
      });
      expectCountsAddUp(stats);
    });

    it("leaves no /Decode or /DecodeParms beside the new bytes", async () => {
      /*
        Belt and braces, and this test says so rather than overclaiming: an
        image carrying either entry is refused by the classifier below, so the
        only thing assertable here is that the replacement does not INVENT one.
        It is still worth pinning — a canvas round-trip normalises samples, so
        an inherited /Decode [1 0 …] on a rewritten object would render the page
        inverted, and the delete is the line that stops a future "carry the
        source dictionary across" refactor from doing exactly that.
      */
      const source = await buildImageDoc([{ key: "Im0" }]);
      const { recode } = fixedRecode(200);

      const { bytes } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.5 },
        recode,
      );

      const image = (await imagesOf(bytes)).get("Im0")!;
      expect(image.dict.get(PDFName.of("Decode"))).toBeUndefined();
      expect(image.dict.get(PDFName.of("DecodeParms"))).toBeUndefined();
    });

    it("hands an image drawn on many pages to the encoder exactly once", async () => {
      /*
        The engine walks INDIRECT OBJECTS, not pages. A per-page implementation
        re-encodes a repeated logo once per page and writes a copy of it per
        page — on a 40-page document with a full-width header image that is 40
        JPEG encodes and 39 wasted copies, and the output can come back LARGER
        than the input while every readout claims a saving.
      */
      const source = await buildImageDoc(
        [{ key: "Im0", pages: [0, 1, 2], bytes: imageBody(4, 800) }],
        3,
      );
      const { recode, calls } = fixedRecode(250);

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.7 },
        recode,
      );

      expect(calls).toHaveLength(1);
      expect(stats.imagesFound).toBe(1);
      expect(stats.imagesRecompressed).toBe(1);

      // One object, still shared: three pages, three references, one ref tag.
      const tags = await refsFor(bytes, "Im0");
      expect(tags).toHaveLength(3);
      expect(new Set(tags).size).toBe(1);
      const images = await imagesOf(bytes);
      expect(images.size).toBe(1);
      expect(images.get("Im0")!.getContents()).toEqual(recodedBody(250));
    });

    it("counts no images in a document that has none", async () => {
      const source = await buildImageDoc([], 2);
      const { recode, calls } = fixedRecode(100);

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.6 },
        recode,
      );

      expect(calls).toHaveLength(0);
      expect(stats.imagesFound).toBe(0);
      expect(stats.imagesRecompressed).toBe(0);
      expectCountsAddUp(stats);
      // And the document still comes back whole rather than as an error.
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      expect(doc.getPageCount()).toBe(2);
    });
  });

  // ── classification ──────────────────────────────────────────

  describe("what it refuses to touch", () => {
    it("groups every skip reason and the counts add up to what it found", async () => {
      /*
        One document carrying one image per refusal, so the grouping the UI
        renders ("3 of 11 were left untouched — 2 are not JPEG…") is asserted as
        a whole rather than one reason at a time. Two of these are eligible on
        purpose: a bare /DCTDecode and a one-element [/DCTDecode] array are the
        same thing to a reader, and refusing the array form would silently skip
        a large slice of real-world files.
      */
      const source = await buildImageDoc([
        { key: "Ok0" },
        { key: "Ok1", filter: ["DCTDecode"] },
        { key: "Jpx", filter: "JPXDecode" },
        { key: "Flate", filter: "FlateDecode" },
        { key: "Mixed", filter: ["FlateDecode", "DCTDecode"] },
        { key: "Parms", decodeParms: { Predictor: 15, Columns: 4 } },
        { key: "Inverted", decode: [1, 0, 1, 0, 1, 0] },
        { key: "Cmyk", colorSpace: "DeviceCMYK" },
        { key: "Indexed", colorSpace: ["Indexed", "DeviceRGB"] },
        { key: "Bilevel", bitsPerComponent: 1 },
        { key: "Deep", bitsPerComponent: 16 },
        { key: "Masked", smask: "Alpha" },
        { key: "Alpha", filter: "FlateDecode", colorSpace: "DeviceGray" },
        // Not an image at all: a form XObject must not even be counted.
        { key: "Form", subtype: "Form" },
      ]);
      const { recode, calls } = fixedRecode(120);

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.6 },
        recode,
      );

      expect(stats.imagesFound).toBe(13);
      expect(stats.imagesRecompressed).toBe(2);
      expect(calls).toHaveLength(2);
      expect(skips(stats)).toEqual({
        filter: 3,
        "decode-parms": 1,
        "decode-array": 1,
        "colour-space": 2,
        "bit-depth": 2,
        mask: 2,
      });
      expectCountsAddUp(stats);

      // The detail is what turns "not JPEG" into something a user can act on.
      const filterSkip = stats.skipped.find((skip) => skip.reason === "filter");
      expect(filterSkip?.detail).toMatch(/JPX|Flate/i);
      const colourSkip = stats.skipped.find((skip) => skip.reason === "colour-space");
      expect(colourSkip?.detail).toMatch(/CMYK|Indexed/i);

      // Every refused object is byte-identical to what arrived, dictionary and
      // stream both — a "skip" that rewrote the dictionary is not a skip.
      const images = await imagesOf(bytes);
      const untouched: [string, number][] = [
        ["Jpx", 2],
        ["Flate", 3],
        ["Mixed", 4],
        ["Parms", 5],
        ["Inverted", 6],
        ["Cmyk", 7],
        ["Indexed", 8],
        ["Bilevel", 9],
        ["Deep", 10],
        ["Masked", 11],
        ["Alpha", 12],
        ["Form", 13],
      ];
      for (const [key, seed] of untouched) {
        expect(images.get(key)!.getContents(), key).toEqual(imageBody(seed));
      }
      expect(images.get("Ok0")!.getContents()).toEqual(recodedBody(120));
      expect(images.get("Ok1")!.getContents()).toEqual(recodedBody(120));
    });

    it("counts an image with no /Type, and ignores a form XObject", async () => {
      // /Type is optional on a stream dictionary and plenty of producers omit
      // it, so /Subtype /Image alone has to be enough — while /Subtype /Form is
      // never an image however it is typed.
      const source = await buildImageDoc([
        { key: "Untyped", type: null },
        { key: "Shape", subtype: "Form" },
      ]);
      const { recode } = fixedRecode(150);

      const { stats } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.6 },
        recode,
      );

      expect(stats.imagesFound).toBe(1);
      expect(stats.imagesRecompressed).toBe(1);
    });

    it("skips both halves of a masked pair, and neither is touched", async () => {
      /*
        Two separate reasons wearing one name. The PARENT cannot be re-encoded
        because its mask is sampled against the original pixel grid, and the
        MASK cannot be re-encoded because an /SMask must stay DeviceGray while a
        canvas hands back RGB. Missing either half desynchronises the pair, and
        the result is a page whose transparency is subtly — or completely —
        wrong, with nothing on screen to say so.
      */
      const source = await buildImageDoc([
        { key: "Photo", smask: "Alpha" },
        { key: "Alpha", colorSpace: "DeviceGray" },
        { key: "Stencilled", mask: "Stencil" },
        { key: "Stencil", colorSpace: "DeviceGray" },
      ]);
      const { recode, calls } = fixedRecode(100);

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.6 },
        recode,
      );

      expect(calls).toHaveLength(0);
      expect(stats.imagesFound).toBe(4);
      expect(stats.imagesRecompressed).toBe(0);
      expect(skips(stats)).toEqual({ mask: 4 });
      expectCountsAddUp(stats);

      const images = await imagesOf(bytes);
      expect(images.get("Photo")!.getContents()).toEqual(imageBody(0));
      expect(images.get("Alpha")!.getContents()).toEqual(imageBody(1));
      expect(images.get("Stencilled")!.getContents()).toEqual(imageBody(2));
      expect(images.get("Stencil")!.getContents()).toEqual(imageBody(3));
    });

    it("reports a mask that is also un-decodable as a mask, once", async () => {
      /*
        Order matters as much as membership: an /SMask written by pdf-lib's own
        PNG embedder is FlateDecode AND carries /Decode [0 1] AND is a mask, so
        three rules match it. Reporting it as `filter` would tell the user their
        transparency was skipped for being the wrong format and invite them to
        "fix" it, and it would double-count against `imagesFound` if the rules
        were allowed to fire more than once.
      */
      const source = await buildImageDoc([
        { key: "Photo", smask: "Alpha" },
        { key: "Alpha", filter: "FlateDecode", colorSpace: "DeviceGray", decode: [0, 1] },
      ]);
      const { recode } = fixedRecode(100);

      const { stats } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.6 },
        recode,
      );

      expect(skips(stats)).toEqual({ mask: 2 });
      expectCountsAddUp(stats);
    });

    it("keeps the original bytes when the encoder cannot make them smaller", async () => {
      /*
        The per-image never-grow guard. A DeviceGray scan is the case that made
        it necessary: the canvas hands back a three-channel JPEG, so re-encoding
        an already-tight greyscale image reliably produces MORE bytes than it
        was given. Both boundaries are here, because `>` instead of `>=` lets an
        exactly-equal re-encode through — new bytes, no saving, and a document
        that now claims a recompression that bought nothing.
      */
      const source = await buildImageDoc([
        { key: "Grew", bytes: imageBody(1, 500) },
        { key: "Tied", bytes: imageBody(2, 400) },
        { key: "Shrank", bytes: imageBody(3, 900) },
      ]);
      const sizes: Record<string, number> = { 500: 900, 400: 400, 900: 250 };
      const recode: PdfImageRecode = async (bytes) => ({
        bytes: recodedBody(sizes[bytes.length]),
        width: 60,
        height: 45,
      });

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.6 },
        recode,
      );

      expect(stats.imagesFound).toBe(3);
      expect(stats.imagesRecompressed).toBe(1);
      expect(skips(stats)).toEqual({ "no-smaller": 2 });
      expectCountsAddUp(stats);

      const images = await imagesOf(bytes);
      // Byte-identical, and still the dictionary they arrived with — a guard
      // that dropped the bytes but wrote the new /Width would be worse than no
      // guard at all.
      expect(images.get("Grew")!.getContents()).toEqual(imageBody(1, 500));
      expect(images.get("Tied")!.getContents()).toEqual(imageBody(2, 400));
      expect(numberEntry(images.get("Grew")!.dict, "Width")).toBe(120);
      expect(images.get("Shrank")!.getContents()).toEqual(recodedBody(250));
      expect(numberEntry(images.get("Shrank")!.dict, "Width")).toBe(60);
    });

    it("leaves an image the encoder could not read at all where it was", async () => {
      const source = await buildImageDoc([
        { key: "Broken", bytes: imageBody(1, 700) },
        { key: "Fine", bytes: imageBody(2, 700) },
      ]);
      const recode: PdfImageRecode = async (bytes) =>
        bytes[0] === imageBody(1, 700)[0]
          ? null
          : { bytes: recodedBody(180), width: 60, height: 45 };

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "quality", quality: 0.6 },
        recode,
      );

      expect(stats.imagesRecompressed).toBe(1);
      expect(skips(stats)).toEqual({ undecodable: 1 });
      expectCountsAddUp(stats);
      const images = await imagesOf(bytes);
      expect(images.get("Broken")!.getContents()).toEqual(imageBody(1, 700));
      expect(images.get("Fine")!.getContents()).toEqual(recodedBody(180));
    });
  });

  // ── target mode ─────────────────────────────────────────────

  describe("target mode", () => {
    /**
     * A stub that behaves the way a JPEG encoder does: output size falls with
     * quality, and with the SQUARE of the linear scale, because that is how
     * pixel count moves. `floor` is the size it can never go below — the knob
     * that separates a reachable target from an unreachable one.
     */
    function sizedRecode(baseline: number, floor = 1) {
      const calls: { scale: number; quality: number; size: number }[] = [];
      const recode: PdfImageRecode = async (_bytes, { scale, quality }) => {
        const size = Math.max(floor, Math.round(baseline * quality * scale * scale));
        calls.push({ scale, quality, size });
        return {
          bytes: recodedBody(size),
          width: Math.max(1, Math.round(800 * scale)),
          height: Math.max(1, Math.round(600 * scale)),
        };
      };
      return { recode, calls };
    }

    it("searches quality down to a size that fits and says the target was met", async () => {
      const source = await buildImageDoc([
        { key: "Im0", width: 800, height: 600, bytes: imageBody(1, 60_000) },
      ]);
      const { recode, calls } = sizedRecode(60_000);
      const targetSizeKb = 20;

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "target", targetSizeKb, quality: 0.6 },
        recode,
      );

      expect(bytes.length).toBeLessThanOrEqual(targetSizeKb * 1024);
      expect(stats.targetMet).toBe(true);
      expect(stats.imagesRecompressed).toBe(1);
      // Quality alone gets there, so the picture must not have been resized —
      // scaling a document that did not need it is a needless loss of detail.
      expect(stats.scale).toBe(1);
      expect(calls.every((call) => call.scale === 1)).toBe(true);
      // A search, not a single lucky encode; and the reported quality is the
      // one the winning pass used, not the mode's.
      expect(stats.passes).toBeGreaterThan(1);
      expect(stats.quality).toBeGreaterThanOrEqual(0.05);
      expect(stats.quality).toBeLessThanOrEqual(0.95);
      expect(stats.quality).not.toBe(0.6);

      // The document that came back is the winning build, not an intermediate.
      const image = (await imagesOf(bytes)).get("Im0")!;
      expect(image.getContents().length).toBe(
        Math.round(60_000 * stats.quality * stats.scale * stats.scale),
      );
    });

    it("returns the smallest it could build, and says the target was missed", async () => {
      /*
        The honesty path, and the one that must never throw: the tool is asked
        for something arithmetic cannot deliver, so it hands back the closest it
        managed and admits it. `floor` here stands in for the bytes no encoder
        setting can remove — in the real fixture that is the two Flate images
        the tool refuses to touch.
      */
      const source = await buildImageDoc([
        { key: "Im0", width: 800, height: 600, bytes: imageBody(1, 60_000) },
      ]);
      const { recode, calls } = sizedRecode(60_000, 5_000);

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "target", targetSizeKb: 1, quality: 0.6 },
        recode,
      );

      expect(stats.targetMet).toBe(false);
      expect(stats.imagesRecompressed).toBe(1);
      expect(bytes.length).toBeGreaterThan(1024);
      expect(bytes.length).toBeLessThan(source.length);
      // It kept going past the first scale level rather than giving up at the
      // first disappointment, and it stopped inside the rebuild cap.
      expect(calls.some((call) => call.scale < 1)).toBe(true);
      expect(stats.scale).toBeLessThanOrEqual(1);
      expect(stats.passes).toBeGreaterThan(4);
      expect(stats.passes).toBeLessThanOrEqual(24);
      // The winner is a build at the floor — the smallest anything could be.
      expect((await imagesOf(bytes)).get("Im0")!.getContents().length).toBe(5_000);
    });

    it("keeps the BEST-LOOKING build that fits, not the smallest one it saw", async () => {
      /*
        The search tracks `under` by moving `lo` upward, so it converges on the
        highest quality still under the target. Nothing above asserted that:
        an implementation that simply returned its smallest build would meet
        the target, report targetMet, and pass every other test in this file
        while handing the user a needlessly ugly document. The registry's
        aboutText makes this promise in as many words, so it is pinned here.
      */
      const source = await buildImageDoc([
        { key: "Im0", width: 800, height: 600, bytes: imageBody(1, 60_000) },
      ]);
      const { recode, calls } = sizedRecode(60_000);
      // Chosen so the first bisection lands well UNDER the target rather than
      // inside the search's 5% stop band — that is what makes it keep probing
      // upward, which is the behaviour under test.
      const targetSizeKb = 45;

      const { bytes, stats } = await recompressPdfImages(
        source,
        { kind: "target", targetSizeKb, quality: 0.6 },
        recode,
      );

      const targetBytes = targetSizeKb * 1024;
      expect(stats.targetMet).toBe(true);
      expect(bytes.length).toBeLessThanOrEqual(targetBytes);

      // It probed lower qualities than the one it kept, so keeping this one
      // was a choice rather than the only option available.
      const qualitiesTried = calls.map((call) => call.quality);
      expect(Math.min(...qualitiesTried)).toBeLessThan(stats.quality);

      // The winner is the LARGEST fitting build among everything probed. An
      // implementation that returned its smallest build would fail here.
      const fittingSizes = calls
        .map((call) => call.size + (bytes.length - calls.find((c) => c.quality === stats.quality)!.size))
        .filter((size) => size <= targetBytes);
      expect(bytes.length).toBe(Math.max(...fittingSizes));
    });

    it("never scales a small image below the shared floor, whatever the document-wide factor", async () => {
      /*
        `clampScale` is the reason the on-screen "scaled to N%" notice carries
        its "except any that would have fallen below 64px" clause. Nothing
        tested it: a build that dropped the clamp would grind a 40x40 bullet
        icon to 20x20 to save a few bytes, and every other assertion here would
        still pass.
      */
      const source = await buildImageDoc([
        { key: "Big", width: 2000, height: 1000, bytes: imageBody(1, 60_000) },
        { key: "Tiny", width: 40, height: 40, bytes: imageBody(2, 900) },
      ]);

      // Keyed on the incoming byte length so each image's scales are separable.
      const seen = new Map<number, number[]>();
      const recode: PdfImageRecode = async (bytes, { scale, quality }) => {
        const list = seen.get(bytes.length) ?? [];
        list.push(scale);
        seen.set(bytes.length, list);
        const size = Math.max(2_000, Math.round(bytes.length * quality * scale * scale));
        return { bytes: recodedBody(size), width: Math.max(1, Math.round(100 * scale)), height: 50 };
      };

      // Unreachable, so the dimension stepping definitely engages.
      const { stats } = await recompressPdfImages(
        source,
        { kind: "target", targetSizeKb: 1, quality: 0.6 },
        recode,
      );

      const bigScales = seen.get(60_000)!;
      const tinyScales = seen.get(900)!;
      expect(bigScales.some((s) => s < 1)).toBe(true); // the big one really was stepped down
      // The 40px image is ALREADY under the 64px floor, so it may never be
      // shrunk at all — not even at the document's smallest scale.
      expect(tinyScales.every((s) => s === 1)).toBe(true);
      // And the reported document-wide factor is below the one actually
      // applied to that image, which is exactly why the notice says "except".
      expect(stats.scale).toBeLessThan(1);
    });

    it("treats a target of zero as a plain quality run rather than dividing by it", async () => {
      // Mirrors image.worker.ts's degenerate-target guard. A UI can hand this
      // over while a number field is mid-edit, and a search against a target of
      // 0 would burn all 24 rebuilds to arrive nowhere.
      const source = await buildImageDoc([{ key: "Im0", bytes: imageBody(1, 5_000) }]);
      const { recode, calls } = fixedRecode(400);

      const { stats } = await recompressPdfImages(
        source,
        { kind: "target", targetSizeKb: 0, quality: 0.55 },
        recode,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ scale: 1, quality: 0.55 });
      expect(stats.passes).toBe(1);
      expect(stats.targetMet).toBeNull();
      expect(stats.imagesRecompressed).toBe(1);
    });
  });

  // ── progress ────────────────────────────────────────────────

  it("reports progress that only ever moves forward, and leaves 100 to the UI", async () => {
    const source = await buildImageDoc([
      { key: "Im0", width: 800, height: 600, bytes: imageBody(1, 60_000) },
    ]);
    const recode: PdfImageRecode = async (_bytes, { scale, quality }) => ({
      bytes: recodedBody(Math.max(4_000, Math.round(60_000 * quality * scale * scale))),
      width: Math.max(1, Math.round(800 * scale)),
      height: Math.max(1, Math.round(600 * scale)),
    });
    const onProgress = vi.fn();

    await recompressPdfImages(
      source,
      { kind: "target", targetSizeKb: 2, quality: 0.6 },
      recode,
      onProgress,
    );

    const reported = onProgress.mock.calls.map(([percent]) => percent as number);
    expect(reported.length).toBeGreaterThan(0);
    for (const [i, percent] of reported.entries()) {
      expect(Number.isInteger(percent), `${percent} should be a whole percent`).toBe(true);
      expect(percent).toBeGreaterThanOrEqual(0);
      // 100 belongs to the caller: the bytes still have to reach the main
      // thread and become a Blob after the last pass finishes.
      expect(percent).toBeLessThanOrEqual(90);
      if (i > 0) expect(percent).toBeGreaterThanOrEqual(reported[i - 1]);
    }
  });
});
