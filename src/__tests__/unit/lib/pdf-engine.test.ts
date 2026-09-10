import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";

/*
  These are REAL round trips, not mock-shape assertions.

  The version of this file that came before mocked `mupdf` with fifteen stub
  methods and then checked that the engine had called them in a particular
  order — which proved that the code called the library, and nothing at all
  about the documents it produced. The engine is pure pdf-lib now, pdf-lib is
  pure JavaScript, and jsdom runs it happily, so every test below builds a
  real PDF, runs the operation on its bytes, parses the bytes that come back
  and asserts on the state of the resulting document. A regression that a mock
  harness cannot see — a rotation that silently no-ops, a stamp drawn off the
  edge of the page, a garbage collector that eats a form field — fails here.

  The one thing that still cannot run for real is the pdfjs render path in
  pdf-engine.ts: it needs a canvas with real 2D raster output, which jsdom does
  not have. Those tests keep their mocks and are unchanged.
*/

// ── pdfjs-dist mock (rasterisation only — see above) ──────────────

const hoisted = vi.hoisted(() => {
  const mockRenderTask = { promise: Promise.resolve() };
  const mockPdfjsPage = {
    getViewport: vi.fn().mockReturnValue({ width: 800, height: 600 }),
    render: vi.fn().mockReturnValue(mockRenderTask),
    cleanup: vi.fn(),
  };
  const mockPdfjsDoc = {
    numPages: 2,
    getPage: vi.fn().mockResolvedValue(mockPdfjsPage),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
  return { mockPdfjsDoc, mockPdfjsPage, mockRenderTask };
});

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn().mockReturnValue({
    promise: Promise.resolve(hoisted.mockPdfjsDoc),
  }),
  GlobalWorkerOptions: { workerSrc: "" },
}));

// ── Imports ───────────────────────────────────────────────────────

import {
  getPageCount,
  mergePdfs,
  splitPdf,
  splitPdfToPages,
  deletePdfPages,
  cropPdfPages,
  changePdfPageSize,
  rotatePdfPages,
  reorderPdfPages,
  addPageNumbers,
  imagesToPdf,
  compressPdf,
  pdfToImages,
  loadPdfjsDocument,
  renderPageFromDoc,
  renderPageToCanvas,
  PDF_PAGE_SIZES,
} from "@/lib/tools/pdf-engine";

const { mockPdfjsDoc, mockPdfjsPage, mockRenderTask } = hoisted;

// ── Canvas mock for pdfToImages / render helpers ──────────────────

let mockCanvas: Record<string, unknown>;

// Captured before the spy is installed: the fallback branch below must reach
// jsdom's real createElement, not the spy, or a non-canvas tag would recurse
// into itself forever.
const realCreateElement = document.createElement.bind(document);

function setupCanvasMock() {
  mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue({}),
    toBlob: vi.fn().mockImplementation((cb: (b: Blob | null) => void) => {
      cb(new Blob(["image-data"], { type: "image/jpeg" }));
    }),
  };
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") return mockCanvas as unknown as HTMLCanvasElement;
    return realCreateElement(tag);
  });
}

// ── Fixture builders ──────────────────────────────────────────────

type Size = [number, number];

const A4: Size = [595, 842];

/** Open a produced document the way the tools' own callers would. */
function open(bytes: Uint8Array): Promise<PDFDocument> {
  // `updateMetadata: false` matters in the assertions as much as it does in
  // the engine: the default rewrites /Producer and /ModDate on load, so a test
  // that read them back would be reading pdf-lib's own stamp and calling it
  // the source's metadata.
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/** A document with one page per entry in `sizes`, and no /Info unless asked. */
async function buildPdf(
  sizes: Size[],
  info: Partial<{
    title: string;
    author: string;
    subject: string;
    keywords: string[];
    creator: string;
    producer: string;
    creationDate: Date;
    modificationDate: Date;
  }> = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const size of sizes) doc.addPage(size);
  if (info.title !== undefined) doc.setTitle(info.title);
  if (info.author !== undefined) doc.setAuthor(info.author);
  if (info.subject !== undefined) doc.setSubject(info.subject);
  if (info.keywords !== undefined) doc.setKeywords(info.keywords);
  if (info.creator !== undefined) doc.setCreator(info.creator);
  if (info.producer !== undefined) doc.setProducer(info.producer);
  if (info.creationDate !== undefined) doc.setCreationDate(info.creationDate);
  if (info.modificationDate !== undefined) doc.setModificationDate(info.modificationDate);
  return doc.save();
}

/** A single page carrying /Rotate on the page dictionary itself. */
async function buildRotatedPdf(angle: number, size: Size = A4): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage(size).node.set(PDFName.of("Rotate"), PDFNumber.of(angle));
  return doc.save();
}

/**
 * /Rotate parked on the shared /Pages node instead of on any leaf — the
 * inheritable-attribute case that used to make rotation a silent no-op.
 */
async function buildInheritedRotatePdf(angle: number, pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < pages; i++) doc.addPage(A4);
  const pagesDict = doc.context.lookup(doc.catalog.get(PDFName.of("Pages"))) as PDFDict;
  pagesDict.set(PDFName.of("Rotate"), PDFNumber.of(angle));
  return doc.save();
}

/**
 * A single page whose boxes are written verbatim, so the CropBox can differ
 * from the MediaBox — the shape that separates "what is in the file" from
 * "what a reader shows", and that every geometry regression below turns on.
 * Boxes are given as raw `[llx, lly, urx, ury]` PDF arrays, not width/height.
 */
async function buildBoxedPdf(boxes: {
  media: [number, number, number, number];
  crop?: number[];
  bleed?: number[];
  trim?: number[];
  art?: number[];
  rotate?: number;
  /**
   * Draw a line of text. Text is used rather than a rectangle because
   * `drawText` emits its placement as a text matrix (`Tm`) while
   * `drawRectangle` emits `1 0 0 1 x y cm` — and several assertions below turn
   * on whether a `cm` in the stream is ours.
   */
  withText?: boolean;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([boxes.media[2] - boxes.media[0], boxes.media[3] - boxes.media[1]]);
  if (boxes.withText) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("body", { x: boxes.media[0] + 20, y: boxes.media[1] + 20, size: 12, font });
  }
  page.node.set(PDFName.of("MediaBox"), doc.context.obj(boxes.media));
  if (boxes.crop) page.node.set(PDFName.of("CropBox"), doc.context.obj(boxes.crop));
  if (boxes.bleed) page.node.set(PDFName.of("BleedBox"), doc.context.obj(boxes.bleed));
  if (boxes.trim) page.node.set(PDFName.of("TrimBox"), doc.context.obj(boxes.trim));
  if (boxes.art) page.node.set(PDFName.of("ArtBox"), doc.context.obj(boxes.art));
  if (boxes.rotate !== undefined) {
    page.node.set(PDFName.of("Rotate"), PDFNumber.of(boxes.rotate));
  }
  return doc.save();
}

/** The four raw numbers of one of a page's boxes, or undefined if absent. */
async function boxOf(
  bytes: Uint8Array,
  name: "MediaBox" | "CropBox" | "BleedBox" | "TrimBox" | "ArtBox",
  index = 0,
): Promise<number[] | undefined> {
  const doc = await open(bytes);
  const array = doc.getPage(index).node.get(PDFName.of(name));
  if (!(array instanceof PDFArray)) return undefined;
  return array.asArray().map((n) => (n as PDFNumber).asNumber());
}

// ── Content-stream reader ─────────────────────────────────────────

/**
 * The concatenated content streams of one page, as text.
 *
 * pdf-lib writes the stamp into a Flate-compressed stream, so the bytes have
 * to be inflated before any operator is visible. Page-scoped rather than a
 * whole-file scan so a per-page assertion cannot accidentally be satisfied by
 * a different page's stamp.
 */
async function pageContent(bytes: Uint8Array, index: number): Promise<string> {
  const doc = await open(bytes);
  const context = doc.context;
  const contents = context.lookup(doc.getPage(index).node.get(PDFName.of("Contents")));
  const refs: (PDFRef | undefined)[] =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i) as PDFRef)
      : [doc.getPage(index).node.get(PDFName.of("Contents")) as PDFRef];

  return refs
    .map((ref) => {
      const stream = context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) return "";
      const raw = Buffer.from(stream.getContents());
      try {
        return inflateSync(raw).toString("latin1");
      } catch {
        return raw.toString("latin1");
      }
    })
    .join("\n");
}

// ── Image fixtures for imagesToPdf ────────────────────────────────

// A real 2×2 PNG; pdf-lib decodes it with its own PNG reader, so it has to be
// genuine bytes rather than a stand-in.
const PNG_2X2 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8Dwn4GBgYmBgYEBAA8+AwGmZCVAAAAAAElFTkSuQmCC",
    "base64",
  ),
);

const SAMPLE_JPEG = new Uint8Array(
  readFileSync(resolve(process.cwd(), "src/__tests__/fixtures/samples", "sample-photo.jpg")),
);

/**
 * The same 800×600 picture as SAMPLE_JPEG, differing in EXACTLY ONE BYTE — the
 * EXIF Orientation tag, which reads 6 (rotated 90° clockwise). Every image
 * viewer therefore shows it as 600×800 portrait. Being a one-byte-different
 * matched pair is what makes it a usable control: anything that differs
 * between the two outputs is attributable to orientation and nothing else.
 */
const SAMPLE_JPEG_ROTATED = new Uint8Array(
  readFileSync(
    resolve(process.cwd(), "src/__tests__/fixtures/samples", "sample-photo-portrait.jpg"),
  ),
);

/** A real 4×2 RGB PNG, so a shape change is visible in both axes. */
const PNG_4X2 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAH0lEQVR4nAXBMQEAAAyDMIRNGCeiKnAJ0JE0AjvTZg9cogixVC78TwAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/**
 * Splice an `eXIf` chunk carrying one Orientation value into a PNG.
 *
 * A PNG `eXIf` payload is a BARE TIFF stream — no `"Exif\0\0"` prefix, which is
 * the single way it differs from the JPEG APP1 case. The chunk is inserted
 * after IHDR and before IDAT, which is where a reader looks for it.
 */
function pngWithExifOrientation(png: Uint8Array, orientation: number): Uint8Array {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("II", 0, "latin1"); // little-endian
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 starts immediately after the header
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(0x0112, 10); // Orientation
  tiff.writeUInt16LE(3, 12); // TYPE_SHORT
  tiff.writeUInt32LE(1, 14); // count
  tiff.writeUInt16LE(orientation, 18); // inline value
  tiff.writeUInt32LE(0, 22); // no next IFD

  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  const crc32 = (buf: Buffer): number => {
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const typeAndData = Buffer.concat([Buffer.from("eXIf", "latin1"), tiff]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(tiff.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  const chunk = Buffer.concat([length, typeAndData, crc]);

  // 8-byte signature + the whole IHDR chunk (4 length + 4 type + 13 data + 4 crc).
  const afterIhdr = 8 + 4 + 4 + 13 + 4;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(png.subarray(0, afterIhdr)),
      chunk,
      Buffer.from(png.subarray(afterIhdr)),
    ]),
  );
}

// ── Tests ─────────────────────────────────────────────────────────

