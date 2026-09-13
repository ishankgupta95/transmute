import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName } from "pdf-lib";

import { addOcrTextLayer, placeOcrWord, type OcrWord } from "@/lib/tools/pdf-ocr-layer";

/*
  The invisible OCR text layer.

  WHAT IS AND IS NOT TESTED HERE, deliberately. The two claims that matter most
  — that the page renders pixel-for-pixel unchanged, and that a real extractor
  gets the words back — need a real renderer and a real pdfjs worker, and this
  file runs in jsdom, which has neither. Asserting them here would produce the
  exact green-but-blind result this repo has a memory about. They are owned by
  `e2e/conversion/ocr-pdf.spec.ts`, which runs in Chromium and WebKit.

  What IS here is everything that is pure: the placement arithmetic, which is
  where every rotation bug in this family of tools has actually lived, and the
  document structure, which is plain object-graph inspection.
*/

const word = (text: string, x0: number, y0: number, x1: number, y1: number): OcrWord => ({
  text,
  x0,
  y0,
  x1,
  y1,
});

/** A4-ish, and deliberately NOT square so a transposed axis cannot pass. */
const PAGE = { x: 0, y: 0, width: 600, height: 800 };

describe("placeOcrWord maps a raster box into user space", () => {
  /*
    The raster is the DISPLAYED page: pdfjs's `getViewport({scale})` has
    already applied /Rotate before OCR ever sees the pixels. So on a turned
    page the raster is landscape even though the MediaBox is portrait, and
    these fixtures say so.
  */
  const raster = { width: 300, height: 400 };
  const turnedRaster = { width: 400, height: 300 };

  it("puts a word's baseline-left where the box's bottom-left is, unrotated", () => {
    // Box spans x 30..90 of 300 and y 40..60 of 400, so in a 600x800 page:
    // left = 60pt, baseline (the box BOTTOM, y1) = 120pt from the top = 680 up.
    const placed = placeOcrWord({ word: word("hi", 30, 40, 90, 60), raster, pageBox: PAGE, rotation: 0 })!;
    expect(placed.origin.x).toBeCloseTo(60, 6);
    expect(placed.origin.y).toBeCloseTo(680, 6);
    // Box height 20px of 400 over an 800pt page = 40pt.
    expect(placed.size).toBeCloseTo(40, 6);
  });

  it("stretches the run to the width OCR measured, not to the font's own advance", () => {
    // 2 codepoints at size 40 advance 80pt naturally (DW 1000 = one em each).
    // The box is 60px of 300 over 600pt = 120pt wide, so Tz = 150%.
    const placed = placeOcrWord({ word: word("hi", 30, 40, 90, 60), raster, pageBox: PAGE, rotation: 0 })!;
    expect(placed.squeeze).toBeCloseTo(150, 6);
  });

  it("counts CODEPOINTS, not UTF-16 code units, when sizing the run", () => {
    /*
      The recorded trap. "𝕏" is one codepoint and two code units; using
      `.length` would compute twice the natural advance and squeeze the run to
      half its correct width. Same box, same size — only the string differs,
      and a one-codepoint string must squeeze to exactly twice the two-
      codepoint one.
    */
    const two = placeOcrWord({ word: word("hi", 30, 40, 90, 60), raster, pageBox: PAGE, rotation: 0 })!;
    const astral = placeOcrWord({ word: word("𝕏", 30, 40, 90, 60), raster, pageBox: PAGE, rotation: 0 })!;
    expect([..."𝕏"]).toHaveLength(1);
    expect("𝕏".length).toBe(2);
    expect(astral.squeeze).toBeCloseTo(two.squeeze * 2, 6);
  });

  it.each([0, 90, 180, 270] as const)(
    "keeps a word inside the page at /Rotate %i",
    (rotation) => {
      const r = rotation % 180 !== 0 ? turnedRaster : raster;
      // A box in the middle of the raster cannot land outside the page.
      const placed = placeOcrWord({
        word: word("mid", r.width * 0.4, r.height * 0.4, r.width * 0.6, r.height * 0.5),
        raster: r,
        pageBox: PAGE,
        rotation,
      })!;
      expect(placed.origin.x).toBeGreaterThanOrEqual(0);
      expect(placed.origin.x).toBeLessThanOrEqual(PAGE.width);
      expect(placed.origin.y).toBeGreaterThanOrEqual(0);
      expect(placed.origin.y).toBeLessThanOrEqual(PAGE.height);
    },
  );

  it("moves a word to a DIFFERENT place on every rotation", () => {
    /*
      The positive control for the sweep above. Four rotations that all mapped
      to the same point would satisfy "inside the page" perfectly while the
      rotation handling did nothing at all — which is exactly how a rotation
      bug survives a bounds check.
    */
    const seen = new Set<string>();
    for (const rotation of [0, 90, 180, 270] as const) {
      const r = rotation % 180 !== 0 ? turnedRaster : raster;
      const placed = placeOcrWord({
        word: word("x", r.width * 0.1, r.height * 0.1, r.width * 0.2, r.height * 0.2),
        raster: r,
        pageBox: PAGE,
        rotation,
      })!;
      seen.add(`${placed.origin.x.toFixed(3)},${placed.origin.y.toFixed(3)}`);
    }
    expect(seen.size, "rotation is being ignored").toBe(4);
  });

  it("declines a degenerate box rather than emitting a zero-size run", () => {
    // A zero-height box would give font size 0; a zero-width one would give an
    // infinite squeeze. Both come out of OCR occasionally.
    expect(placeOcrWord({ word: word("x", 30, 40, 90, 40), raster, pageBox: PAGE, rotation: 0 })).toBeNull();
    expect(placeOcrWord({ word: word("x", 30, 40, 30, 60), raster, pageBox: PAGE, rotation: 0 })).toBeNull();
    expect(placeOcrWord({ word: word("", 30, 40, 90, 60), raster, pageBox: PAGE, rotation: 0 })).toBeNull();
  });
});

