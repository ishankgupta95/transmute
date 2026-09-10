import type { ProcessingContext } from "@/hooks/useFileProcessor";
import { abortError } from "@/lib/utils/abort";
import { loadPdfjsDocument } from "./pdf-engine";

/**
 * Text extraction from a PDF's text layer, via pdfjs.
 *
 * This is a READER, not an OCR engine. A PDF either carries a text layer —
 * glyph codes plus a font that maps them back to Unicode — or it does not. A
 * scan is a photograph of a page: pdfjs returns `items: []` for it, and no
 * amount of coaxing produces characters that were never in the file. That
 * empty result is reported as `emptyPages` precisely so the UI can say so out
 * loud instead of handing back a blank download.
 *
 * It lives here rather than in pdf-engine-core.ts because it is a pdfjs op,
 * not a pdf-lib one: pdfjs ships its own worker for the parse, so the main
 * thread is not the one doing the work and there is nothing to hand to the
 * pdf-lib pool worker. Same reasoning that keeps `pdfToImages` in
 * pdf-engine.ts.
 *
 * What this CANNOT do, and what the UI copy must therefore say:
 *  - No OCR. Image-only pages come back empty.
 *  - No layout. A two-column page is emitted in content-stream order, which
 *    for the pages we measured means the whole left column, then the whole
 *    right column — not interleaved as a human reads it. Tables lose their
 *    cell structure entirely; a row's cells arrive as separate lines.
 */

/**
 * The only fields of pdfjs's `TextItem` the line folder reads.
 *
 * Declared structurally rather than importing pdfjs's `TextItem` so the folding
 * logic — the part with the interesting bugs — is testable under jsdom without
 * pulling in pdfjs and its worker. `TextItem` is assignable to this.
 */
export interface PdfTextFragment {
  str: string;
  hasEOL: boolean;
  /** pdfjs's six-number text matrix. `[5]` is the baseline y — see below. */
  transform: number[];
  /** Height in text space. pdfjs's synthesised spacing items report 0. */
  height: number;
}

export interface PdfTextResult {
  /** Every page, joined — with page markers when there is more than one page. */
  text: string;
  pageCount: number;
  /**
   * 1-based page numbers that produced no text at all: pdfjs returned zero
   * text items (a scanned or image-only page, or a genuinely blank one), or
   * only whitespace. This is the signal for the "no text layer, and there is
   * no OCR here" warning.
   */
  emptyPages: number[];
  /**
   * Per-page text, in page order. Present so the caller can re-join with or
   * without page markers — a checkbox in the UI — without re-parsing the
   * document, which for a 500-page file is seconds of work.
   */
  pages: string[];
}

/**
 * A line break is worth this many multiples of the body leading before it
 * counts as a paragraph break rather than a wrap.
 *
 * 1.6 sits above the widest ordinary line spacing (double-spaced body text is
 * 2.0 of the FONT size but ~1.15–1.5 of the measured baseline-to-baseline
 * leading, since leading already includes the line's own height) and below the
 * gap a heading or a figure leaves behind. Measured on a synthetic two-column
 * page: 14pt body leading, paragraph gaps of 60–62pt and a column jump of
 * 202pt — every real break cleared 22.4pt, no wrap came close.
 */
const PARAGRAPH_LEADING_RATIO = 1.6;

interface FoldedLine {
  text: string;
  /** Baseline y, or null when nothing in the line carried a usable one. */
  y: number | null;
  /** A blank line stood here in the content stream — always a paragraph break. */
  breakBefore: boolean;
}

