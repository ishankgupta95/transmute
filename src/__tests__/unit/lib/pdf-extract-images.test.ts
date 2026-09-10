import { describe, it, expect, vi, afterEach } from "vitest";
import { PDFDocument, PDFDict, PDFName, PDFObject, PDFRawStream, PDFRef } from "pdf-lib";

import { extractPdfImages } from "@/lib/tools/pdf-extract-images";
import type { PdfExtractImagesResult } from "@/lib/tools/pdf-extract-images";
import { readJpegOrientation } from "@/lib/tools/jpeg-orientation";

/*
  The extractor is DOM-free by design — there is no canvas anywhere in it,
  because the whole premise is that a /DCTDecode stream IS a JPEG file and gets
  copied rather than decoded. So unlike the recompressor, jsdom can run 100% of
  this engine for real: the classifier, the verbatim lift AND the PNG builder.
  Nothing below is a shape assertion against a mock.

  Every test therefore does the same thing end to end: build a document whose
  image dictionaries are written out by hand (so the shapes an embedder would
  never emit — a stale /DecodeParms, a 1-bit scan, a CMYK photo — can be put in
  front of the classifier), run the real extractor over its saved bytes, and
  assert on the FILES that come back, parsing the PNGs to their samples where
  the claim is about pixels.
*/

// ── Fixture builders ──────────────────────────────────────────────

interface ImageSpec {
  /** The /XObject resource name, e.g. "Im0". Documentation only. */
  key: string;
  /** Stream bytes exactly as stored. Defaults to a tiny valid JPEG. */
  bytes?: Uint8Array;
  width?: number;
  height?: number;
  filter?: string | string[] | null;
  /** A name, an array of names, or `["ICCBased", n]` for a profile stream. */
  colorSpace?: string | string[] | { icc: number } | null;
  bitsPerComponent?: number | null;
  decodeParms?: Record<string, number> | null;
  decode?: number[] | null;
  imageMask?: boolean;
  /** Key of another spec in the same document to reference as /SMask. */
  smask?: string;
  /** Key of another spec in the same document to reference as /Mask. */
  mask?: string;
  type?: string | null;
  subtype?: string | null;
  /** Page indices whose /Resources list this object. Defaults to page 0. */
  pages?: number[];
}

/**
 * The smallest thing that is unambiguously a JPEG file: SOI, an APP0/JFIF
 * segment, then EOI. The extractor never decodes it — it only checks the SOI
 * marker and copies — so the entropy-coded scan nobody reads is left out.
 */
function jpegBody(seed: number, length = 64): Uint8Array {
  const out = new Uint8Array(length);
  out[0] = 0xff;
  out[1] = 0xd8;
  for (let i = 2; i < length - 2; i++) out[i] = (i * 31 + seed * 97 + 11) & 0xff;
  out[length - 2] = 0xff;
  out[length - 1] = 0xd9;
  return out;
}

/** A minimal but real JPEG carrying an Exif Orientation tag. */
function jpegWithOrientation(orientation: number): Uint8Array {
  const tiff = [
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II", 42, IFD0 @ 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  const len = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload,
    0xff, 0xd9,
  ]);
}

/** Deterministic, recognisable raw samples — never all-zero, never random. */
function rawSamples(width: number, height: number, components: number, seed = 0): Uint8Array {
  const out = new Uint8Array(width * height * components);
  for (let i = 0; i < out.length; i++) out[i] = (i * 37 + seed * 53 + 7) & 0xff;
  return out;
}

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const pump = (async () => {
    await writer.write(new Uint8Array(raw));
    await writer.close();
  })();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await pump;
  return concat(chunks);
}

