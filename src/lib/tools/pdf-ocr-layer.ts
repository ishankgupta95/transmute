import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFPage,
  PDFRef,
  PDFString,
  TextRenderingMode,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
} from "pdf-lib";

import { fractionToUserSpace, normaliseRotation, visiblePageBox } from "./pdf-stamp-core";

/**
 * THE INVISIBLE TEXT LAYER — what makes a scanned PDF searchable without
 * changing a pixel of it.
 *
 * The whole tool rests on one claim: the page you get back LOOKS exactly like
 * the page you put in, and the only thing added is text nobody can see. That
 * is text rendering mode 3 (`3 Tr`), which tells a viewer to run the whole
 * text-drawing machinery and rasterise nothing. Search, selection, copy and a
 * screen reader all still find it.
 *
 * MEASURED, not assumed: a page with this layer renders **0 differing pixels**
 * against the same page without it, in two independent renderers (poppler at
 * 150 dpi, and pdfjs — the one this site already ships) at all four `/Rotate`
 * values, while `pdftotext` and pdfjs's own `getTextContent` both recover the
 * words. The operators are appended to the page's existing content stream, so
 * the original page objects — the scan's own image XObject, its compression,
 * any vector art — are never rewritten.
 *
 * ⚠ THIS IS NOT REDACTION AND NOT A RE-TYPESETTING. Nothing underneath is
 * removed or replaced. The tool's copy has to say so, because "makes a PDF
 * searchable" is easy to hear as "converts a scan into a document".
 */

/** One OCR word, in DISPLAYED raster pixels with the origin at the top-left. */
export interface OcrWord {
  readonly text: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * A glyphless Type0 / Identity-H / CIDFontType2 font — a font with NO font
 * program in it at all.
 *
 * ⚠ THIS IS THE PIECE THAT MAKES THE TOOL POSSIBLE, and it is worth
 * understanding before anyone "simplifies" it into a standard font.
 *
 * A standard font cannot carry OCR output. `StandardFonts.Helvetica` encodes
 * WinAnsi, and pdf-lib's `encodeText` THROWS on anything outside cp1252 —
 * including a plain newline. That leaves three options, and all three are the
 * kind of quiet damage this repo spends its time removing: DROP the character
 * (the word silently stops being searchable, and the width maths goes wrong),
 * SUBSTITUTE "?" (a lie in the text layer, and the real word still cannot be
 * found), or REFUSE the page (one stray glyph kills a whole document, for a
 * tool whose entire job is best-effort).
 *
 * None of that applies here, because under `3 Tr` no glyph is ever rasterised.
 * Nothing needs to know what the characters LOOK like — only `/ToUnicode`
 * decides what search and copy return. So the font can legally omit its
 * `FontFile2`, every codepoint gets a CID, and Polish, Greek, Cyrillic, CJK
 * and emoji all round-trip exactly. It costs about 1.3 KB inside the produced
 * PDF and **zero served bytes**.
 *
 * ⚠ ONE CID PER CODEPOINT, not per UTF-16 code unit. Allocating per code unit
 * emits lone surrogates for astral characters, and extractors mangle them —
 * measured. `[...text]` iterates codepoints; `text.length` does not.
 */
class CidTable {
  private readonly map = new Map<number, number>();
  /** CID 0 is `.notdef` by convention, so allocation starts at 1. */
  private next = 1;

  /** Never throws. Any codepoint gets a CID, allocated on first sight. */
  encode(text: string): PDFHexString {
    let hex = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      let cid = this.map.get(cp);
      if (cid === undefined) {
        cid = this.next++;
        this.map.set(cp, cid);
      }
      hex += cid.toString(16).padStart(4, "0").toUpperCase();
    }
    return PDFHexString.of(hex);
  }

  /** How many CIDs a string emits — one per CODEPOINT. Drives the Tz maths. */
  static codepointCount(text: string): number {
    return [...text].length;
  }

  get size(): number {
    return this.map.size;
  }

  /** The `/ToUnicode` CMap: the only thing that decides what copy/search get. */
  cmap(): string {
    const entries = [...this.map.entries()].sort((a, b) => a[1] - b[1]);
    let body = "";
    // A `bfchar` run may hold at most 100 entries; longer runs are invalid.
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      body +=
        `${chunk.length} beginbfchar\n` +
        chunk
          .map(
            ([cp, cid]) =>
              `<${cid.toString(16).padStart(4, "0").toUpperCase()}> <${utf16beHex(cp)}>`,
          )
          .join("\n") +
        "\nendbfchar\n";
    }
    return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${body}endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  }
}