describe("pdf-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupCanvasMock();

    mockPdfjsDoc.getPage.mockResolvedValue(mockPdfjsPage);
    mockPdfjsDoc.destroy.mockResolvedValue(undefined);
    mockPdfjsPage.getViewport.mockReturnValue({ width: 800, height: 600 });
    mockPdfjsPage.render.mockReturnValue(mockRenderTask);
  });

  // ── getPageCount ──────────────────────────────────────────────

  describe("getPageCount", () => {
    it("counts the pages of a real document", async () => {
      expect(await getPageCount(await buildPdf([A4, A4, A4, A4, A4]))).toBe(5);
    });

    it("accepts ArrayBuffer input", async () => {
      const bytes = await buildPdf([A4, A4]);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      expect(await getPageCount(buffer as ArrayBuffer)).toBe(2);
    });

    it("says a file is not a PDF instead of leaking parser internals", async () => {
      // The UIs render err.message verbatim, so "offset=5: No PDF header
      // found" would be what the user reads.
      await expect(getPageCount(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(
        /damaged or is not a PDF/,
      );
    });

    it("points a damaged file at repair-pdf rather than dead-ending it", async () => {
      // This message used to end "Nothing here repairs a broken PDF" — true
      // until /repair-pdf shipped, and a lie the moment it did. The route is
      // the load-bearing half of the sentence, so it is what the test pins.
      await expect(getPageCount(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(
        /\/repair-pdf/,
      );
    });

    it("says a document is password-protected rather than failing obscurely", async () => {
      // MuPDF opened these silently; pdf-lib refuses, and the refusal has to
      // read as an instruction rather than an API note about ignoreEncryption.
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.addPage(A4);
      doc.context.trailerInfo.Encrypt = doc.context.register(
        doc.context.obj({
          Filter: PDFName.of("Standard"),
          V: 1,
          R: 2,
          O: PDFString.of("owner"),
          U: PDFString.of("user"),
          P: -1,
        }),
      );
      const bytes = await doc.save({ useObjectStreams: false });

      await expect(getPageCount(bytes)).rejects.toThrow(/password-protected/);
      // And it names the tool that can do something about it. The old wording
      // ("nothing here can decrypt a protected document") went false the day
      // /unlock-pdf shipped.
      await expect(getPageCount(bytes)).rejects.toThrow(/\/unlock-pdf/);
    });
  });

  // ── mergePdfs ─────────────────────────────────────────────────

  const asArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  describe("mergePdfs", () => {
    it("concatenates every source in buffer order", async () => {
      const a = await buildPdf([[100, 100], [110, 110]]);
      const b = await buildPdf([[200, 200]]);
      const c = await buildPdf([[300, 300], [310, 310]]);

      const merged = await open(
        await mergePdfs([asArrayBuffer(a), asArrayBuffer(b), asArrayBuffer(c)]),
      );

      expect(merged.getPageCount()).toBe(5);
      // Distinct page sizes are the only falsifiable proof of ORDER.
      expect(merged.getPages().map((p) => Math.round(p.getWidth()))).toEqual([
        100, 110, 200, 300, 310,
      ]);
    });

    it("carries the FIRST document's title and author, not the last", async () => {
      const first = await buildPdf([A4], { title: "First Title", author: "First Author" });
      const second = await buildPdf([A4], { title: "Second Title", author: "Second Author" });

      const merged = await open(await mergePdfs([asArrayBuffer(first), asArrayBuffer(second)]));

      expect(merged.getTitle()).toBe("First Title");
      expect(merged.getAuthor()).toBe("First Author");
    });

    it("does not borrow metadata from a later file when the first has none", async () => {
      // "First document wins" has to mean the whole /Info, not a per-field
      // scavenge — a merge that reported file 3's author would be describing a
      // document that has never existed.
      const first = await buildPdf([A4]);
      const second = await buildPdf([A4], { title: "Second Title", author: "Second Author" });

      const merged = await open(await mergePdfs([asArrayBuffer(first), asArrayBuffer(second)]));

      expect(merged.getTitle()).toBeUndefined();
      expect(merged.getAuthor()).toBeUndefined();
    });

    it("invents no producer for a source that carried none", async () => {
      const merged = await open(await mergePdfs([asArrayBuffer(await buildPdf([A4]))]));
      expect(merged.getProducer()).toBeUndefined();
      expect(merged.getCreationDate()).toBeUndefined();
    });

    it("carries the remaining standard /Info entries too", async () => {
      const created = new Date(Date.UTC(2019, 4, 6, 7, 8, 9));
      const source = await buildPdf([A4], {
        title: "T",
        author: "A",
        subject: "S",
        keywords: ["alpha", "beta"],
        creator: "C",
        producer: "P",
        creationDate: created,
      });

      const merged = await open(await mergePdfs([asArrayBuffer(source)]));

      expect(merged.getSubject()).toBe("S");
      expect(merged.getKeywords()).toBe("alpha beta");
      expect(merged.getCreator()).toBe("C");
      expect(merged.getProducer()).toBe("P");
      expect(merged.getCreationDate()?.toISOString()).toBe(created.toISOString());
    });

    it("handles a single input", async () => {
      const merged = await open(await mergePdfs([asArrayBuffer(await buildPdf([A4, A4]))]));
      expect(merged.getPageCount()).toBe(2);
    });

    it("produces an empty document from an empty list, not a blank page", async () => {
      // pdf-lib's save() invents a page when a document has none; a merge of
      // nothing must not hand back a sheet the user never supplied.
      const merged = await open(await mergePdfs([]));
      expect(merged.getPageCount()).toBe(0);
    });
  });

  // ── splitPdf ──────────────────────────────────────────────────

  describe("splitPdf", () => {
    it("does not leave an orphan page object behind an annotation's /P", async () => {
      /*
        An annotation may name its page with /P. pdf-lib's copyPages deep-copies
        the annotation, follows that reference and copies the ORIGINAL page
        dictionary too — leaving a second /Type /Page object outside the page
        tree that the annotation, not the tree, holds alive. Viewers render it
        fine; preflight and PDF/A validators fail on "annotation /P does not
        reference a page in the document".
      */
      const doc = await PDFDocument.create({ updateMetadata: false });
      const page = doc.addPage([300, 300]);
      const annot = doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [10, 10, 100, 30],
        P: page.ref,
        A: { S: PDFName.of("URI"), URI: PDFString.of("https://example.com") },
      });
      page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));

      const out = await splitPdf(await doc.save(), [0]);
      const result = await open(out);

      const pageObjects = result.context
        .enumerateIndirectObjects()
        .filter(([, obj]) => obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Page"));
      expect(pageObjects).toHaveLength(1);
      expect(result.getPageCount()).toBe(1);

      // and the annotation points at the page that is actually in the tree
      const annots = result.getPage(0).node.Annots()!;
      const copied = result.context.lookup(annots.get(0), PDFDict);
      expect(copied.get(PDFName.of("P"))).toBe(result.getPage(0).ref);
    });

    it("extracts exactly the requested pages, in the requested order", async () => {
      const source = await buildPdf([
        [100, 100],
        [200, 200],
        [300, 300],
        [400, 400],
      ]);

      const out = await open(await splitPdf(source, [2, 0]));

      expect(out.getPageCount()).toBe(2);
      expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([300, 100]);
    });

    it("extracts a single page", async () => {
      const out = await open(await splitPdf(await buildPdf([A4, A4, A4]), [1]));
      expect(out.getPageCount()).toBe(1);
    });

    it("keeps the document title and author", async () => {
      const source = await buildPdf([A4, A4], { title: "Audit Title", author: "Audit Author" });
      const out = await open(await splitPdf(source, [0]));
      expect(out.getTitle()).toBe("Audit Title");
      expect(out.getAuthor()).toBe("Audit Author");
    });

    it("preserves each extracted page's rotation", async () => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.addPage(A4);
      doc.addPage(A4).node.set(PDFName.of("Rotate"), PDFNumber.of(270));
      const out = await open(await splitPdf(await doc.save(), [1]));
      expect(out.getPage(0).getRotation().angle).toBe(270);
    });

    it("extracting nothing yields nothing, not a blank page", async () => {
      const out = await open(await splitPdf(await buildPdf([A4, A4]), []));
      expect(out.getPageCount()).toBe(0);
    });
  });

  // ── splitPdfToPages ───────────────────────────────────────────

  describe("splitPdfToPages", () => {
    it("returns one single-page document per selected page, in order", async () => {
      const source = await buildPdf([
        [100, 100],
        [200, 200],
        [300, 300],
        [400, 400],
      ]);

      const outputs = await splitPdfToPages(source, [2, 0]);

      expect(outputs).toHaveLength(2);
      // Distinct page sizes are the only falsifiable proof of WHICH page went
      // into which file, and of the order.
      const widths = await Promise.all(
        outputs.map(async (bytes) => Math.round((await open(bytes)).getPage(0).getWidth())),
      );
      expect(widths).toEqual([300, 100]);
      for (const bytes of outputs) expect((await open(bytes)).getPageCount()).toBe(1);
    });

    it("skips out-of-range indices instead of throwing", async () => {
      // pdf-lib's copyPages has no bounds check at all — a stale index from a
      // UI still holding the previous file's page count reaches PDFPageLeaf as
      // undefined and comes back out as a raw TypeError.
      const outputs = await splitPdfToPages(await buildPdf([A4, A4]), [-1, 0, 5, 1.5, 1]);
      expect(outputs).toHaveLength(2);
    });

    it("returns nothing for an empty selection", async () => {
      expect(await splitPdfToPages(await buildPdf([A4, A4]), [])).toEqual([]);
    });

    it("carries the document /Info onto every output", async () => {
      const source = await buildPdf([A4, A4], { title: "Split Title", author: "Split Author" });

      const outputs = await splitPdfToPages(source, [0, 1]);

      for (const bytes of outputs) {
        const doc = await open(bytes);
        expect(doc.getTitle()).toBe("Split Title");
        expect(doc.getAuthor()).toBe("Split Author");
      }
    });

    it("keeps each page's own rotation and content", async () => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.addPage(A4).drawText("first", { x: 20, y: 20, size: 12, font });
      const second = doc.addPage(A4);
      second.drawText("second", { x: 20, y: 20, size: 12, font });
      second.node.set(PDFName.of("Rotate"), PDFNumber.of(270));

      const outputs = await splitPdfToPages(await doc.save(), [0, 1]);

      expect((await open(outputs[0])).getPage(0).getRotation().angle).toBe(0);
      expect((await open(outputs[1])).getPage(0).getRotation().angle).toBe(270);
      expect(await pageContent(outputs[1], 0)).toContain("Tj");
    });
  });

  // ── deletePdfPages ────────────────────────────────────────────

  describe("deletePdfPages", () => {
    it("keeps every page except the ones named", async () => {
      const source = await buildPdf([
        [100, 100],
        [200, 200],
        [300, 300],
        [400, 400],
      ]);

      const out = await open(await deletePdfPages(source, [1, 3]));

      expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([100, 300]);
    });

    it("derives the complement from the document, not from the caller", async () => {
      // The survivors are a fact about the file that was opened. An index the
      // document does not have is simply not in the complement — it must never
      // shift which pages get dropped.
      const source = await buildPdf([
        [100, 100],
        [200, 200],
      ]);

      const out = await open(await deletePdfPages(source, [1, 7, -3]));

      expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([100]);
    });

    it("keeps the document title and author", async () => {
      const source = await buildPdf([A4, A4, A4], { title: "Kept", author: "Author" });
      const out = await open(await deletePdfPages(source, [1]));
      expect(out.getTitle()).toBe("Kept");
      expect(out.getAuthor()).toBe("Author");
    });

    it("leaves exactly one /Type /Page object per surviving page", async () => {
      /*
        The same orphan the splitPdf test above pins: copyPages deep-copies an
        annotation, follows its /P and copies the ORIGINAL page dictionary too,
        leaving a second /Type /Page outside the page tree that preflight and
        PDF/A validators fail on. Any op built on the same graft has to run
        fixAnnotationPageRefs, so it gets its own test rather than trusting
        that the shared helper was used.
      */
      const doc = await PDFDocument.create({ updateMetadata: false });
      for (const size of [[300, 300], [310, 310], [320, 320]] as Size[]) {
        const page = doc.addPage(size);
        const annot = doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [10, 10, 100, 30],
          P: page.ref,
          A: { S: PDFName.of("URI"), URI: PDFString.of("https://example.com") },
        });
        page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(annot)]));
      }

      const result = await open(await deletePdfPages(await doc.save(), [1]));

      const pageObjects = result.context
        .enumerateIndirectObjects()
        .filter(
          ([, obj]) =>
            obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Page"),
        );
      expect(pageObjects).toHaveLength(2);
      expect(result.getPageCount()).toBe(2);
      for (let i = 0; i < 2; i++) {
        const annots = result.getPage(i).node.Annots()!;
        const copied = result.context.lookup(annots.get(0), PDFDict);
        expect(copied.get(PDFName.of("P"))).toBe(result.getPage(i).ref);
      }
    });

    /*
      A /Link's DESTINATION is a second edge from an annotation to a page, and
      pdf-lib's copier follows it: `/Dest [pageRef /Fit]` or
      `/A << /S /GoTo /D [pageRef /XYZ …] >>` — the shape Word, InDesign and
      Acrobat emit for every internal cross-reference — dragged the TARGET page,
      its /Contents stream and its /Resources into the output. Two measured
      consequences, both of which these tests pin:

      - `deletePdfPages` removed nothing. This 4-page fixture came back
        reporting 2 pages while still holding 4 /Type /Page objects and both
        dropped pages' text, at 1452 bytes against a 1437-byte source. (At 100
        pages with a ToC linking to all of them, deleting 99 returned a file the
        size of the source.) It is 997 bytes and 2 page objects now.
      - Every internal link landed on page 1, because the destination's copy of
        the page is a different object from the one in the tree and no reader
        can locate it. Asked through pdfjs, both links in a merged, reordered,
        extracted or page-deleted output resolved to page index 0 instead of 4
        and 3.

      The existing orphan tests above cannot see any of this: their annotations
      are `/S /URI` external links, the one link shape with no page edge.
    */
    async function buildCrossLinkedPdf(): Promise<Uint8Array> {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = ["Cover", "Intro", "Appendix", "SALARY TABLE"].map((label) => {
        const page = doc.addPage([300, 400]);
        page.drawText(label, { x: 40, y: 300, size: 14, font });
        return page;
      });
      const link = (on: (typeof pages)[number], extra: Record<string, unknown>) =>
        on.node.set(
          PDFName.of("Annots"),
          doc.context.obj([
            doc.context.register(
              doc.context.obj({
                Type: PDFName.of("Annot"),
                Subtype: PDFName.of("Link"),
                Rect: doc.context.obj([10, 10, 200, 40]),
                P: on.ref,
                ...extra,
              }),
            ),
          ]),
        );
      // page 1: a table-of-contents /Dest to page 4; page 2: a /GoTo to page 3
      link(pages[0], { Dest: doc.context.obj([pages[3].ref, PDFName.of("Fit")]) });
      link(pages[1], {
        A: { S: PDFName.of("GoTo"), D: doc.context.obj([pages[2].ref, PDFName.of("XYZ"), 0, 400, 0]) },
      });
      return doc.save();
    }

    /** Every /Type /Page object in a file, whether or not the page tree holds it. */
    async function pageObjectCount(bytes: Uint8Array): Promise<number> {
      const doc = await open(bytes);
      return doc.context
        .enumerateIndirectObjects()
        .filter(
          ([, obj]) =>
            obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Page"),
        ).length;
    }

    /** Every text run in every stream of a file, decompressed. */
    async function allText(bytes: Uint8Array): Promise<string> {
      const doc = await open(bytes);
      let out = "";
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        const raw = Buffer.from(obj.getContents());
        try {
          out += inflateSync(raw).toString("latin1");
        } catch {
          out += raw.toString("latin1");
        }
      }
      return out;
    }

    /** Which output page index each surviving link points at, or null. */
    async function linkTargets(bytes: Uint8Array): Promise<(number | null)[]> {
      const doc = await open(bytes);
      const refs = doc.getPages().map((p) => p.ref);
      return doc.getPages().map((page) => {
        const annots = page.node.Annots();
        if (!annots || annots.size() === 0) return null;
        const annot = doc.context.lookup(annots.get(0), PDFDict);
        const action = annot.lookup(PDFName.of("A"));
        const dest =
          annot.get(PDFName.of("Dest")) ??
          (action instanceof PDFDict ? action.get(PDFName.of("D")) : undefined);
        const array = doc.context.lookup(dest);
        if (!(array instanceof PDFArray)) return null;
        const target = array.get(0);
        const index = refs.findIndex((ref) => ref === target);
        return index === -1 ? null : index;
      });
    }

    it("removes a deleted page's content, even when a link pointed at it", async () => {
      const source = await buildCrossLinkedPdf();
      expect(await pageObjectCount(source)).toBe(4);

      const out = await deletePdfPages(source, [2, 3]);

      expect((await open(out)).getPageCount()).toBe(2);
      expect(await pageObjectCount(out)).toBe(2);
      expect(await allText(out)).not.toContain("SALARY TABLE");
      expect(await allText(out)).not.toContain("Appendix");
      expect(out.length).toBeLessThan(source.length);
    });

    it("cuts the links whose page did not survive rather than pointing them at page 1", async () => {
      const out = await deletePdfPages(await buildCrossLinkedPdf(), [2, 3]);

      const result = await open(out);
      for (let i = 0; i < 2; i++) {
        const annot = result.context.lookup(result.getPage(i).node.Annots()!.get(0), PDFDict);
        expect(annot.get(PDFName.of("Dest"))).toBeUndefined();
        expect(annot.get(PDFName.of("A"))).toBeUndefined();
        // the annotation itself stays — only its destination is gone
        expect(annot.get(PDFName.of("Rect"))).toBeDefined();
      }
    });

    it("repoints a link at the page it names when that page survived", async () => {
      // Page 1 links to page 4; deleting page 3 leaves page 4 at index 2.
      expect(await linkTargets(await deletePdfPages(await buildCrossLinkedPdf(), [2]))).toEqual([
        2,
        null,
        null,
      ]);
    });

    it("keeps a merge's internal cross-references working", async () => {
      // Nothing is dropped here, so both links must still resolve — and to the
      // pages they name, not to page 1.
      const source = await buildCrossLinkedPdf();
      const buffer = source.buffer.slice(
        source.byteOffset,
        source.byteOffset + source.byteLength,
      ) as ArrayBuffer;

      const merged = await mergePdfs([buffer]);

      expect(await linkTargets(merged)).toEqual([3, 2, null, null]);
      expect(await pageObjectCount(merged)).toBe(4);
    });

    /*
      A merge's source→output page map has to be scoped PER INPUT FILE.

      `PDFRef.tag` is "objectNumber generationNumber" and is unique only within
      ONE document, so two inputs out of the same producer routinely carry the
      same page-object tags. A single map shared across the grafts lets the
      later file's entry overwrite the earlier file's, and the earlier file's
      link is then repointed into the LATER file's pages — a wrong page rather
      than no page, which is the worse failure of the two.

      Both fixtures below are built by the same code path, so their page refs
      collide exactly. Under the shared map the first file's link resolved to
      index 7 (the second copy's page 4) instead of 3.
    */
    it("keeps each input's links inside its own file when two merged files share ref tags", async () => {
      const asBuffer = (b: Uint8Array) =>
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      const a = await buildCrossLinkedPdf();
      const b = await buildCrossLinkedPdf();

      const merged = await mergePdfs([asBuffer(a), asBuffer(b)]);

      // File A occupies indices 0-3 and file B indices 4-7. A's cover links to
      // A's page 4 (index 3); B's cover links to B's page 4 (index 7).
      expect(await linkTargets(merged)).toEqual([3, 2, null, null, 7, 6, null, null]);
    });

    it("follows the links through a reorder", async () => {
      // [3, 2, 1, 0]: the cover is now the last page and page 4 is now the
      // first, so the cover's link points at index 0.
      expect(await linkTargets(await reorderPdfPages(await buildCrossLinkedPdf(), [3, 2, 1, 0]))).toEqual([
        null,
        null,
        1,
        0,
      ]);
    });

    it("removes a deleted page reached through a form field's /Kids, not a link", async () => {
      /*
        The other edge out of a copied annotation, and the one the destination
        repair above cannot see because the offending widget is not in any
        surviving page's /Annots. A field with one widget per page — the
        ordinary shape of a signature or a page-number field repeated across a
        document — kept its widget on the DROPPED page alive through the
        surviving widget's /Parent → /Kids, and that widget's own /P then held
        the dropped page and its content stream in the file: 1 page in the
        tree, 2 page objects, the removed page's text still inflatable.

        A /P naming a page that is not in the document's page tree is already
        meaningless — no reader can resolve it — so it is dropped wherever it
        appears on an annotation-shaped dictionary.
      */
      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const pages = ["Cover", "PAYROLL"].map((label) => {
        const page = doc.addPage([300, 400]);
        page.drawText(label, { x: 40, y: 300, size: 14, font });
        return page;
      });
      const parentRef = doc.context.nextRef();
      const widget = (page: (typeof pages)[number]) =>
        doc.context.register(
          doc.context.obj({
            Type: PDFName.of("Annot"),
            Subtype: PDFName.of("Widget"),
            Rect: doc.context.obj([10, 10, 100, 30]),
            P: page.ref,
            Parent: parentRef,
          }),
        );
      const kids = pages.map(widget);
      doc.context.assign(
        parentRef,
        doc.context.obj({ FT: PDFName.of("Tx"), T: "field", Kids: doc.context.obj(kids) }),
      );
      pages.forEach((page, i) =>
        page.node.set(PDFName.of("Annots"), doc.context.obj([kids[i]])),
      );

      const out = await deletePdfPages(await doc.save(), [1]);

      expect((await open(out)).getPageCount()).toBe(1);
      expect(await pageObjectCount(out)).toBe(1);
      expect(await allText(out)).not.toContain("PAYROLL");
    });

    it("does not strip /P from a dictionary where /P is not a page", async () => {
      /*
        The narrow shape test on the sweep above, pinned. /P is a page
        reference on an annotation and the PARENT ELEMENT on a structure
        element (PDF 32000-1 14.7.2), so a blanket "delete every /P that is not
        a live page" would quietly dismantle a structure tree.

        The carrier here is contrived — nothing a page dictionary references
        reaches a /StructElem today, because /StructParents is a number and
        /StructTreeRoot is not copied — but the rule it guards is not: the
        moment this graft starts carrying more of the catalog across (it
        already drops /AcroForm, /Names and /PageLabels), a structure element
        becomes reachable and a blanket sweep would corrupt it.
      */
      const doc = await PDFDocument.create({ updateMetadata: false });
      const page = doc.addPage([300, 400]);
      const grandparent = doc.context.register(
        doc.context.obj({ Type: PDFName.of("StructElem"), S: PDFName.of("Document") }),
      );
      const element = doc.context.register(
        doc.context.obj({ Type: PDFName.of("StructElem"), S: PDFName.of("Span"), P: grandparent }),
      );
      page.node.set(
        PDFName.of("Annots"),
        doc.context.obj([
          doc.context.register(
            doc.context.obj({
              Type: PDFName.of("Annot"),
              Subtype: PDFName.of("Link"),
              Rect: doc.context.obj([10, 10, 100, 30]),
              P: page.ref,
              // any key the copier follows will drag the element across
              Struct: element,
            }),
          ),
        ]),
      );

      const out = await deletePdfPages(await doc.save(), []);

      const result = await open(out);
      const annot = result.context.lookup(result.getPage(0).node.Annots()!.get(0), PDFDict);
      const copied = result.context.lookup(annot.get(PDFName.of("Struct")), PDFDict);
      expect(copied.get(PDFName.of("Type"))).toBe(PDFName.of("StructElem"));
      expect(copied.get(PDFName.of("P"))).toBeDefined();
    });

    it("leaves a NAMED destination alone, and it never held a page alive", async () => {
      /*
        The leak is specific to EXPLICIT destination arrays. A name is a direct
        object, so pdf-lib's copier has no reference to follow and nothing is
        dragged in — this is the control that says the sweep is collecting the
        orphan because of the /Dest edge and not for some other reason. The
        graft carries no /Names table either, so the name resolves to nothing
        in the output and is left as it is rather than being invented away.
      */
      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (const label of ["Cover", "Intro", "SALARY TABLE"]) {
        const page = doc.addPage([300, 400]);
        page.drawText(label, { x: 40, y: 300, size: 14, font });
      }
      doc.getPage(0).node.set(
        PDFName.of("Annots"),
        doc.context.obj([
          doc.context.register(
            doc.context.obj({
              Type: PDFName.of("Annot"),
              Subtype: PDFName.of("Link"),
              Rect: doc.context.obj([10, 10, 200, 40]),
              Dest: PDFString.of("salary"),
            }),
          ),
        ]),
      );

      const out = await deletePdfPages(await doc.save(), [2]);

      expect(await pageObjectCount(out)).toBe(2);
      expect(await allText(out)).not.toContain("SALARY TABLE");
      const annot = (await open(out)).context.lookup(
        (await open(out)).getPage(0).node.Annots()!.get(0),
        PDFDict,
      );
      expect(annot.get(PDFName.of("Dest"))).toBeDefined();
    });

    it("deleting nothing returns the whole document", async () => {
      const out = await open(await deletePdfPages(await buildPdf([A4, A4, A4]), []));
      expect(out.getPageCount()).toBe(3);
    });

    it("deleting every page yields an empty document, not a blank page", async () => {
      // Consistent with splitPdf(data, []) — the UI is the layer that refuses
      // to let a user ask for this.
      const out = await open(await deletePdfPages(await buildPdf([A4, A4]), [0, 1]));
      expect(out.getPageCount()).toBe(0);
    });
  });

  // ── cropPdfPages ──────────────────────────────────────────────

  describe("cropPdfPages", () => {
    /*
      The visual→content rotation table, pinned. Each expected box was verified
      by rendering the cropped output through this repo's pdfjs at scale 1 and
      comparing every pixel against the same sub-rectangle of the uncropped
      rotated render: 100.00% match on all four. The 90 and 270 rows are mirror
      images and are the easy pair to swap — swapping them scores 0.00%, and
      pdfjs reports each other's `view`, which is what makes this table worth
      writing down as numbers rather than as a formula.
    */
    const RECT = { x: 37, y: 61, width: 120, height: 190 };
    const ROTATION_CASES: [number, number[]][] = [
      [0, [37, 61, 157, 251]],
      [90, [149, 37, 339, 157]],
      [180, [243, 349, 363, 539]],
      [270, [61, 443, 251, 563]],
    ];

    for (const [rotate, expected] of ROTATION_CASES) {
      it(`maps a visual crop into content space on a /Rotate ${rotate} page`, async () => {
        const source = await buildBoxedPdf({ media: [0, 0, 400, 600], rotate });

        const out = await cropPdfPages(source, RECT);

        expect(await boxOf(out, "CropBox")).toEqual(expected);
        expect(await boxOf(out, "MediaBox")).toEqual(expected);
      });
    }

    it("sets BOTH boxes, because either one alone is ignored somewhere", async () => {
      // Display is intersect(CropBox, MediaBox): a MediaBox-only crop is a
      // no-op under a smaller CropBox, and a CropBox-only crop leaves a
      // MediaBox some print paths still honour.
      const out = await cropPdfPages(await buildPdf([A4]), {
        x: 50,
        y: 50,
        width: 200,
        height: 300,
      });

      expect(await boxOf(out, "CropBox")).toEqual([50, 50, 250, 350]);
      expect(await boxOf(out, "MediaBox")).toEqual([50, 50, 250, 350]);
    });

    it("measures the crop from the visible rect, not the sheet", async () => {
      const source = await buildBoxedPdf({
        media: [0, 0, 842, 1191],
        crop: [100, 100, 742, 1091],
      });

      const out = await cropPdfPages(source, { x: 10, y: 20, width: 200, height: 300 });

      expect(await boxOf(out, "CropBox")).toEqual([110, 120, 310, 420]);
    });

    it("never scales or moves the content", async () => {
      // Content coordinates are absolute, so the box alone does the cropping;
      // a matrix here would drag the content out from under the new box.
      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.addPage(A4).drawText("keep me", { x: 60, y: 60, size: 12, font });

      const out = await cropPdfPages(await doc.save(), {
        x: 40,
        y: 40,
        width: 200,
        height: 200,
      });

      const content = await pageContent(out, 0);
      expect(content).toContain("Tj");
      expect(content).not.toContain(" cm");
    });

    it("clamps a crop larger than the page instead of inventing paper", async () => {
      const out = await cropPdfPages(await buildPdf([A4]), {
        x: -100,
        y: -100,
        width: 5000,
        height: 5000,
      });

      expect(await boxOf(out, "CropBox")).toEqual([0, 0, 595, 842]);
    });

    it("clamps an OVERHANGING CropBox to the sheet before measuring", async () => {
      /*
        The half of the intersection nothing else covers. Every other CropBox
        fixture in this file sits strictly INSIDE its MediaBox, and for a
        contained box `Math.max(media.x, crop.x)` is a no-op — so replacing the
        two `Math.max` calls with plain `crop.x` / `crop.y` left the entire
        suite green (2034 tests) while displacing this crop by 50pt and 60pt:
        [10, 10, 210, 310] became [-40, -50, 160, 250].

        A CropBox that overhangs the sheet is legal and common in producer
        output; PDF 32000-1 14.11.2 requires a reader to clip it to the
        MediaBox, and pdfjs's `Page#view` does exactly that. `visiblePageRect`
        has to agree with pdfjs, because CropPdfUI frames the user's rect
        against `page.getViewport({ scale: 1 })`, which IS pdfjs's view.
      */
      const source = await buildBoxedPdf({
        media: [0, 0, 595, 842],
        crop: [-50, -60, 700, 900],
      });

      const out = await cropPdfPages(source, { x: 10, y: 10, width: 200, height: 300 });

      expect(await boxOf(out, "CropBox")).toEqual([10, 10, 210, 310]);
      expect(await boxOf(out, "MediaBox")).toEqual([10, 10, 210, 310]);
    });

    it("survives a malformed or missing /MediaBox instead of leaking pdf-lib internals", async () => {
      /*
        `getCropBox()` was wrapped for exactly this reason and `getMediaBox()`
        was not, and pdf-lib's assertion messages interpolate its MINIFIED class
        names, so the user saw "Expected instance of PDFNumber2, but got
        instance of PDFNull2" in the error panel — on a file this repo's own
        pdfjs opens happily at 612 × 792, which is why the thumbnails and the
        size probe came up normally and only the run failed. Every shape below
        killed crop, resize AND add-page-numbers; the six non-geometry ops on
        the same bytes were fine.

        The fallback is pdfjs's own LETTER_SIZE_MEDIABOX, so the ops now agree
        with the renderer the app ships rather than refusing a file it displays.
      */
      const shapes: Record<string, (number | null | PDFName)[] | null> = {
        "[0 0 612 null]": [0, 0, 612, null],
        "three numbers": [0, 0, 612],
        "a name in the corner": [0, 0, 612, PDFName.of("Foo")],
        absent: null,
      };

      for (const [label, media] of Object.entries(shapes)) {
        const doc = await PDFDocument.create({ updateMetadata: false });
        const page = doc.addPage([400, 600]);
        if (media === null) page.node.delete(PDFName.of("MediaBox"));
        else page.node.set(PDFName.of("MediaBox"), doc.context.obj(media));
        const bytes = await doc.save();

        // The assertion is that none of these throws; the fallback rect is
        // 612 × 792, so the crop below clamps to the rect it asked for.
        const cropped = await cropPdfPages(bytes, { x: 10, y: 10, width: 100, height: 100 });
        expect(await boxOf(cropped, "CropBox"), label).toEqual([10, 10, 110, 110]);
        await expect(
          changePdfPageSize(bytes, { width: 612, height: 792, scaleContent: true }),
          label,
        ).resolves.toBeDefined();
        await expect(
          changePdfPageSize(bytes, { width: 612, height: 792, scaleContent: false }),
          label,
        ).resolves.toBeDefined();
        await expect(addPageNumbers(bytes), label).resolves.toBeDefined();
      }
    });

    it("leaves a page whose crop falls entirely outside it untouched", async () => {
      const out = await cropPdfPages(await buildPdf([A4]), {
        x: 2000,
        y: 2000,
        width: 100,
        height: 100,
      });

      expect(await boxOf(out, "MediaBox")).toEqual([0, 0, 595, 842]);
      expect(await boxOf(out, "CropBox")).toBeUndefined();
    });

    it("crops only the pages it was given", async () => {
      const source = await buildPdf([A4, A4, A4]);

      const out = await cropPdfPages(source, { x: 10, y: 10, width: 100, height: 100 }, [1]);

      expect(await boxOf(out, "CropBox", 0)).toBeUndefined();
      expect(await boxOf(out, "CropBox", 1)).toEqual([10, 10, 110, 110]);
      expect(await boxOf(out, "CropBox", 2)).toBeUndefined();
    });

    it("leaves /Rotate alone", async () => {
      // The crop is expressed in the frame the user was looking at; deriving a
      // new rotation from it would change what they saw.
      const source = await buildBoxedPdf({ media: [0, 0, 400, 600], rotate: 90 });
      const out = await open(await cropPdfPages(source, { x: 10, y: 10, width: 50, height: 60 }));
      expect(out.getPage(0).getRotation().angle).toBe(90);
    });

    it("pulls a Trim/Art box that would fall outside the crop back inside it", async () => {
      // PDF 32000-1 14.11.2 requires these to lie within the CropBox; a trim
      // box still describing the original sheet fails preflight.
      const source = await buildBoxedPdf({
        media: [0, 0, 400, 600],
        trim: [0, 0, 400, 600],
        art: [20, 20, 80, 80],
      });

      const out = await cropPdfPages(source, { x: 10, y: 10, width: 200, height: 300 });

      expect(await boxOf(out, "TrimBox")).toEqual([10, 10, 210, 310]);
      // The art box was already inside the crop, so it keeps its own meaning.
      expect(await boxOf(out, "ArtBox")).toEqual([20, 20, 80, 80]);
    });

    it("does not invent auxiliary boxes a page never had", async () => {
      const out = await cropPdfPages(await buildPdf([A4]), {
        x: 10,
        y: 10,
        width: 100,
        height: 100,
      });
      expect(await boxOf(out, "TrimBox")).toBeUndefined();
      expect(await boxOf(out, "BleedBox")).toBeUndefined();
      expect(await boxOf(out, "ArtBox")).toBeUndefined();
    });
  });

  // ── changePdfPageSize ─────────────────────────────────────────

  describe("changePdfPageSize", () => {
    it("exposes the named page sizes it is driven by", async () => {
      expect(PDF_PAGE_SIZES.a4).toEqual({ width: 595.28, height: 841.89 });
      expect(Object.keys(PDF_PAGE_SIZES)).toEqual([
        "a3",
        "a4",
        "a5",
        "letter",
        "legal",
        "tabloid",
      ]);
    });

    it("scales the content uniformly and centres it", async () => {
      const source = await buildBoxedPdf({ media: [0, 0, 400, 600], withText: true });

      const out = await changePdfPageSize(source, {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      // s = min(612/400, 792/600) = 1.32; the shorter axis is already full, so
      // only x is padded: (612 − 528)/2 = 42.
      expect(await pageContent(out, 0)).toContain("1.32 0 0 1.32 42 0 cm");
      expect(await boxOf(out, "MediaBox")).toEqual([0, 0, 612, 792]);
    });

    it("removes a non-zero box origin instead of scaling it up", async () => {
      /*
        pdf-lib's own scaleContent() emits `s 0 0 s 0 0`, which scales about
        content space's origin. On a page whose visible rect starts at (50, 80)
        that pushes the content off the sheet by 50s, 80s. The e/f terms below
        subtract the origin first and then centre what is left — verified by
        rendering through pdfjs: a marker drawn at the source page's centre
        comes out at the centre pixel of the resized page.
      */
      const source = await buildBoxedPdf({ media: [50, 80, 450, 680], withText: true });

      const out = await changePdfPageSize(source, {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      // ex = 42 − 1.32·50 = −24, ey = 0 − 1.32·80 = −105.6
      expect(await pageContent(out, 0)).toMatch(/1\.32 0 0 1\.32 -24 -105\.6\d* cm/);
    });

    it("treats the target size as VISUAL on a quarter-turned page", async () => {
      // The reader sees a /Rotate 90 page's height as its width, so asking for
      // 612 × 792 has to write a 792 × 612 media box for it to READ as 612 × 792.
      const source = await buildBoxedPdf({ media: [0, 0, 400, 600], rotate: 90 });

      const out = await changePdfPageSize(source, {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      expect(await boxOf(out, "MediaBox")).toEqual([0, 0, 792, 612]);
      expect((await open(out)).getPage(0).getRotation().angle).toBe(90);
    });

    it("rewrites a CropBox that differs from the MediaBox", async () => {
      /*
        The single biggest silent-wrong-output risk here. pdf-lib's setSize()
        propagates to the CropBox only when it float-EQUALS the MediaBox
        (PDFPage.js:112-123, via rectanglesAreEqual, comparing with ===). A
        page with a real CropBox would keep it, the reader would keep showing
        intersect(oldCrop, newMedia), and the resize would be invisible in
        exactly the files that most need it. Both boxes are written outright.
      */
      const source = await buildBoxedPdf({
        media: [0, 0, 842, 1191],
        crop: [100, 100, 742, 1091],
      });

      const out = await changePdfPageSize(source, {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      expect(await boxOf(out, "MediaBox")).toEqual([0, 0, 612, 792]);
      expect(await boxOf(out, "CropBox")).toEqual([0, 0, 612, 792]);
    });

    it("scales to fit the VISIBLE rect, not the sheet", async () => {
      const source = await buildBoxedPdf({
        media: [0, 0, 842, 1191],
        crop: [100, 100, 742, 1091],
        withText: true,
      });

      const out = await changePdfPageSize(source, {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      // s = min(612/642, 792/991) = 0.7991…, not min(612/842, 792/1191).
      const content = await pageContent(out, 0);
      const cm = content.match(/(0\.\d+) 0 0 \1 [-\d.]+ [-\d.]+ cm/);
      expect(cm).not.toBeNull();
      expect(Number(cm![1])).toBeCloseTo(Math.min(612 / 642, 792 / 991), 6);
    });

    it("moves the box only when scaleContent is false", async () => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.addPage([400, 600]).drawText("body", { x: 20, y: 20, size: 12, font });

      const out = await changePdfPageSize(await doc.save(), {
        width: 612,
        height: 792,
        scaleContent: false,
      });

      const content = await pageContent(out, 0);
      expect(content).toContain("Tj");
      expect(content).not.toContain(" cm");
      expect(await boxOf(out, "MediaBox")).toEqual([0, 0, 612, 792]);
      expect(await boxOf(out, "CropBox")).toEqual([0, 0, 612, 792]);
    });

    /*
      Box-only mode anchors the new sheet at the VISUAL bottom-left of the page
      the reader was shown — which is what the tool's own copy promises ("the
      new sheet is drawn from the bottom-left corner") and what its preview
      draws (the source rectangle is pinned `absolute bottom-0 left-0`).

      Writing the box at the content-space origin instead broke that promise
      twice, both measured through this repo's pdfjs. A page with MediaBox
      [50 70 450 670] and a mark 10pt in from its visible corner came out 60pt
      and 80pt in from the resized sheet's corner — content moved by exactly the
      media origin, on a control whose copy says the content "is not rescaled or
      moved". And WHICH visual edge a smaller sheet ate depended on /Rotate:
      shrinking the same 400 × 600 page cut the visual TOP half at /Rotate 0 and
      the visual BOTTOM half at /Rotate 180.

      The 90/270 rows are the pair that is easy to get backwards — on a
      /Rotate 90 page the visual bottom-left corner is the content RIGHT edge —
      and they were checked by rendering the output through pdfjs and asking
      which of two markers, one 10pt inside the visual bottom-left corner and
      one 10pt inside the visual top-right, survived. Every rotation kept the
      bottom-left one at visual (0, 0) and lost the top-right one.
    */
    it.each([
      // rotate, MediaBox, expected box for a visual 300 × 400 target
      [0, [0, 0, 400, 600], [0, 0, 300, 400]],
      [90, [0, 0, 400, 600], [0, 0, 400, 300]],
      [180, [0, 0, 400, 600], [100, 200, 400, 600]],
      [270, [0, 0, 400, 600], [0, 300, 400, 600]],
      [0, [50, 70, 450, 670], [50, 70, 350, 470]],
      [180, [50, 70, 450, 670], [150, 270, 450, 670]],
    ])(
      "anchors a box-only resize at the visual bottom-left (/Rotate %i, media %j)",
      async (rotate, media, expected) => {
        const out = await changePdfPageSize(
          await buildBoxedPdf({ media: media as [number, number, number, number], rotate }),
          { width: 300, height: 400, scaleContent: false },
        );

        expect(await boxOf(out, "MediaBox")).toEqual(expected);
        expect(await boxOf(out, "CropBox")).toEqual(expected);
        // and the content is still untouched — this mode never emits a matrix
        expect(await pageContent(out, 0)).not.toContain(" cm");
      },
    );

    it("anchors a box-only resize on the CROP box, not the sheet", async () => {
      // The same rule read off the rectangle a reader actually shows: this page
      // displays [100 100 742 1091], so a 300 × 400 sheet starts at (100, 100).
      const out = await changePdfPageSize(
        await buildBoxedPdf({ media: [0, 0, 842, 1191], crop: [100, 100, 742, 1091] }),
        { width: 300, height: 400, scaleContent: false },
      );

      expect(await boxOf(out, "MediaBox")).toEqual([100, 100, 400, 500]);
    });

    it("keeps the whole page inside one balanced graphics state", async () => {
      /*
        Counted, not sniffed. `content.trimEnd().endsWith("Q")` cannot see this
        property at all: pdf-lib's own drawText emits a push/pop pair
        (operations.js:11,20) and PDFPageLeaf.normalize() wraps a single
        /Contents stream in another one, so the page content already ends in Q
        whatever the resize appends. Deleting the closing popGraphicsState left
        the whole suite green while shipping `q … cm` with no matching `Q`,
        which leaves the page CTM in force for anything a later tool appends —
        chaining addPageNumbers onto such a file put the stamp at roughly
        (400, 26) instead of in the footer.

        Both halves are live: dropping pushGraphicsState makes the first
        assertion fail, dropping popGraphicsState makes the count fail.
      */
      const source = await buildBoxedPdf({ media: [0, 0, 400, 600], withText: true });
      const out = await changePdfPageSize(source, {
        width: 612,
        height: 792,
        scaleContent: true,
      });
      const content = await pageContent(out, 0);
      expect(content.trimStart().startsWith("q")).toBe(true);

      const count = (op: string) =>
        (content.match(new RegExp(`(^|[\\s])${op}([\\s]|$)`, "g")) ?? []).length;
      expect(count("q")).toBeGreaterThan(0);
      expect(count("Q")).toBe(count("q"));

      // and the LAST stream of /Contents is the closing operator itself, which
      // is the unambiguous form of the same statement
      const doc = await open(out);
      const contents = doc.context.lookup(doc.getPage(0).node.get(PDFName.of("Contents")));
      expect(contents).toBeInstanceOf(PDFArray);
      const last = (contents as PDFArray).get((contents as PDFArray).size() - 1);
      const stream = doc.context.lookup(last) as PDFRawStream;
      const raw = Buffer.from(stream.getContents());
      let text: string;
      try {
        text = inflateSync(raw).toString("latin1");
      } catch {
        text = raw.toString("latin1");
      }
      expect(text.trim()).toBe("Q");
    });

    it("clips the scaled content to the rect the source actually showed", async () => {
      /*
        A page whose CropBox is smaller than its MediaBox carries marks no
        reader ever displayed — the normal shape of a print/bleed export, of a
        scanned or imposed document, and of anything crop-pdf just produced.
        The new sheet's CropBox is the whole target and `scale = Math.min(…)`
        always leaves slack on one axis, so before the clip existed those marks
        were scaled onto the visible output: a 30 × 30 block at content
        (5, 300) on MediaBox [0 0 400 600] / CropBox [40 60 360 540], invisible
        in the source under pdfjs, was painted on the A4 output at every
        /Rotate — at 90 it landed dead centre, device [298, 179]–[335, 216].

        The clip follows the `cm`, so the rectangle is written in the SOURCE's
        own coordinates; emitting it before the cm would describe a rectangle
        in the new sheet's space and cut the content in half instead.
      */
      const source = await buildBoxedPdf({
        media: [0, 0, 400, 600],
        crop: [40, 60, 360, 540],
        withText: true,
      });

      const content = await pageContent(
        await changePdfPageSize(source, { width: 595.28, height: 841.89, scaleContent: true }),
        0,
      );

      // s = min(595.28/320, 841.89/480) = 1.7539…; ex/ey re-centre it.
      const cm = content.indexOf(" cm");
      expect(cm).toBeGreaterThan(-1);
      // `re W n` in source coordinates, AFTER the cm
      expect(content).toMatch(/40 60 320 480 re\s*W\s*n/);
      expect(content.indexOf(" re")).toBeGreaterThan(cm);
    });

    it("leaves an ordinary page's content stream unclipped in effect", async () => {
      // The clip above must be a no-op for the overwhelmingly common page whose
      // CropBox equals its MediaBox: the rectangle is the whole visible page,
      // so it is the whole scaled sheet. Rendered through poppler at 150dpi,
      // builds with and without the clip are pixel-identical at all four
      // rotations and three target sizes; the only difference is antialiasing
      // on the single boundary row when content is drawn flush to the edge.
      const source = await buildBoxedPdf({ media: [0, 0, 400, 600], withText: true });
      const content = await pageContent(
        await changePdfPageSize(source, { width: 612, height: 792, scaleContent: true }),
        0,
      );
      expect(content).toMatch(/0 0 400 600 re\s*W\s*n/);
    });

    /**
     * Build a page carrying one annotation of every geometry shape the
     * transform touches, so a key left out of the walk fails rather than
     * silently keeping its old numbers.
     */
    async function buildAnnotatedPdf(media: [number, number, number, number]) {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const page = doc.addPage([media[2] - media[0], media[3] - media[1]]);
      page.node.set(PDFName.of("MediaBox"), doc.context.obj(media));
      const annot = (extra: Record<string, unknown>) =>
        doc.context.register(
          doc.context.obj({
            Type: PDFName.of("Annot"),
            Subtype: PDFName.of("Link"),
            Rect: doc.context.obj([10, 10, 100, 30]),
            ...extra,
          }),
        );
      page.node.set(
        PDFName.of("Annots"),
        doc.context.obj([
          annot({}),
          annot({ QuadPoints: doc.context.obj([10, 30, 100, 30, 10, 10, 100, 10]) }),
          annot({ Vertices: doc.context.obj([10, 10, 100, 30]) }),
          annot({ L: doc.context.obj([10, 10, 100, 30]) }),
          annot({ InkList: doc.context.obj([doc.context.obj([10, 10, 100, 30])]) }),
          annot({ RD: doc.context.obj([1, 2, 3, 4]) }),
        ]),
      );
      return doc.save();
    }

    /** The four numbers of one key on one annotation of a produced document. */
    async function annotArray(bytes: Uint8Array, index: number, key: string) {
      const result = await open(bytes);
      const annots = result.getPage(0).node.Annots()!;
      const annot = result.context.lookup(annots.get(index), PDFDict);
      let list = result.context.lookup(annot.get(PDFName.of(key))) as PDFArray;
      if (key === "InkList") list = result.context.lookup(list.get(0)) as PDFArray;
      // Rounded: the transform is a multiply-then-add in binary floating point,
      // so 1.32 × 10 + 42 lands on 55.199999999999996 as often as on 55.2, and
      // a bit of mantissa noise is not what any of these tests are about.
      return list.asArray().map((n) => Math.round((n as PDFNumber).asNumber() * 1e6) / 1e6);
    }

    it("gives annotations the SAME affine the content gets, not just the scale", async () => {
      /*
        pdf-lib's page.scaleAnnotations(s, s) multiplies /Rect and friends by s
        about content space's ORIGIN (PDFPage.js:1393 → PDFArray.scalePDFNumbers,
        a pure multiply with no translation term), while the content stream gets
        `cm s 0 0 s ex ey`. The annotation therefore landed short by exactly
        (ex, ey) — and ex/ey are non-zero whenever the source and target aspect
        ratios differ, i.e. on a pristine zero-origin page, not only on the
        "cropped or offset" pages the code comment used to blame.

        Measured against real output, with a /Link whose /Rect exactly covered a
        drawn 200 × 40 button and the drift read back through this repo's pdfjs:
        A4 → Letter 26.00 pt, Letter → A4 35.76 pt (more than the scaled 38.9 pt
        hotspot's own height, so the link no longer overlapped what it linked),
        Letter → Legal 108.00 pt, Letter → A4 landscape 190.95 pt, Legal →
        Tabloid landscape 371.57 pt. Every one of those is 0.00 now.

        This case is the one the suite used to pin at the WRONG value: 400 × 600
        → 612 × 792 gives s = 1.32 and ex = 42, and the old expectation was the
        untranslated 1.32 × [10, 10, 100, 30].
      */
      const out = await changePdfPageSize(await buildAnnotatedPdf([0, 0, 400, 600]), {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      // s = 1.32, ex = (612 − 528)/2 = 42, ey = 0
      expect(await annotArray(out, 0, "Rect")).toEqual([55.2, 13.2, 174, 39.6]);
    });

    it("applies the affine to every coordinate list, not only /Rect", async () => {
      const out = await changePdfPageSize(await buildAnnotatedPdf([0, 0, 400, 600]), {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      // Each of these is a sequence of (x, y) POINTS, so each takes ex/ey.
      expect(await annotArray(out, 1, "QuadPoints")).toEqual([55.2, 39.6, 174, 39.6, 55.2, 13.2, 174, 13.2]);
      expect(await annotArray(out, 2, "Vertices")).toEqual([55.2, 13.2, 174, 39.6]);
      expect(await annotArray(out, 3, "L")).toEqual([55.2, 13.2, 174, 39.6]);
      expect(await annotArray(out, 4, "InkList")).toEqual([55.2, 13.2, 174, 39.6]);
    });

    it("scales /RD but does not translate it, because it is a set of margins", async () => {
      // /RD (PDF 32000-1 12.5.6.10) is four margin WIDTHS — the inset of the
      // annotation's geometry from its own /Rect — not a pair of points.
      // Adding the centring offset to an inset would move it by 42pt.
      const out = await changePdfPageSize(await buildAnnotatedPdf([0, 0, 400, 600]), {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      expect(await annotArray(out, 5, "RD")).toEqual([1.32, 2.64, 3.96, 5.28]);
    });

    it("removes the source origin from the annotation, as it does from the content", async () => {
      // MediaBox [50 80 450 680]: s = 1.32, ex = 42 − 1.32·50 = −24,
      // ey = 0 − 1.32·80 = −105.6 — the same e/f the `cm` carries.
      const out = await changePdfPageSize(await buildAnnotatedPdf([50, 80, 450, 680]), {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      const rect = await annotArray(out, 0, "Rect");
      expect(rect[0]).toBeCloseTo(1.32 * 10 - 24, 6);
      expect(rect[1]).toBeCloseTo(1.32 * 10 - 105.6, 6);
      expect(rect[2]).toBeCloseTo(1.32 * 100 - 24, 6);
      expect(rect[3]).toBeCloseTo(1.32 * 30 - 105.6, 6);
    });

    it("resizes every page of a multi-page document", async () => {
      const out = await open(
        await changePdfPageSize(await buildPdf([A4, [300, 300], [900, 400]]), {
          width: 612,
          height: 792,
          scaleContent: true,
        }),
      );

      expect(out.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
        [612, 792],
        [612, 792],
        [612, 792],
      ]);
    });

    it("resets a Trim/Art box outright, even one that would still fit", async () => {
      /*
        Cropping only narrows the visible region, so an auxiliary box that
        still fits keeps its meaning. Resizing moves and rescales everything
        and `scaleAnnotations` does not touch page boxes, so those coordinates
        would be left describing nothing — a trim box at [20 20 80 80] on a
        page that was 400 × 600 and is now 612 × 792 is production intent that
        no longer corresponds to anything on the sheet.
      */
      const source = await buildBoxedPdf({
        media: [0, 0, 400, 600],
        trim: [20, 20, 80, 80],
        withText: true,
      });

      const out = await changePdfPageSize(source, {
        width: 612,
        height: 792,
        scaleContent: true,
      });

      expect(await boxOf(out, "TrimBox")).toEqual([0, 0, 612, 792]);
      // and still not invented where the page never had one
      expect(await boxOf(out, "ArtBox")).toBeUndefined();
    });

    it("survives a page with no content stream at all", async () => {
      // wrapContentStreams reports false on such a page; there is nothing to
      // scale, and the boxes must still move.
      const out = await changePdfPageSize(await buildBoxedPdf({ media: [0, 0, 400, 600] }), {
        width: 612,
        height: 792,
        scaleContent: true,
      });
      expect(await boxOf(out, "MediaBox")).toEqual([0, 0, 612, 792]);
    });
  });

  // ── rotatePdfPages ────────────────────────────────────────────

  describe("rotatePdfPages", () => {
    it("rotates only the pages it was given", async () => {
      const out = await open(await rotatePdfPages(await buildPdf([A4, A4, A4]), [1], 90));
      expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 0]);
    });

    it("adds to the rotation the page already had", async () => {
      const out = await open(await rotatePdfPages(await buildRotatedPdf(90), [0], 90));
      expect(out.getPage(0).getRotation().angle).toBe(180);
    });

    it("wraps past 360", async () => {
      const out = await open(await rotatePdfPages(await buildRotatedPdf(270), [0], 180));
      expect(out.getPage(0).getRotation().angle).toBe(90);
    });

    it("normalises a negative result into 0-359", async () => {
      const out = await open(await rotatePdfPages(await buildPdf([A4]), [0], -90));
      expect(out.getPage(0).getRotation().angle).toBe(270);
    });

    it("resolves an INHERITED /Rotate before adding to it", async () => {
      /*
        The regression this pins: /Rotate is inheritable, so a document that
        keeps its rotation on the /Pages node reads as unrotated at the leaf.
        Adding 90 to that phantom 0 wrote 90 — the angle the page was already
        displaying — and the user got a "rotated" file that had not moved.
      */
      const out = await open(await rotatePdfPages(await buildInheritedRotatePdf(90), [0], 90));

      expect(out.getPage(0).getRotation().angle).toBe(180);
      // The untouched sibling keeps inheriting rather than being flattened.
      expect(out.getPage(1).getRotation().angle).toBe(90);
    });

    it("skips out-of-range indices instead of throwing", async () => {
      const out = await open(await rotatePdfPages(await buildPdf([A4, A4]), [-1, 0, 5], 90));
      expect(out.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0]);
    });

    it("repairs a /Rotate that is not a quarter turn rather than failing", async () => {
      // PDF 32000-1 requires a multiple of 90 and pdf-lib refuses to write
      // anything else, so a malformed 45 has to be snapped — the alternative
      // is throwing away the whole operation over one bad page.
      const out = await open(await rotatePdfPages(await buildRotatedPdf(45), [0], 90));
      expect(out.getPage(0).getRotation().angle % 90).toBe(0);
      expect(out.getPage(0).getRotation().angle).toBe(180);
    });

    it("leaves the document's own metadata alone", async () => {
      // An in-place edit must not silently restamp /Producer with pdf-lib's
      // own name, which is what loading with the default options would do.
      const created = new Date(Date.UTC(2011, 1, 2, 3, 4, 5));
      const source = await buildPdf([A4], { producer: "Original Producer", creationDate: created });

      const out = await open(await rotatePdfPages(source, [0], 90));

      expect(out.getProducer()).toBe("Original Producer");
      expect(out.getCreationDate()?.toISOString()).toBe(created.toISOString());
    });
  });

  // ── reorderPdfPages ───────────────────────────────────────────

  describe("reorderPdfPages", () => {
    it("puts the source page named at each slot into that slot", async () => {
      const source = await buildPdf([
        [100, 100],
        [200, 200],
        [300, 300],
      ]);

      const out = await open(await reorderPdfPages(source, [2, 0, 1]));

      expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([300, 100, 200]);
    });

    it("handles the identity permutation", async () => {
      const source = await buildPdf([
        [100, 100],
        [200, 200],
      ]);
      const out = await open(await reorderPdfPages(source, [0, 1]));
      expect(out.getPages().map((p) => Math.round(p.getWidth()))).toEqual([100, 200]);
    });

    it("keeps the document title and author", async () => {
      const source = await buildPdf([A4, A4], { title: "Deck", author: "Author" });
      const out = await open(await reorderPdfPages(source, [1, 0]));
      expect(out.getTitle()).toBe("Deck");
      expect(out.getAuthor()).toBe("Author");
    });
  });

  // ── addPageNumbers ────────────────────────────────────────────

  describe("addPageNumbers", () => {
    it("stamps inside a MediaBox written with reversed corners", async () => {
      /*
        PDF 32000-1 7.9.5 lets a rectangle be given with EITHER pair of
        opposite corners, so [0 792 612 0] is a legal spelling of US Letter and
        readers must normalise it. pdf-lib reports the raw numbers, which makes
        the height negative; without normalising, bottom-center landed at
        y = 792 + 20 — twenty points above the top of the page, invisible.
      */
      const doc = await PDFDocument.create({ updateMetadata: false });
      const page = doc.addPage([612, 792]);
      page.node.set(
        PDFName.of("MediaBox"),
        doc.context.obj([0, 792, 612, 0]),
      );

      const out = await addPageNumbers(await doc.save(), "bottom-center", 1);

      const content = await pageContent(out, 0);
      const td = content.match(/([\d.]+) ([\d.]+) Td/);
      expect(td).not.toBeNull();
      const [, x, y] = td!;
      // Inside the page, not above it.
      expect(Number(y)).toBeGreaterThanOrEqual(0);
      expect(Number(y)).toBeLessThan(792);
      expect(Number(x)).toBeGreaterThan(0);
      expect(Number(x)).toBeLessThan(612);
    });

    it("stamps every page and keeps the page count", async () => {
      const out = await addPageNumbers(await buildPdf([A4, A4, A4]));
      const doc = await open(out);
      expect(doc.getPageCount()).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(await pageContent(out, i)).toMatch(/Tj/);
      }
    });

    it("grows the checked-in sample, because stamping adds a font and content", async () => {
      // Mirrors the e2e assertion on the same fixture: a "numbered" file that
      // came back the same size would mean nothing was written.
      const source = new Uint8Array(
        readFileSync(resolve(process.cwd(), "src/__tests__/fixtures/samples", "sample-doc.pdf")),
      );
      const out = await addPageNumbers(source);
      expect(out.length).toBeGreaterThan(source.length);
      expect((await open(out)).getPageCount()).toBe(5);
    });

    it("numbers from 1 by default", async () => {
      const out = await addPageNumbers(await buildPdf([A4, A4]));
      // showText writes the font's encoding of the string, which for the
      // standard-14 Helvetica is a hex literal: "1" is <31>, "2" is <32>.
      expect(await pageContent(out, 0)).toContain("<31> Tj");
      expect(await pageContent(out, 1)).toContain("<32> Tj");
    });

    it("honours a custom start number", async () => {
      const out = await addPageNumbers(await buildPdf([A4, A4]), "bottom-center", 7);
      expect(await pageContent(out, 0)).toContain("<37> Tj");
      expect(await pageContent(out, 1)).toContain("<38> Tj");
    });

    it("sets the number in 10-point Helvetica", async () => {
      // faqs.ts promises "plain numerals set in 10-point Helvetica" — the
      // font size lives in the Tf operator and the face in the page's /Font.
      const out = await addPageNumbers(await buildPdf([A4]));
      expect(await pageContent(out, 0)).toContain("/PgNum 10 Tf");

      const doc = await open(out);
      const resources = doc.context.lookup(
        doc.getPage(0).node.get(PDFName.of("Resources")),
      ) as PDFDict;
      const fonts = doc.context.lookup(resources.get(PDFName.of("Font"))) as PDFDict;
      const font = doc.context.lookup(fonts.get(PDFName.of("PgNum"))) as PDFDict;
      expect((font.get(PDFName.of("BaseFont")) as PDFName).asString()).toBe("/Helvetica");
    });

    const POSITIONS: [Parameters<typeof addPageNumbers>[1], RegExp][] = [
      // 40 points in from the sides, 20 up from the bottom or 30 down from the
      // top — the constants faqs.ts quotes. The centred x is (595 − 5.56) / 2.
      ["bottom-left", /(^|\s)40 20 Td/],
      ["bottom-center", /294\.\d+ 20 Td/],
      ["bottom-right", /549\.\d+ 20 Td/],
      ["top-left", /(^|\s)40 812 Td/],
      ["top-center", /294\.\d+ 812 Td/],
      ["top-right", /549\.\d+ 812 Td/],
    ];

    for (const [position, expected] of POSITIONS) {
      it(`places the number for ${position}`, async () => {
        const out = await addPageNumbers(await buildPdf([A4]), position);
        expect(await pageContent(out, 0)).toMatch(expected);
      });
    }

    it("emits no transformation matrix on an unrotated page", async () => {
      const content = await pageContent(await addPageNumbers(await buildPdf([A4])), 0);
      // pdf-lib's own q/Q wrapper streams contain no operators at all, so the
      // absence of a cm here really is the absence of a compensation matrix.
      expect(content).not.toContain(" cm");
    });

    /*
      The counter-rotation contract. MuPDF handed back the visual rectangle;
      pdf-lib reports the unrotated media box, so the engine derives the visual
      frame itself and then inverts the display rotation to get back into the
      page's own content space. Without the matrix a number on a /Rotate 90 A4
      page was centred on 842 inside a 595-wide box and drawn sideways off the
      edge. Each case pins both halves: the matrix, and the placement that only
      makes sense inside it.
    */
    it("counter-rotates the stamp on a /Rotate 90 page", async () => {
      const content = await pageContent(await addPageNumbers(await buildRotatedPdf(90)), 0);
      expect(content).toContain("0 1 -1 0 595 0 cm");
      expect(content).toMatch(/418\.\d+ 20 Td/);
    });

    it("counter-rotates the stamp on a /Rotate 180 page", async () => {
      const content = await pageContent(await addPageNumbers(await buildRotatedPdf(180)), 0);
      expect(content).toContain("-1 0 0 -1 595 842 cm");
      expect(content).toMatch(/294\.\d+ 20 Td/);
    });

    it("counter-rotates the stamp on a /Rotate 270 page", async () => {
      const content = await pageContent(await addPageNumbers(await buildRotatedPdf(270)), 0);
      expect(content).toContain("0 -1 1 0 0 842 cm");
      expect(content).toMatch(/418\.\d+ 20 Td/);
    });

    it("counter-rotates against an INHERITED /Rotate", async () => {
      const content = await pageContent(
        await addPageNumbers(await buildInheritedRotatePdf(90, 1)),
        0,
      );
      expect(content).toContain("0 1 -1 0 595 0 cm");
    });

    it("keeps the whole stamp inside its own graphics state", async () => {
      // An unbalanced q/Q would leak the compensation matrix into anything the
      // page drew after it.
      const content = await pageContent(await addPageNumbers(await buildRotatedPdf(90)), 0);
      const stamp = content.slice(content.indexOf("0 1 -1 0 595 0 cm"));
      expect(stamp.trim().endsWith("Q")).toBe(true);
    });

    /*
      The CropBox contract. What a reader displays is intersect(CropBox,
      MediaBox) — pdfjs computes exactly that for its `view` — so a page whose
      producer parked a margin in the CropBox has a MediaBox that is real in
      the file and invisible on screen. The pdf-lib port placed the stamp in
      the MediaBox and every one of the six positions therefore missed on such
      a file. Measured before the fix on MediaBox [0 0 842 1191] + CropBox
      [100 100 742 1091]: bottom-center emitted `418.22 20 Td`, which the
      repo's own pdfjs renders at canvas y = 1071 on a 991px-tall canvas — 80
      points below the visible page. MuPDF's getBounds() returned the CROP box,
      so this was a regression, not a decision.

      Both cases below are falsifiable in BOTH coordinates: the crop rects are
      deliberately off-centre, so a MediaBox-based placement cannot pass by
      symmetry.
    */
    it("stamps inside the CropBox, not the MediaBox", async () => {
      const source = await buildBoxedPdf({
        media: [0, 0, 842, 1191],
        crop: [120, 100, 700, 900],
      });

      const content = await pageContent(await addPageNumbers(source, "bottom-center"), 0);

      // Visible rect is 580 × 800 at (120, 100): x = 120 + (580 − 5.56)/2,
      // y = 100 + 20. Placing in the media box would give 418.22 and 20.
      expect(content).toMatch(/407\.\d+ 120 Td/);
    });

    it("carries the CropBox into the counter-rotation matrix", async () => {
      const source = await buildBoxedPdf({
        media: [0, 0, 842, 1191],
        crop: [100, 100, 742, 1091],
        rotate: 90,
      });

      const content = await pageContent(await addPageNumbers(source, "bottom-center"), 0);

      // The matrix has to carry the crop's width and origin, not the sheet's:
      // 100 + 642 = 742, and the y translation is the crop's own 100.
      expect(content).toContain("0 1 -1 0 742 100 cm");
      // Inside that frame the visual width is the crop's HEIGHT (991), so the
      // centred x is (991 − 5.56)/2. The media box would give (1191 − 5.56)/2.
      expect(content).toMatch(/492\.\d+ 20 Td/);
    });

    it("ignores a /CropBox that is not a rectangle rather than failing", async () => {
      // pdf-lib's asRectangle() THROWS on an array whose length is not 4,
      // where pdfjs just warns and falls back to the MediaBox. A malformed
      // decorative box must cost a slightly-off stamp, not the operation.
      const source = await buildBoxedPdf({ media: [0, 0, 595, 842], crop: [0, 0, 595] });

      const content = await pageContent(await addPageNumbers(source, "bottom-center"), 0);

      expect(content).toMatch(/294\.\d+ 20 Td/);
    });

    it("stamps inside the sheet when the CropBox overhangs it", async () => {
      // The same clamp, seen from the stamp: the visible rect is the sheet
      // itself, so the number is centred on 595 and sits 20pt up from y = 0.
      // Without the clamp the visible rect starts at (-50, -60) and the stamp
      // lands at y = -40 — 40pt BELOW the sheet, invisible in every reader.
      const source = await buildBoxedPdf({
        media: [0, 0, 595, 842],
        crop: [-50, -60, 700, 900],
      });

      const content = await pageContent(await addPageNumbers(source, "bottom-center"), 0);

      expect(content).toMatch(/294\.\d+ 20 Td/);
    });

    it("falls back to the MediaBox when the CropBox does not overlap it", async () => {
      // A disjoint CropBox is malformed; an empty visible rect would make the
      // centring maths divide into nothing.
      const source = await buildBoxedPdf({
        media: [0, 0, 595, 842],
        crop: [2000, 2000, 2500, 2500],
      });

      const content = await pageContent(await addPageNumbers(source, "bottom-center"), 0);

      expect(content).toMatch(/294\.\d+ 20 Td/);
    });

    it("does not shadow a page's inherited /Resources", async () => {
      /*
        /Resources is inheritable too. Attaching a fresh dictionary to a page
        that was inheriting its fonts and XObjects hides every one of them and
        renders the page blank. pdf-lib's normalize() resolves the inherited
        dictionary onto the page before adding to it — this is the test that
        says so out loud, because the hand-rolled code that used to do it here
        was deleted rather than ported.
      */
      const doc = await PDFDocument.create({ updateMetadata: false });
      const courier = await doc.embedFont(StandardFonts.Courier);
      doc.addPage(A4).drawText("original text", { x: 10, y: 10, size: 8, font: courier });
      const hoistable = await open(await doc.save());
      const leaf = hoistable.getPage(0).node;
      const resources = leaf.get(PDFName.of("Resources"))!;
      const pagesDict = hoistable.context.lookup(
        hoistable.catalog.get(PDFName.of("Pages")),
      ) as PDFDict;
      pagesDict.set(PDFName.of("Resources"), resources);
      leaf.delete(PDFName.of("Resources"));

      const out = await addPageNumbers(await hoistable.save());

      const result = await open(out);
      const pageResources = result.context.lookup(
        result.getPage(0).node.get(PDFName.of("Resources")),
      ) as PDFDict;
      const fonts = result.context.lookup(pageResources.get(PDFName.of("Font"))) as PDFDict;
      const keys = fonts.keys().map((k) => k.asString());
      expect(keys).toContain("/PgNum");
      expect(keys.some((k) => k.startsWith("/Courier"))).toBe(true);
      // And the page's original drawing survives alongside the stamp.
      expect(await pageContent(out, 0)).toContain("Tj");
    });
  });

  // ── imagesToPdf ───────────────────────────────────────────────

  describe("imagesToPdf", () => {
    it("makes one page per image", async () => {
      const doc = await open(
        await imagesToPdf([
          { bytes: PNG_2X2, type: "image/png" },
          { bytes: SAMPLE_JPEG, type: "image/jpeg" },
          { bytes: PNG_2X2, type: "image/png" },
        ]),
      );
      expect(doc.getPageCount()).toBe(3);
    });

    it("defaults to A4 (595.28 × 841.89)", async () => {
      const doc = await open(await imagesToPdf([{ bytes: PNG_2X2, type: "image/png" }]));
      const page = doc.getPage(0);
      expect(page.getWidth()).toBeCloseTo(595.28, 2);
      expect(page.getHeight()).toBeCloseTo(841.89, 2);
    });

    it("uses US Letter (612 × 792) when asked", async () => {
      const doc = await open(
        await imagesToPdf([{ bytes: PNG_2X2, type: "image/png" }], "letter"),
      );
      expect(doc.getPage(0).getWidth()).toBe(612);
      expect(doc.getPage(0).getHeight()).toBe(792);
    });

    it("uses the image's own pixel dimensions for 'fit'", async () => {
      const doc = await open(
        await imagesToPdf([{ bytes: SAMPLE_JPEG, type: "image/jpeg" }], "fit"),
      );
      expect(doc.getPage(0).getWidth()).toBe(800);
      expect(doc.getPage(0).getHeight()).toBe(600);
    });

    it("treats any non-PNG type as JPEG bytes", async () => {
      // images-to-pdf-prep.ts hands the engine exactly two byte formats and
      // relies on this fallthrough for the second one; a type it has never
      // heard of must still reach embedJpg rather than embedPng.
      const doc = await open(
        await imagesToPdf([{ bytes: SAMPLE_JPEG, type: "image/tiff" }], "fit"),
      );
      expect(doc.getPage(0).getWidth()).toBe(800);
    });

    /*
      THE SHIPPED BUG THESE PIN. `embedJpg` embeds the original bytes and takes
      its dimensions from the STORED sample grid; a PDF reader never reads EXIF
      inside a /DCTDecode stream, but every image viewer does. So a photo
      carrying Orientation 6 is 800x600 in the file and 600x800 on screen, and
      building the page from the stored grid produced a landscape page with the
      photo on its side, stretched to the wrong aspect ratio — on all six
      images-to-pdf tools, with the thumbnail strip (a plain <img>, which
      honours EXIF) showing it the right way up the whole time.

      `sample-photo-portrait.jpg` and `sample-photo.jpg` are the same 800x600
      picture and differ in EXACTLY ONE BYTE, the Orientation tag, which makes
      them a matched pair: anything that differs between the two outputs is
      attributable to orientation and nothing else.
    */
    it("builds a portrait page for a portrait photo stored landscape", async () => {
      const doc = await open(
        await imagesToPdf([{ bytes: SAMPLE_JPEG_ROTATED, type: "image/jpeg" }], "fit"),
      );
      // 800x600 stored, Orientation 6 -> 600x800 as every viewer shows it.
      expect(doc.getPage(0).getWidth()).toBe(600);
      expect(doc.getPage(0).getHeight()).toBe(800);
    });

    it("leaves an upright photo byte-identical — the fix touches only rotated ones", async () => {
      /*
        The other half of the pair, and the one that matters for regression:
        the overwhelming majority of images carry Orientation 1, and their
        output must not move by a single byte.
      */
      const before = await imagesToPdf([{ bytes: SAMPLE_JPEG, type: "image/jpeg" }], "a4");
      const doc = await open(before);
      expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 2);
      expect(await pageContent(before, 0)).toContain("515.28 0 0 386.46 0 0 cm");
    });

    it("fits a rotated photo to the printable area by its DISPLAYED shape", async () => {
      /*
        On a fixed page size the page cannot change, so the assertion is on
        where the image lands. The content stream composes
        `T(40, 764.465) · R90 · S(687.04, 515.28)`, and pushing the unit square
        through that puts the drawn picture at x in [40, 555.28] and y in
        [77.425, 764.465] — 515.28 x 687.04, which is 600x800 scaled by
        515.28/600 and centred on A4 with the 40pt margin. Landscape placement
        (the bug) would have been 515.28 x 386.46, the same numbers as the
        upright control above.
      */
      const bytes = await imagesToPdf(
        [{ bytes: SAMPLE_JPEG_ROTATED, type: "image/jpeg" }],
        "a4",
      );
      const stream = await pageContent(bytes, 0);

      expect(stream).toContain("687.04 0 0 515.28 0 0 cm");
      // and it really is rotated: a quarter-turn matrix, not the identity
      expect(stream).toMatch(/-?[\d.e-]+ -1 1 -?[\d.e-]+ 0 0 cm/);
      // the landscape placement the bug produced must be gone
      expect(stream).not.toContain("515.28 0 0 386.46 0 0 cm");
    });

    it("reads a PNG's eXIf orientation, not just a JPEG's", async () => {
      /*
        pdf-lib's PNG path takes width and height from the IHDR via UPNG and
        never looks at `eXIf`, while Chrome DOES apply it — measured, a 40x20
        PNG with eXIf Orientation 6 decodes to 20x40. png-to-pdf therefore had
        the identical bug, and this repo can produce such a file itself:
        change-image-dpi writes an eXIf chunk.
      */
      const rotated = pngWithExifOrientation(PNG_4X2, 6);
      const doc = await open(await imagesToPdf([{ bytes: rotated, type: "image/png" }], "fit"));
      expect(doc.getPage(0).getWidth()).toBe(2);
      expect(doc.getPage(0).getHeight()).toBe(4);

      // control: the same PNG with no eXIf chunk keeps its stored shape
      const plain = await open(await imagesToPdf([{ bytes: PNG_4X2, type: "image/png" }], "fit"));
      expect(plain.getPage(0).getWidth()).toBe(4);
      expect(plain.getPage(0).getHeight()).toBe(2);
    });
  });

  // ── compressPdf ───────────────────────────────────────────────

  /**
   * Register `count` unreferenced streams that nothing in the document points
   * at. The fill is deliberately noisy: a run of identical bytes deflates to
   * almost nothing, which would make the orphans free and the size assertion
   * below meaningless.
   */
  function addOrphans(doc: PDFDocument, count: number, size = 20_000) {
    for (let i = 0; i < count; i++) {
      const junk = new Uint8Array(size).map((_, j) => (j * 2654435761 + i * 40503) % 251);
      doc.context.register(doc.context.flateStream(junk));
    }
  }

  describe("compressPdf", () => {
    it("drops objects nothing references any more", async () => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (let i = 0; i < 3; i++) {
        doc.addPage([300, 300]).drawText(`page ${i}`, { x: 20, y: 20, size: 12, font });
      }
      addOrphans(doc, 6);
      const source = await doc.save();

      const out = await compressPdf(source);

      expect(out.length).toBeLessThan(source.length / 2);
      expect((await open(out)).getPageCount()).toBe(3);
    });

    /*
      Rebuild a document the way a producer that never compresses anything
      emits one: every /FlateDecode stream inflated back out and its filter
      dropped. This is the case pdf-lib alone cannot help with — it writes a
      stream it did not create back exactly as it found it — and the reason
      compressPdf runs its own deflate pass.
    */
    async function withUncompressedStreams(bytes: Uint8Array): Promise<Uint8Array> {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        if (obj.dict.get(PDFName.of("Filter")) !== PDFName.of("FlateDecode")) continue;
        const raw = new Uint8Array(inflateSync(Buffer.from(obj.contents)));
        obj.dict.delete(PDFName.of("Filter"));
        obj.dict.set(PDFName.of("Length"), doc.context.obj(raw.length));
        doc.context.assign(ref, PDFRawStream.of(obj.dict, raw));
      }
      return doc.save({ useObjectStreams: false });
    }

    it("deflates the streams that arrived with no filter", async () => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (let page = 0; page < 4; page++) {
        const p = doc.addPage([595, 842]);
        p.drawText(`marker ${page}`, { x: 60, y: 700, size: 18, font });
        for (let i = 0; i < 600; i++) {
          p.drawLine({
            start: { x: (i * 7) % 560, y: (i * 13) % 600 },
            end: { x: ((i * 7) % 560) + 18, y: ((i * 13) % 600) + 12 },
            thickness: 0.4,
          });
        }
      }
      const source = await withUncompressedStreams(await doc.save({ useObjectStreams: false }));

      const out = await compressPdf(source);

      // A plain re-save leaves these streams alone and saves almost nothing;
      // the deflate pass is what makes this a real reduction.
      expect(out.length).toBeLessThan(source.length / 2);
      const result = await open(out);
      expect(result.getPageCount()).toBe(4);
      // and the deflated bytes are still readable content, not just smaller
      expect(await pageContent(out, 3)).toContain("Tj");
    });

    it("leaves a stream carrying stale /DecodeParms alone", async () => {
      /*
        /DecodeParms with no /Filter is inert — nothing to parameterise — so
        readers ignore it. Writing /FlateDecode beside it would bring it back to
        life and apply a PNG predictor to bytes that were never predictor-coded.
        Verified against pdfjs before this guard existed: the image failed to
        decode ("Unsupported predictor") and was dropped from the page, under a
        tool that promises the pixels come out byte for byte identical.
      */
      const doc = await PDFDocument.create({ updateMetadata: false });
      const page = doc.addPage([200, 200]);
      const raw = new Uint8Array(5000).fill(0x41);
      const dict = doc.context.obj({
        Type: "XObject",
        Subtype: "Image",
        Width: 5,
        Height: 40,
        ColorSpace: "DeviceGray",
        BitsPerComponent: 8,
        DecodeParms: { Predictor: 12, Columns: 5, Colors: 1, BitsPerComponent: 8 },
      });
      const ref = doc.context.register(PDFRawStream.of(dict, raw));
      page.node.setXObject(PDFName.of("Im0"), ref);

      const out = await compressPdf(await doc.save());

      const result = await open(out);
      const xobjects = result
        .getPage(0)
        .node.Resources()
        ?.lookup(PDFName.of("XObject"), PDFDict);
      const image = result.context.lookup(
        xobjects?.get(PDFName.of("Im0")),
      ) as PDFRawStream;
      expect(image.dict.get(PDFName.of("Filter"))).toBeUndefined();
      expect(Array.from(image.contents)).toEqual(Array.from(raw));
    });

    it("leaves a stream that already declares a filter alone", async () => {
      // Re-deflating compressed bytes costs time to gain nothing, and a
      // filter we do not understand must not be reinterpreted at all.
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.addPage([200, 200]);
      const jpegish = new Uint8Array(4096).map((_, i) => (i * 2654435761) % 251);
      const dict = doc.context.obj({ Type: "XObject", Subtype: "Image", Filter: "DCTDecode" });
      const ref = doc.context.register(PDFRawStream.of(dict, jpegish));
      doc.catalog.set(PDFName.of("TestImage"), ref);

      const out = await compressPdf(await doc.save());

      const result = await open(out);
      const kept = result.context.lookup(result.catalog.get(PDFName.of("TestImage")));
      expect(kept).toBeInstanceOf(PDFRawStream);
      expect((kept as PDFRawStream).dict.get(PDFName.of("Filter"))).toBe(PDFName.of("DCTDecode"));
      expect(Array.from((kept as PDFRawStream).contents)).toEqual(Array.from(jpegish));
    });

    it("does not grow a document that is already packed this way", async () => {
      // The tool's promise is "smaller or unchanged"; a compressor that
      // reliably added bytes would be the opposite of what it says it is.
      // CompressPdfUI ships the original when the rewrite does not pay, and
      // this keeps the engine's own output from making that the normal case.
      const source = new Uint8Array(
        readFileSync(resolve(process.cwd(), "src/__tests__/fixtures/samples", "sample-doc.pdf")),
      );
      const out = await compressPdf(source);
      expect(out.length).toBeLessThanOrEqual(source.length);
      expect((await open(out)).getPageCount()).toBe((await open(source)).getPageCount());
    });

    it("keeps interactive form fields and their values", async () => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const page = doc.addPage([400, 400]);
      const form = doc.getForm();
      const text = form.createTextField("contact.name");
      text.setText("Ada Lovelace");
      text.addToPage(page, { x: 20, y: 300, width: 200, height: 20 });
      const check = form.createCheckBox("contact.subscribed");
      check.check();
      check.addToPage(page, { x: 20, y: 260, width: 15, height: 15 });
      addOrphans(doc, 2);

      const out = await compressPdf(await doc.save());

      const result = await open(out);
      const resultForm = result.getForm();
      expect(resultForm.getFields().map((f) => f.getName()).sort()).toEqual([
        "contact.name",
        "contact.subscribed",
      ]);
      expect(resultForm.getTextField("contact.name").getText()).toBe("Ada Lovelace");
      expect(resultForm.getCheckBox("contact.subscribed").isChecked()).toBe(true);
    });

    it("keeps the outline tree, page labels and named destinations", async () => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.addPage([400, 400]);
      const target = doc.addPage([400, 400]);
      const ctx = doc.context;

      const outlinesRef = PDFRef.of(ctx.largestObjectNumber + 1);
      const itemRef = PDFRef.of(ctx.largestObjectNumber + 2);
      ctx.assign(
        itemRef,
        ctx.obj({
          Title: PDFString.of("Chapter One"),
          Parent: outlinesRef,
          Dest: ctx.obj([target.ref, PDFName.of("Fit")]),
        }),
      );
      ctx.assign(
        outlinesRef,
        ctx.obj({ Type: PDFName.of("Outlines"), First: itemRef, Last: itemRef, Count: 1 }),
      );
      doc.catalog.set(PDFName.of("Outlines"), outlinesRef);

      const destRef = ctx.register(ctx.obj({ D: ctx.obj([target.ref, PDFName.of("Fit")]) }));
      doc.catalog.set(
        PDFName.of("Names"),
        ctx.register(
          ctx.obj({ Dests: ctx.obj({ Names: ctx.obj([PDFString.of("intro"), destRef]) }) }),
        ),
      );
      doc.catalog.set(
        PDFName.of("PageLabels"),
        ctx.obj({ Nums: ctx.obj([0, ctx.obj({ S: PDFName.of("r") })]) }),
      );
      addOrphans(doc, 3);

      const result = await open(await compressPdf(await doc.save()));
      const ctx2 = result.context;

      const outlines = ctx2.lookup(result.catalog.get(PDFName.of("Outlines"))) as PDFDict;
      const first = ctx2.lookup(outlines.get(PDFName.of("First"))) as PDFDict;
      expect((first.get(PDFName.of("Title")) as PDFString).decodeText()).toBe("Chapter One");

      const names = ctx2.lookup(result.catalog.get(PDFName.of("Names"))) as PDFDict;
      const dests = ctx2.lookup(names.get(PDFName.of("Dests"))) as PDFDict;
      const list = ctx2.lookup(dests.get(PDFName.of("Names"))) as PDFArray;
      expect((list.get(0) as PDFString).decodeText()).toBe("intro");

      expect(result.catalog.get(PDFName.of("PageLabels"))).toBeDefined();
    });

    it("keeps page annotations", async () => {
      const doc = await PDFDocument.create({ updateMetadata: false });
      const page = doc.addPage([400, 400]);
      const ctx = doc.context;
      page.node.set(
        PDFName.of("Annots"),
        ctx.obj([
          ctx.register(
            ctx.obj({
              Type: PDFName.of("Annot"),
              Subtype: PDFName.of("Link"),
              Rect: ctx.obj([10, 10, 100, 30]),
              A: ctx.obj({
                Type: PDFName.of("Action"),
                S: PDFName.of("URI"),
                URI: PDFString.of("https://transmute.tools"),
              }),
            }),
          ),
        ]),
      );
      addOrphans(doc, 2);

      const result = await open(await compressPdf(await doc.save()));
      const annots = result.context.lookup(
        result.getPage(0).node.get(PDFName.of("Annots")),
      ) as PDFArray;
      expect(annots.size()).toBe(1);
      const annot = result.context.lookup(annots.get(0)) as PDFDict;
      const action = result.context.lookup(annot.get(PDFName.of("A"))) as PDFDict;
      expect((action.get(PDFName.of("URI")) as PDFString).decodeText()).toBe(
        "https://transmute.tools",
      );
    });

    it("keeps the document's own metadata", async () => {
      // tools.ts promises compression carries title and author through
      // unchanged; the sweep must not treat /Info as unreachable, and the load
      // must not restamp it.
      const created = new Date(Date.UTC(2020, 2, 3, 4, 5, 6));
      const source = await buildPdf([A4, A4], {
        title: "Kept Title",
        author: "Kept Author",
        producer: "Kept Producer",
        creationDate: created,
      });

      const result = await open(await compressPdf(source));

      expect(result.getTitle()).toBe("Kept Title");
      expect(result.getAuthor()).toBe("Kept Author");
      expect(result.getProducer()).toBe("Kept Producer");
      expect(result.getCreationDate()?.toISOString()).toBe(created.toISOString());
    });

    it("accepts ArrayBuffer input", async () => {
      const bytes = await buildPdf([A4]);
      const out = await compressPdf(asArrayBuffer(bytes));
      expect(out).toBeInstanceOf(Uint8Array);
      expect((await open(out)).getPageCount()).toBe(1);
    });

    it("does not grow a document whose raw streams deflate by less than the filter entry costs", async () => {
      /*
        THE REGRESSION. The deflate pass used to guard with
        `packed.length >= obj.contents.length`, comparing stream PAYLOADS while
        ignoring the `/Filter /FlateDecode` it writes into the dictionary two
        lines later — 21 serialised bytes per stream, by PDFDict's own
        accounting. A document made of many SHORT raw streams therefore came
        out bigger: measured at 11,032 -> 11,192 bytes, a 1.45% loss, on a
        compressor.

        TWO THINGS ABOUT THIS FIXTURE ARE LOAD-BEARING, and the test was
        worthless without either of them — both found by mutation-testing it
        against the reverted guard and watching it stay green.

        (1) THE STREAMS MUST LAND IN THE BUG'S WINDOW. The bug only bites where
        deflate saves MORE than nothing and LESS than the twenty-one bytes the
        filter entry costs. Repeated text is the wrong fixture: sixty pages of
        `Page 1`, `Page 2` … deflate by 71+ bytes each, so the guard pays for
        itself and reverting it changes nothing. Very short streams are wrong
        too — 84 raw bytes of `p0` deflate to 86, so even the old guard
        declined. Measured across a sweep of shapes, one line of ~16-32
        HIGH-ENTROPY characters is the window: raw 111-143 bytes, deflated
        108-125, saving 3-18. The generator below is a fixed LCG, not random,
        so the fixture is identical on every run.

        (2) THE SOURCE MUST ALREADY BE OBJECT-STREAM PACKED. Built through
        `withUncompressedStreams` (which saves with `useObjectStreams: false`)
        the re-save's object-stream rewrite shrinks the file by far more than
        the deflate pass loses, so the output is smaller either way. Packing the
        source first removes that subsidy and leaves the deflate pass as the
        only lever, so a pass that loses money shows up directly as growth.
      */
      const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      const noise = (seed: number): string => {
        let out = "";
        let x = seed;
        for (let i = 0; i < 24; i++) {
          x = (x * 1103515245 + 12345) & 0x7fffffff;
          out += alphabet[x % alphabet.length];
        }
        return out;
      };

      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (let page = 0; page < 60; page++) {
        doc.addPage([300, 200]).drawText(noise(page * 7 + 13), { x: 20, y: 150, size: 8, font });
      }

      const packed = await PDFDocument.load(await doc.save({ useObjectStreams: true }), {
        updateMetadata: false,
      });
      let stripped = 0;
      for (const [ref, obj] of packed.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        if (obj.dict.get(PDFName.of("Filter")) !== PDFName.of("FlateDecode")) continue;
        const raw = new Uint8Array(inflateSync(Buffer.from(obj.contents)));
        obj.dict.delete(PDFName.of("Filter"));
        obj.dict.set(PDFName.of("Length"), packed.context.obj(raw.length));
        packed.context.assign(ref, PDFRawStream.of(obj.dict, raw));
        stripped++;
      }
      expect(stripped).toBeGreaterThan(50); // the fixture really is all-raw
      const source = await packed.save({ useObjectStreams: true });

      const out = await compressPdf(source);

      expect(out.length).toBeLessThanOrEqual(source.length);
      expect((await open(out)).getPageCount()).toBe(60);
    });

    it("re-deflates a stream whose producer compressed it loosely", async () => {
      /*
        The lever that actually pays. Producers differ enormously in how hard
        they compress; a stream that arrived already carrying /FlateDecode is
        left alone by pdf-lib and by the pass above, which only touches streams
        with NO filter at all.

        `deflateSync(..., { level: 1 })` stands in for such a producer: valid
        /FlateDecode that a stronger deflate beats comfortably.

        ⚠ THE SOURCE IS SAVED WITH OBJECT STREAMS ON BOTH SIDES, and that is
        what makes the assertion mean anything. Saved without them, the
        re-save's object-stream rewrite shrinks the file on its own and
        `out.length < source.length` holds whether or not the re-deflate pass
        runs at all — proven by mutation: deleting the pass left this test
        green. With the source already packed, the loosely-compressed streams
        are the only remaining lever, so deleting the pass turns it red.
      */
      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([595, 842]);
      for (let i = 0; i < 400; i++) {
        page.drawText(`the quick brown fox jumps over the lazy dog ${i}`, {
          x: 20,
          y: 820 - (i % 80) * 10,
          size: 6,
          font,
        });
      }

      const loaded = await PDFDocument.load(await doc.save({ useObjectStreams: true }), {
        updateMetadata: false,
      });
      let loosened = 0;
      for (const [ref, obj] of loaded.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        if (obj.dict.get(PDFName.of("Filter")) !== PDFName.of("FlateDecode")) continue;
        const raw = new Uint8Array(inflateSync(Buffer.from(obj.contents)));
        if (raw.length < 2000) continue;
        const weak = new Uint8Array(deflateSync(Buffer.from(raw), { level: 1 }));
        obj.dict.set(PDFName.of("Length"), loaded.context.obj(weak.length));
        loaded.context.assign(ref, PDFRawStream.of(obj.dict, weak));
        loosened++;
      }
      expect(loosened).toBeGreaterThan(0); // the fixture really is loosely compressed
      const source = await loaded.save({ useObjectStreams: true });

      const out = await compressPdf(source);

      expect(out.length).toBeLessThan(source.length);
      // and it is still the same document, not merely a smaller one
      const result = await open(out);
      expect(result.getPageCount()).toBe(1);
      expect(await pageContent(out, 0)).toContain("Tj");
    });

    it("re-deflation decodes back to the identical bytes", async () => {
      /*
        The losslessness claim, asserted at the level the claim is made at.
        Every stream that survives compression must DECODE to exactly the bytes
        it decoded to before — which is the whole justification for leaving
        /DecodeParms in place here while the raw-stream pass refuses to touch
        it. Comparing the compressed bytes would prove nothing; they are
        supposed to differ.
      */
      async function decodedStreams(bytes: Uint8Array): Promise<string[]> {
        const d = await PDFDocument.load(bytes, { updateMetadata: false });
        const out: string[] = [];
        for (const [, obj] of d.context.enumerateIndirectObjects()) {
          if (!(obj instanceof PDFRawStream)) continue;
          const filter = obj.dict.get(PDFName.of("Filter"));
          if (filter !== undefined && filter !== PDFName.of("FlateDecode")) continue;
          const payload =
            filter === undefined
              ? Buffer.from(obj.contents)
              : Buffer.from(inflateSync(Buffer.from(obj.contents)));
          out.push(payload.toString("base64"));
        }
        return out.sort();
      }

      const doc = await PDFDocument.create({ updateMetadata: false });
      const font = await doc.embedFont(StandardFonts.Helvetica);
      for (let page = 0; page < 3; page++) {
        const p = doc.addPage([595, 842]);
        for (let i = 0; i < 300; i++) {
          p.drawText(`row ${page}-${i} lorem ipsum dolor sit amet`, {
            x: 20,
            y: 820 - (i % 80) * 10,
            size: 6,
            font,
          });
        }
      }
      const source = await doc.save({ useObjectStreams: false });

      const before = await decodedStreams(source);
      const after = await decodedStreams(await compressPdf(source));

      expect(before.length).toBeGreaterThan(0); // not vacuous
      for (const stream of before) expect(after).toContain(stream);
    });
  });

  // ── pdfToImages ───────────────────────────────────────────────

  const fakePdfData = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4

  /**
   * pdfjs's own exception shape: `BaseException extends Error` with the class
   * name assigned to `.name`, so it IS `instanceof Error` and only `.name`
   * distinguishes it. Matches pdfjs-dist 5.6.205.
   */
  function pdfjsException(name: string, message: string): Error {
    const err = new Error(message);
    err.name = name;
    return err;
  }

  /** Make the next `getDocument` call reject, the way a real load failure does. */
  async function rejectNextGetDocument(err: unknown) {
    const pdfjs = await import("pdfjs-dist");
    vi.mocked(pdfjs.getDocument).mockReturnValueOnce({
      promise: Promise.reject(err),
    } as never);
  }

  describe("pdfToImages", () => {
    it("converts PDF pages to JPEG images by default", async () => {
      const results = await pdfToImages(fakePdfData);
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("page-1.jpg");
      expect(results[1].name).toBe("page-2.jpg");
    });

    it("converts PDF pages to PNG images when specified", async () => {
      const results = await pdfToImages(fakePdfData, "png");
      expect(results[0].name).toBe("page-1.png");
      expect(results[1].name).toBe("page-2.png");
    });

    it("uses correct scale for viewport", async () => {
      await pdfToImages(fakePdfData, "jpeg", 0.85, 3);
      expect(mockPdfjsPage.getViewport).toHaveBeenCalledWith({ scale: 3 });
    });

    it("sets canvas dimensions from viewport", async () => {
      await pdfToImages(fakePdfData, "jpeg", 0.85, 2);
      expect(mockCanvas.width).toBe(800);
      expect(mockCanvas.height).toBe(600);
    });

    it("renders each page", async () => {
      await pdfToImages(fakePdfData);
      expect(mockPdfjsPage.render).toHaveBeenCalledTimes(2);
    });

    it("returns Blob results", async () => {
      const results = await pdfToImages(fakePdfData, "jpeg");
      expect(results[0].blob).toBeInstanceOf(Blob);
    });

    it("uses default parameters (jpeg, 0.85 quality, scale 2)", async () => {
      await pdfToImages(fakePdfData);
      expect(mockPdfjsPage.getViewport).toHaveBeenCalledWith({ scale: 2 });
    });

    it("gets pages with 1-based indexing", async () => {
      await pdfToImages(fakePdfData);
      expect(mockPdfjsDoc.getPage).toHaveBeenCalledWith(1);
      expect(mockPdfjsDoc.getPage).toHaveBeenCalledWith(2);
    });

    it("destroys the pdfjs document once every page is encoded", async () => {
      // pdf.js pins the parsed document in its worker until destroy() — a
      // leak of the whole document per conversion otherwise.
      await pdfToImages(fakePdfData);
      expect(mockPdfjsDoc.destroy).toHaveBeenCalledTimes(1);
    });

    it("destroys the document even when a page fails to render", async () => {
      mockPdfjsPage.render.mockReturnValue({ promise: Promise.reject(new Error("boom")) });
      await expect(pdfToImages(fakePdfData)).rejects.toThrow("boom");
      expect(mockPdfjsDoc.destroy).toHaveBeenCalledTimes(1);
    });

    it("releases each page's operator list after rendering", async () => {
      await pdfToImages(fakePdfData);
      expect(mockPdfjsPage.cleanup).toHaveBeenCalledTimes(2);
    });

    it("renders with canvas and viewport", async () => {
      await pdfToImages(fakePdfData);
      expect(mockPdfjsPage.render).toHaveBeenCalledWith(
        expect.objectContaining({
          canvas: expect.anything(),
          viewport: expect.anything(),
        }),
      );
    });

    /*
      The pdf-lib path has always turned a protected or unreadable document
      into a house sentence. This one — pdf-to-jpg / png / webp — opened the
      document through pdfjs with no catch at all, and PdfToJpgUI renders
      `err.message` verbatim, so the user read pdfjs's own English: literally
      "No password given". Same two buckets, same two sentences, whichever
      engine parsed the file.
    */
    it("maps a pdfjs password failure to the house sentence", async () => {
      await rejectNextGetDocument(pdfjsException("PasswordException", "No password given"));
      const failure = pdfToImages(fakePdfData);
      await expect(failure).rejects.toThrow(/password-protected/);
      await expect(failure).rejects.toThrow(/\/unlock-pdf/);
    });

    it("does not leak pdfjs's own wording for a protected file", async () => {
      await rejectNextGetDocument(pdfjsException("PasswordException", "No password given"));
      await expect(pdfToImages(fakePdfData)).rejects.not.toThrow(/No password given/);
    });

    it("maps a pdfjs parse failure to the damaged-file sentence", async () => {
      await rejectNextGetDocument(
        pdfjsException("InvalidPDFException", "Invalid PDF structure."),
      );
      const failure = pdfToImages(fakePdfData);
      await expect(failure).rejects.toThrow(/damaged or is not a PDF/);
      await expect(failure).rejects.toThrow(/\/repair-pdf/);
    });

    it("rethrows a load failure it cannot name, untouched", async () => {
      // We do not know what it was, so we do not get to describe it.
      await rejectNextGetDocument(new Error("something else entirely"));
      await expect(pdfToImages(fakePdfData)).rejects.toThrow("something else entirely");
    });
  });

  // ── loadPdfjsDocument ─────────────────────────────────────────

  describe("loadPdfjsDocument", () => {
    it("loads a pdfjs document from Uint8Array", async () => {
      const doc = await loadPdfjsDocument(fakePdfData);
      expect(doc).toBe(mockPdfjsDoc);
    });

    it("loads a pdfjs document from ArrayBuffer", async () => {
      const doc = await loadPdfjsDocument(fakePdfData.buffer.slice(0));
      expect(doc).toBe(mockPdfjsDoc);
    });

    it("slices the input data to avoid detaching caller buffer", async () => {
      const pdfjs = await import("pdfjs-dist");
      await loadPdfjsDocument(fakePdfData);
      expect(pdfjs.getDocument).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.any(Uint8Array) }),
      );
    });

    /*
      Every other pdfjs entry point in the app goes through here — the crop and
      page-size previews, the thumbnail picker, pdf-to-text — so the mapping
      lives at this one door rather than being re-implemented behind each of
      them (which is how pdfToImages came to have none).
    */
    it("maps a password failure for every caller that loads through it", async () => {
      await rejectNextGetDocument(pdfjsException("PasswordException", "No password given"));
      const failure = loadPdfjsDocument(fakePdfData);
      await expect(failure).rejects.toThrow(/password-protected/);
      await expect(failure).rejects.not.toThrow(/No password given/);
    });

    it("maps a parse failure for every caller that loads through it", async () => {
      await rejectNextGetDocument(
        pdfjsException("InvalidPDFException", "Invalid PDF structure."),
      );
      await expect(loadPdfjsDocument(fakePdfData)).rejects.toThrow(/damaged or is not a PDF/);
    });
  });

  // ── renderPageFromDoc ─────────────────────────────────────────

  describe("renderPageFromDoc", () => {
    it("renders a page from an existing document", async () => {
      const canvas = await renderPageFromDoc(mockPdfjsDoc as never, 1, 0.5);
      expect(mockPdfjsDoc.getPage).toHaveBeenCalledWith(1);
      expect(canvas).toBeDefined();
    });

    it("cleans the page up after rendering", async () => {
      await renderPageFromDoc(mockPdfjsDoc as never, 1, 0.5);
      expect(mockPdfjsPage.cleanup).toHaveBeenCalled();
    });

    it("uses provided scale", async () => {
      await renderPageFromDoc(mockPdfjsDoc as never, 1, 1.5);
      expect(mockPdfjsPage.getViewport).toHaveBeenCalledWith({ scale: 1.5 });
    });

    it("defaults to 0.5 scale", async () => {
      await renderPageFromDoc(mockPdfjsDoc as never, 1);
      expect(mockPdfjsPage.getViewport).toHaveBeenCalledWith({ scale: 0.5 });
    });

    it("sets canvas dimensions from viewport", async () => {
      await renderPageFromDoc(mockPdfjsDoc as never, 1, 0.5);
      expect(mockCanvas.width).toBe(800);
      expect(mockCanvas.height).toBe(600);
    });
  });

  // ── renderPageToCanvas ────────────────────────────────────────

  describe("renderPageToCanvas", () => {
    it("renders a single page from raw data", async () => {
      const canvas = await renderPageToCanvas(fakePdfData, 1, 0.5);
      expect(canvas).toBeDefined();
      expect(mockPdfjsDoc.getPage).toHaveBeenCalledWith(1);
    });

    it("defaults to 0.5 scale", async () => {
      await renderPageToCanvas(fakePdfData, 1);
      expect(mockPdfjsPage.getViewport).toHaveBeenCalledWith({ scale: 0.5 });
    });

    it("destroys the document it opened", async () => {
      await renderPageToCanvas(fakePdfData, 1);
      expect(mockPdfjsDoc.destroy).toHaveBeenCalledTimes(1);
    });

    it("creates a new document internally", async () => {
      const pdfjs = await import("pdfjs-dist");
      await renderPageToCanvas(fakePdfData, 1);
      expect(pdfjs.getDocument).toHaveBeenCalled();
    });
  });
});
