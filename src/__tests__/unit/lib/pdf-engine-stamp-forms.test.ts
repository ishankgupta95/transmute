import { describe, it, expect, beforeAll } from "vitest";
import { inflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  StandardFonts,
} from "pdf-lib";

import {
  PDF_FORM_FLATTEN_BLOCKED,
  PDF_FORM_NO_FIELDS,
  STAMP_TEXT_UNSUPPORTED,
  fillPdfForm,
  flattenPdfForm,
  readPdfForm,
  readPdfMetadata,
  removePdfMetadata,
  stampPdf,
  unsupportedStampCharacters,
} from "@/lib/tools/pdf-engine-core";
import type { PdfStamp } from "@/lib/tools/pdf-engine-core";

/*
  Real round trips for the six stamping / form / metadata operations.

  Every test below builds a genuine PDF with pdf-lib, runs the operation on its
  bytes, re-parses what comes back and asserts on the resulting document. The
  core is imported DIRECTLY rather than through `pdf-engine.ts`: these are the
  engine's own behaviours, and going through the barrel would only add the
  worker-routing shim (which falls back to this same code under jsdom) plus a
  pdfjs mock that none of this needs.

  ── TWO METHOD RULES, both learned the expensive way ──

  1. A RAW BYTE GREP OVER A PDF IS UNSOUND. pdf-lib saves with object streams,
     so structure is Flate-compressed, and every string it draws is written as
     a HEX STRING through the font's encoding. MEASURED on the flatten fixture
     below: `Buffer.from(bytes).includes("Ada Lovelace")` is FALSE both before
     AND after flattening, on a document that visibly shows the name. So text
     assertions here inflate the content streams, follow `/Resources /XObject`
     into the appearance streams flatten leaves behind, and compare against
     `winAnsiHex()` — never against the plain string.

     The one place a raw scan is used is the XMP packet, and only with a
     POSITIVE CONTROL in the same test: the marker is asserted present in the
     source bytes before it is asserted absent from the cleaned bytes. Without
     that control "not found" would prove nothing. It is sound there because an
     unfiltered `PDFRawStream` is written verbatim.

  2. AN ASSERTION MUST HAVE ONE LEVER. Each fixture is built so the behaviour
     under test is the only thing that can satisfy the assertion: the tiling
     test pins 12 AND pins 1 for the untiled control on the same page, the
     opacity test reads the exact `/ca` rather than "an ExtGState exists", and
     the `behind` tests compare the stamp's position in `/Contents` against the
     page body's own drawing rather than against a byte count.
*/

// ── Helpers ───────────────────────────────────────────────────────

const A4: [number, number] = [595, 842];

/** Open produced bytes the way a caller would, without pdf-lib restamping /Info. */
function open(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

/**
 * A string as pdf-lib writes it into a content stream.
 *
 * The standard fonts encode WinAnsi, one byte per character for everything
 * these tests draw, and pdf-lib emits the result as an UPPERCASE hex string.
 * `<4452414654>` is "DRAFT". This is the only sound way to look for drawn text.
 *
 * ASCII arguments only. WinAnsi and Latin-1 agree everywhere except 0x80–0x9F,
 * where WinAnsi puts the curly quotes and the em dash — so this shortcut would
 * be wrong for exactly the characters the encoding tests are about, and none of
 * them go through here.
 */
function winAnsiHex(text: string): string {
  return Buffer.from(text, "latin1").toString("hex").toUpperCase();
}

function inflateStream(context: PDFDocument["context"], ref: unknown): string {
  const stream = context.lookup(ref as PDFRef);
  if (!(stream instanceof PDFRawStream)) return "";
  const raw = Buffer.from(stream.getContents());
  try {
    return inflateSync(raw).toString("latin1");
  } catch {
    return raw.toString("latin1");
  }
}

/**
 * One page's content streams, inflated and concatenated IN ORDER.
 *
 * Order is the point for the `behind` tests: pdf-lib's `normalizedEntries()`
 * turns a single `/Contents` stream into an array, so "under the page" means
 * "earlier in this string" and nothing else.
 */
async function pageContent(bytes: Uint8Array, index: number): Promise<string> {
  const doc = await open(bytes);
  const raw = doc.getPage(index).node.get(PDFName.of("Contents"));
  const contents = doc.context.lookup(raw);
  const refs: unknown[] =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : [raw];
  return refs.map((ref) => inflateStream(doc.context, ref)).join("\n");
}

/**
 * Every XObject on a page, keyed by resource name, inflated.
 *
 * Form XObjects — the appearance streams `flatten()` leaves behind — come back
 * as readable operators; an image XObject inflates to sample data, which is
 * harmless noise the callers here only test for the presence of.
 */
async function pageXObjects(
  bytes: Uint8Array,
  index: number,
): Promise<Record<string, string>> {
  const doc = await open(bytes);
  const resources = doc.getPage(index).node.Resources();
  const xObjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const out: Record<string, string> = {};
  if (!xObjects) return out;
  for (const [name, value] of xObjects.entries()) {
    out[name.asString()] = inflateStream(doc.context, value);
  }
  return out;
}

/**
 * The alpha entries of every ExtGState on a page.
 *
 * `/ca` is the FILL alpha and `/CA` the STROKE alpha, and pdf-lib writes only
 * the ones it was given — which is how a fill-only and a stroke-only rectangle
 * are told apart below.
 */
async function alphas(
  bytes: Uint8Array,
  index: number,
): Promise<{ ca?: number; CA?: number }[]> {
  const doc = await open(bytes);
  const resources = doc.getPage(index).node.Resources();
  const states = resources?.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
  if (!states) return [];
  const out: { ca?: number; CA?: number }[] = [];
  for (const [, value] of states.entries()) {
    const dict = doc.context.lookup(value);
    if (!(dict instanceof PDFDict)) continue;
    const entry: { ca?: number; CA?: number } = {};
    const ca = dict.get(PDFName.of("ca"));
    const CA = dict.get(PDFName.of("CA"));
    if (ca instanceof PDFNumber) entry.ca = ca.asNumber();
    if (CA instanceof PDFNumber) entry.CA = CA.asNumber();
    out.push(entry);
  }
  return out;
}

/** Just the `/ca` fill alphas, for the stamps that only have one. */
async function fillAlphas(bytes: Uint8Array, index: number): Promise<number[]> {
  return (await alphas(bytes, index))
    .map((entry) => entry.ca)
    .filter((value): value is number => value !== undefined);
}

/**
 * The six numbers of the first text matrix in a content stream.
 * `cos θ, sin θ, −sin θ, cos θ, x, y` — the stamp's rotation and its origin.
 */
function textMatrix(content: string): number[] {
  const match = content.match(
    /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/,
  );
  if (!match) throw new Error("no Tm operator in content stream");
  return match.slice(1, 7).map(Number);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ── Image fixtures ────────────────────────────────────────────────

/**
 * A real 4×2 RGB PNG. Deliberately NOT square: the image stamp's height is
 * derived from the aspect ratio, so a square fixture would let a broken
 * `image.height / image.width` still produce the expected number.
 */
const PNG_4X2 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAH0lEQVR4nAXBMQEAAAyDMIRNGCeiKnAJ0JE0AjvTZg9cogixVC78TwAAAABJRU5ErkJggg==",
    "base64",
  ),
);

// ── Document fixtures ─────────────────────────────────────────────

/** N blank A4 pages, no /Info, no form. */
async function blankPdf(pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < pages; i++) doc.addPage(A4);
  return doc.save();
}

/**
 * One BLANK A4 page carrying /Rotate on the page dictionary.
 *
 * Blank on purpose: `textMatrix()` reads the first `Tm` in the page, and a page
 * with its own text would hand back the body's matrix instead of the stamp's.
 */
async function rotatedBlankPdf(angle: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage(A4).node.set(PDFName.of("Rotate"), PDFNumber.of(angle));
  return doc.save();
}

/**
 * One A4 page carrying a line of its own text.
 *
 * The body is what the `behind` assertions measure against: "under the page
 * content" is only meaningful relative to content the page already had.
 */
async function pdfWithBody(text = "body"): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(A4);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 30, y: 30, size: 10, font });
  return doc.save();
}

