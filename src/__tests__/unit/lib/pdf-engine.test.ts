import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted shared state & helpers (runs before vi.mock) ──────────

const hoisted = vi.hoisted(() => {
  function createMockBuffer() {
    const data = new Uint8Array([37, 80, 68, 70]);
    return { asUint8Array: vi.fn().mockReturnValue(data) };
  }

  function createMockPdfObj(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      isNull: vi.fn().mockReturnValue(false),
      isArray: vi.fn().mockReturnValue(false),
      asNumber: vi.fn().mockReturnValue(0),
      get: vi.fn().mockImplementation(() => createMockPdfObj()),
      put: vi.fn(),
      push: vi.fn(),
      ...overrides,
    };
  }

  function createMockDocument(pageCount = 3) {
    const pages = Array.from({ length: pageCount }, () =>
      createMockPdfObj({
        get: vi.fn().mockImplementation((key: string) => {
          if (key === "Rotate")
            return createMockPdfObj({ isNull: vi.fn().mockReturnValue(true), asNumber: vi.fn().mockReturnValue(0) });
          if (key === "Resources")
            return createMockPdfObj({ isNull: vi.fn().mockReturnValue(true) });
          if (key === "Contents")
            return createMockPdfObj({ isNull: vi.fn().mockReturnValue(true), isArray: vi.fn().mockReturnValue(false) });
          return createMockPdfObj();
        }),
      }),
    );

    return {
      countPages: vi.fn().mockReturnValue(pageCount),
      findPage: vi.fn().mockImplementation((idx: number) => pages[idx]),
      loadPage: vi.fn().mockImplementation(() => ({
        getBounds: vi.fn().mockReturnValue([0, 0, 595, 842]),
      })),
      newGraftMap: vi.fn().mockReturnValue({ graftPage: vi.fn() }),
      newInteger: vi.fn().mockImplementation((n: number) => n),
      newDictionary: vi.fn().mockImplementation(() => createMockPdfObj()),
      newArray: vi.fn().mockImplementation(() => {
        const items: unknown[] = [];
        return createMockPdfObj({
          push: vi.fn().mockImplementation((item: unknown) => items.push(item)),
          isArray: vi.fn().mockReturnValue(true),
        });
      }),
      addSimpleFont: vi.fn().mockReturnValue(createMockPdfObj()),
      addStream: vi.fn().mockReturnValue(createMockPdfObj()),
      saveToBuffer: vi.fn().mockReturnValue(createMockBuffer()),
      destroy: vi.fn(),
      _pages: pages,
    };
  }

  const mockDocuments: ReturnType<typeof createMockDocument>[] = [];

  const mockFont = {
    encodeCharacter: vi.fn().mockReturnValue(1),
    advanceGlyph: vi.fn().mockReturnValue(0.5),
  };

  const mockPdfPage = { drawImage: vi.fn() };
  const mockEmbedded = { scale: vi.fn().mockReturnValue({ width: 200, height: 150 }) };
  const mockPdfDoc = {
    embedPng: vi.fn().mockResolvedValue(mockEmbedded),
    embedJpg: vi.fn().mockResolvedValue(mockEmbedded),
    addPage: vi.fn().mockReturnValue(mockPdfPage),
    save: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
  };

  const mockRenderTask = { promise: Promise.resolve() };
  const mockPdfjsPage = {
    getViewport: vi.fn().mockReturnValue({ width: 800, height: 600 }),
    render: vi.fn().mockReturnValue(mockRenderTask),
  };
  const mockPdfjsDoc = {
    numPages: 2,
    getPage: vi.fn().mockResolvedValue(mockPdfjsPage),
  };

  return {
    createMockDocument,
    createMockPdfObj,
    mockDocuments,
    mockFont,
    mockPdfDoc,
    mockPdfPage,
    mockEmbedded,
    mockPdfjsDoc,
    mockPdfjsPage,
    mockRenderTask,
  };
});

// ── Mock mupdf ────────────────────────────────────────────────────

