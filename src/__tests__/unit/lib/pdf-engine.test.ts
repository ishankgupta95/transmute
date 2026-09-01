import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
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
  rotatePdfPages,
  reorderPdfPages,
  addPageNumbers,
  imagesToPdf,
  compressPdf,
  pdfToImages,
  loadPdfjsDocument,
  renderPageFromDoc,
  renderPageToCanvas,
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
  });

  // ── pdfToImages ───────────────────────────────────────────────

  const fakePdfData = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4

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