interface FormFixtureOptions {
  /** Add a /Sig field by hand — pdf-lib has no API to create one. */
  signature?: boolean;
  /** Add a radio group and then delete its widgets' /AP, the documented case. */
  brokenRadio?: boolean;
  /**
   * Add a field whose /AP dictionary EXISTS but carries no /N.
   *
   * A separate shape from `brokenRadio`, and worth its own fixture: a check
   * that stops at "is there an /AP?" passes this document and then dies inside
   * `flatten()` with `Unexpected N type: undefined`. Deleting the whole /AP
   * cannot tell the two checks apart.
   */
  appearanceWithoutN?: boolean;
}

/**
 * A form carrying one field of every kind pdf-lib can build, with the text
 * field's flags set so the report's `multiline` / `maxLength` / `required` /
 * `readOnly` columns have something to be wrong about.
 */
async function formPdf(options: FormFixtureOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage(A4);
  const form = doc.getForm();

  const who = form.createTextField("who");
  who.setText("Ada Lovelace");
  who.enableMultiline();
  who.setMaxLength(40);
  who.enableRequired();
  who.addToPage(page, { x: 20, y: 700, width: 240, height: 40 });

  const locked = form.createTextField("reference");
  locked.setText("AL-1843");
  locked.enableReadOnly();
  locked.addToPage(page, { x: 20, y: 660, width: 160, height: 20 });

  const agree = form.createCheckBox("agree");
  agree.check();
  agree.addToPage(page, { x: 20, y: 620, width: 18, height: 18 });

  const plan = form.createRadioGroup("plan");
  plan.addOptionToPage("basic", page, { x: 20, y: 580, width: 18, height: 18 });
  plan.addOptionToPage("pro", page, { x: 60, y: 580, width: 18, height: 18 });
  plan.select("pro");

  const city = form.createDropdown("city");
  city.setOptions(["London", "Paris", "Turin"]);
  city.select("Paris");
  city.addToPage(page, { x: 20, y: 540, width: 140, height: 20 });

  const langs = form.createOptionList("langs");
  langs.setOptions(["ada", "lisp", "rust"]);
  langs.select(["ada", "rust"]);
  langs.addToPage(page, { x: 20, y: 460, width: 140, height: 60 });

  const go = form.createButton("go");
  go.addToPage("Go", page, { x: 20, y: 420, width: 60, height: 20 });

  if (options.brokenRadio) {
    const orphan = form.createRadioGroup("delivery");
    orphan.addOptionToPage("post", page, { x: 20, y: 380, width: 18, height: 18 });
    for (const widget of orphan.acroField.getWidgets()) {
      widget.dict.delete(PDFName.of("AP"));
    }
  }

  if (options.appearanceWithoutN) {
    const stray = form.createTextField("stray");
    stray.setText("no appearance");
    stray.addToPage(page, { x: 20, y: 340, width: 160, height: 20 });
  }

  if (options.signature) {
    // pdf-lib exposes no `createSignature`, so the widget is written by hand:
    // /FT /Sig with no /AP at all, which is exactly the shape flatten() dies on.
    const sig = doc.context.obj({
      FT: PDFName.of("Sig"),
      T: PDFHexString.fromText("countersign"),
      Type: PDFName.of("Annot"),
      Subtype: PDFName.of("Widget"),
      Rect: doc.context.obj([20, 300, 220, 360]),
      F: PDFNumber.of(4),
      P: page.ref,
    }) as PDFDict;
    const ref = doc.context.register(sig);
    page.node.addAnnot(ref);
    const acroForm = doc.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    acroForm.lookup(PDFName.of("Fields"), PDFArray).push(ref);
  }

  const bytes = await doc.save();
  if (!options.appearanceWithoutN) return bytes;

  /*
    The /AP surgery has to happen on a SECOND pass, after a reload.

    MEASURED: `PDFDocument.save()` defaults to `updateFieldAppearances: true`,
    which regenerates the appearance of every field marked dirty — and
    `setText` marks it dirty. Emptying the /AP before that save is undone by
    it, and the fixture silently comes back healthy. After a reload no field is
    dirty, so the surgery survives.

    (`brokenRadio` above needs no such dance and that is not luck: pdf-lib's
    radio `updateAppearances` reads the widget's on-value out of /AP /N, so
    with /AP gone it has nothing to key on and skips the widget — which is
    exactly the shape the engine documents.)
  */
  const again = await open(bytes);
  for (const widget of again.getForm().getTextField("stray").acroField.getWidgets()) {
    widget.dict.set(PDFName.of("AP"), again.context.obj({}) as PDFDict);
  }
  return again.save({ updateFieldAppearances: false });
}

/**
 * A document carrying /Info AND three XMP packets: one on the catalog, one on
 * the page, one on an image XObject.
 *
 * ⚠ TWO SAVES, and the second one is load-bearing. MEASURED: `embedPng` only
 * RESERVES a ref (`context.nextRef()`) and queues the embedder; the image
 * stream is not assigned to that ref until `save()` runs `flush()`. So before
 * the first save `context.lookup(imageRef)` is `undefined`, and any attempt to
 * hang `/Metadata` on the image silently does nothing. A one-pass fixture
 * produces TWO XMP streams and quietly agrees with a broken engine — the same
 * false negative this file's header warns about, in fixture form.
 */