async function inflate(packed: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const pump = (async () => {
    await writer.write(new Uint8Array(packed));
    await writer.close();
  })();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await pump;
  return concat(chunks);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
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
    const entries: Record<string, PDFObject | number | boolean> = {};
    if (spec.type !== null) entries.Type = PDFName.of(spec.type ?? "XObject");
    if (spec.subtype !== null) entries.Subtype = PDFName.of(spec.subtype ?? "Image");
    entries.Width = spec.width ?? 8;
    entries.Height = spec.height ?? 4;
    if (spec.filter !== null) {
      const filter = spec.filter ?? "DCTDecode";
      entries.Filter = Array.isArray(filter)
        ? doc.context.obj(filter.map((name) => PDFName.of(name)))
        : PDFName.of(filter);
    }
    if (spec.colorSpace !== null) {
      const space = spec.colorSpace ?? "DeviceRGB";
      if (typeof space === "object" && "icc" in space) {
        // `[/ICCBased streamRef]`, the shape Acrobat and InDesign tag every
        // ordinary sRGB photograph with. /N is what says how many components.
        const profileRef = doc.context.nextRef();
        doc.context.assign(
          profileRef,
          PDFRawStream.of(doc.context.obj({ N: space.icc }) as PDFDict, new Uint8Array([1, 2, 3])),
        );
        entries.ColorSpace = doc.context.obj([PDFName.of("ICCBased"), profileRef]);
      } else if (Array.isArray(space)) {
        entries.ColorSpace = doc.context.obj(space.map((name) => PDFName.of(name)));
      } else {
        entries.ColorSpace = PDFName.of(space);
      }
    }
    if (spec.bitsPerComponent !== null) entries.BitsPerComponent = spec.bitsPerComponent ?? 8;
    if (spec.decodeParms) entries.DecodeParms = doc.context.obj(spec.decodeParms);
    if (spec.decode) entries.Decode = doc.context.obj(spec.decode);
    if (spec.imageMask) entries.ImageMask = true;
    if (spec.smask) entries.SMask = refs.get(spec.smask)!;
    if (spec.mask) entries.Mask = refs.get(spec.mask)!;

    const bytes = spec.bytes ?? jpegBody(index);
    entries.Length = bytes.length;

    doc.context.assign(
      refs.get(spec.key)!,
      PDFRawStream.of(doc.context.obj(entries) as PDFDict, bytes),
    );
  });

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

/** A Flate image spec whose stream really is the deflate of `samples`. */
async function flateSpec(
  spec: ImageSpec & { samples: Uint8Array },
): Promise<ImageSpec> {
  const { samples, ...rest } = spec;
  return { ...rest, filter: rest.filter ?? "FlateDecode", bytes: await deflate(samples) };
}

// ── Reading a produced PNG back ───────────────────────────────────

interface DecodedPng {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  compression: number;
  filterMethod: number;
  interlace: number;
  /** Un-filtered samples, row-major, exactly as a decoder would see them. */
  samples: Uint8Array;
  /** Every chunk type in file order. */
  chunkTypes: string[];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A real (if minimal) PNG reader: it verifies the signature, walks the chunks
 * checking every CRC, inflates the IDAT and un-does the per-row filter. So
 * "the samples survived" below is a claim about a file a decoder can open, not
 * about a byte range this test happened to slice out.
 */
async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  expect([...bytes.subarray(0, 8)], "PNG signature").toEqual(PNG_SIGNATURE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkTypes: string[] = [];
  let at = 8;
  let ihdr: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    expect(view.getUint32(at + 8 + length), `${type} CRC`).toBe(
      crc32(bytes.subarray(at + 4, at + 8 + length)),
    );
    chunkTypes.push(type);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    at += 12 + length;
  }
  expect(at, "chunks exactly fill the file").toBe(bytes.length);
  expect(ihdr, "IHDR present").not.toBeNull();

  const header = new DataView(ihdr!.buffer, ihdr!.byteOffset, ihdr!.byteLength);
  const width = header.getUint32(0);
  const height = header.getUint32(4);
  const colourType = ihdr![9];
  const components = colourType === 0 ? 1 : 3;

  const raw = await inflate(concat(idat));
  const stride = width * components;
  const samples = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    // Only filter 0 ("None") is produced, deliberately — see buildPng.
    expect(raw[y * (stride + 1)], `row ${y} filter byte`).toBe(0);
    samples.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }

  return {
    width,
    height,
    bitDepth: ihdr![8],
    colourType,
    compression: ihdr![10],
    filterMethod: ihdr![11],
    interlace: ihdr![12],
    samples,
    chunkTypes,
  };
}

// ── Assertions shared by every test ───────────────────────────────