/** A codepoint as UTF-16BE hex — two bytes for the BMP, four above it. */
function utf16beHex(cp: number): string {
  const s = String.fromCodePoint(cp);
  let hex = "";
  for (let i = 0; i < s.length; i += 1) hex += s.charCodeAt(i).toString(16).padStart(4, "0");
  return hex.toUpperCase();
}

function registerGlyphlessFont(doc: PDFDocument, table: CidTable): PDFRef {
  const ctx = doc.context;
  const toUnicode = ctx.register(ctx.flateStream(table.cmap()));
  const descriptor = ctx.register(
    ctx.obj({
      Type: "FontDescriptor",
      FontName: PDFName.of("GlyphLessFont"),
      // 4 = Symbolic. There is no glyph set to describe, and claiming
      // Nonsymbolic would invite a viewer to apply a standard encoding.
      Flags: 4,
      FontBBox: [0, 0, 1000, 1000],
      ItalicAngle: 0,
      Ascent: 1000,
      Descent: 0,
      CapHeight: 1000,
      StemV: 80,
    }),
  );
  const descendant = ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "CIDFontType2",
      BaseFont: PDFName.of("GlyphLessFont"),
      CIDSystemInfo: ctx.obj({
        Registry: PDFString.of("Adobe"),
        Ordering: PDFString.of("Identity"),
        Supplement: 0,
      }),
      FontDescriptor: descriptor,
      /*
        Every CID advances exactly one em. That is what turns the horizontal
        scaling below into a division instead of a per-glyph metrics lookup —
        there are no metrics, because there is no font program.
      */
      DW: 1000,
      CIDToGIDMap: PDFName.of("Identity"),
    }),
  );
  return ctx.register(
    ctx.obj({
      Type: "Font",
      Subtype: "Type0",
      BaseFont: PDFName.of("GlyphLessFont"),
      Encoding: PDFName.of("Identity-H"),
      DescendantFonts: [descendant],
      ToUnicode: toUnicode,
    }),
  );
}

/**
 * The unit vector along DISPLAYED-right, in user space.
 *
 * DERIVED rather than tabulated, exactly as `displayedDownUnit` in
 * `pdf-stamp-core.ts` is, and for the same reason: a second table of four
 * vectors can drift from the first, whereas asking the mapping cannot.
 * Without it, text placed on a `/Rotate 90` page comes out sideways — the
 * origin would be right and the glyphs would run down the page.
 */
function displayedRightUnit(
  pageBox: { x: number; y: number; width: number; height: number },
  rotation: 0 | 90 | 180 | 270,
): { x: number; y: number } {
  const a = fractionToUserSpace({ fraction: { x: 0, y: 0 }, pageBox, rotation });
  const b = fractionToUserSpace({ fraction: { x: 1, y: 0 }, pageBox, rotation });
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return Number.isFinite(len) && len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
}

/**
 * Where one word's invisible run goes, as pure arithmetic.
 *
 * Split out from the drawing so it can be tested without a PDF: the repo's own
 * division of labour — `pdf-stamp-core.ts` owns the geometry, the pipelines
 * own the surface they draw on — applied one level down. Every rotation bug
 * this family of tools has had was an arithmetic bug, and arithmetic that is
 * only reachable through `pushOperators` can only be checked by reading bytes
 * back out of a saved document.
 */