vi.mock("mupdf", () => ({
  Document: {
    openDocument: vi.fn().mockImplementation(() => {
      const doc = hoisted.createMockDocument(3);
      hoisted.mockDocuments.push(doc);
      return doc;
    }),
  },
  // Must be a function (not arrow) so it can be called with `new`
  PDFDocument: vi.fn().mockImplementation(function (data?: Uint8Array) {
    const pageCount = data ? 3 : 0;
    const doc = hoisted.createMockDocument(pageCount);
    hoisted.mockDocuments.push(doc);
    // Copy all properties onto `this` so `new PDFDocument(...)` returns an object with the methods
    return doc;
  }),
  Font: vi.fn().mockImplementation(function () {
    return hoisted.mockFont;
  }),
}));

// ── Mock pdf-lib ──────────────────────────────────────────────────

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    create: vi.fn().mockResolvedValue(hoisted.mockPdfDoc),
  },
}));

// ── Mock pdfjs-dist ───────────────────────────────────────────────

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

// ── Canvas mock for pdfToImages / render helpers ──────────────────

let mockCanvas: Record<string, unknown>;

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
    return document.createElement(tag);
  });
}

// ── Test data ─────────────────────────────────────────────────────

const fakePdfData = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]); // %PDF-1.4

// ── Convenience aliases ───────────────────────────────────────────

const {
  mockDocuments,
  mockPdfDoc,
  mockPdfPage,
  mockEmbedded,
  mockPdfjsDoc,
  mockPdfjsPage,
  mockRenderTask,
  createMockDocument,
  createMockPdfObj,
} = hoisted;

// ── Tests ─────────────────────────────────────────────────────────