async function metadataPdf(): Promise<Uint8Array> {
  const first = await PDFDocument.create({ updateMetadata: false });
  const page = first.addPage(A4);
  const font = await first.embedFont(StandardFonts.Helvetica);
  page.drawText("body", { x: 30, y: 30, size: 10, font });
  page.drawImage(await first.embedPng(PNG_4X2), { x: 10, y: 700, width: 80, height: 40 });
  first.setTitle("Quarterly numbers");
  first.setAuthor("Ada Lovelace");
  first.setSubject("Internal");
  first.setKeywords(["draft", "private"]);
  first.setCreator("Analytical Engine");
  first.setProducer("Widget Suite 9");
  first.setCreationDate(new Date("2020-01-02T03:04:05Z"));
  first.setModificationDate(new Date("2021-06-07T08:09:10Z"));

  const doc = await open(await first.save());
  const packet = (label: string): PDFRef =>
    doc.context.register(
      PDFRawStream.of(
        doc.context.obj({
          Type: PDFName.of("Metadata"),
          Subtype: PDFName.of("XML"),
        }) as PDFDict,
        new TextEncoder().encode(
          `<?xpacket begin="" id="${XMP_MARKER}"?><x:xmpmeta xmlns:x="adobe:ns:meta/">` +
            `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
            `<rdf:Description dc:title="${label}"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`,
        ),
      ),
    );

  doc.catalog.set(PDFName.of("Metadata"), packet("catalog"));
  const leaf = doc.getPage(0);
  leaf.node.set(PDFName.of("Metadata"), packet("page"));
  const xObjects = leaf.node.Resources()?.lookup(PDFName.of("XObject"), PDFDict);
  for (const [, value] of xObjects?.entries() ?? []) {
    const stream = doc.context.lookup(value);
    if (stream instanceof PDFRawStream) {
      stream.dict.set(PDFName.of("Metadata"), packet("image"));
    }
  }
  return doc.save();
}

/** The XMP packet id, used as the positive-control marker in the byte scan. */
const XMP_MARKER = "W5M0MpCehiHzreSzNTczkc9d";

// ── Stamp builders ────────────────────────────────────────────────

function textStamp(overrides: Partial<Extract<PdfStamp, { kind: "text" }>> = {}) {
  return {
    kind: "text" as const,
    pages: "all" as const,
    at: { x: 0.5, y: 0.5 },
    opacity: 1,
    rotate: 0,
    text: "DRAFT",
    size: 40,
    colour: "#000000",
    bold: false,
    behind: false,
    tile: false,
    ...overrides,
  };
}

function rectStamp(overrides: Partial<Extract<PdfStamp, { kind: "rect" }>> = {}) {
  return {
    kind: "rect" as const,
    pages: "all" as const,
    at: { x: 0.2, y: 0.3 },
    opacity: 1,
    rotate: 0,
    size: { width: 0.4, height: 0.1 },
    strokeWidth: 2,
    ...overrides,
  };
}

function imageStamp(overrides: Partial<Extract<PdfStamp, { kind: "image" }>> = {}) {
  return {
    kind: "image" as const,
    pages: "all" as const,
    at: { x: 0.5, y: 0.5 },
    opacity: 1,
    rotate: 0,
    bytes: PNG_4X2,
    type: "image/png",
    widthFraction: 0.1,
    behind: false,
    tile: false,
    ...overrides,
  };
}

/*
  ⚠ `unsupportedStampCharacters` reads a module-level probe font that ONLY
  `stampPdf` builds (`ensureProbeFont`), and it is synchronous, so on a cold
  module every character comes back unsupported — MEASURED:
  `unsupportedStampCharacters("hello")` returns `["h","e","l","o"]` before any
  stamp has run. Priming here keeps these tests independent of file order.
  It is also a real hazard for any caller that pre-flights before stamping;
  reported to the owner rather than pinned as expected behaviour here.
*/
beforeAll(async () => {
  await stampPdf(await blankPdf(1), [textStamp({ text: "prime" })]);
});

// ══ stampPdf ══════════════════════════════════════════════════════

describe("stampPdf — text stamps", () => {
  it("draws the text, at the fraction asked for, in the colour asked for", async () => {
    const out = await stampPdf(await blankPdf(1), [
      textStamp({ text: "DRAFT", at: { x: 0.25, y: 0.5 }, colour: "#ff0080" }),
    ]);
    const content = await pageContent(out, 0);

    expect(content).toContain(`<${winAnsiHex("DRAFT")}> Tj`);
    // #ff0080 → 255/255, 0/255, 128/255 as a non-stroking RGB fill.
    expect(content).toContain(`1 0 ${128 / 255} rg`);
    // A4 is 595×842 with a zero origin: x runs across, y is flipped because
    // the fraction counts DOWN from the top and user space counts up.
    const [, , , , x, y] = textMatrix(content);
    expect(x).toBeCloseTo(0.25 * 595, 6);
    expect(y).toBeCloseTo(0.5 * 842, 6);
  });

  it("embeds the bold face only when bold is asked for", async () => {
    const boldOut = await stampPdf(await blankPdf(1), [textStamp({ bold: true })]);
    const plainOut = await stampPdf(await blankPdf(1), [textStamp({ bold: false })]);

    expect(await pageContent(boldOut, 0)).toMatch(/\/Helvetica-Bold-\d+ 40 Tf/);
    expect(await pageContent(plainOut, 0)).toMatch(/\/Helvetica-\d+ 40 Tf/);
    expect(await pageContent(plainOut, 0)).not.toContain("Helvetica-Bold");
  });
});

describe("stampPdf — page targeting", () => {
  const mark = `<${winAnsiHex("MARK")}> Tj`;

  async function stampedPages(pages: PdfStamp["pages"], pageCount = 4): Promise<number[]> {
    const out = await stampPdf(await blankPdf(pageCount), [
      textStamp({ text: "MARK", pages }),
    ]);
    const hit: number[] = [];
    for (let i = 0; i < pageCount; i++) {
      if ((await pageContent(out, i)).includes(mark)) hit.push(i);
    }
    return hit;
  }

  it('"all" stamps every page', async () => {
    expect(await stampedPages("all")).toEqual([0, 1, 2, 3]);
  });

  it('"first" stamps only the first page', async () => {
    expect(await stampedPages("first")).toEqual([0]);
  });

  it('"last" stamps only the final page', async () => {
    expect(await stampedPages("last")).toEqual([3]);
  });

  it("an explicit list stamps exactly those 0-based pages", async () => {
    expect(await stampedPages([1, 3])).toEqual([1, 3]);
  });

  it("a repeated index still stamps that page once", async () => {
    const out = await stampPdf(await blankPdf(2), [
      textStamp({ text: "MARK", pages: [1, 1, 1] }),
    ]);
    expect(count(await pageContent(out, 1), mark)).toBe(1);
    expect(await pageContent(out, 0)).not.toContain(mark);
  });

  it("drops an out-of-range or negative index instead of throwing", async () => {
    const out = await stampPdf(await blankPdf(2), [
      textStamp({ text: "MARK", pages: [-1, 0, 7] }),
    ]);
    expect(await pageContent(out, 0)).toContain(mark);
    expect(await pageContent(out, 1)).not.toContain(mark);
  });

  it("stamps nothing, and does not throw, when every index is out of range", async () => {
    const out = await stampPdf(await blankPdf(2), [
      textStamp({ text: "MARK", pages: [9, 10] }),
    ]);
    expect(await pageContent(out, 0)).not.toContain(mark);
    expect(await pageContent(out, 1)).not.toContain(mark);
  });
});

describe("stampPdf — tiling", () => {
  it("repeats the mark 12 times, against an untiled control of 1", async () => {
    const mark = `<${winAnsiHex("TILE")}> Tj`;

    const tiled = await stampPdf(await blankPdf(1), [
      textStamp({ text: "TILE", tile: true }),
    ]);
    const single = await stampPdf(await blankPdf(1), [
      textStamp({ text: "TILE", tile: false }),
    ]);

    // Both numbers matter: 12 alone could be satisfied by a stamp drawn twelve
    // times for some other reason, and 1 alone says nothing about the grid.
    expect(count(await pageContent(tiled, 0), mark)).toBe(12);
    expect(count(await pageContent(single, 0), mark)).toBe(1);
  });

  it("tiles an image stamp too, at twelve distinct positions", async () => {
    const out = await stampPdf(await blankPdf(1), [imageStamp({ tile: true })]);
    const content = await pageContent(out, 0);

    expect((content.match(/\/Image-\d+ Do/g) ?? []).length).toBe(12);
    // Distinct positions, not just twelve draws. The identity matrices pdf-lib
    // emits for the zero rotation and zero skew are dropped first — they are
    // `1 0 0 1 0 0 cm` on every draw and would collapse to one entry.
    const translations = new Set(
      (content.match(/1 0 0 1 [\d.]+ [\d.]+ cm/g) ?? []).filter(
        (op) => op !== "1 0 0 1 0 0 cm",
      ),
    );
    expect(translations.size).toBe(12);
  });
});

describe("stampPdf — opacity and rotation", () => {
  it("writes the requested opacity into the page's ExtGState", async () => {
    const out = await stampPdf(await blankPdf(1), [textStamp({ opacity: 0.35 })]);

    expect(await fillAlphas(out, 0)).toEqual([0.35]);
    expect(await pageContent(out, 0)).toMatch(/\/GS-\d+ gs/);
  });

  it("carries a different opacity per stamp on the same page", async () => {
    const out = await stampPdf(await blankPdf(1), [
      textStamp({ text: "ONE", opacity: 0.2 }),
      textStamp({ text: "TWO", opacity: 0.8 }),
    ]);
    expect((await fillAlphas(out, 0)).sort()).toEqual([0.2, 0.8]);
  });

  it("writes the requested rotation into the text matrix", async () => {
    const turned = await stampPdf(await blankPdf(1), [textStamp({ rotate: 30 })]);
    const straight = await stampPdf(await blankPdf(1), [textStamp({ rotate: 0 })]);

    const [a, b, c, d] = textMatrix(await pageContent(turned, 0));
    expect(a).toBeCloseTo(Math.cos(Math.PI / 6), 6);
    expect(b).toBeCloseTo(Math.sin(Math.PI / 6), 6);
    expect(c).toBeCloseTo(-Math.sin(Math.PI / 6), 6);
    expect(d).toBeCloseTo(Math.cos(Math.PI / 6), 6);

    expect(textMatrix(await pageContent(straight, 0)).slice(0, 4)).toEqual([1, 0, 0, 1]);
  });

  it("composes the stamp's rotation with the page's own /Rotate", async () => {
    // A user asking for 0° on a page the reader turns 90° means 0° AS SEEN,
    // which is 90° in the page's un-turned user space.
    const out = await stampPdf(await rotatedBlankPdf(90), [textStamp({ rotate: 0 })]);
    const [a, b] = textMatrix(await pageContent(out, 0));
    expect(a).toBeCloseTo(0, 6);
    expect(b).toBeCloseTo(1, 6);

    // The control: the same stamp on an unturned page is not rotated at all.
    const flat = await stampPdf(await blankPdf(1), [textStamp({ rotate: 0 })]);
    expect(textMatrix(await pageContent(flat, 0)).slice(0, 4)).toEqual([1, 0, 0, 1]);
  });
});

describe("stampPdf — behind", () => {
  const body = `<${winAnsiHex("body")}> Tj`;
  const mark = `<${winAnsiHex("OVER")}> Tj`;

  it("behind: true puts the mark BEFORE the page body in /Contents", async () => {
    const out = await stampPdf(await pdfWithBody(), [
      textStamp({ text: "OVER", behind: true }),
    ]);
    const content = await pageContent(out, 0);

    expect(content).toContain(mark);
    expect(content).toContain(body);
    expect(content.indexOf(mark)).toBeLessThan(content.indexOf(body));
  });

  it("behind: false puts the mark AFTER the page body in /Contents", async () => {
    const out = await stampPdf(await pdfWithBody(), [
      textStamp({ text: "OVER", behind: false }),
    ]);
    const content = await pageContent(out, 0);

    expect(content).toContain(mark);
    expect(content).toContain(body);
    expect(content.indexOf(mark)).toBeGreaterThan(content.indexOf(body));
  });

  it("moves all twelve tiles under the body, not just the first", async () => {
    const out = await stampPdf(await pdfWithBody(), [
      textStamp({ text: "OVER", behind: true, tile: true }),
    ]);
    const content = await pageContent(out, 0);

    expect(count(content, mark)).toBe(12);
    expect(content.lastIndexOf(mark)).toBeLessThan(content.indexOf(body));
  });
});

describe("stampPdf — image stamps", () => {
  it("embeds the image and sizes it from the page width and the aspect ratio", async () => {
    const out = await stampPdf(await blankPdf(1), [
      imageStamp({ at: { x: 0.5, y: 0.5 }, widthFraction: 0.1 }),
    ]);
    const content = await pageContent(out, 0);

    // 0.1 × 595 = 59.5 wide; the PNG is 4×2, so it is half as tall: 29.75.
    // A square fixture could not tell a correct ratio from a dropped one.
    expect(content).toContain("59.5 0 0 29.75 0 0 cm");
    // Fractions are top-left anchored and a PDF draws an image from its
    // BOTTOM left, so the origin drops by the drawn height: 421 − 29.75.
    expect(content).toContain(`1 0 0 1 ${0.5 * 595} ${0.5 * 842 - 29.75} cm`);
    expect(content).toMatch(/\/Image-\d+ Do/);
  });

  it("honours widthFraction", async () => {
    const wide = await stampPdf(await blankPdf(1), [imageStamp({ widthFraction: 0.5 })]);
    expect(await pageContent(wide, 0)).toContain("297.5 0 0 148.75 0 0 cm");
  });

  it("places an image stamp behind the page body when asked", async () => {
    const out = await stampPdf(await pdfWithBody(), [imageStamp({ behind: true })]);
    const content = await pageContent(out, 0);

    expect(content).toMatch(/\/Image-\d+ Do/);
    expect(content.search(/\/Image-\d+ Do/)).toBeLessThan(
      content.indexOf(`<${winAnsiHex("body")}> Tj`),
    );
  });
});

describe("stampPdf — rectangle stamps", () => {
  it("sizes the rectangle from the displayed page and drops it by its height", async () => {
    const out = await stampPdf(await blankPdf(1), [
      rectStamp({ at: { x: 0.2, y: 0.3 }, size: { width: 0.4, height: 0.1 }, fill: "#ffff00" }),
    ]);
    const content = await pageContent(out, 0);

    // 0.4 × 595 = 238 wide, 0.1 × 842 = 84.2 tall; the anchor is top-left, so
    // the lower-left corner is 842 − 0.3 × 842 − 84.2 = 505.19999999999993.
    expect(content).toContain("0 84.2 l");
    expect(content).toContain("238 84.2 l");
    expect(content).toContain(`1 0 0 1 ${0.2 * 595} ${842 - 0.3 * 842 - 84.2} cm`);
    // #ffff00 fills, and nothing was asked to stroke.
    expect(content).toContain("1 1 0 rg");
    expect(content).not.toContain("RG");
  });

  it("strokes without filling when only a stroke colour is given", async () => {
    const out = await stampPdf(await blankPdf(1), [
      rectStamp({ stroke: "#0000ff", strokeWidth: 3 }),
    ]);
    const content = await pageContent(out, 0);

    expect(content).toContain("0 0 1 RG");
    expect(content).toContain("3 w");
    expect(content).not.toMatch(/ rg\n/);
    // Stroke alpha only: a fill-only ExtGState would be the wrong operator on
    // an outline the user asked to see through.
    expect(await alphas(out, 0)).toEqual([{ CA: 1 }]);
  });

  it("fills AND strokes when both colours are given, with one alpha for each", async () => {
    const out = await stampPdf(await blankPdf(1), [
      rectStamp({ fill: "#ff0000", stroke: "#00ff00", opacity: 0.5 }),
    ]);
    const content = await pageContent(out, 0);

    expect(content).toContain("1 0 0 rg");
    expect(content).toContain("0 1 0 RG");
    expect(await alphas(out, 0)).toEqual([{ ca: 0.5, CA: 0.5 }]);
  });

  it("draws a border width of zero when no stroke colour is given", async () => {
    // strokeWidth is carried on every rect, so a fill-only mark would otherwise
    // pick up an outline the user never asked for.
    const out = await stampPdf(await blankPdf(1), [
      rectStamp({ fill: "#000000", strokeWidth: 8 }),
    ]);
    expect(await pageContent(out, 0)).toContain("0 w");
  });

  it("is always drawn OVER the page content — a rect carries no behind flag", async () => {
    // `PdfRectStamp` has neither `behind` nor `tile`, so an annotation mark
    // cannot be hidden under the text and cannot be tiled. Copy that promises
    // either would be wrong.
    const out = await stampPdf(await pdfWithBody(), [rectStamp({ fill: "#ffff00" })]);
    const content = await pageContent(out, 0);

    expect(content.indexOf("1 1 0 rg")).toBeGreaterThan(
      content.indexOf(`<${winAnsiHex("body")}> Tj`),
    );
  });
});

// ══ unsupportedStampCharacters ════════════════════════════════════

describe("unsupportedStampCharacters", () => {
  it("accepts the Latin text people actually paste", () => {
    // Accented letters, curly quotes, an em dash and the euro sign all encode
    // in WinAnsi. Refusing them would be the false positive that makes the
    // pre-flight useless.
    expect(unsupportedStampCharacters("Café — “Naïve” résumé €5 · ½")).toEqual([]);
    expect(unsupportedStampCharacters("ABC abc 0123 !?@#&*()[]{}<>/\\|+=~^")).toEqual([]);
  });

  it("ignores line breaks rather than reporting them", () => {
    expect(unsupportedStampCharacters("line one\r\nline two")).toEqual([]);
  });

  it("reports CJK, Cyrillic, Arabic and emoji, in the order they appear", () => {
    expect(unsupportedStampCharacters("a日b Привет مرحبا 😀")).toEqual([
      "日",
      "П",
      "р",
      "и",
      "в",
      "е",
      "т",
      "م",
      "ر",
      "ح",
      "ب",
      "ا",
      "😀",
    ]);
  });

  it("reports a repeated character once", () => {
    expect(unsupportedStampCharacters("日日日本")).toEqual(["日", "本"]);
  });

  it("treats an emoji as one character, not two surrogates", () => {
    const bad = unsupportedStampCharacters("😀");
    expect(bad).toHaveLength(1);
    expect(bad[0]).toBe("😀");
  });
});

describe("stampPdf — refusing text it cannot draw", () => {
  it("throws a sentence naming every character it cannot draw", async () => {
    await expect(
      stampPdf(await blankPdf(1), [textStamp({ text: "承認済み" })]),
    ).rejects.toThrow(`${STAMP_TEXT_UNSUPPORTED} "承", "認", "済", "み".`);
  });

  it("refuses BEFORE drawing anything, even when the bad stamp is the last one", async () => {
    // Validation runs over every stamp first, so a call whose FIRST stamp is
    // drawable still comes back empty-handed rather than half-applied — pdf-lib
    // would otherwise throw again from save() on a part-written document.
    const source = await blankPdf(1);
    await expect(
      stampPdf(source, [textStamp({ text: "OK" }), textStamp({ text: "Привет" })]),
    ).rejects.toThrow(STAMP_TEXT_UNSUPPORTED);
  });

  it("stamps the same text happily once the unsupported characters are gone", async () => {
    const out = await stampPdf(await blankPdf(1), [textStamp({ text: "Approved" })]);
    expect(await pageContent(out, 0)).toContain(`<${winAnsiHex("Approved")}> Tj`);
  });
});

// ══ readPdfForm ═══════════════════════════════════════════════════

describe("readPdfForm", () => {
  it("classifies every field kind, with its value and its options", async () => {
    const report = await readPdfForm(await formPdf());

    expect(report.hasForm).toBe(true);
    const byName = Object.fromEntries(report.fields.map((f) => [f.name, f]));

    expect(byName.who.kind).toBe("text");
    expect(byName.who.value).toBe("Ada Lovelace");
    expect(byName.who.options).toEqual([]);

    expect(byName.agree.kind).toBe("checkbox");
    expect(byName.agree.value).toBe(true);

    expect(byName.plan.kind).toBe("radio");
    expect(byName.plan.value).toBe("pro");
    expect(byName.plan.options).toEqual(["basic", "pro"]);

    expect(byName.city.kind).toBe("dropdown");
    expect(byName.city.value).toEqual(["Paris"]);
    expect(byName.city.options).toEqual(["London", "Paris", "Turin"]);

    expect(byName.langs.kind).toBe("optionlist");
    expect(byName.langs.value).toEqual(["ada", "rust"]);
    expect(byName.langs.options).toEqual(["ada", "lisp", "rust"]);

    expect(byName.go.kind).toBe("button");
    expect(byName.go.value).toBeNull();
    expect(byName.go.options).toEqual([]);
  });

  it("classifies a /Sig field as a signature with no value", async () => {
    const report = await readPdfForm(await formPdf({ signature: true }));
    const sig = report.fields.find((f) => f.name === "countersign");

    expect(sig?.kind).toBe("signature");
    expect(sig?.value).toBeNull();
  });

  it("reports the text field's flags and the page its widgets sit on", async () => {
    const report = await readPdfForm(await formPdf());
    const byName = Object.fromEntries(report.fields.map((f) => [f.name, f]));

    expect(byName.who.multiline).toBe(true);
    expect(byName.who.maxLength).toBe(40);
    expect(byName.who.required).toBe(true);
    expect(byName.who.readOnly).toBe(false);
    expect(byName.who.pageIndices).toEqual([0]);

    expect(byName.reference.readOnly).toBe(true);
    expect(byName.reference.multiline).toBe(false);
    expect(byName.reference.maxLength).toBeNull();
  });

  it("reports hasForm: false for a document with no /AcroForm", async () => {
    const report = await readPdfForm(await blankPdf(2));

    expect(report.hasForm).toBe(false);
    expect(report.fields).toEqual([]);
    expect(report.flattenBlockedBy).toEqual([]);
    expect(report.needAppearances).toBe(false);
  });

  it("does not let getForm() invent an /AcroForm on a document that has none", async () => {
    // getForm() CREATES the dictionary as a side effect, so reading the
    // catalog first is the whole reason hasForm is trustworthy. Reading twice
    // is the check that the first read did not change the answer.
    const bytes = await blankPdf(1);
    expect((await readPdfForm(bytes)).hasForm).toBe(false);
    expect((await readPdfForm(bytes)).hasForm).toBe(false);

    const doc = await open(bytes);
    expect(doc.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  });

  it("names the signature field as the reason flatten is blocked", async () => {
    const report = await readPdfForm(await formPdf({ signature: true }));

    expect(report.flattenBlockedBy).toEqual(["countersign"]);
    expect(report.fields.find((f) => f.name === "countersign")?.brokenWidgets).toBe(1);
    // The fields pdf-lib CAN regenerate must not be swept up with it.
    expect(report.fields.find((f) => f.name === "who")?.brokenWidgets).toBe(0);
  });

  it("names a radio group whose widgets lost their /AP", async () => {
    const report = await readPdfForm(await formPdf({ brokenRadio: true }));

    expect(report.flattenBlockedBy).toEqual(["delivery"]);
    // The intact radio group in the same document stays clear of the list.
    expect(report.fields.find((f) => f.name === "plan")?.brokenWidgets).toBe(0);
  });

  it("names a widget whose /AP dictionary carries no /N", async () => {
    // "Has an /AP" is not the question — `flatten()` reads /AP /N, and this is
    // the document that separates the two checks.
    const report = await readPdfForm(await formPdf({ appearanceWithoutN: true }));

    expect(report.flattenBlockedBy).toEqual(["stray"]);
    expect(report.fields.find((f) => f.name === "stray")?.brokenWidgets).toBe(1);
  });

  it("reports nothing blocked on a form pdf-lib can draw in full", async () => {
    expect((await readPdfForm(await formPdf())).flattenBlockedBy).toEqual([]);
  });
});

// ══ fillPdfForm ═══════════════════════════════════════════════════

describe("fillPdfForm", () => {
  it("sets every field kind and reads the new value back", async () => {
    const out = await fillPdfForm(await formPdf(), {
      who: "Grace Hopper",
      agree: false,
      plan: "basic",
      city: "Turin",
      langs: ["lisp"],
    });
    const byName = Object.fromEntries(
      (await readPdfForm(out)).fields.map((f) => [f.name, f]),
    );

    expect(byName.who.value).toBe("Grace Hopper");
    expect(byName.agree.value).toBe(false);
    expect(byName.plan.value).toBe("basic");
    expect(byName.city.value).toEqual(["Turin"]);
    expect(byName.langs.value).toEqual(["lisp"]);
  });

  it("selects several options at once in an option list", async () => {
    const out = await fillPdfForm(await formPdf(), { langs: ["ada", "lisp"] });
    const langs = (await readPdfForm(out)).fields.find((f) => f.name === "langs");

    expect(langs?.value).toEqual(["ada", "lisp"]);
  });

  it("leaves the fields it was not given alone", async () => {
    const out = await fillPdfForm(await formPdf(), { who: "Grace Hopper" });
    const byName = Object.fromEntries(
      (await readPdfForm(out)).fields.map((f) => [f.name, f]),
    );

    expect(byName.city.value).toEqual(["Paris"]);
    expect(byName.agree.value).toBe(true);
    expect(byName.plan.value).toBe("pro");
  });

  it("ignores a name that is not a field in this document", async () => {
    const out = await fillPdfForm(await formPdf(), {
      who: "Grace Hopper",
      "no-such-field": "ignored",
    });
    const report = await readPdfForm(out);

    expect(report.fields.map((f) => f.name)).not.toContain("no-such-field");
    expect(report.fields.find((f) => f.name === "who")?.value).toBe("Grace Hopper");
  });

  it("without flatten, the form is still a form", async () => {
    const out = await fillPdfForm(await formPdf(), { who: "Grace Hopper" });
    const report = await readPdfForm(out);

    expect(report.hasForm).toBe(true);
    expect(report.fields.length).toBeGreaterThan(0);
  });

  it("with flatten: true, the value is drawn into the page and the fields are gone", async () => {
    const out = await fillPdfForm(
      await formPdf(),
      { who: "Grace Hopper" },
      { flatten: true },
    );

    expect((await readPdfForm(out)).fields).toEqual([]);
    // The value lives in the widget's appearance stream, hex-encoded — the
    // raw-byte scan the header warns about would report a false negative.
    const drawn = Object.values(await pageXObjects(out, 0)).join("\n");
    expect(drawn).toContain(winAnsiHex("Grace Hopper"));
    expect(drawn).not.toContain(winAnsiHex("Ada Lovelace"));
  });

  it("refuses a document with no form", async () => {
    await expect(fillPdfForm(await blankPdf(1), { who: "Grace" })).rejects.toThrow(
      PDF_FORM_NO_FIELDS,
    );
  });

  it("refuses to flatten a form with an unrenderable field", async () => {
    await expect(
      fillPdfForm(await formPdf({ signature: true }), { who: "Grace" }, { flatten: true }),
    ).rejects.toThrow(PDF_FORM_FLATTEN_BLOCKED);
  });

  it("still fills that same document when flatten is not asked for", async () => {
    // The refusal is about flattening, not about the document: a blocked form
    // must stay fillable, or the tool would dead-end on a file it can serve.
    const out = await fillPdfForm(await formPdf({ signature: true }), { who: "Grace" });
    const who = (await readPdfForm(out)).fields.find((f) => f.name === "who");

    expect(who?.value).toBe("Grace");
  });
});

// ══ flattenPdfForm ════════════════════════════════════════════════

describe("flattenPdfForm", () => {
  it("bakes the stored value into the page and empties getFields()", async () => {
    const out = await flattenPdfForm(await formPdf());
    const report = await readPdfForm(out);

    expect(report.fields).toEqual([]);
    expect(report.flattenBlockedBy).toEqual([]);

    const content = await pageContent(out, 0);
    expect(content).toMatch(/\/FlatWidget-\d+ Do/);

    const drawn = Object.values(await pageXObjects(out, 0)).join("\n");
    expect(drawn).toContain(winAnsiHex("Ada Lovelace"));
    expect(drawn).toContain(winAnsiHex("AL-1843"));
    expect(drawn).toContain(winAnsiHex("Paris"));
  });

  it("a raw byte scan of the flattened file finds nothing — the control for the test above", async () => {
    // Documented on purpose: this is the assertion that must NOT be written.
    // The name is visible in the flattened document and absent from its bytes.
    const out = await flattenPdfForm(await formPdf());
    expect(Buffer.from(out).includes("Ada Lovelace")).toBe(false);
  });

  it("draws one appearance per widget, not one per field", async () => {
    // The radio group has two widgets, so a per-field loop would lose one.
    const out = await flattenPdfForm(await formPdf());
    const names = Object.keys(await pageXObjects(out, 0));

    expect(names.filter((n) => n.startsWith("/FlatWidget")).length).toBe(8);
  });

  it("keeps the page's own content", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const page = doc.addPage(A4);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("body", { x: 30, y: 30, size: 10, font });
    const field = doc.getForm().createTextField("who");
    field.setText("Ada Lovelace");
    field.addToPage(page, { x: 20, y: 700, width: 200, height: 20 });

    const out = await flattenPdfForm(await doc.save());
    expect(await pageContent(out, 0)).toContain(`<${winAnsiHex("body")}> Tj`);
  });

  it("refuses a document with no form", async () => {
    await expect(flattenPdfForm(await blankPdf(1))).rejects.toThrow(PDF_FORM_NO_FIELDS);
  });

  it("refuses a form carrying a signature field rather than half-flattening it", async () => {
    const bytes = await formPdf({ signature: true });
    await expect(flattenPdfForm(bytes)).rejects.toThrow(PDF_FORM_FLATTEN_BLOCKED);

    // Look-before-leaping means the source is still readable afterwards.
    expect((await readPdfForm(bytes)).fields.length).toBeGreaterThan(0);
  });

  it("refuses a form whose radio widgets lost their /AP", async () => {
    await expect(flattenPdfForm(await formPdf({ brokenRadio: true }))).rejects.toThrow(
      PDF_FORM_FLATTEN_BLOCKED,
    );
  });

  it("refuses a form whose widget has an /AP but no /N inside it", async () => {
    await expect(
      flattenPdfForm(await formPdf({ appearanceWithoutN: true })),
    ).rejects.toThrow(PDF_FORM_FLATTEN_BLOCKED);
  });
});

// ══ readPdfMetadata / removePdfMetadata ═══════════════════════════

describe("readPdfMetadata", () => {
  it("reports the eight standard /Info entries", async () => {
    const report = await readPdfMetadata(await metadataPdf());

    expect(report.info.Title).toBe("Quarterly numbers");
    expect(report.info.Author).toBe("Ada Lovelace");
    expect(report.info.Subject).toBe("Internal");
    expect(report.info.Keywords).toContain("draft");
    expect(report.info.Creator).toBe("Analytical Engine");
    expect(report.info.Producer).toBe("Widget Suite 9");
    expect(report.info.CreationDate).toContain("2020");
    expect(report.info.ModDate).toContain("2021");
  });

  it("omits /Info keys the document does not carry", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage(A4);
    doc.setTitle("Only a title");
    const report = await readPdfMetadata(await doc.save());

    expect(report.info).toEqual({ Title: "Only a title" });
    expect(report.xmpStreams).toBe(0);
  });

  it("counts the XMP packets on the catalog, the page AND the image XObject", async () => {
    // Three, not one: XMP is not only a catalog thing, and a photograph placed
    // into a PDF commonly brings its own packet with it.
    expect((await readPdfMetadata(await metadataPdf())).xmpStreams).toBe(3);
  });

  it("changes nothing — the same bytes read twice give the same report", async () => {
    const bytes = await metadataPdf();
    expect(await readPdfMetadata(bytes)).toEqual(await readPdfMetadata(bytes));
  });
});

describe("removePdfMetadata", () => {
  it("removes every /Info entry rather than blanking it", async () => {
    const out = await removePdfMetadata(await metadataPdf());
    const report = await readPdfMetadata(out);

    expect(report.info).toEqual({});

    // Blanked is not removed: pdf-lib's setters write <FEFF>, a lone byte-order
    // mark, so an emptied /Title is still a /Title. Check the dictionary, not
    // the report, or an empty-string value would read the same as an absent one.
    const doc = await open(out);
    const info = doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict);
    for (const key of ["Title", "Author", "Producer", "CreationDate"]) {
      expect(info?.get(PDFName.of(key))).toBeUndefined();
    }
  });

  it("removes all three XMP packets", async () => {
    expect((await readPdfMetadata(await removePdfMetadata(await metadataPdf()))).xmpStreams).toBe(
      0,
    );
  });

  it("takes the XMP bytes out of the file, with a positive control on the scan", async () => {
    const before = await metadataPdf();
    // The control. An unfiltered PDFRawStream is written verbatim, so the
    // marker IS findable here — which is what makes its absence below evidence
    // rather than an artefact of compression.
    expect(Buffer.from(before).includes(XMP_MARKER)).toBe(true);

    const after = await removePdfMetadata(before);
    expect(Buffer.from(after).includes(XMP_MARKER)).toBe(false);

    // And the counter-example, kept as documentation: the /Info title is NOT
    // findable in EITHER file. pdf-lib writes /Info strings with
    // `PDFHexString.fromText`, i.e. UTF-16BE hex — "Quarterly numbers" is
    // stored as <FEFF0051007500610072...>, so the plain text is never in the
    // bytes. That is why the /Info assertions above go through
    // `readPdfMetadata` and the dictionary, never through a scan.
    expect(Buffer.from(before).includes("Quarterly numbers")).toBe(false);
    expect(Buffer.from(after).includes("Quarterly numbers")).toBe(false);
  });

  it("leaves the page's drawn content and its image alone", async () => {
    const out = await removePdfMetadata(await metadataPdf());

    expect(await pageContent(out, 0)).toContain(`<${winAnsiHex("body")}> Tj`);
    expect(Object.keys(await pageXObjects(out, 0)).some((n) => n.startsWith("/Image"))).toBe(
      true,
    );
  });

  it("is a no-op it survives on a document that carries no metadata at all", async () => {
    const out = await removePdfMetadata(await blankPdf(2));
    const report = await readPdfMetadata(out);

    expect(report.info).toEqual({});
    expect(report.xmpStreams).toBe(0);
    expect((await open(out)).getPageCount()).toBe(2);
  });
});

describe("an image or rect stamp lands where it was asked to on a ROTATED page", () => {
  /*
    THE REGRESSION. `at` is documented as a fraction "across and down the page
    AS DISPLAYED, from its TOP-LEFT corner". A PDF draws an image and a
    rectangle from their BOTTOM-left, so the anchor has to drop by the stamp's
    own height — and the original code spelled that `y: origin.y - height`, a
    subtraction along the UNROTATED y axis. That is only "down the page" when
    /Rotate is 0.

    Three separate agents building on this engine measured the same failure
    independently. Reproduced here on A4 with a 40x20 image at (25%, 25%),
    reading the composed CTM out of the inflated content stream and mapping the
    image's top-left corner back into display fractions:

        /Rotate   0  -> (25.0%, 25.0%)   correct even before the fix
        /Rotate  90  -> (15.0%, 10.9%)   one image height out SIDEWAYS
        /Rotate 180  -> (25.0%, 10.9%)   two image heights high
        /Rotate 270  -> (35.0%, 10.9%)

    TEXT stamps were never affected: drawText rotates about its own origin and
    needs no top-left correction at all.

    The cure is `displayedDownUnit` in pdf-stamp-core.ts, which asks
    `fractionToUserSpace` where the top of the page goes and where the bottom
    goes rather than tabulating four vectors that could drift from it. At
    rotation 0 it returns exactly (0, -1), so the old behaviour is a special
    case of the new one.
  */
  const compose = (content: string): number[] => {
    const matrices = [
      ...content.matchAll(
        /(-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) (-?[\d.e-]+) cm/g,
      ),
    ].map((m) => m.slice(1, 7).map(Number));
    const mul = (a: number[], b: number[]): number[] => [
      a[0] * b[0] + a[1] * b[2],
      a[0] * b[1] + a[1] * b[3],
      a[2] * b[0] + a[3] * b[2],
      a[2] * b[1] + a[3] * b[3],
      a[4] * b[0] + a[5] * b[2] + b[4],
      a[4] * b[1] + a[5] * b[3] + b[5],
    ];
    let out = [1, 0, 0, 1, 0, 0];
    for (const m of matrices) out = mul(m, out);
    return out;
  };

  /** A user-space point back to display fractions, for a given page /Rotate. */
  const toDisplay = (
    px: number,
    py: number,
    rotation: number,
  ): { x: number; y: number } => {
    const w = A4[0];
    const h = A4[1];
    switch (rotation) {
      case 90:
        return { x: py / h, y: px / w };
      case 180:
        return { x: 1 - px / w, y: py / h };
      case 270:
        return { x: 1 - py / h, y: 1 - px / w };
      default:
        return { x: px / w, y: 1 - py / h };
    }
  };

  it.each([0, 90, 180, 270])(
    "puts an image's top-left at the requested fraction on a /Rotate %i page",
    async (rotation) => {
      const stamp: PdfStamp = {
        kind: "image",
        pages: "all",
        bytes: PNG_4X2,
        type: "image/png",
        at: { x: 0.25, y: 0.25 },
        widthFraction: 0.2,
        opacity: 1,
        rotate: 0,
        behind: false,
        tile: false,
      };

      const out = await stampPdf(await rotatedBlankPdf(rotation), [stamp]);
      const m = compose(await pageContent(out, 0));
      // The image's own top-left is (0,1) in the unit square it is drawn into.
      const topLeft = toDisplay(m[2] + m[4], m[3] + m[5], rotation);

      expect(topLeft.x).toBeCloseTo(0.25, 3);
      expect(topLeft.y).toBeCloseTo(0.25, 3);
    },
  );
});

describe("stampPdf — freehand path stamps", () => {
  /*
    A `PdfPathStamp` is the odd one out among the four stamp kinds, and the
    difference is the whole point of these tests.

    The text, image and rect stamps place ONE anchor and then let pdf-lib rotate
    the mark about it, which is why they need `displayedDownUnit` to push a
    top-left fraction down to the bottom-left corner a PDF actually draws from,
    and why the describe above them exists at all. A path has no anchor and no
    box: every point is pushed through `fractionToUserSpace` on its own, so the
    page's `/Rotate` is already accounted for by the time any operator is
    written. Two consequences fall out, and both are asserted below rather than
    assumed — `at` does nothing to a path, and so does the stamp's own `rotate`.

    HOW THE ASSERTIONS READ THE FILE. A raw byte scan over a PDF proves nothing
    (see the note at the top of this file), so everything here goes through
    `pageContent()`, which inflates the page's content streams. What pdf-lib's
    `drawLine` emits per segment, MEASURED on a /Rotate 90 A4 page with a
    #ff8000 stroke of width 3.5 at 40% opacity:

        q
        /GS-7098480789 gs
        1 0.5019607843137255 0 RG
        3.5 w
        [] 0 d
        59.5 84.2 m
        1 J
        59.5 84.2 m
        416.5 336.8 l
        S
        Q

    Two `m` operators, because pdf-lib writes the move both before and after the
    line cap — `strokeSegments` below is deliberately loose about what sits
    between the first `m` and the `l` so that it keeps finding the endpoints even
    if the cap operator moves or goes away.

    Note `RG` and `CA`, both upper case: a path is STROKED, so the colour is the
    stroking colour and the opacity is the stroking alpha. The `fillAlphas()`
    helper used by the rect and text tests reads `/ca` and would report nothing
    at all here, which is why this block reads the ExtGState by name instead.
  */

  const [A4_WIDTH, A4_HEIGHT] = A4;

  /** Every stroked segment on a page, as its two user-space endpoints. */
  function strokeSegments(
    content: string,
  ): { start: { x: number; y: number }; end: { x: number; y: number } }[] {
    return [
      ...content.matchAll(
        /(-?[\d.]+) (-?[\d.]+) m[\s\S]*?(-?[\d.]+) (-?[\d.]+) l\s*S/g,
      ),
    ].map((m) => ({
      start: { x: Number(m[1]), y: Number(m[2]) },
      end: { x: Number(m[3]), y: Number(m[4]) },
    }));
  }

  /** Every `w` (line width) operand, in the order it was written. */
  const strokeWidths = (content: string): number[] =>
    [...content.matchAll(/(-?[\d.]+) w\b/g)].map((m) => Number(m[1]));

  /** Every `RG` (stroking colour) operand triple, in the order written. */
  const strokeColours = (content: string): number[][] =>
    [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) RG/g)].map((m) =>
      m.slice(1, 4).map(Number),
    );

  /** Every `/GSn gs` resource name the content stream actually invokes. */
  const graphicsStateNames = (content: string): string[] =>
    [...content.matchAll(/(\/\S+) gs/g)].map((m) => m[1]);

  /**
   * The page's ExtGState dictionaries KEYED BY RESOURCE NAME.
   *
   * `alphas()` above throws the names away, which is fine when the question is
   * "what alphas exist"; here the question is "does the state this stroke
   * NAMES carry the alpha", so the name has to survive.
   */
  async function graphicsStates(
    bytes: Uint8Array,
    index: number,
  ): Promise<Record<string, { ca?: number; CA?: number }>> {
    const doc = await open(bytes);
    const resources = doc.getPage(index).node.Resources();
    const states = resources?.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
    const out: Record<string, { ca?: number; CA?: number }> = {};
    if (!states) return out;
    for (const [name, value] of states.entries()) {
      const dict = doc.context.lookup(value);
      if (!(dict instanceof PDFDict)) continue;
      const entry: { ca?: number; CA?: number } = {};
      const ca = dict.get(PDFName.of("ca"));
      const CA = dict.get(PDFName.of("CA"));
      if (ca instanceof PDFNumber) entry.ca = ca.asNumber();
      if (CA instanceof PDFNumber) entry.CA = CA.asNumber();
      out[name.asString()] = entry;
    }
    return out;
  }

  /**
   * A user-space point back to the fraction of the page a READER sees, for a
   * given page `/Rotate`. The inverse of `fractionToUserSpace`, written out by
   * hand so that a mistake in the engine's forward mapping cannot cancel
   * itself out against the check.
   */
  const toDisplayFraction = (
    point: { x: number; y: number },
    rotation: number,
  ): { x: number; y: number } => {
    switch (rotation) {
      case 90:
        return { x: point.y / A4_HEIGHT, y: point.x / A4_WIDTH };
      case 180:
        return { x: 1 - point.x / A4_WIDTH, y: point.y / A4_HEIGHT };
      case 270:
        return { x: 1 - point.y / A4_HEIGHT, y: 1 - point.x / A4_WIDTH };
      default:
        return { x: point.x / A4_WIDTH, y: 1 - point.y / A4_HEIGHT };
    }
  };

  type PathStamp = Extract<PdfStamp, { kind: "path" }>;

  const pathStamp = (over: Partial<PathStamp> = {}): PdfStamp => ({
    kind: "path",
    pages: "all",
    // Deliberately a corner: `at` is meaningless for a path, and a non-zero
    // value here would let an anchor bug hide inside a plausible-looking number.
    at: { x: 0, y: 0 },
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.4, y: 0.7 },
    ],
    stroke: "#ff8000",
    strokeWidth: 3.5,
    opacity: 1,
    rotate: 0,
    ...over,
  });

  const segmentsOf = async (
    bytes: Uint8Array,
    stamps: PdfStamp[],
    page = 0,
  ) => strokeSegments(await pageContent(await stampPdf(bytes, stamps), page));

  it.each([0, 90, 180, 270])(
    "puts the first point at the displayed fraction it was given on a /Rotate %i page",
    async (rotation) => {
      const segments = await segmentsOf(await rotatedBlankPdf(rotation), [
        pathStamp(),
      ]);

      expect(segments).toHaveLength(1);
      const first = toDisplayFraction(segments[0].start, rotation);
      expect(first.x).toBeCloseTo(0.1, 3);
      expect(first.y).toBeCloseTo(0.1, 3);

      // And the far end, so a mapping that collapsed every point onto the same
      // place would still fail here.
      const last = toDisplayFraction(segments[0].end, rotation);
      expect(last.x).toBeCloseTo(0.4, 3);
      expect(last.y).toBeCloseTo(0.7, 3);
    },
  );

  it("the four rotations agree on the DISPLAYED fraction and disagree on user space", async () => {
    const rotations = [0, 90, 180, 270];
    const starts = [];
    for (const rotation of rotations) {
      const segments = await segmentsOf(await rotatedBlankPdf(rotation), [
        pathStamp(),
      ]);
      starts.push(segments[0].start);
    }

    // The control for the test above. Four pages that happen to write the SAME
    // user-space coordinates would satisfy it trivially and prove nothing about
    // rotation; measured, they are four different points on the page.
    // The literals are what pdf-lib WROTE, to the digit: it emits a JS number
    // at full precision, so 0.9 * 842 is 757.8000000000001 in the file.
    expect(starts).toEqual([
      { x: 59.5, y: 757.8000000000001 },
      { x: 59.5, y: 84.2 },
      { x: 535.5, y: 84.2 },
      { x: 535.5, y: 757.8000000000001 },
    ]);
    expect(new Set(starts.map((p) => `${p.x},${p.y}`)).size).toBe(4);

    // Yet a reader sees the stroke start in the same corner every time.
    for (const [i, rotation] of rotations.entries()) {
      const seen = toDisplayFraction(starts[i], rotation);
      expect([seen.x, seen.y].map((v) => Number(v.toFixed(3)))).toEqual([0.1, 0.1]);
    }
  });

  it("ignores the stamp's own rotate — a stroke is drawn where it was drawn", async () => {
    const page = await rotatedBlankPdf(90);
    const upright = await segmentsOf(page, [pathStamp({ rotate: 0 })]);

    for (const rotate of [45, 90, 180, 270, -30]) {
      expect(await segmentsOf(page, [pathStamp({ rotate })])).toEqual(upright);
    }
  });

  it("ignores `at` — every point carries its own position", async () => {
    const page = await blankPdf();
    const atOrigin = await segmentsOf(page, [pathStamp({ at: { x: 0, y: 0 } })]);

    expect(await segmentsOf(page, [pathStamp({ at: { x: 0.9, y: 0.9 } })])).toEqual(
      atOrigin,
    );
    // The positive control: the same document, moved by the only lever a path
    // HAS, does change.
    const moved = await segmentsOf(page, [
      pathStamp({ points: [{ x: 0.9, y: 0.9 }, { x: 0.95, y: 0.95 }] }),
    ]);
    expect(moved).not.toEqual(atOrigin);
  });

  it("writes each stroke's colour and width into the content stream", async () => {
    const out = await stampPdf(await blankPdf(), [
      pathStamp({ stroke: "#ff8000", strokeWidth: 3.5 }),
      pathStamp({ stroke: "#0040c0", strokeWidth: 1.25 }),
    ]);
    const content = await pageContent(out, 0);

    const colours = strokeColours(content);
    expect(colours).toHaveLength(2);
    expect(colours[0][0]).toBeCloseTo(1, 5);
    expect(colours[0][1]).toBeCloseTo(128 / 255, 5);
    expect(colours[0][2]).toBeCloseTo(0, 5);
    expect(colours[1][0]).toBeCloseTo(0, 5);
    expect(colours[1][1]).toBeCloseTo(64 / 255, 5);
    expect(colours[1][2]).toBeCloseTo(192 / 255, 5);

    expect(strokeWidths(content)).toEqual([3.5, 1.25]);
  });

  it("puts the opacity in a real ExtGState — the stroking alpha the `gs` operator names", async () => {
    const out = await stampPdf(await blankPdf(), [pathStamp({ opacity: 0.4 })]);
    const content = await pageContent(out, 0);

    const named = graphicsStateNames(content);
    expect(named).toHaveLength(1);

    const states = await graphicsStates(out, 0);
    // Not "an ExtGState exists with 0.4 in it" — the state THIS stroke invokes.
    expect(states[named[0]]).toEqual({ CA: 0.4 });
    // A stroke has no fill, so a `/ca` here would be a fill alpha nothing uses.
    expect(states[named[0]].ca).toBeUndefined();
  });

  it("carries a different opacity per stroke on the same page", async () => {
    const out = await stampPdf(await blankPdf(), [
      pathStamp({ opacity: 0.25 }),
      pathStamp({ opacity: 0.75 }),
    ]);
    const content = await pageContent(out, 0);
    const states = await graphicsStates(out, 0);

    expect(graphicsStateNames(content).map((name) => states[name].CA)).toEqual([
      0.25, 0.75,
    ]);
  });

  it.each([[[]], [[{ x: 0.5, y: 0.5 }]]])(
    "draws nothing for a stroke of fewer than two points (%j)",
    async (points) => {
      const out = await stampPdf(await blankPdf(), [pathStamp({ points })]);

      expect(strokeSegments(await pageContent(out, 0))).toHaveLength(0);
      // A single tap must not leave a graphics state behind either: the stamp
      // returns before pdf-lib is asked to draw anything at all.
      expect(await graphicsStates(out, 0)).toEqual({});
    },
  );

  it("draws a two-point stroke — the control for the test above", async () => {
    const out = await stampPdf(await blankPdf(), [
      pathStamp({ points: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }] }),
    ]);

    expect(strokeSegments(await pageContent(out, 0))).toHaveLength(1);
    expect(Object.keys(await graphicsStates(out, 0))).toHaveLength(1);
  });

  it("draws one segment per gap, chained end to start in draw order", async () => {
    const points = [
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.2 },
      { x: 0.3, y: 0.6 },
      { x: 0.8, y: 0.9 },
    ];
    const segments = await segmentsOf(await blankPdf(), [pathStamp({ points })]);

    expect(segments).toHaveLength(points.length - 1);
    for (const [i, segment] of segments.entries()) {
      const start = toDisplayFraction(segment.start, 0);
      const end = toDisplayFraction(segment.end, 0);
      expect(start.x).toBeCloseTo(points[i].x, 3);
      expect(start.y).toBeCloseTo(points[i].y, 3);
      expect(end.x).toBeCloseTo(points[i + 1].x, 3);
      expect(end.y).toBeCloseTo(points[i + 1].y, 3);
    }
  });

  it("strokes exactly the pages an explicit list names", async () => {
    const out = await stampPdf(await blankPdf(4), [
      pathStamp({ pages: [0, 2] }),
    ]);

    const counts = [];
    for (let i = 0; i < 4; i++) {
      counts.push(strokeSegments(await pageContent(out, i)).length);
    }
    expect(counts).toEqual([1, 0, 1, 0]);
  });

  it.each([
    ["first", [1, 0, 0]],
    ["last", [0, 0, 1]],
    ["all", [1, 1, 1]],
  ] as const)("a pages selector of %s strokes %j", async (pages, expected) => {
    const out = await stampPdf(await blankPdf(3), [pathStamp({ pages })]);

    const counts = [];
    for (let i = 0; i < 3; i++) {
      counts.push(strokeSegments(await pageContent(out, i)).length);
    }
    expect(counts).toEqual([...expected]);
  });
});