export function placeOcrWord(args: {
  word: OcrWord;
  raster: { width: number; height: number };
  pageBox: { x: number; y: number; width: number; height: number };
  rotation: 0 | 90 | 180 | 270;
}): { origin: { x: number; y: number }; size: number; squeeze: number } | null {
  const { word, raster, pageBox, rotation } = args;
  if (!word.text || raster.width <= 0 || raster.height <= 0) return null;

  const turned = rotation % 180 !== 0;
  const displayedW = turned ? pageBox.height : pageBox.width;
  const displayedH = turned ? pageBox.width : pageBox.height;
  const sx = displayedW / raster.width;
  const sy = displayedH / raster.height;

  const boxW = (word.x1 - word.x0) * sx;
  // Font size from the box HEIGHT. Never from the width — see the squeeze.
  const size = (word.y1 - word.y0) * sy;
  if (!(size > 0) || !(boxW > 0)) return null;

  // Baseline-left as a fraction of the DISPLAYED page, then through the one
  // function that already knows about both the y-flip and /Rotate.
  const origin = fractionToUserSpace({
    fraction: { x: (word.x0 * sx) / displayedW, y: (word.y1 * sy) / displayedH },
    pageBox,
    rotation,
  });

  /*
    HORIZONTAL SCALING (Tz), not a fudged font size, and the difference is not
    cosmetic. `DW 1000` makes the natural advance exactly one em per CID, so
    the run is stretched to match the width of the box OCR measured. Measured:
    with Tz the invisible run's advance lands within 0.9% of the ink box;
    without it, up to 48% short — selection highlights would stop mid-word and
    a drag-select would pick up the wrong glyphs. It also matters for phrase
    search, because a viewer merges adjacent runs into one text item only when
    the advances are right.
  */
  const natural = CidTable.codepointCount(word.text) * size;
  const squeeze = natural > 0 ? (boxW / natural) * 100 : 100;

  return { origin, size, squeeze };
}

/**
 * Append the invisible layer for ONE page.
 *
 * `raster` is the pixel size of the bitmap OCR actually ran on, and it must be
 * the one pdfjs produced from `page.getViewport({ scale })` — because that
 * viewport has ALREADY APPLIED `/Rotate`. The word boxes therefore arrive in
 * the DISPLAYED frame, and `fractionToUserSpace` un-applies it. Handing this
 * function boxes measured on a raster produced any other way puts the text in
 * the wrong place on every rotated page, invisibly.
 */
export function drawInvisibleTextLayer(args: {
  page: PDFPage;
  words: readonly OcrWord[];
  raster: { width: number; height: number };
  table: CidTable;
  fontKey: PDFName;
}): number {
  const { page, words, raster, table, fontKey } = args;
  if (raster.width <= 0 || raster.height <= 0) return 0;

  const pageBox = visiblePageBox({ mediaBox: page.getMediaBox(), cropBox: page.getCropBox() });
  const rotation = normaliseRotation(page.getRotation().angle);

  const right = displayedRightUnit(pageBox, rotation);

  const ops = [pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];

  let drawn = 0;
  for (const word of words) {
    const placed = placeOcrWord({ word, raster, pageBox, rotation });
    if (!placed) continue;
    const { origin, size, squeeze } = placed;

    ops.push(setFontAndSize(fontKey, size));
    ops.push(setCharacterSqueeze(squeeze));
    // Tm = [cos, sin, -sin, cos, e, f], with (cos, sin) = DISPLAYED-right.
    ops.push(setTextMatrix(right.x, right.y, -right.y, right.x, origin.x, origin.y));
    ops.push(showText(table.encode(word.text)));
    drawn += 1;
  }

  ops.push(endText(), popGraphicsState());
  page.pushOperators(...ops);
  return drawn;
}

export interface PageWords {
  readonly page: PDFPage;
  readonly words: readonly OcrWord[];
  readonly raster: { width: number; height: number };
}

/**
 * Add the layer to a whole document: one font for the file, one resource key
 * per page.
 *
 * ⚠ THE PRE-ENCODE PASS BELOW IS LOAD-BEARING AND LOOKS REDUNDANT.
 * `registerGlyphlessFont` serialises the `/ToUnicode` CMap from whatever the
 * table holds AT THAT MOMENT, while `encode()` allocates CIDs lazily. Register
 * the font first and every codepoint that appears afterwards gets a CID with
 * no entry in the CMap — the text is placed correctly, is invisible, and comes
 * out of a copy-paste as nothing at all. Filling the table first is what makes
 * the CMap complete. Deleting the loop leaves a document that looks perfect
 * and yields empty text.
 */
export function addOcrTextLayer(doc: PDFDocument, pages: readonly PageWords[]): number {
  const table = new CidTable();
  for (const { words } of pages) for (const word of words) table.encode(word.text);
  if (table.size === 0) return 0;

  const fontRef = registerGlyphlessFont(doc, table);
  let drawn = 0;
  for (const entry of pages) {
    const fontKey = entry.page.node.newFontDictionary("OCR", fontRef);
    drawn += drawInvisibleTextLayer({ ...entry, table, fontKey });
  }
  return drawn;
}
