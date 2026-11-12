import { test, expect, type Locator, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { deflateSync, inflateSync } from "node:zlib";
import {
  SAMPLES,
  uploadFixture,
  primaryAction,
  downloadAffordance,
  captureDownload,
  toolError,
} from "./support";
import { assertPdf } from "./validators";
import { expectPdfPages } from "./fidelity";
import type { FixtureFile } from "../helpers";

/**
 * The four pages that share ONE engine op: watermark-pdf, sign-pdf,
 * add-image-to-pdf and annotate-pdf all call `stampPdf`
 * (src/lib/tools/pdf-engine-core.ts) and differ only in their defaults and
 * their controls. They shipped with unit coverage only, and this repo's
 * recorded lesson is that jsdom has neither a canvas nor WebAssembly — so a
 * green unit suite says nothing about what a browser actually produces. Every
 * case here drives the real page, captures the real download, and asserts on
 * the bytes that came back.
 *
 * ── METHOD, and the two traps that make a lazier version worthless ──
 *
 * 1. A RAW BYTE GREP OVER A PDF IS UNSOUND. pdf-lib saves structure through
 *    object streams (Flate) and writes every drawn string as a HEX STRING
 *    through the font's encoding, so `bytes.includes("DRAFT")` is FALSE on a
 *    document that visibly says DRAFT. `pageContent()` below therefore walks
 *    `/Contents` with pdf-lib, inflates each stream, and text is looked for as
 *    `<${winAnsiHex(...)}> Tj`.
 *
 * 2. THE ORDER OF `/Contents` IS THE ONLY MEANING OF "BEHIND". A page paints
 *    its content streams in array order, so `pageContent()` concatenates them
 *    IN ORDER and the `behind` cases compare the mark's offset against the
 *    fixture's own body text. A byte count or a "the file changed" assertion
 *    would pass on a mark drawn on top.
 *
 * ── THE ONE CASE THAT COULD NOT BE WRITTEN AGAINST THE BYTES ──
 *
 * `stampPdf` used to anchor an image and a rectangle with `y: origin.y −
 * height`, a top-left-to-bottom-left correction along the UNROTATED y axis,
 * which only means "down the page" when a page's `/Rotate` is 0. On a turned
 * page a mark landed a full mark-height out of place, twice that at 180. There
 * is a unit test for the fix; the browser-level case here does not re-derive
 * the engine's arithmetic (that would move both sides of the comparison
 * together). It RENDERS the produced document with pdf.js and measures where
 * the ink actually is, in fractions of the page as a reader shows it. See
 * `inkBoxOfRenderedPage`.
 *
 * NOTE ON TITLES: `conversion-webkit` greps out /gif|FFmpeg|MP4/i against the
 * project name, the file path and the joined describe/test titles. Everything
 * here is pdf-lib and pdf.js, runs in both engines, and no title below may
 * contain those words.
 */

/** The checked-in fixture's page box — `buildPdf()` in the fixture generator. */
const A4 = { width: 595, height: 842 };

// ────────────────────────────────────────────────────────────────────────────
// Reading a produced document
// ────────────────────────────────────────────────────────────────────────────

/**
 * The 27 codepoints WinAnsi puts in 0x80–0x9F, where cp1252 and Latin-1 part
 * company.
 *
 * ⚠ THIS TABLE IS THE DIFFERENCE BETWEEN A TEST AND A FALSE FAILURE. The
 * obvious spelling of `winAnsiHex` is `Buffer.from(text, "latin1")`, and it is
 * silently wrong for exactly the characters the encoding cases are about:
 * Node's latin1 encoder TRUNCATES a codepoint to its low byte, so the em dash
 * U+2014 comes out as 0x14, the curly quote U+201C as 0x1C and the euro sign
 * U+20AC as 0xAC — none of which is what pdf-lib writes. Measured against a
 * real run before this table existed: the assertion looked for
 * `<436166E92014201C4E61EF76651D20AC35>` on a page whose stream holds the
 * correctly-encoded string.
 */
const WINANSI_HIGH = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

/**
 * A string as pdf-lib writes it into a content stream.
 *
 * The standard fonts encode WinAnsi — one byte per character for everything
 * drawn here — and pdf-lib emits the result as an UPPERCASE hex string, so
 * "DRAFT" appears as `<4452414654> Tj`. This is the only sound way to look for
 * drawn text.
 *
 * Throws rather than guessing for a character WinAnsi cannot carry: a stamp
 * containing one is refused by the tool, so a test asking for its bytes has
 * asked the wrong question and should say so loudly.
 */
function winAnsiHex(text: string): string {
  const bytes = [...text].map((character) => {
    const cp = character.codePointAt(0)!;
    const byte = WINANSI_HIGH.get(cp) ?? (cp <= 0xff ? cp : undefined);
    if (byte === undefined) {
      throw new Error(`WinAnsi cannot encode ${JSON.stringify(character)} (U+${cp.toString(16)})`);
    }
    return byte;
  });
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

/** `<hex> Tj` — the operator a drawn string actually appears as. */
function drawnText(text: string): string {
  return `<${winAnsiHex(text)}> Tj`;
}

/**
 * One page's content streams, inflated and concatenated IN THE ORDER the page
 * paints them.
 *
 * Order is the whole point for the `behind` cases: `normalizedEntries()` turns
 * a single `/Contents` stream into an array and the engine inserts the stamp
 * at index 0, so "under the page" means "earlier in this string" and nothing
 * else. The inflate is wrapped because a stream pdf-lib chose not to filter is
 * readable as it stands.
 */
async function pageContent(bytes: Buffer, index: number): Promise<string> {
  const { PDFArray, PDFName, PDFRawStream, PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  const raw = doc.getPage(index).node.get(PDFName.of("Contents"));
  const contents = doc.context.lookup(raw);
  const refs: unknown[] =
    contents instanceof PDFArray
      ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
      : [raw];
  return refs
    .map((ref) => {
      const stream = doc.context.lookup(ref as never);
      if (!(stream instanceof PDFRawStream)) return "";
      const buf = Buffer.from(stream.getContents());
      try {
        return inflateSync(buf).toString("latin1");
      } catch {
        return buf.toString("latin1");
      }
    })
    .join("\n");
}

/** Every image XObject on a page, as the sample grid the file declares. */
async function pageImages(
  bytes: Buffer,
  index: number,
): Promise<{ name: string; width: number; height: number }[]> {
  const { PDFDict, PDFName, PDFNumber, PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  const resources = doc.getPage(index).node.Resources();
  const xObjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const out: { name: string; width: number; height: number }[] = [];
  if (!xObjects) return out;
  for (const [name, value] of xObjects.entries()) {
    const stream = doc.context.lookup(value);
    const dict = stream instanceof PDFDict ? stream : (stream as { dict?: unknown })?.dict;
    if (!(dict instanceof PDFDict)) continue;
    if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;
    const width = dict.get(PDFName.of("Width"));
    const height = dict.get(PDFName.of("Height"));
    out.push({
      name: name.asString(),
      width: width instanceof PDFNumber ? width.asNumber() : 0,
      height: height instanceof PDFNumber ? height.asNumber() : 0,
    });
  }
  return out;
}

/** The `/ca` fill alphas of every ExtGState on a page. */
async function pageFillAlphas(bytes: Buffer, index: number): Promise<number[]> {
  const { PDFDict, PDFName, PDFNumber, PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  const states = doc.getPage(index).node.Resources()?.lookupMaybe(PDFName.of("ExtGState"), PDFDict);
  const out: number[] = [];
  if (!states) return out;
  for (const [, value] of states.entries()) {
    const dict = doc.context.lookup(value);
    if (!(dict instanceof PDFDict)) continue;
    const ca = dict.get(PDFName.of("ca"));
    if (ca instanceof PDFNumber) out.push(ca.asNumber());
  }
  return out;
}

/**
 * How many annotation objects a page carries — the thing all four of these
 * tools promise NOT to write.
 *
 * ⚠ The count, not the presence of the key: pdf-lib writes an empty
 * `/Annots [ ]` onto every page it creates, so the checked-in fixture arrives
 * with one already. "The page has no /Annots entry" is therefore a claim that
 * is false before any stamping happens, and asserting it would fail a correct
 * engine.
 */
async function pageAnnotCount(bytes: Buffer, index: number): Promise<number> {
  const { PDFArray, PDFName, PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
  const annots = doc.context.lookup(doc.getPage(index).node.get(PDFName.of("Annots")));
  return annots instanceof PDFArray ? annots.size() : 0;
}

/**
 * Every `cm` transformation matrix in a content stream, in order.
 *
 * pdf-lib's `drawImage` emits translate · rotate · scale · skew as four
 * separate `cm` operators (api/operations.js), so a placed image shows up as
 * `1 0 0 1 x y cm` followed — after the identity rotation and skew — by
 * `w 0 0 h 0 0 cm`. `drawRectangle` emits the same translate and then draws
 * its path with `l` operators relative to it.
 *
 * The numbers are compared with a tolerance rather than as strings: the
 * engine's arithmetic produces values like 505.19999999999993, and a spec that
 * pinned that spelling would be pinning IEEE754 rather than a placement.
 */
function transformMatrices(content: string): number[][] {
  return [
    ...content.matchAll(
      /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g,
    ),
  ].map((m) => m.slice(1, 7).map(Number));
}

/** Every text matrix (`Tm`) in a content stream: `cos θ, sin θ, −sin θ, cos θ, x, y`. */
function textMatrices(content: string): number[][] {
  return [
    ...content.matchAll(
      /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/g,
    ),
  ].map((m) => m.slice(1, 7).map(Number));
}

/** Every `x y l` path target — how pdf-lib spells a rectangle's corners. */
function lineTargets(content: string): number[][] {
  return [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) l/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
}

/**
 * Fail unless one of `found` is within `tolerance` of `expected` on every
 * component, naming what was actually there when it is not.
 *
 * A "some matrix matches" assertion rather than "the first one does", because
 * the page carries the fixture's own drawing as well as the stamp's, and which
 * index the stamp lands at is not a property worth pinning.
 */
function expectSomeNear(
  found: number[][],
  expected: number[],
  tolerance: number,
  label: string,
): void {
  const hit = found.some(
    (row) =>
      row.length === expected.length &&
      row.every((value, i) => Math.abs(value - expected[i]) <= tolerance),
  );
  expect(
    hit,
    `${label}: expected [${expected.map((n) => n.toFixed(2)).join(", ")}] ±${tolerance}, ` +
      `but the page carries ${found.length} of them: ` +
      found.map((row) => `[${row.map((n) => n.toFixed(2)).join(", ")}]`).join(" "),
  ).toBe(true);
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ────────────────────────────────────────────────────────────────────────────
// Fixtures built here
// ────────────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * A solid-colour truecolour PNG, deliberately NOT square.
 *
 * Both properties are load-bearing. The height of an image stamp is derived
 * from the aspect ratio (`image.height / image.width`), so a square fixture
 * would let a dropped ratio still produce the expected number; and a single
 * saturated colour is what makes the rendered mark findable pixel by pixel in
 * `inkBoxOfRenderedPage` without a decoder in the test process.
 */
function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const stride = width * 3 + 1; // one filter-type byte per scanline
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 3;
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour, no alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 40 × 20 pure red — the mark every image case places. */
const RED_MARK: FixtureFile = {
  name: "red-mark.png",
  mimeType: "image/png",
  buffer: solidPng(40, 20, [230, 20, 20]),
};

/**
 * The pages whose geometry the fix was about: one per `/Rotate`, each a
 * DIFFERENT size.
 *
 * The sizes are not decoration. A stamp is placed as a fraction of the page as
 * DISPLAYED, so four differently-shaped pages make four different expected
 * rectangles — which means a preview stuck on one page, or a run that stamped
 * the same page four times, cannot satisfy the assertions. The displayed
 * aspect ratios are 0.75, 2.0, 1.0 and 3.0, far enough apart that the rendered
 * raster alone identifies which page it came from.
 */
async function turnedPagesPdf(): Promise<FixtureFile> {
  const { PDFDocument, degrees } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (const spec of TURNED_PAGES) {
    const page = doc.addPage([spec.box.width, spec.box.height]);
    page.setRotation(degrees(spec.rotate));
  }
  return {
    name: "turned-pages.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await doc.save()),
  };
}

const TURNED_PAGES = [
  { rotate: 0, box: { width: 600, height: 800 } },
  { rotate: 90, box: { width: 400, height: 800 } },
  { rotate: 180, box: { width: 500, height: 500 } },
  { rotate: 270, box: { width: 300, height: 900 } },
] as const;

/** What a reader shows for one of those pages: axes exchanged at 90 and 270. */
function displayedSize(spec: (typeof TURNED_PAGES)[number]): { width: number; height: number } {
  return spec.rotate % 180 === 0
    ? { width: spec.box.width, height: spec.box.height }
    : { width: spec.box.height, height: spec.box.width };
}

// ────────────────────────────────────────────────────────────────────────────
// Driving the pages
// ────────────────────────────────────────────────────────────────────────────

const surfaceOf = (page: Page) => page.locator("[data-tool-surface]");

/**
 * Read a `StatStrip` cell by its mono label. The value is the label span's
 * sibling, so the parent's text is `LABEL` + `VALUE` concatenated. Scoped to
 * the tool surface because the FAQ and how-to copy on the same page quote
 * these words.
 */
async function statValue(page: Page, label: string): Promise<string> {
  const cell = surfaceOf(page).getByText(label, { exact: true }).first().locator("..");
  const text = (await cell.textContent()) ?? "";
  return text.slice(label.length).trim();
}

/** A `<input type="number">` in the rail, by its accessible name. */
function numberField(page: Page, name: string): Locator {
  return surfaceOf(page).getByRole("spinbutton", { name, exact: true });
}

/** One of a `ToolChoice` group's chips. */
function choiceChip(page: Page, label: string): Locator {
  return surfaceOf(page).getByRole("button", { name: label, exact: true });
}

/**
 * Press the tool's primary and capture the file it produces.
 *
 * Written as one helper because every page in this family has the same shape:
 * the footer swaps the primary out for the Download the moment a run
 * finishes, and every control puts the primary back. That is what lets a
 * single test drive several runs without reloading — which is the only way the
 * page-selector and `behind` cases can compare two outputs of the same
 * document without paying for the pdf.js render four times over.
 */
async function runTool(
  page: Page,
  action: RegExp,
): Promise<{ name: string; bytes: Buffer }> {
  const primary = primaryAction(page, action);
  await expect(primary, `the tool never became runnable: ${await toolError(page)}`).toBeEnabled({
    timeout: 90_000,
  });
  await primary.click();
  const dl = downloadAffordance(page);
  await expect(dl, `the run failed: ${await toolError(page)}`).toBeVisible({ timeout: 90_000 });
  return captureDownload(page, dl);
}

/**
 * Where the ink is on a page of a produced document, as fractions of the page
 * AS A READER SHOWS IT.
 *
 * THIS IS THE INDEPENDENT MEASUREMENT, and it is why the rotated-page case is
 * worth a browser at all. Every other assertion in this file reads the numbers
 * the engine wrote; re-deriving those numbers from `fractionToUserSpace` would
 * move both sides of the comparison together, so a wrong mapping would agree
 * with itself. Here the document is handed back to pdf.js — which applies
 * `/Rotate` itself, exactly as the reader the user opens the file in does —
 * and the red mark is found by scanning the rasterised page. Nothing in the
 * path shares arithmetic with `drawStamp`.
 *
 * `/annotate-pdf` is the vehicle only because it renders an arbitrary page of
 * an uploaded document at scale 1 and publishes the result as a data URL whose
 * `alt` names the page it is of — so waiting on the alt guarantees the pixels
 * belong to the page asked for, with no race against a late render.
 */
async function inkBoxOfRenderedPage(
  page: Page,
  pdf: FixtureFile,
  pageNumber: number,
): Promise<{
  aspect: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  coverage: number;
}> {
  if (/\/annotate-pdf\/?$/.test(page.url())) {
    await numberField(page, "Page to mark up").fill(String(pageNumber));
  } else {
    await page.goto("/annotate-pdf");
    await uploadFixture(page, pdf);
    if (pageNumber !== 1) {
      await expect(surfaceOf(page).locator('img[alt^="Page 1 "]')).toBeVisible({
        timeout: 90_000,
      });
      await numberField(page, "Page to mark up").fill(String(pageNumber));
    }
  }

  const rendered = surfaceOf(page).locator(`img[alt^="Page ${pageNumber} "]`);
  await expect(rendered, `page ${pageNumber} never rendered: ${await toolError(page)}`).toBeVisible(
    { timeout: 90_000 },
  );
  const src = await rendered.getAttribute("src");
  expect(src, "the rendered page must be published as a data URL").toMatch(/^data:image\//);

  const box = await page.evaluate(async (url: string) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context to read the rendered page with");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    bitmap.close();

    // "Clearly red", not "exactly the fixture's colour": the page is published
    // as a quality-0.9 JPEG, so the block's interior is within a few units of
    // (230,20,20) and its edges ring. A margin of 60 over both other channels
    // is far outside anything JPEG does to white paper or black type.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hits = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const o = (y * canvas.width + x) * 4;
        if (data[o] - data[o + 1] < 60 || data[o] - data[o + 2] < 60) continue;
        hits++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    return { width: canvas.width, height: canvas.height, minX, minY, maxX, maxY, hits };
  }, src!);

  expect(
    box.hits,
    `nothing was drawn on page ${pageNumber} of the produced document — ` +
      `the ${box.width}x${box.height} render carries no mark at all`,
  ).toBeGreaterThan(100);

  return {
    aspect: box.width / box.height,
    left: box.minX / box.width,
    top: box.minY / box.height,
    right: (box.maxX + 1) / box.width,
    bottom: (box.maxY + 1) / box.height,
    coverage: box.hits / (box.width * box.height),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// watermark-pdf
// ════════════════════════════════════════════════════════════════════════════

test.describe("watermark-pdf — real output", () => {
  /** The tool is ready once the rendered page has published its size. */
  async function openWatermark(page: Page, fixture: FixtureFile): Promise<void> {
    await page.goto("/watermark-pdf");
    await uploadFixture(page, fixture);
    await expect(
      primaryAction(page, /Add watermark/),
      `the page never rendered: ${await toolError(page)}`,
    ).toBeEnabled({ timeout: 90_000 });
  }

  test("the text really reaches the page, at the anchor the fields hold", async ({ page }) => {
    await openWatermark(page, await SAMPLES.pdf());

    await surfaceOf(page)
      .getByRole("textbox", { name: "Watermark text", exact: true })
      .fill("TRANSMUTE STAMP");
    await numberField(page, "Anchor position across the page, in percent").fill("20");
    await numberField(page, "Anchor position down the page, in percent").fill("30");
    await expect(surfaceOf(page).getByText("20% · 30%", { exact: true })).toBeVisible();

    const { name, bytes } = await runTool(page, /Add watermark/);
    expect(name).toBe("sample-doc-watermarked.pdf");
    await assertPdf(bytes, { pages: 5 });
    // Each page still carries its own content, in order — not only five pages.
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "watermarked");

    const content = await pageContent(bytes, 0);
    /*
      The string itself, hex-encoded — see the header. Looking for the plain
      characters in the file's bytes would report "absent" on this very
      document.
    */
    expect(content, "the watermark text is not drawn on the page").toContain(
      drawnText("TRANSMUTE STAMP"),
    );

    /*
      And it is drawn WHERE THE RAIL SAID. The fields hold percentages of the
      displayed page from its top-left corner; user space counts up from the
      bottom, so 30% down is 70% up. The first four components are the stamp's
      own 45° default, which is worth pinning here rather than in a case of its
      own: it is the same operator, and a rotation silently dropped would leave
      an identity matrix.
      `drawText` anchors the baseline AT the origin — there is no height
      correction on a text stamp — so this is the anchor unmodified.
    */
    const half = Math.SQRT1_2;
    expectSomeNear(
      textMatrices(content),
      [half, half, -half, half, 0.2 * A4.width, 0.7 * A4.height],
      0.5,
      "the watermark's text matrix",
    );

    // The colour control's default, as a non-stroking RGB fill: #d92d20.
    expect(content).toContain(`${0xd9 / 255} ${0x2d / 255} ${0x20 / 255} rg`);
    // And the opacity default, 22%, as a real graphics state rather than a
    // mark drawn at full strength over the page.
    expect(await pageFillAlphas(bytes, 0)).toContain(0.22);
  });

  test("under the page content really means under it", async ({ page }) => {
    /*
      `behind` has exactly one observable meaning: the mark's drawing sits
      EARLIER in the page's `/Contents` array than the page's own, because a
      PDF paints them in order. The fixture is the checked-in 5-page document,
      whose every page carries the literal "Transmute conversion fixture" drawn
      with Helvetica — so the comparison is against real body text rather than
      against a byte offset or a file size.

      Both directions are asserted from the same page load, because "the mark
      is before the body" alone would pass on a build where `behind` did
      nothing and the engine had always inserted at index 0.
    */
    await openWatermark(page, await SAMPLES.pdf());
    const body = drawnText("Transmute conversion fixture");

    await surfaceOf(page)
      .getByRole("textbox", { name: "Watermark text", exact: true })
      .fill("UNDERNEATH");
    await choiceChip(page, "First").click();

    // ── The default: over the page ──
    const over = await runTool(page, /Add watermark/);
    const overContent = await pageContent(over.bytes, 0);
    expect(overContent).toContain(drawnText("UNDERNEATH"));
    expect(overContent).toContain(body);
    expect(
      overContent.indexOf(drawnText("UNDERNEATH")),
      "by default the mark must be painted AFTER the page's own content",
    ).toBeGreaterThan(overContent.indexOf(body));

    // ── Ticked: under the page ──
    await surfaceOf(page)
      .getByRole("checkbox", { name: "Place under the page content", exact: true })
      .check();
    await expect(downloadAffordance(page)).toHaveCount(0);

    const under = await runTool(page, /Add watermark/);
    const underContent = await pageContent(under.bytes, 0);
    expect(underContent).toContain(drawnText("UNDERNEATH"));
    expect(underContent).toContain(body);
    expect(
      underContent.indexOf(drawnText("UNDERNEATH")),
      "with `Place under the page content` ticked the mark must be painted BEFORE the page's own content",
    ).toBeLessThan(underContent.indexOf(body));
  });

  test("tiling repeats the mark twelve times, against an untiled control of one", async ({
    page,
  }) => {
    await openWatermark(page, await SAMPLES.pdf());

    await surfaceOf(page)
      .getByRole("textbox", { name: "Watermark text", exact: true })
      .fill("TILED");
    await choiceChip(page, "First").click();

    // The control first, so "twelve" cannot be satisfied by a mark drawn
    // twelve times for some other reason.
    const single = await runTool(page, /Add watermark/);
    expect(countOf(await pageContent(single.bytes, 0), drawnText("TILED"))).toBe(1);

    await surfaceOf(page)
      .getByRole("checkbox", { name: "Tile across the page", exact: true })
      .check();
    await expect(surfaceOf(page).getByText("TILED 3×4", { exact: true })).toBeVisible();
    await expect(downloadAffordance(page)).toHaveCount(0);

    const tiled = await runTool(page, /Add watermark/);
    const content = await pageContent(tiled.bytes, 0);
    expect(countOf(content, drawnText("TILED")), "tiling must draw the mark twelve times").toBe(12);

    // Twelve DISTINCT places, not one place drawn twelve times: the text
    // matrices carry the origin, and the engine's grid is 3 across by 4 down.
    const origins = new Set(
      textMatrices(content)
        .filter((m) => Math.abs(m[0] - Math.SQRT1_2) < 0.01)
        .map((m) => `${m[4].toFixed(3)},${m[5].toFixed(3)}`),
    );
    expect(origins.size, "the twelve tiles must land at twelve different places").toBe(12);
    expect(new Set([...origins].map((o) => o.split(",")[0])).size, "three columns").toBe(3);
    expect(new Set([...origins].map((o) => o.split(",")[1])).size, "four rows").toBe(4);
  });

  test("the page selector picks the pages it names", async ({ page }) => {
    await openWatermark(page, await SAMPLES.pdf());
    const mark = drawnText("PAGEPICK");

    await surfaceOf(page)
      .getByRole("textbox", { name: "Watermark text", exact: true })
      .fill("PAGEPICK");

    /** Which of the fixture's five pages the produced file carries the mark on. */
    async function stampedPages(bytes: Buffer): Promise<number[]> {
      const hit: number[] = [];
      for (let i = 0; i < 5; i++) {
        if ((await pageContent(bytes, i)).includes(mark)) hit.push(i);
      }
      return hit;
    }

    // "All" is the default the tool opens on.
    await expect(surfaceOf(page).getByText("5 OF 5", { exact: true })).toBeVisible();
    expect(await stampedPages((await runTool(page, /Add watermark/)).bytes)).toEqual([0, 1, 2, 3, 4]);

    await choiceChip(page, "First").click();
    await expect(downloadAffordance(page)).toHaveCount(0);
    expect(await stampedPages((await runTool(page, /Add watermark/)).bytes)).toEqual([0]);

    await choiceChip(page, "Last").click();
    await expect(downloadAffordance(page)).toHaveCount(0);
    expect(await stampedPages((await runTool(page, /Add watermark/)).bytes)).toEqual([4]);

    // A named page. The field is 1-based and the engine is 0-based, which is
    // exactly the sort of translation worth proving rather than assuming.
    await choiceChip(page, "Range").click();
    await surfaceOf(page)
      .getByRole("textbox", { name: "Page range to stamp", exact: true })
      .fill("2, 4-5");
    await expect(surfaceOf(page).getByText("3 OF 5", { exact: true })).toBeVisible();
    await expect(downloadAffordance(page)).toHaveCount(0);
    expect(await stampedPages((await runTool(page, /Add watermark/)).bytes)).toEqual([1, 3, 4]);
  });

  test("text the standard fonts cannot draw is refused before the run", async ({ page }) => {
    /*
      The engine throws for a character WinAnsi cannot encode, and pdf-lib's
      own message names a byte offset rather than the character a person typed.
      The promise this pins is that the user never reaches that: the page
      refuses while they are still typing, names every offending character, and
      the button that would start the run is not pressable.
    */
    await openWatermark(page, await SAMPLES.pdf());

    const field = surfaceOf(page).getByRole("textbox", { name: "Watermark text", exact: true });
    await field.fill("SECRET 日本 Жизнь 😀");

    const warning = surfaceOf(page).getByText(/The standard PDF fonts cannot draw/);
    await expect(warning).toBeVisible();
    const message = (await warning.textContent()) ?? "";
    // Every character it cannot draw, in the order they appear — a warning that
    // said only "some characters" would leave the user guessing which.
    for (const character of ["日", "本", "Ж", "😀"]) {
      expect(message, `the refusal must name ${character}`).toContain(`"${character}"`);
    }
    expect(message.indexOf('"日"')).toBeLessThan(message.indexOf('"Ж"'));

    // Refused BEFORE the run: the primary is dead and no error box has been
    // raised, because nothing was attempted.
    await expect(primaryAction(page, /Add watermark/)).toBeDisabled();
    expect(await toolError(page), "nothing should have been attempted yet").toBeNull();
    await expect(downloadAffordance(page)).toHaveCount(0);

    // And it is a refusal, not a lock: the accented Latin the same fonts DO
    // cover runs, and lands on the page.
    await field.fill("Café — “Naïve” €5");
    await expect(warning).toHaveCount(0);
    const { bytes } = await runTool(page, /Add watermark/);
    expect(await pageContent(bytes, 0)).toContain(drawnText("Café — “Naïve” €5"));
  });
});

// ════════════════════════════════════════════════════════════════════════════
// add-image-to-pdf
// ════════════════════════════════════════════════════════════════════════════

test.describe("add-image-to-pdf — real output", () => {
  async function openAddImage(page: Page, pdf: FixtureFile): Promise<void> {
    await page.goto("/add-image-to-pdf");
    await uploadFixture(page, pdf);
    // The rail's Choose an image button is live only once the page render has
    // landed; waiting on the stat cell is the narrowest signal for that.
    await expect
      .poll(() => statValue(page, "PAGE 1"), { timeout: 90_000 })
      .toMatch(/\d+ × \d+ PT/);
    // The PDF's own DropZone has unmounted by now, so the one remaining file
    // input on the page is the image picker.
    await uploadFixture(page, RED_MARK);
    await expect(surfaceOf(page).getByText("40×20", { exact: true })).toBeVisible();
  }

  test("the picture is embedded, and drawn at the size and place the rail claims", async ({
    page,
  }) => {
    await openAddImage(page, await SAMPLES.pdf());

    await numberField(page, "X position, per cent across the page from its top-left corner").fill(
      "30",
    );
    await numberField(page, "Y position, per cent across the page from its top-left corner").fill(
      "40",
    );
    // What the rail SAYS it will produce, read off the stat strip before the
    // run. Width is a slider left at its 25% default; the assertions below
    // compare the produced bytes against this readout rather than against a
    // constant copied out of the component.
    const claimed = await statValue(page, "PLACED");
    expect(claimed, "the rail must state the placed size before the run").toMatch(/\d+ × \d+ PT/);

    const { name, bytes } = await runTool(page, /Place image/);
    expect(name).toBe("sample-doc-with-image.pdf");
    await assertPdf(bytes, { pages: 5 });
    // Each page still carries its own content, in order — not only five pages.
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "with image");

    // ── Embedded, as a real image XObject with the fixture's own sample grid ──
    const images = await pageImages(bytes, 0);
    expect(
      images.map((i) => `${i.width}x${i.height}`),
      "the PNG must be embedded as an image XObject at its stored size",
    ).toContain("40x20");

    // ── Drawn where the rail said ──
    // The default width is 25% of the page; the height follows the picture's
    // 2:1 grid. Both numbers are re-derived from the rail's own readout so the
    // assertion is against what the user was looking at, not against a
    // constant copied out of the component.
    const [claimedWidth, claimedHeight] = claimed
      .match(/(\d+) × (\d+) PT/)!
      .slice(1, 3)
      .map(Number);
    expect(claimedWidth).toBe(Math.round(A4.width * 0.25));
    expect(claimedHeight).toBe(Math.round((20 / 40) * A4.width * 0.25));

    const content = await pageContent(bytes, 0);
    expect(content, "the embedded image must actually be drawn").toMatch(/\/Image-\d+ Do/);
    // pdf-lib's `drawImage` emits the extents as a scale matrix…
    expectSomeNear(
      transformMatrices(content),
      [claimedWidth, 0, 0, claimedHeight, 0, 0],
      1,
      "the image's scale matrix",
    );
    // …and the anchor as a translate. Fractions are top-left anchored and a
    // PDF draws an image from its BOTTOM-left corner, so the anchor drops by
    // the drawn height: 60% up the page, less the picture's own height.
    expectSomeNear(
      transformMatrices(content),
      [1, 0, 0, 1, 0.3 * A4.width, (1 - 0.4) * A4.height - claimedHeight],
      1,
      "the image's translate matrix",
    );

    // The pages that were not chosen — "All" is the default here — all carry
    // it, and the source document's own text is untouched on every one.
    for (let i = 0; i < 5; i++) {
      const other = await pageContent(bytes, i);
      expect(other, `page ${i + 1} should carry the picture`).toMatch(/\/Image-\d+ Do/);
      expect(other, `page ${i + 1}'s own text must survive`).toContain(
        drawnText("Transmute conversion fixture"),
      );
    }
  });

  test("a mark lands at the requested fraction on a page the file turns", async ({ page }) => {
    /*
      THE REGRESSION THIS FILE EXISTS FOR, measured in a browser rather than
      re-derived from the engine.

      `drawStamp` used to shift an image's anchor from top-left to bottom-left
      with `y: origin.y − height` — a subtraction along the UNROTATED y axis,
      which only means "down the page" when `/Rotate` is 0. On a turned page
      the mark landed a full mark-height out of place, and twice that at 180.
      It now shifts along `displayedDownUnit`.

      The document below carries one page per rotation, each a different shape,
      and one run stamps all four at (25%, 25%) — so the rotation-0 page is the
      control in the same file, and a build that ignored rotation would pass
      there and fail on the other three.

      What makes the assertion independent: the produced document is handed
      back to pdf.js and the RED PIXELS ARE FOUND IN THE RASTER. pdf.js applies
      `/Rotate` itself, so what is measured is where a reader shows the mark,
      in fractions of the page as displayed. No arithmetic is shared with the
      engine, so a wrong mapping cannot agree with itself.
    */
    const turned = await turnedPagesPdf();
    await openAddImage(page, turned);

    await numberField(page, "X position, per cent across the page from its top-left corner").fill(
      "25",
    );
    await numberField(page, "Y position, per cent across the page from its top-left corner").fill(
      "25",
    );

    const { name, bytes } = await runTool(page, /Place image/);
    expect(name).toBe("turned-pages-with-image.pdf");
    const info = await assertPdf(bytes, { pages: 4 });
    expect(info.rotations, "the produced file must keep every page's own /Rotate").toEqual([
      0, 90, 180, 270,
    ]);

    const stamped: FixtureFile = {
      name: "turned-pages-stamped.pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    };

    for (const [index, spec] of TURNED_PAGES.entries()) {
      const shown = displayedSize(spec);
      const box = await inkBoxOfRenderedPage(page, stamped, index + 1);

      // The raster is of the page it claims to be: four different displayed
      // aspect ratios, so this alone rules out a preview stuck on one page.
      expect(
        box.aspect,
        `page ${index + 1} (/Rotate ${spec.rotate}) rendered at aspect ${box.aspect.toFixed(3)}`,
      ).toBeCloseTo(shown.width / shown.height, 1);

      // 25% of the DISPLAYED width; the height follows the 2:1 picture, which
      // is a different share of the page on every one of these four shapes.
      const widthFraction = 0.25;
      const heightFraction = ((20 / 40) * widthFraction * shown.width) / shown.height;
      const where = `page ${index + 1} (/Rotate ${spec.rotate}, shown ${shown.width}×${shown.height})`;

      expect(box.left, `${where}: left edge`).toBeCloseTo(0.25, 2);
      expect(box.top, `${where}: top edge`).toBeCloseTo(0.25, 2);
      expect(box.right, `${where}: right edge`).toBeCloseTo(0.25 + widthFraction, 2);
      expect(box.bottom, `${where}: bottom edge`).toBeCloseTo(0.25 + heightFraction, 2);
      // Solid, not a sliver: a mark clipped by the page edge would still have
      // a plausible corner, and this is what says the whole of it is on the
      // sheet.
      expect(box.coverage, `${where}: the mark's share of the page`).toBeCloseTo(
        widthFraction * heightFraction,
        2,
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// sign-pdf
// ════════════════════════════════════════════════════════════════════════════

test.describe("sign-pdf — real output", () => {
  test("the uploaded signature lands on the chosen page, and nowhere else", async ({ page }) => {
    await page.goto("/sign-pdf");
    await uploadFixture(page, await SAMPLES.pdf());
    await expect(
      surfaceOf(page).locator('img[alt^="Page 1 "]'),
      `the page never rendered: ${await toolError(page)}`,
    ).toBeVisible({ timeout: 90_000 });

    // The Upload arm, which is also the only one reachable without a pointer —
    // the pad is a canvas you draw on.
    await choiceChip(page, "Upload").click();
    await uploadFixture(page, RED_MARK);
    await expect(surfaceOf(page).getByText("40 × 20 PX", { exact: true })).toBeVisible();

    // Width first: the X and Y clamps are computed against the placed box's
    // own size, so setting them before the width would clamp against the old
    // one.
    await numberField(page, "Signature width as a percentage of the page width").fill("26");
    await numberField(page, "Signature left edge as a percentage of the page").fill("50");
    await numberField(page, "Signature top edge as a percentage of the page").fill("60");

    const { name, bytes } = await runTool(page, /Sign PDF/);
    expect(name).toBe("sample-doc-signed.pdf");
    await assertPdf(bytes, { pages: 5 });
    // Each page still carries its own content, in order — not only five pages.
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "signed");

    // ── On page 1 only, at the placement the three fields hold ──
    const width = 0.26 * A4.width;
    const height = (20 / 40) * width;
    const signed = await pageContent(bytes, 0);
    expect(signed).toMatch(/\/Image-\d+ Do/);
    expect((await pageImages(bytes, 0)).map((i) => `${i.width}x${i.height}`)).toContain("40x20");
    expectSomeNear(transformMatrices(signed), [width, 0, 0, height, 0, 0], 0.5, "the signature's size");
    expectSomeNear(
      transformMatrices(signed),
      [1, 0, 0, 1, 0.5 * A4.width, (1 - 0.6) * A4.height - height],
      0.5,
      "the signature's anchor",
    );

    for (let i = 1; i < 5; i++) {
      expect(
        await pageContent(bytes, i),
        `"This page" must leave page ${i + 1} alone`,
      ).not.toMatch(/\/Image-\d+ Do/);
    }

    /*
      And the claim the whole page is written around: this is a PICTURE of a
      signature. `stampPdf` has no cryptography in its import graph at all, so
      the observable half of that promise is that the file gains no signature
      field and no annotation object — which is exactly what a reader would
      offer to validate.
    */
    const { PDFDocument, PDFName } = await import("pdf-lib");
    const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false });
    expect(
      doc.catalog.get(PDFName.of("AcroForm")),
      "a drawn signature must not invent a form to hang a /Sig field on",
    ).toBeUndefined();
    expect(
      await pageAnnotCount(bytes, 0),
      "the mark is page content, not an annotation",
    ).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// annotate-pdf
// ════════════════════════════════════════════════════════════════════════════

test.describe("annotate-pdf — real output", () => {
  test("a highlight and a note both reach the page", async ({ page }) => {
    await page.goto("/annotate-pdf");
    await uploadFixture(page, await SAMPLES.pdf());

    const addHighlight = surfaceOf(page).getByRole("button", { name: "Add highlight", exact: true });
    await expect(addHighlight, `the page never rendered: ${await toolError(page)}`).toBeEnabled({
      timeout: 90_000,
    });
    expect(await statValue(page, "PAGE 1")).toBe(`${A4.width} × ${A4.height} PT`);

    // ── A highlight, sized and placed through the fields ──
    await addHighlight.click();
    await numberField(page, "Mark x as a percentage of the page").fill("10");
    await numberField(page, "Mark y as a percentage of the page").fill("20");
    await numberField(page, "Mark width as a percentage of the page").fill("50");
    await numberField(page, "Mark height as a percentage of the page").fill("6");

    // ── And a note, which is a text stamp anchored at a point ──
    await surfaceOf(page).getByRole("button", { name: "Add note", exact: true }).click();
    await numberField(page, "Mark x as a percentage of the page").fill("15");
    await numberField(page, "Mark y as a percentage of the page").fill("60");
    await surfaceOf(page)
      .getByRole("textbox", { name: "Note text", exact: true })
      .fill("REVIEWED BY QA");
    // Two marks on the page, and the second is the note — the rail's chip list
    // is where that is stated, so a mark that silently failed to be added
    // fails here rather than in the byte assertions below.
    await expect(
      surfaceOf(page).getByRole("button", { name: "1 · Highlight", exact: true }),
    ).toBeVisible();
    await expect(
      surfaceOf(page).getByRole("button", { name: "2 · Note", exact: true }),
    ).toBeVisible();

    const { name, bytes } = await runTool(page, /Annotate page/);
    expect(name).toBe("sample-doc-annotated.pdf");
    await assertPdf(bytes, { pages: 5 });
    // Each page still carries its own content, in order — not only five pages.
    await expectPdfPages(bytes, [1, 2, 3, 4, 5], "annotated");

    const content = await pageContent(bytes, 0);

    // ── The note ──
    expect(content, "the note's wording must be drawn on the page").toContain(
      drawnText("REVIEWED BY QA"),
    );
    // `rotate` is left at 0 by the tool, so the text matrix is upright and its
    // origin is the anchor itself — a note has no height correction.
    expectSomeNear(
      textMatrices(content),
      [1, 0, 0, 1, 0.15 * A4.width, (1 - 0.6) * A4.height],
      0.5,
      "the note's text matrix",
    );

    // ── The highlight ──
    const width = 0.5 * A4.width;
    const height = 0.06 * A4.height;
    // #ffe14d, the tool's opening swatch, as a non-stroking fill.
    expect(content, "the highlight's colour must reach the page").toContain(
      `1 ${0xe1 / 255} ${0x4d / 255} rg`,
    );
    // pdf-lib draws a rectangle as a path relative to a translate, so the
    // corners are `0 h l` and `w h l` and the anchor is the translate. As with
    // an image, the top-left fraction drops by the mark's own height.
    expectSomeNear(lineTargets(content), [0, height], 0.5, "the highlight's top-left corner");
    expectSomeNear(lineTargets(content), [width, height], 0.5, "the highlight's top-right corner");
    expectSomeNear(
      transformMatrices(content),
      [1, 0, 0, 1, 0.1 * A4.width, (1 - 0.2) * A4.height - height],
      0.5,
      "the highlight's anchor",
    );
    // Translucent, and by the amount the opacity control opens on: a highlight
    // drawn at full strength covers the text it is supposed to tint.
    expect(await pageFillAlphas(bytes, 0), "the highlight must be translucent").toContain(0.35);

    // ── What the page promises it does NOT do ──
    expect(
      await pageAnnotCount(bytes, 0),
      "the marks are painted into the page, so no annotation object may appear",
    ).toBe(0);
    expect(content, "the page's own text must survive being marked up").toContain(
      drawnText("Transmute conversion fixture"),
    );
    for (let i = 1; i < 5; i++) {
      const other = await pageContent(bytes, i);
      expect(other, `only the marked page changes — page ${i + 1} must not`).not.toContain(
        drawnText("REVIEWED BY QA"),
      );
      expect(other).not.toContain(`1 ${0xe1 / 255} ${0x4d / 255} rg`);
    }
  });
});