/**
 * Split a page's items into visual lines.
 *
 * `hasEOL` is the line splitter, NOT geometry, and that is load-bearing.
 * `transform[5]` is UNROTATED user space: y grows upward and the page's
 * `/Rotate` is NOT applied to it — measured on a `/Rotate 90` fixture, where
 * pdfjs reported exactly the content-space baselines the page was written
 * with. So the visual top-to-bottom order of a rotated page does not run along
 * `transform[5]` at all (at 90° it runs along x, at 180° it runs the other way
 * up), and any reconstruction that sorts by that number reorders the page for
 * three of the four rotations. `hasEOL` is computed by pdfjs in text space
 * from the text matrix itself, so it needs no sort and no rotation handling:
 * items in content-stream order, split where pdfjs says the line ended.
 * Verified on the same fixture: six lines, five `hasEOL`, reading order intact.
 *
 * Fragments are concatenated verbatim. pdfjs already synthesises the
 * inter-fragment spacing as its own `str: " "` items (height 0) — a mid-line
 * font change on one baseline arrives as `["mixed line start", " ", "BOLD
 * TAIL"]` — so inserting our own separator would double every such space.
 */
function foldLines(items: readonly PdfTextFragment[]): FoldedLine[] {
  const lines: FoldedLine[] = [];
  let text = "";
  let y: number | null = null;
  let blankSeen = false;

  const flush = () => {
    /*
      A whitespace-only line is not emitted as a blank line; it is remembered
      as a break and dropped. Emitting it would put a baseline that carries no
      glyphs into the leading median, and it would double up with the doubled
      baseline gap such a line already leaves behind — one blank line in,
      two blank lines out. Remembering it instead keeps the break in the rare
      case where geometry alone cannot prove it (a page of two lines: the only
      gap IS the median, so nothing can ever exceed 1.6x it).
    */
    if (text.trim() === "") {
      if (lines.length > 0) blankSeen = true;
    } else {
      lines.push({ text, y, breakBefore: blankSeen });
      blankSeen = false;
    }
    text = "";
    y = null;
  };

  for (const item of items) {
    text += item.str;
    // The line's y comes from its first item with real extent. pdfjs closes a
    // line with a zero-height `str: ""` marker whose transform already carries
    // the NEXT line's baseline — taking that would shift every line's y by one
    // and wreck the leading median.
    if (y === null && item.height > 0 && typeof item.transform?.[5] === "number") {
      y = item.transform[5];
    }
    if (item.hasEOL) flush();
  }
  flush();

  return lines;
}

/** Median of a non-empty list. Even counts take the mean of the two middles. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Rebuild one page's text from its pdfjs text items.
 *
 * Exported for the unit tests: this is the whole of the interesting logic, and
 * jsdom cannot run the pdfjs half (no canvas, no worker), so the tests drive
 * this directly with item arrays harvested from real documents.
 */
export function foldPdfTextItems(items: readonly PdfTextFragment[]): string {
  const lines = foldLines(items);
  if (lines.length === 0) return "";

  /*
    Body leading is the MEDIAN baseline-to-baseline distance, not the mean.
    A page with one 20pt heading and forty 14pt body lines has a mean pulled
    upward by the heading's 60pt gap; the median ignores it, which is the
    point — the threshold has to be calibrated on the body, since the body is
    what must NOT be broken into paragraphs.

    Deltas are absolute: content order runs down a column, so consecutive
    baselines normally DECREASE, but a second column restarts at the top of
    the page and produces a large positive jump. Both are breaks.

    Zero deltas (two lines sharing a baseline, e.g. a caption beside a figure
    that pdfjs split) carry no leading information and would drag the median
    toward 0, so they are excluded.
  */
  const deltas: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1].y;
    const b = lines[i].y;
    if (a === null || b === null) continue;
    const d = Math.abs(a - b);
    if (d > 0) deltas.push(d);
  }
  const leading = deltas.length > 0 ? median(deltas) : 0;

  let out = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1].y;
    const b = lines[i].y;
    const gap =
      lines[i].breakBefore ||
      (leading > 0 &&
        a !== null &&
        b !== null &&
        Math.abs(a - b) > leading * PARAGRAPH_LEADING_RATIO);
    out += gap ? "\n\n" : "\n";
    out += lines[i].text;
  }

  /*
    No blank-run collapsing pass is needed: `foldLines` never emits an empty
    line (whitespace-only ones become `breakBefore` instead), and each join
    adds at most one blank line before non-empty text, so three consecutive
    newlines cannot occur. The trim drops what the page's own top and bottom
    margins contribute.
  */
  return out.trim();
}