describe("pdf-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocuments.length = 0;
    setupCanvasMock();

    // Re-setup return values after clearAllMocks
    mockPdfDoc.embedPng.mockResolvedValue(mockEmbedded);
    mockPdfDoc.embedJpg.mockResolvedValue(mockEmbedded);
    mockPdfDoc.addPage.mockReturnValue(mockPdfPage);
    mockPdfDoc.save.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
    mockEmbedded.scale.mockReturnValue({ width: 200, height: 150 });
    mockPdfjsDoc.getPage.mockResolvedValue(mockPdfjsPage);
    mockPdfjsPage.getViewport.mockReturnValue({ width: 800, height: 600 });
    mockPdfjsPage.render.mockReturnValue(mockRenderTask);
  });

  // ── getPageCount ──────────────────────────────────────────────

  describe("getPageCount", () => {
    it("returns the page count from the mupdf document", async () => {
      const count = await getPageCount(fakePdfData);
      expect(count).toBe(3);
    });

    it("destroys the document after counting", async () => {
      await getPageCount(fakePdfData);
      expect(mockDocuments[0].destroy).toHaveBeenCalled();
    });

    it("accepts ArrayBuffer input", async () => {
      const buf = fakePdfData.buffer.slice(0);
      const count = await getPageCount(buf);
      expect(count).toBe(3);
    });
  });

  // ── mergePdfs ─────────────────────────────────────────────────

  describe("mergePdfs", () => {
    it("merges multiple PDFs by grafting pages from each source", async () => {
      const result = await mergePdfs([fakePdfData.buffer.slice(0), fakePdfData.buffer.slice(0)]);
      expect(result).toBeInstanceOf(Uint8Array);
      const outDoc = mockDocuments[0];
      expect(outDoc.newGraftMap).toHaveBeenCalled();
    });

    it("returns a valid Uint8Array from saveToBuffer", async () => {
      const result = await mergePdfs([fakePdfData.buffer.slice(0)]);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles a single PDF input", async () => {
      const result = await mergePdfs([fakePdfData.buffer.slice(0)]);
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("handles empty array input", async () => {
      const result = await mergePdfs([]);
      expect(result).toBeInstanceOf(Uint8Array);
      const outDoc = mockDocuments[0];
      expect(outDoc.saveToBuffer).toHaveBeenCalledWith("compress");
    });

    it("destroys source documents after merging", async () => {
      await mergePdfs([fakePdfData.buffer.slice(0), fakePdfData.buffer.slice(0)]);
      expect(mockDocuments[1].destroy).toHaveBeenCalled();
      expect(mockDocuments[2].destroy).toHaveBeenCalled();
    });

    it("destroys the output document after saving", async () => {
      await mergePdfs([fakePdfData.buffer.slice(0)]);
      expect(mockDocuments[0].destroy).toHaveBeenCalled();
    });

    it("grafts pages in order with incrementing insertAt", async () => {
      await mergePdfs([fakePdfData.buffer.slice(0), fakePdfData.buffer.slice(0)]);
      const outDoc = mockDocuments[0];
      const graftMap = outDoc.newGraftMap.mock.results[0].value;
      expect(graftMap.graftPage).toHaveBeenCalledWith(0, mockDocuments[1], 0);
      expect(graftMap.graftPage).toHaveBeenCalledWith(1, mockDocuments[1], 1);
      expect(graftMap.graftPage).toHaveBeenCalledWith(2, mockDocuments[1], 2);
      expect(graftMap.graftPage).toHaveBeenCalledWith(3, mockDocuments[2], 0);
      expect(graftMap.graftPage).toHaveBeenCalledWith(4, mockDocuments[2], 1);
      expect(graftMap.graftPage).toHaveBeenCalledWith(5, mockDocuments[2], 2);
    });
  });

  // ── splitPdf ──────────────────────────────────────────────────

  describe("splitPdf", () => {
    it("extracts specified pages by index", async () => {
      const result = await splitPdf(fakePdfData, [0, 2]);
      expect(result).toBeInstanceOf(Uint8Array);
      const outDoc = mockDocuments[1];
      const graftMap = outDoc.newGraftMap.mock.results[0].value;
      expect(graftMap.graftPage).toHaveBeenCalledTimes(2);
      expect(graftMap.graftPage).toHaveBeenCalledWith(0, mockDocuments[0], 0);
      expect(graftMap.graftPage).toHaveBeenCalledWith(1, mockDocuments[0], 2);
    });

    it("extracts a single page", async () => {
      await splitPdf(fakePdfData, [1]);
      const outDoc = mockDocuments[1];
      const graftMap = outDoc.newGraftMap.mock.results[0].value;
      expect(graftMap.graftPage).toHaveBeenCalledTimes(1);
      expect(graftMap.graftPage).toHaveBeenCalledWith(0, mockDocuments[0], 1);
    });

    it("destroys both source and output documents", async () => {
      await splitPdf(fakePdfData, [0]);
      expect(mockDocuments[0].destroy).toHaveBeenCalled();
      expect(mockDocuments[1].destroy).toHaveBeenCalled();
    });

    it("saves with compress option", async () => {
      await splitPdf(fakePdfData, [0]);
      const outDoc = mockDocuments[1];
      expect(outDoc.saveToBuffer).toHaveBeenCalledWith("compress");
    });

    it("handles extracting all pages", async () => {
      await splitPdf(fakePdfData, [0, 1, 2]);
      const outDoc = mockDocuments[1];
      const graftMap = outDoc.newGraftMap.mock.results[0].value;
      expect(graftMap.graftPage).toHaveBeenCalledTimes(3);
    });
  });

  // ── rotatePdfPages ────────────────────────────────────────────

  describe("rotatePdfPages", () => {
    it("rotates specified pages by the given angle", async () => {
      await rotatePdfPages(fakePdfData, [0, 1], 90);
      const doc = mockDocuments[0];
      expect(doc.findPage).toHaveBeenCalledWith(0);
      expect(doc.findPage).toHaveBeenCalledWith(1);
    });

    it("adds rotation to existing rotation value", async () => {
      await rotatePdfPages(fakePdfData, [0], 180);
      const doc = mockDocuments[0];
      expect(doc.newInteger).toHaveBeenCalledWith(180);
    });

    it("wraps rotation at 360 degrees", async () => {
      const mupdf = await import("mupdf");
      vi.mocked(mupdf.PDFDocument).mockImplementationOnce(function () {
        const doc = createMockDocument(1);
        doc._pages[0].get = vi.fn().mockImplementation((key: string) => {
          if (key === "Rotate")
            return { isNull: vi.fn().mockReturnValue(false), asNumber: vi.fn().mockReturnValue(270) };
          return createMockPdfObj();
        });
        mockDocuments.push(doc);
        return doc as never;
      });

      await rotatePdfPages(fakePdfData, [0], 180);
      const doc = mockDocuments[0];
      expect(doc.newInteger).toHaveBeenCalledWith(90);
    });

    it("skips out-of-range page indices", async () => {
      await rotatePdfPages(fakePdfData, [5, -1], 90);
      const doc = mockDocuments[0];
      expect(doc._pages[0].put).not.toHaveBeenCalled();
    });

    it("destroys the document after rotation", async () => {
      await rotatePdfPages(fakePdfData, [0], 90);
      expect(mockDocuments[0].destroy).toHaveBeenCalled();
    });

    it("saves with compress option", async () => {
      await rotatePdfPages(fakePdfData, [0], 90);
      expect(mockDocuments[0].saveToBuffer).toHaveBeenCalledWith("compress");
    });

    it("handles rotating all pages", async () => {
      await rotatePdfPages(fakePdfData, [0, 1, 2], 90);
      const doc = mockDocuments[0];
      expect(doc.findPage).toHaveBeenCalledTimes(3);
    });
  });

  // ── reorderPdfPages ───────────────────────────────────────────

  describe("reorderPdfPages", () => {
    it("reorders pages according to newOrder", async () => {
      await reorderPdfPages(fakePdfData, [2, 0, 1]);
      const outDoc = mockDocuments[1];
      const graftMap = outDoc.newGraftMap.mock.results[0].value;
      expect(graftMap.graftPage).toHaveBeenCalledTimes(3);
      expect(graftMap.graftPage).toHaveBeenCalledWith(0, mockDocuments[0], 2);
      expect(graftMap.graftPage).toHaveBeenCalledWith(1, mockDocuments[0], 0);
      expect(graftMap.graftPage).toHaveBeenCalledWith(2, mockDocuments[0], 1);
    });

    it("handles identity reorder (no change)", async () => {
      await reorderPdfPages(fakePdfData, [0, 1, 2]);
      const outDoc = mockDocuments[1];
      const graftMap = outDoc.newGraftMap.mock.results[0].value;
      expect(graftMap.graftPage).toHaveBeenCalledWith(0, mockDocuments[0], 0);
      expect(graftMap.graftPage).toHaveBeenCalledWith(1, mockDocuments[0], 1);
      expect(graftMap.graftPage).toHaveBeenCalledWith(2, mockDocuments[0], 2);
    });

    it("handles reverse order", async () => {
      await reorderPdfPages(fakePdfData, [2, 1, 0]);
      const outDoc = mockDocuments[1];
      const graftMap = outDoc.newGraftMap.mock.results[0].value;
      expect(graftMap.graftPage).toHaveBeenCalledWith(0, mockDocuments[0], 2);
      expect(graftMap.graftPage).toHaveBeenCalledWith(1, mockDocuments[0], 1);
      expect(graftMap.graftPage).toHaveBeenCalledWith(2, mockDocuments[0], 0);
    });

    it("destroys both source and output documents", async () => {
      await reorderPdfPages(fakePdfData, [0, 1, 2]);
      expect(mockDocuments[0].destroy).toHaveBeenCalled();
      expect(mockDocuments[1].destroy).toHaveBeenCalled();
    });

    it("saves with compress option", async () => {
      await reorderPdfPages(fakePdfData, [0]);
      const outDoc = mockDocuments[1];
      expect(outDoc.saveToBuffer).toHaveBeenCalledWith("compress");
    });
  });

  // ── addPageNumbers ────────────────────────────────────────────

  describe("addPageNumbers", () => {
    it("adds page numbers starting at 1 by default", async () => {
      const result = await addPageNumbers(fakePdfData, "bottom-center");
      expect(result).toBeInstanceOf(Uint8Array);
      const doc = mockDocuments[0];
      expect(doc.addStream).toHaveBeenCalledTimes(3);
    });

    it("uses custom start number", async () => {
      await addPageNumbers(fakePdfData, "bottom-center", 5);
      const doc = mockDocuments[0];
      expect((doc.addStream.mock.calls[0][0] as string)).toContain("(5)");
      expect((doc.addStream.mock.calls[1][0] as string)).toContain("(6)");
      expect((doc.addStream.mock.calls[2][0] as string)).toContain("(7)");
    });

    it("positions numbers at bottom-left", async () => {
      await addPageNumbers(fakePdfData, "bottom-left");
      const doc = mockDocuments[0];
      const stream = doc.addStream.mock.calls[0][0] as string;
      expect(stream).toContain("40 20 Td");
    });

    it("positions numbers at top-center", async () => {
      await addPageNumbers(fakePdfData, "top-center");
      const doc = mockDocuments[0];
      const stream = doc.addStream.mock.calls[0][0] as string;
      expect(stream).toContain("812 Td");
    });

    it("positions numbers at bottom-right", async () => {
      await addPageNumbers(fakePdfData, "bottom-right");
      const doc = mockDocuments[0];
      const stream = doc.addStream.mock.calls[0][0] as string;
      expect(stream).toContain("20 Td");
    });

    it("positions numbers at top-left", async () => {
      await addPageNumbers(fakePdfData, "top-left");
      const doc = mockDocuments[0];
      const stream = doc.addStream.mock.calls[0][0] as string;
      expect(stream).toContain("40");
      expect(stream).toContain("812 Td");
    });

    it("positions numbers at top-right", async () => {
      await addPageNumbers(fakePdfData, "top-right");
      const doc = mockDocuments[0];
      const stream = doc.addStream.mock.calls[0][0] as string;
      expect(stream).toContain("812 Td");
    });

    it("positions numbers at bottom-center", async () => {
      await addPageNumbers(fakePdfData, "bottom-center");
      const doc = mockDocuments[0];
      const stream = doc.addStream.mock.calls[0][0] as string;
      expect(stream).toContain("20 Td");
    });

    it("creates a Helvetica font", async () => {
      const mupdf = await import("mupdf");
      await addPageNumbers(fakePdfData, "bottom-center");
      expect(mupdf.Font).toHaveBeenCalledWith("Helvetica");
    });

    it("adds font to page Resources via addSimpleFont", async () => {
      await addPageNumbers(fakePdfData, "bottom-center");
      const doc = mockDocuments[0];
      expect(doc.addSimpleFont).toHaveBeenCalled();
    });

    it("destroys the document after processing", async () => {
      await addPageNumbers(fakePdfData, "bottom-center");
      expect(mockDocuments[0].destroy).toHaveBeenCalled();
    });

    it("generates correct PDF content stream syntax", async () => {
      await addPageNumbers(fakePdfData, "bottom-center", 1);
      const doc = mockDocuments[0];
      const stream = doc.addStream.mock.calls[0][0] as string;
      expect(stream).toMatch(/^q BT \/Fn 10 Tf .+ Td \(1\) Tj ET Q$/);
    });

    it("saves with compress option", async () => {
      await addPageNumbers(fakePdfData, "bottom-center");
      expect(mockDocuments[0].saveToBuffer).toHaveBeenCalledWith("compress");
    });
  });

  // ── imagesToPdf ───────────────────────────────────────────────

  describe("imagesToPdf", () => {
    it("creates a PDF from PNG images", async () => {
      const images = [{ bytes: new Uint8Array([1, 2, 3]), type: "image/png" }];
      const result = await imagesToPdf(images, "a4");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(mockPdfDoc.embedPng).toHaveBeenCalledWith(images[0].bytes);
      expect(mockPdfDoc.addPage).toHaveBeenCalled();
    });

    it("creates a PDF from JPEG images", async () => {
      const images = [{ bytes: new Uint8Array([0xFF, 0xD8]), type: "image/jpeg" }];
      await imagesToPdf(images, "a4");
      expect(mockPdfDoc.embedJpg).toHaveBeenCalledWith(images[0].bytes);
    });

    it("handles mixed PNG and JPEG image types", async () => {
      const images = [
        { bytes: new Uint8Array([1]), type: "image/png" },
        { bytes: new Uint8Array([2]), type: "image/jpeg" },
      ];
      await imagesToPdf(images, "a4");
      expect(mockPdfDoc.embedPng).toHaveBeenCalledTimes(1);
      expect(mockPdfDoc.embedJpg).toHaveBeenCalledTimes(1);
      expect(mockPdfDoc.addPage).toHaveBeenCalledTimes(2);
    });

    it("uses A4 page dimensions (595.28 x 841.89)", async () => {
      const images = [{ bytes: new Uint8Array([1]), type: "image/png" }];
      await imagesToPdf(images, "a4");
      expect(mockPdfDoc.addPage).toHaveBeenCalledWith([595.28, 841.89]);
    });

    it("uses letter page dimensions (612 x 792)", async () => {
      const images = [{ bytes: new Uint8Array([1]), type: "image/png" }];
      await imagesToPdf(images, "letter");
      expect(mockPdfDoc.addPage).toHaveBeenCalledWith([612, 792]);
    });

    it("uses image dimensions for 'fit' page size", async () => {
      const images = [{ bytes: new Uint8Array([1]), type: "image/png" }];
      await imagesToPdf(images, "fit");
      expect(mockPdfDoc.addPage).toHaveBeenCalledWith([200, 150]);
    });

    it("draws image at full size for 'fit' page size", async () => {
      const images = [{ bytes: new Uint8Array([1]), type: "image/png" }];
      await imagesToPdf(images, "fit");
      expect(mockPdfPage.drawImage).toHaveBeenCalledWith(mockEmbedded, {
        x: 0,
        y: 0,
        width: 200,
        height: 150,
      });
    });

    it("centers and scales image within page margins for fixed page sizes", async () => {
      const images = [{ bytes: new Uint8Array([1]), type: "image/png" }];
      await imagesToPdf(images, "a4");
      expect(mockPdfPage.drawImage).toHaveBeenCalledWith(
        mockEmbedded,
        expect.objectContaining({ width: 200, height: 150 }),
      );
    });

    it("scales down images larger than page margins", async () => {
      mockEmbedded.scale.mockReturnValue({ width: 2000, height: 1500 });
      const images = [{ bytes: new Uint8Array([1]), type: "image/png" }];
      await imagesToPdf(images, "a4");
      expect(mockPdfPage.drawImage).toHaveBeenCalledWith(
        mockEmbedded,
        expect.objectContaining({
          width: expect.closeTo(515.28, 0),
          height: expect.closeTo(386.46, 0),
        }),
      );
    });

    it("handles empty images array", async () => {
      const result = await imagesToPdf([], "a4");
      expect(result).toBeInstanceOf(Uint8Array);
      expect(mockPdfDoc.addPage).not.toHaveBeenCalled();
    });

    it("calls save on the PDF document", async () => {
      const images = [{ bytes: new Uint8Array([1]), type: "image/png" }];
      await imagesToPdf(images, "a4");
      expect(mockPdfDoc.save).toHaveBeenCalled();
    });

    it("defaults to A4 page size when not specified", async () => {
      const images = [{ bytes: new Uint8Array([1]), type: "image/png" }];
      await imagesToPdf(images);
      expect(mockPdfDoc.addPage).toHaveBeenCalledWith([595.28, 841.89]);
    });

    it("treats non-PNG types as JPEG", async () => {
      const images = [{ bytes: new Uint8Array([1]), type: "image/webp" }];
      await imagesToPdf(images, "a4");
      expect(mockPdfDoc.embedJpg).toHaveBeenCalled();
      expect(mockPdfDoc.embedPng).not.toHaveBeenCalled();
    });
  });

  // ── compressPdf ───────────────────────────────────────────────

  describe("compressPdf", () => {
    it("compresses a PDF with compress,garbage options", async () => {
      const result = await compressPdf(fakePdfData);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(mockDocuments[0].saveToBuffer).toHaveBeenCalledWith("compress,garbage");
    });

    it("destroys the document after compression", async () => {
      await compressPdf(fakePdfData);
      expect(mockDocuments[0].destroy).toHaveBeenCalled();
    });

    it("accepts ArrayBuffer input", async () => {
      const result = await compressPdf(fakePdfData.buffer.slice(0));
      expect(result).toBeInstanceOf(Uint8Array);
    });

    it("returns a Uint8Array result", async () => {
      const result = await compressPdf(fakePdfData);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ── pdfToImages ───────────────────────────────────────────────

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

    it("creates a new document internally", async () => {
      const pdfjs = await import("pdfjs-dist");
      await renderPageToCanvas(fakePdfData, 1);
      expect(pdfjs.getDocument).toHaveBeenCalled();
    });
  });
});