/** Skip counts as `{ reason: count }`, for readable assertions. */
function skips(result: PdfExtractImagesResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const skip of result.skipped) out[skip.reason] = (out[skip.reason] ?? 0) + skip.count;
  return out;
}

/**
 * The invariant the on-screen disclosure is built out of: every image the file
 * holds is either handed over as a file or accounted for by a named skip. A
 * tool that quietly dropped one would still look like it worked.
 */
function expectCountsAddUp(result: PdfExtractImagesResult): void {
  const skipped = result.skipped.reduce((sum, skip) => sum + skip.count, 0);
  expect(
    result.images.length + skipped,
    "every image found is either extracted or accounted for by a skip",
  ).toBe(result.imagesFound);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────

describe("extractPdfImages — the verbatim JPEG lift", () => {
  it("hands back the stored bytes byte-for-byte, under a .jpg name", async () => {
    /*
      THE HEADLINE CLAIM. A /DCTDecode stream is a JPEG bitstream, so a true
      extraction is a byte copy. Anything that decoded and re-encoded would
      still produce a plausible-looking .jpg here — which is exactly why the
      assertion is on equality with the source bytes rather than on the file
      merely opening.
    */
    const stored = jpegBody(3, 512);
    const source = await buildImageDoc([{ key: "Im0", width: 320, height: 240, bytes: stored }]);

    const result = await extractPdfImages(source);

    expect(result.imagesFound).toBe(1);
    expect(result.skipped).toEqual([]);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].name).toBe("image-01.jpg");
    expect(result.images[0].format).toBe("jpeg");
    expect(result.images[0].width).toBe(320);
    expect(result.images[0].height).toBe(240);
    expect(result.images[0].bytes).toEqual(stored);
    expectCountsAddUp(result);
  });

  it("leaves EXIF Orientation exactly as it found it", async () => {
    /*
      THE EXIF TRAP, pinned. `createImageBitmap` APPLIES Orientation and a PDF
      reader ignores it, so any decode/re-encode path writes rotated — and for
      5-8 transposed — samples out. This document's JPEG carries Orientation 6.

      Two assertions, and the second is the one that cannot be faked: the tag
      still reads 6 (so nothing normalised it the way the recompressor
      deliberately does), and the bytes are identical to what went in (so
      nothing decoded them either). A re-encoder would strip the Exif segment
      entirely and this file would read 1.
    */
    const stored = jpegWithOrientation(6);
    expect(readJpegOrientation(stored), "fixture really carries Orientation 6").toBe(6);
    const source = await buildImageDoc([{ key: "Im0", width: 400, height: 200, bytes: stored }]);

    const result = await extractPdfImages(source);

    expect(result.images).toHaveLength(1);
    expect(result.images[0].bytes).toEqual(stored);
    expect(readJpegOrientation(result.images[0].bytes)).toBe(6);
    // Not transposed: the dictionary's grid is reported, untouched.
    expect(result.images[0]).toMatchObject({ width: 400, height: 200 });
  });

  it("does not pin the whole parsed document behind the extracted bytes", async () => {
    /*
      `stream.contents` is a VIEW onto the parsed PDF. Handing it over directly
      would keep the entire document alive for as long as a 4 KB thumbnail
      does, which on a 200 MB file is the difference between a tab and a dead
      tab. The copy is observable: the extracted array owns its buffer.
    */
    const stored = jpegBody(9, 256);
    const source = await buildImageDoc([{ key: "Im0", bytes: stored }]);

    const result = await extractPdfImages(source);

    expect(result.images[0].bytes.byteOffset).toBe(0);
    expect(result.images[0].bytes.buffer.byteLength).toBe(stored.length);
  });

  it("refuses a /DCTDecode stream that is not actually a JPEG", async () => {
    // No SOI marker: writing these bytes out would produce a .jpg that no
    // viewer opens — a failure wearing a file's clothes.
    const source = await buildImageDoc([
      { key: "Im0", bytes: new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]) },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(skips(result)).toEqual({ undecodable: 1 });
    expectCountsAddUp(result);
  });

  it("accepts an ICCBased JPEG, because a JPEG carries its own colour data", async () => {
    /*
      Acrobat and InDesign tag essentially every sRGB photograph
      `[/ICCBased ref]`. Refusing the family wholesale would skip most of the
      photographs in most real PDFs and call it caution — and it would be
      caution about nothing, because the file written out is the self-
      describing JPEG bitstream, not a container this module has to label.
    */
    const source = await buildImageDoc([
      { key: "Im0", colorSpace: { icc: 3 }, bytes: jpegBody(1, 128) },
      { key: "Im1", colorSpace: { icc: 1 }, bytes: jpegBody(2, 128) },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images.map((i) => i.name)).toEqual(["image-01.jpg", "image-02.jpg"]);
    expect(result.skipped).toEqual([]);
  });

  it("refuses an ICCBased JPEG with four components", async () => {
    // /N 4 is CMYK wearing a profile. Same refusal as DeviceCMYK, and for the
    // same reason: the inverted-ink convention makes a lifted file that most
    // viewers cannot open and one that can may show as a colour negative.
    const source = await buildImageDoc([{ key: "Im0", colorSpace: { icc: 4 } }]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(result.skipped).toEqual([{ reason: "colour-space", count: 1, detail: "ICCBased" }]);
  });
});

describe("extractPdfImages — the Flate → PNG rebuild", () => {
  it("rebuilds an RGB bitmap into a PNG whose samples are the stored samples", async () => {
    /*
      There are no JPEG bytes to lift out of a /FlateDecode image, so a PNG has
      to be authored around the samples. The claim that makes that honest is
      that the SAMPLES do not change — so this parses the produced file the way
      a decoder would (CRCs, inflate, un-filter) and compares every byte with
      what the document stored.
    */
    const samples = rawSamples(9, 5, 3, 2);
    const source = await buildImageDoc([
      await flateSpec({ key: "Im0", width: 9, height: 5, samples }),
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toHaveLength(1);
    expect(result.images[0].name).toBe("image-01.png");
    expect(result.images[0].format).toBe("png");

    const png = await decodePng(result.images[0].bytes);
    expect(png).toMatchObject({
      width: 9,
      height: 5,
      bitDepth: 8,
      colourType: 2, // truecolour
      compression: 0,
      filterMethod: 0,
      interlace: 0,
    });
    expect(png.chunkTypes).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(png.samples).toEqual(samples);
  });

  it("rebuilds a greyscale bitmap as colour type 0, not as three grey channels", async () => {
    // Writing a DeviceGray scan out as RGB would triple the file and claim
    // colour the document does not have. Colour type 0 is the honest header.
    const samples = rawSamples(7, 3, 1, 5);
    const source = await buildImageDoc([
      await flateSpec({
        key: "Im0",
        width: 7,
        height: 3,
        colorSpace: "DeviceGray",
        samples,
      }),
    ]);

    const result = await extractPdfImages(source);

    const png = await decodePng(result.images[0].bytes);
    expect(png.colourType).toBe(0);
    expect(png.samples).toEqual(samples);
  });

  it("ignores trailing padding rather than letting it shift the rows", async () => {
    // Some producers pad the stream past width*height*components. Taking the
    // whole buffer would push the extra bytes into the filtered rows and shear
    // the image; only the samples the dictionary describes are used.
    const samples = rawSamples(4, 2, 3, 9);
    const padded = new Uint8Array(samples.length + 16);
    padded.set(samples);
    padded.fill(0xab, samples.length);
    const source = await buildImageDoc([
      await flateSpec({ key: "Im0", width: 4, height: 2, samples: padded }),
    ]);

    const result = await extractPdfImages(source);

    const png = await decodePng(result.images[0].bytes);
    expect(png.samples).toEqual(samples);
  });

  it("skips a stream that holds fewer samples than its dictionary promises", async () => {
    /*
      The quiet failure: a short buffer would build a PNG with garbage (or
      zeroed) rows at the bottom of an image that otherwise looks fine, and
      report a success. One byte short is enough to refuse.
    */
    const source = await buildImageDoc([
      await flateSpec({
        key: "Im0",
        width: 4,
        height: 2,
        samples: rawSamples(4, 2, 3).subarray(0, 4 * 2 * 3 - 1),
      }),
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(skips(result)).toEqual({ undecodable: 1 });
    expectCountsAddUp(result);
  });

  it("survives a corrupt deflate stream instead of failing the whole document", async () => {
    // One broken image must not cost the user the other twelve.
    const source = await buildImageDoc([
      {
        key: "Im0",
        filter: "FlateDecode",
        width: 4,
        height: 2,
        bytes: new Uint8Array([0x78, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      },
      { key: "Im1", bytes: jpegBody(4, 96) },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images.map((i) => i.name)).toEqual(["image-01.jpg"]);
    expect(skips(result)).toEqual({ undecodable: 1 });
    expectCountsAddUp(result);
  });

  it("still writes a readable PNG where CompressionStream does not exist", async () => {
    /*
      The stored-block fallback. It is a real, spec-valid zlib stream that any
      decoder reads — it simply does not compress. A large PNG beats no PNG,
      and this is the one branch in the module that can fail-safe at all;
      everything else is byte copying.
    */
    const samples = rawSamples(6, 4, 3, 11);
    const source = await buildImageDoc([
      await flateSpec({ key: "Im0", width: 6, height: 4, samples }),
    ]);
    vi.stubGlobal("CompressionStream", undefined);

    const result = await extractPdfImages(source);

    expect(result.images).toHaveLength(1);
    const png = await decodePng(result.images[0].bytes);
    expect(png).toMatchObject({ width: 6, height: 4, colourType: 2 });
    expect(png.samples).toEqual(samples);
  });

  it("falls back rather than throwing when the compressor itself refuses", async () => {
    const samples = rawSamples(5, 2, 1, 13);
    const source = await buildImageDoc([
      await flateSpec({
        key: "Im0",
        width: 5,
        height: 2,
        colorSpace: "DeviceGray",
        samples,
      }),
    ]);
    vi.stubGlobal(
      "CompressionStream",
      class {
        constructor() {
          throw new Error("no compression here");
        }
      },
    );

    const result = await extractPdfImages(source);

    const png = await decodePng(result.images[0].bytes);
    expect(png.samples).toEqual(samples);
  });
});

describe("extractPdfImages — an image drawn on many pages is one image", () => {
  it("emits a shared XObject once, not once per placement", async () => {
    /*
      THE REASON THE WALK IS OVER INDIRECT OBJECTS. A logo drawn on all forty
      pages of a report is ONE image XObject listed in forty /Resources
      dictionaries. Iterating pages would hand the user forty identical files
      and call it forty images.
    */
    const stored = jpegBody(6, 200);
    const source = await buildImageDoc(
      [{ key: "Logo", bytes: stored, pages: [0, 1, 2] }, { key: "Photo", bytes: jpegBody(7, 200), pages: [1] }],
      3,
    );

    const result = await extractPdfImages(source);

    expect(result.imagesFound).toBe(2);
    expect(result.images).toHaveLength(2);
    expect(result.images.filter((i) => i.bytes.length === stored.length)).toHaveLength(2);
    expect(result.images.map((i) => i.name)).toEqual(["image-01.jpg", "image-02.jpg"]);
    expectCountsAddUp(result);
  });

  it("finds an image no page references any more", async () => {
    // An XObject an editor orphaned is still in the file, so it is still
    // extracted — and `imagesFound` stays an honest statement about the file
    // rather than about what a reader happens to draw.
    const source = await buildImageDoc([{ key: "Orphan", bytes: jpegBody(8, 128), pages: [] }]);

    const result = await extractPdfImages(source);

    expect(result.imagesFound).toBe(1);
    expect(result.images).toHaveLength(1);
  });
});

describe("extractPdfImages — what it refuses, and what it says about it", () => {
  it("leaves transparency masks alone in both directions", async () => {
    /*
      An image used AS a mask is an alpha channel, not a picture — handing it
      over gives a white silhouette nobody asked for. An image that CARRIES a
      mask stores the picture WITHOUT its transparency, so lifting its bytes
      paints back in whatever the mask was hiding. Both are left in the
      document; there is no honest fix that does not decode and composite.
    */
    const source = await buildImageDoc([
      { key: "Photo", smask: "Alpha" },
      { key: "Alpha", colorSpace: "DeviceGray" },
      { key: "KeyMasked", mask: "Stencil" },
      { key: "Stencil", colorSpace: "DeviceGray" },
      { key: "Stamp", imageMask: true, colorSpace: null, bitsPerComponent: 1 },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(result.imagesFound).toBe(5);
    expect(skips(result)).toEqual({ mask: 5 });
    expectCountsAddUp(result);
  });

  it("names the filter it will not read", async () => {
    const source = await buildImageDoc([
      { key: "Jpx", filter: "JPXDecode" },
      { key: "Fax", filter: "CCITTFaxDecode" },
      { key: "Jbig", filter: "JBIG2Decode" },
      { key: "Chained", filter: ["ASCII85Decode", "DCTDecode"] },
      { key: "Bare", filter: null },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(result.skipped).toEqual([
      {
        reason: "filter",
        count: 5,
        // Distinct details, capped at three so the sentence stays readable.
        detail: "JPXDecode, CCITTFaxDecode, JBIG2Decode…",
      },
    ]);
    expectCountsAddUp(result);
  });

  it("refuses a stream carrying /DecodeParms rather than guessing at a predictor", async () => {
    /*
      MEASURED ELSEWHERE IN THIS REPO: a leftover `<< /Predictor 12 >>` made
      pdfjs drop an image from the page entirely (see deflateRawStreams in
      pdf-engine-core.ts). Here the risk runs the other way — `decodePDFRawStream`
      does NOT un-predict, so writing the predicted rows out as samples would
      produce a smeared image that still looks like a successful extraction.
    */
    const samples = rawSamples(4, 2, 3);
    const source = await buildImageDoc([
      await flateSpec({
        key: "Im0",
        width: 4,
        height: 2,
        samples,
        decodeParms: { Predictor: 15, Colors: 3, Columns: 4 },
      }),
      { key: "Im1", decodeParms: { ColorTransform: 0 } },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(skips(result)).toEqual({ "decode-parms": 2 });
    expectCountsAddUp(result);
  });

  it("refuses a /Decode array, which no extracted file can carry", async () => {
    // `[1 0 1 0 1 0]` is a photographic negative applied by the reader. A JPEG
    // or PNG has nowhere to put it, so the lifted file would be the image the
    // page does NOT show.
    const source = await buildImageDoc([{ key: "Im0", decode: [1, 0, 1, 0, 1, 0] }]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(skips(result)).toEqual({ "decode-array": 1 });
  });

  it("names the colour spaces it will not guess at", async () => {
    const source = await buildImageDoc([
      { key: "Cmyk", colorSpace: "DeviceCMYK" },
      { key: "Indexed", colorSpace: ["Indexed", "DeviceRGB"] },
      { key: "Spot", colorSpace: ["Separation", "PANTONE"] },
      { key: "Untagged", colorSpace: null },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(result.skipped).toEqual([
      {
        reason: "colour-space",
        count: 4,
        detail: "DeviceCMYK, Indexed, Separation…",
      },
    ]);
    expectCountsAddUp(result);
  });

  it("refuses an ICCBased raw bitmap, because the PNG header would be a guess", async () => {
    /*
      The one place the two paths differ, on purpose. A JPEG is self-describing
      so ICCBased is fine there; a PNG's colour type is written by this module,
      so the Flate path takes DeviceRGB and DeviceGray exactly and nothing else.
    */
    const source = await buildImageDoc([
      await flateSpec({
        key: "Im0",
        width: 4,
        height: 2,
        colorSpace: { icc: 3 },
        samples: rawSamples(4, 2, 3),
      }),
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(skips(result)).toEqual({ "colour-space": 1 });
  });

  it("refuses samples that are not 8 bits per component", async () => {
    // A 12- or 16-bit JPEG is a file browsers will not open, and the PNG
    // builder writes 8-bit rows and nothing else. An ABSENT /BitsPerComponent
    // is a dictionary that cannot be trusted about its own samples.
    const source = await buildImageDoc([
      { key: "Scan", bitsPerComponent: 1 },
      { key: "Deep", bitsPerComponent: 16 },
      { key: "Silent", bitsPerComponent: null },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(result.skipped).toEqual([
      { reason: "bit-depth", count: 3, detail: "1, 16, absent" },
    ]);
    expectCountsAddUp(result);
  });

  it("refuses a dictionary with no usable dimensions", async () => {
    const source = await buildImageDoc([
      { key: "Zero", width: 0, height: 10 },
      { key: "Negative", width: -4, height: 10 },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(skips(result)).toEqual({ undecodable: 2 });
  });

  it("blames ITSELF, not the document, for a bitmap over its own memory ceiling", async () => {
    /*
      MAX_SAMPLE_BYTES is 256 MB of samples, checked from the DECLARED
      dimensions before a byte is decompressed. 12000 × 12000 RGB is 432 MB, so
      this image never reaches the inflater — the tool learns nothing at all
      about whether the stream is intact.

      It used to be counted as `undecodable`, whose sentence on screen is "DID
      NOT HOLD THE IMAGE ITS DICTIONARY DESCRIBES": a large-format scan that a
      PNG represents perfectly, reported to its owner as a damaged file. The
      reason has to name the tool's budget, and the detail has to be a fact the
      classifier actually established — the size.
    */
    const source = await buildImageDoc([
      {
        key: "Huge",
        filter: "FlateDecode",
        colorSpace: "DeviceRGB",
        width: 12000,
        height: 12000,
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    ]);

    const result = await extractPdfImages(source);

    expect(result.images).toEqual([]);
    expect(skips(result)).toEqual({ "too-large": 1 });
    expect(result.skipped[0].detail).toBe("12000 × 12000");
    // The word that sent a user off to repair an undamaged file.
    expect(JSON.stringify(result.skipped)).not.toContain("undecodable");
  });

  it("keeps its own ceiling distinct from a stream that really is broken", async () => {
    /*
      The contrast that makes the row above mean something. Same shape, same
      four junk bytes; only the declared size differs. 9000 × 9000 RGB is
      243 MB and passes the ceiling, so the inflater IS reached, refuses the
      bytes, and `undecodable` — a verdict on a stream that was actually read —
      is the honest answer for that one.
    */
    const source = await buildImageDoc([
      {
        key: "Over",
        filter: "FlateDecode",
        colorSpace: "DeviceRGB",
        width: 12000,
        height: 12000,
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
      {
        key: "Broken",
        filter: "FlateDecode",
        colorSpace: "DeviceRGB",
        width: 9000,
        height: 9000,
        bytes: new Uint8Array([1, 2, 3, 4]),
      },
    ]);

    const result = await extractPdfImages(source);

    expect(skips(result)).toEqual({ undecodable: 1, "too-large": 1 });
  });

  it("reports skips in a fixed order, whatever order the images arrive in", async () => {
    /*
      The disclosure on screen is a sentence built from this list. Encounter
      order would make the same document read differently from run to run;
      the order below is the classification order, so it is stable.
    */
    const source = await buildImageDoc([
      { key: "A", bitsPerComponent: 4 },
      { key: "B", colorSpace: "DeviceCMYK" },
      { key: "C", decode: [1, 0, 1, 0, 1, 0] },
      { key: "D", decodeParms: { ColorTransform: 0 } },
      { key: "E", filter: "JPXDecode" },
      { key: "F", smask: "G" },
      { key: "G", colorSpace: "DeviceGray" },
    ]);

    const result = await extractPdfImages(source);

    expect(result.skipped.map((s) => s.reason)).toEqual([
      "mask",
      "filter",
      "decode-parms",
      "decode-array",
      "colour-space",
      "bit-depth",
    ]);
  });

  it("counts an object that is not an image XObject as nothing at all", async () => {
    // /Subtype /Form is a content-stream XObject, not a picture. Counting it
    // would inflate `imagesFound`, which is the denominator of every readout.
    const source = await buildImageDoc([
      { key: "Form", subtype: "Form" },
      { key: "Odd", type: "Font" },
      { key: "Real", bytes: jpegBody(2, 96) },
    ]);

    const result = await extractPdfImages(source);

    expect(result.imagesFound).toBe(1);
    expect(result.images).toHaveLength(1);
  });

  it("finds an image whose dictionary omits /Type, which most producers do", async () => {
    const source = await buildImageDoc([{ key: "Im0", type: null, bytes: jpegBody(5, 96) }]);

    const result = await extractPdfImages(source);

    expect(result.imagesFound).toBe(1);
    expect(result.images).toHaveLength(1);
  });
});

describe("extractPdfImages — naming and progress", () => {
  it("numbers the files it actually produces, contiguously and zero-padded", async () => {
    /*
      Numbering by position among the CANDIDATES would leave gaps wherever one
      failed to decode, and a ZIP containing image-01, image-03, image-04 reads
      as a tool that lost something. Padding is what makes the ZIP sort the way
      it reads.
    */
    const specs: ImageSpec[] = [];
    for (let i = 0; i < 11; i++) {
      // The third one is a broken JPEG, so it drops out mid-run.
      specs.push(
        i === 2
          ? { key: `Im${i}`, bytes: new Uint8Array([1, 2, 3, 4]) }
          : { key: `Im${i}`, bytes: jpegBody(i, 64) },
      );
    }
    const source = await buildImageDoc(specs);

    const result = await extractPdfImages(source);

    expect(result.images.map((i) => i.name)).toEqual([
      "image-01.jpg",
      "image-02.jpg",
      "image-03.jpg",
      "image-04.jpg",
      "image-05.jpg",
      "image-06.jpg",
      "image-07.jpg",
      "image-08.jpg",
      "image-09.jpg",
      "image-10.jpg",
    ]);
    expectCountsAddUp(result);
  });

  it("pads by the number of files produced, not by how many were considered", async () => {
    /*
      A document with a hundred image objects of which five can be written out
      gives image-01…image-05, not image-001…image-005 — the padding describes
      the ZIP the user opens, not the search that filled it.
    */
    const specs: ImageSpec[] = [];
    for (let i = 0; i < 100; i++) {
      specs.push(
        i % 20 === 0
          ? { key: `Im${i}`, bytes: jpegBody(i, 64) }
          : { key: `Im${i}`, filter: "JPXDecode" },
      );
    }
    const source = await buildImageDoc(specs);

    const result = await extractPdfImages(source);

    expect(result.images.map((i) => i.name)).toEqual([
      "image-01.jpg",
      "image-02.jpg",
      "image-03.jpg",
      "image-04.jpg",
      "image-05.jpg",
    ]);
    expectCountsAddUp(result);
  });

  it("gives the two formats their own extensions", async () => {
    const source = await buildImageDoc([
      { key: "Photo", bytes: jpegBody(1, 96) },
      await flateSpec({ key: "Bitmap", width: 3, height: 2, samples: rawSamples(3, 2, 3) }),
    ]);

    const result = await extractPdfImages(source);

    expect(result.images.map((i) => i.name)).toEqual(["image-01.jpg", "image-02.png"]);
  });

  it("reports progress that only climbs, and parks at 90", async () => {
    // The caller owns the last 10 — it is the one that knows when the files
    // have reached the user.
    const source = await buildImageDoc([
      { key: "A", bytes: jpegBody(1, 96) },
      { key: "B", bytes: jpegBody(2, 96) },
      { key: "C", bytes: jpegBody(3, 96) },
    ]);
    const seen: number[] = [];

    await extractPdfImages(source, (p) => seen.push(p));

    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(Math.max(...seen)).toBe(90);
    expect(seen.every((p) => Number.isInteger(p) && p >= 0 && p <= 90)).toBe(true);
  });

  it("says nothing was found rather than failing on a PDF with no images", async () => {
    const source = await buildImageDoc([]);

    const result = await extractPdfImages(source);

    expect(result).toEqual({ images: [], imagesFound: 0, skipped: [] });
  });
});

describe("extractPdfImages — load failures speak the same sentence as every other PDF tool", () => {
  it("points a damaged file at Repair PDF", async () => {
    await expect(extractPdfImages(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(
      /damaged or is not a PDF[\s\S]*\/repair-pdf/,
    );
  });

  it("points an encrypted file at Unlock PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    // pdf-lib refuses to LOAD an encrypted document; the /Encrypt entry is what
    // it looks for, so a hand-set one reproduces the user-visible failure.
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: PDFName.of("Standard"), V: 1 });
    const bytes = await doc.save();

    await expect(extractPdfImages(bytes)).rejects.toThrow(
      /password-protected[\s\S]*\/unlock-pdf/,
    );
  });
});