/** The marker written before each page's text when page markers are on. */
export function pdfPageMarker(pageNumber: number): string {
  return `--- Page ${pageNumber} ---`;
}

/**
 * Join per-page text into one document.
 *
 * `withMarkers` defaults on, because without them a page break is
 * indistinguishable from a paragraph break and there is no way to tell which
 * page a passage came from. A single-page document never gets a marker: there
 * is nothing to separate, and the header would just be noise at the top of the
 * output.
 */
export function joinPdfPages(pages: readonly string[], withMarkers: boolean = true): string {
  if (!withMarkers || pages.length < 2) {
    return pages
      .filter((p) => p !== "")
      .join("\n\n")
      .trim();
  }
  return pages
    .map((page, i) => (page === "" ? pdfPageMarker(i + 1) : `${pdfPageMarker(i + 1)}\n\n${page}`))
    .join("\n\n")
    .trim();
}

/**
 * Extract the text layer of every page.
 *
 * Cancellation is COOPERATIVE, checked between pages, and that is not a style
 * choice: `doc.destroy()` called while a `getTextContent()` is in flight
 * leaves that promise PENDING FOREVER — pdfjs neither resolves nor rejects it,
 * so an `await` on it never returns and the caller's `finally` never runs.
 * So the signal is only ever read between pages, and the destroy happens in a
 * `finally` once no page request is outstanding.
 */
export async function extractPdfText(
  data: ArrayBuffer | Uint8Array,
  ctx: ProcessingContext = {},
): Promise<PdfTextResult> {
  /*
    No catch here on purpose. This module used to map pdfjs's PasswordException
    and InvalidPDFException to the house sentences itself, with its own copy of
    both strings — while `pdfToImages`, opening a document through the very
    same library, mapped nothing and put pdfjs's raw English ("No password
    given") in front of pdf-to-jpg users. The mapping now lives inside
    `loadPdfjsDocument` (see `openPdfjsDocument` in pdf-engine.ts), so every
    pdfjs entry point gets it and there is one copy of the wording instead of
    two. Duplicating it back here would only let the two drift apart again.
  */
  const doc = await loadPdfjsDocument(data);

  try {
    const pageCount = doc.numPages;
    const pages: string[] = [];
    const emptyPages: number[] = [];

    for (let i = 1; i <= pageCount; i++) {
      // Between pages, never during one — see the doc comment above.
      if (ctx.signal?.aborted) throw abortError();

      const page = await doc.getPage(i);
      /*
        No parameters. `getTextContent` in pdfjs 5 accepts only
        `includeMarkedContent` and `disableNormalization`; the v2/v3
        `normalizeWhitespace` and `disableCombineTextItems` options are GONE
        and are SILENTLY IGNORED when passed, so a tutorial snippet that sets
        them looks correct and does nothing. Marked content is left out
        deliberately: those items carry no `str` and we would only filter them
        back out. Normalization stays ON (the default): read at
        pdf.worker.mjs's `normalizeUnicode`, it NFKC-folds the Latin ligature
        block (U+FB00-04 — "ﬁ" becomes "fi", so the word is searchable) and the
        exotic space characters (NBSP, the U+2000 range) into plain ones, and
        nothing else. It does NOT strip soft hyphens.
      */
      const content = await page.getTextContent();
      // `'str' in item` is the only safe discriminator: `TextMarkedContent`
      // has no `str` at all, and pdfjs types the array as the union of both.
      const fragments: PdfTextFragment[] = [];
      for (const item of content.items) {
        if ("str" in item) fragments.push(item);
      }
      const text = foldPdfTextItems(fragments);
      pages.push(text);
      if (text === "") emptyPages.push(i);

      // Releases the page's parsed operator list in the pdfjs worker. Without
      // it a 500-page extraction keeps all 500 alive until destroy().
      page.cleanup();
      ctx.onProgress?.((i / pageCount) * 100);
    }

    return { text: joinPdfPages(pages), pageCount, emptyPages, pages };
  } finally {
    await doc.destroy();
  }
}