describe("addOcrTextLayer writes a usable document", () => {
  const build = async (words: OcrWord[], rotate = 0) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE.width, PAGE.height]);
    if (rotate) page.setRotation({ type: "degrees", angle: rotate } as never);
    const drawn = addOcrTextLayer(doc, [
      { page, words, raster: { width: 300, height: 400 } },
    ]);
    return { doc, page, drawn, bytes: await doc.save() };
  };

  it("draws one run per word and reports the count", async () => {
    const { drawn } = await build([word("alpha", 10, 10, 60, 30), word("beta", 70, 10, 110, 30)]);
    expect(drawn).toBe(2);
  });

  /*
    ⚠ THESE READ THE OBJECT GRAPH, NOT THE SAVED BYTES, and that is not a
    stylistic choice. pdf-lib saves with `useObjectStreams` on by default, so
    the whole object structure is Flate-compressed and
    `Buffer.includes("GlyphLessFont")` returns FALSE on a document that
    demonstrably contains it. That is a recorded scar in this repo — a raw byte
    grep over a PDF is unsound — and it caught this file on first writing.
  */
  const objectsAsText = (doc: PDFDocument): string =>
    doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => String(obj))
      .join("\n");

  it("adds nothing at all when there is no text", async () => {
    /*
      A page OCR found nothing on must not gain a font, an empty text object or
      a resource entry. "It changed the file but only a little" is not a thing
      this tool is allowed to do.
    */
    const empty = await build([]);
    expect(empty.drawn).toBe(0);
    expect(empty.doc.getPageCount()).toBe(1);
    expect(objectsAsText(empty.doc)).not.toContain("GlyphLessFont");
  });

  it("embeds a glyphless font with no font program", async () => {
    const { doc } = await build([word("alpha", 10, 10, 60, 30)]);
    const objects = objectsAsText(doc);
    // POSITIVE CONTROLS first: a negative over a document that never got a
    // layer, or over a walk that returned nothing, would pass every line below.
    expect(objects.length).toBeGreaterThan(200);
    expect(objects).toContain("GlyphLessFont");
    expect(objects).toContain("Identity-H");
    expect(objects).toContain("CIDFontType2");
    expect(objects).toContain("ToUnicode");
    // …and the point of the whole design: no embedded font program.
    expect(
      objects,
      "a font program was embedded — the layer is meant to carry none",
    ).not.toContain("FontFile2");
  });

  it("gives the page an OCR font resource keyed into its own dictionary", async () => {
    const { page } = await build([word("alpha", 10, 10, 60, 30)]);
    const resources = page.node.Resources();
    expect(resources, "the page gained no Resources dictionary").toBeDefined();
    const fonts = resources!.get(PDFName.of("Font"));
    expect(String(fonts ?? ""), "no Font dictionary on the page").toContain("OCR");
  });

  it.each([0, 90, 180, 270])("survives a page rotated %i degrees", async (angle) => {
    const { drawn, bytes } = await build([word("alpha", 10, 10, 60, 30)], angle);
    expect(drawn).toBe(1);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
