import { describe, expect, it } from "vitest";
import {
  foldPdfTextItems,
  joinPdfPages,
  pdfPageMarker,
  type PdfTextFragment,
} from "@/lib/tools/pdf-text";

/*
  These tests drive the pure line-reconstruction half of pdf-text.ts. The pdfjs
  half is deliberately NOT exercised here: jsdom has no canvas and no real
  Worker, so a pdfjs document would either fail to open or silently take a
  different code path than the browser does — the blind spot this project has
  already been bitten by. What IS testable is the folding, which is where all
  the interesting decisions live.

  Every item shape below was harvested from a real document rendered through
  the repo's own pdfjs (5.6.205): the zero-height `str: ""` line terminator
  that carries the NEXT line's baseline, the synthesised `str: " "` between two
  fragments of one visual line, and the content-stream ordering of a
  two-column page. See the comments on each block for the source.
*/

/** One pdfjs text item. `y` is `transform[5]` — unrotated user space. */
function item(
  str: string,
  y: number,
  hasEOL: boolean,
  height: number = 10,
): PdfTextFragment {
  return { str, hasEOL, transform: [height, 0, 0, height, 0, y], height };
}

/** pdfjs's zero-height line terminator: no glyphs, next line's baseline. */
function eolMarker(nextY: number): PdfTextFragment {
  return { str: "", hasEOL: true, transform: [0, 0, 0, 0, 0, nextY], height: 0 };
}

/** `n` body lines at `leading` apart, starting at `y`. */
function body(lines: string[], y: number, leading: number): PdfTextFragment[] {
  return lines.map((text, i) => item(text, y - i * leading, true));
}

describe("foldPdfTextItems", () => {
  it("returns an empty string for a page with no text items", () => {
    // An image-only (scanned) page: pdfjs really does return `items: []` —
    // verified against a pdf-lib page carrying only a filled rectangle.
    expect(foldPdfTextItems([])).toBe("");
  });

  it("flushes the last line even though it carries no hasEOL", () => {
    // Real pages end this way: the final item of the last line on every page
    // of the repo's sample-doc.pdf has hasEOL false.
    expect(foldPdfTextItems([item("only line", 700, false)])).toBe("only line");
  });

  it("concatenates fragments of one line verbatim, adding no spacing of its own", () => {
    // A mid-line font change on one baseline. pdfjs synthesises the gap as its
    // own zero-height `str: " "` item, so a folder that inserts a separator
    // between fragments would emit a double space here.
    const line: PdfTextFragment[] = [
      item("mixed line start", 480, false),
      { str: " ", hasEOL: false, transform: [0, 0, 0, 0, 117.24, 480], height: 0 },
      item("BOLD TAIL", 480, false),
    ];
    expect(foldPdfTextItems(line)).toBe("mixed line start BOLD TAIL");
  });

  it("splits lines on hasEOL, not on the baseline order", () => {
    /*
      The load-bearing case. `transform[5]` is unrotated user space with y
      growing upward and /Rotate NOT applied, so a reconstruction that sorted
      by y would emit a bottom-up content stream in the wrong order. These
      three lines ASCEND in y; content order is still the reading order.
    */
    const items = [
      item("first", 100, true),
      item("second", 120, true),
      item("third", 140, false),
    ];
    expect(foldPdfTextItems(items)).toBe("first\nsecond\nthird");
  });

  it("does not let the zero-height line terminator claim the line's baseline", () => {
    /*
      The exact shape of page 1 of sample-doc.pdf: a 32pt title, then a
      zero-height terminator whose transform already carries the NEXT line's y.
      Reading the line's y off that marker would shift every baseline by one
      line and mis-measure the leading — the title would look like body text
      and the blank line under it would disappear.
    */
    const items = [
      item("Page 1", 760, false, 32),
      eolMarker(715),
      item("Transmute conversion fixture", 715, false, 16),
      eolMarker(660),
      ...body(["01 body line", "02 body line", "03 body line", "04 body line"], 660, 22),
    ];
    expect(foldPdfTextItems(items)).toBe(
      "Page 1\n\nTransmute conversion fixture\n\n01 body line\n02 body line\n03 body line\n04 body line",
    );
  });

  it("breaks a paragraph only where the gap clears 1.6x the body leading", () => {
    const items = [
      ...body(["a1", "a2", "a3", "a4"], 700, 14),
      // 14 * 1.6 = 22.4 — a 22pt gap is still a wrap, a 23pt gap is a break.
      ...body(["b1", "b2"], 700 - 3 * 14 - 22, 14),
      ...body(["c1", "c2"], 700 - 3 * 14 - 22 - 14 - 23, 14),
    ];
    expect(foldPdfTextItems(items)).toBe("a1\na2\na3\na4\nb1\nb2\n\nc1\nc2");
  });

  it("takes the MEDIAN leading, so one heading gap cannot raise the threshold", () => {
    /*
      Mean-based thresholds fail exactly here: eight 14pt gaps and one 60pt
      heading gap average 19.1, and 1.6x that is 30.6 — the 60pt gap still
      breaks, but a second 31pt gap in the same page would not. The median is
      14 whatever the heading does.
    */
    const items = [
      item("A Heading With Air Above It", 780, true, 20),
      ...body(["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"], 720, 14),
      // 720 - 7*14 = 622; a 31pt gap lands at 591. Under a mean-based
      // threshold (30.6) this would NOT break.
      ...body(["p1", "p2"], 591, 14),
    ];
    expect(foldPdfTextItems(items)).toBe(
      "A Heading With Air Above It\n\nl1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n\np1\np2",
    );
  });

  it("sorts the leading deltas numerically, so the median is not a string sort", () => {
    /*
      `median()` sorts with an explicit `(a, b) => a - b`. JavaScript's default
      `Array.prototype.sort` compares STRINGS, and the two orders disagree the
      moment the deltas straddle a digit-count boundary — which real body text
      does constantly, because a producer that rounds baselines emits 9, 10 and
      11pt gaps on one page.

      Measured on this fixture (baselines 700, 691, 681, 670, 653 → deltas
      9, 10, 11, 17): the numeric sort is [9, 10, 11, 17], median (10+11)/2 =
      10.5, threshold 16.8, so the closing 17pt gap IS a paragraph break. The
      default sort is ["10", "11", "17", "9"], median (11+17)/2 = 14, threshold
      22.4, and the break silently disappears. Replacing the comparator with a
      bare `.sort()` turns the expectation below into "t1\nt2\nt3\nt4\nt5" —
      verified by mutation; none of the other fixtures here notice, because
      their deltas all have the same number of digits.

      This also pins the even-count branch of `median()` (the mean of the two
      middles): with four deltas, taking `sorted[mid]` alone would give 11 and
      a 17.6 threshold, which likewise loses the break.

      Both mutations were run against this file: `.sort()` → 1 failed / 20
      passed, and `return sorted[mid];` → 1 failed / 20 passed. In both cases
      the single failure is this test.
    */
    const items = [
      item("t1", 700, true),
      item("t2", 691, true),
      item("t3", 681, true),
      item("t4", 670, true),
      item("t5", 653, false),
    ];
    expect(foldPdfTextItems(items)).toBe("t1\nt2\nt3\nt4\n\nt5");
  });

  it("keeps two lines sharing a baseline out of the leading median", () => {
    /*
      The zero-delta exclusion at pdf-text.ts:200 (`if (d > 0)`), which the
      comment above it calls load-bearing. Lines that share a baseline carry no
      leading information — a caption pdfjs split beside a figure, or a table
      row, whose cells this module's header comment says "arrive as separate
      lines" — and counting their 0pt delta drags the median toward 0.

      Both directions of the damage are pinned here, because the median can be
      dragged either side of a real gap:

        · The caption pair below yields deltas [100] and a 160pt threshold, so
          the 100pt gap is a wrap. Keeping the zeros gives [0, 100], median 50,
          threshold 80 — and a paragraph break appears out of nowhere:
          "a\nb\n\nc".
        · The 3x3 table yields deltas [20, 20] (the three cells of each row are
          one baseline apart from the next row's), median 20, threshold 32, so
          the 60pt drop to the body text IS a break. Keeping the zeros gives
          six 0s among two 20s, median 0 — and `leading > 0` at line 210 then
          short-circuits EVERY paragraph break on the page away.

      Measured, not assumed. Replacing the two guarded lines with
      `deltas.push(Math.abs(a - b));` and re-running this file: 1 failed, 20
      passed — the failure is this test, and BOTH assertions below kill the
      mutant independently (the table half was re-run on its own to check that
      it is not carried by the caption half). The other fourteen fixtures in
      this describe are blind to the guard.
    */
    expect(
      foldPdfTextItems([item("a", 500, true), item("b", 500, true), item("c", 400, false)]),
    ).toBe("a\nb\nc");

    const table = [
      item("Region", 600, true),
      item("Q1", 600, true),
      item("Q2", 600, true),
      item("North", 580, true),
      item("11", 580, true),
      item("12", 580, true),
      item("South", 560, true),
      item("21", 560, true),
      item("22", 560, true),
      item("Body text follows the table.", 500, false),
    ];
    expect(foldPdfTextItems(table)).toBe(
      "Region\nQ1\nQ2\nNorth\n11\n12\nSouth\n21\n22\n\nBody text follows the table.",
    );
  });

  it("trims the whitespace the page's own margins leave on the first and last line", () => {
    /*
      The closing `out.trim()`. `foldLines` concatenates each line's fragments
      verbatim, so an indented opening line or a trailing-space closing line
      arrives with that whitespace attached and would otherwise be handed to
      the clipboard and the .txt download. Dropping the `.trim()` returns
      "   Indented opening line\nclosing line   " here. Measured: `return out;`
      instead of `return out.trim();` → 1 failed / 20 passed in this file, and
      the failure is this test — nothing else here notices.
    */
    const items = [
      item("   Indented opening line", 700, true),
      item("closing line   ", 686, false),
    ];
    expect(foldPdfTextItems(items)).toBe("Indented opening line\nclosing line");
  });

  it("breaks where a second column restarts at the top of the page", () => {
    /*
      Two-column reality, harvested from a real page: pdfjs emits the whole
      left column, then the whole right column, and the baseline jumps back UP
      by 202pt at the seam. The delta is taken absolute so the jump reads as a
      break rather than as a negative (and therefore sub-threshold) gap.

      Note what this test does NOT claim: the columns are not interleaved back
      into reading order. One column follows the other, and the UI says so.
    */
    const items = [
      ...body(["left 1", "left 2", "left 3", "left 4"], 720, 14),
      ...body(["right 1", "right 2", "right 3"], 720, 14),
    ];
    expect(foldPdfTextItems(items)).toBe(
      "left 1\nleft 2\nleft 3\nleft 4\n\nright 1\nright 2\nright 3",
    );
  });

  it("turns a run of whitespace-only lines into a single paragraph break", () => {
    /*
      Two blank lines in, one blank line out — and the break survives even
      though geometry alone could not prove it here: after the blanks are
      dropped there is exactly one gap left, so the gap IS the median and
      nothing can exceed 1.6x it.
    */
    const items = [
      item("head", 700, true),
      item("   ", 660, true),
      item("    ", 600, true),
      item("tail", 540, false),
    ];
    expect(foldPdfTextItems(items)).toBe("head\n\ntail");
  });

  it("ignores blank lines above the first line of text", () => {
    const items = [item("  ", 780, true), item("first real line", 700, false)];
    expect(foldPdfTextItems(items)).toBe("first real line");
  });

  it("emits plain newlines when no baseline information survives", () => {
    // Every item zero-height: there is no leading to measure, so the folder
    // must not invent paragraph breaks out of a zero median.
    const items = [
      { str: "one", hasEOL: true, transform: [0, 0, 0, 0, 0, 100], height: 0 },
      { str: "two", hasEOL: true, transform: [0, 0, 0, 0, 0, 900], height: 0 },
      { str: "three", hasEOL: false, transform: [0, 0, 0, 0, 0, 20], height: 0 },
    ];
    expect(foldPdfTextItems(items)).toBe("one\ntwo\nthree");
  });

  it("survives a malformed transform without throwing", () => {
    const items: PdfTextFragment[] = [
      { str: "short matrix", hasEOL: true, transform: [], height: 10 },
      item("normal", 500, false),
    ];
    expect(foldPdfTextItems(items)).toBe("short matrix\nnormal");
  });
});

describe("joinPdfPages", () => {
  it("marks every page when there is more than one", () => {
    expect(joinPdfPages(["alpha", "beta"])).toBe(
      "--- Page 1 ---\n\nalpha\n\n--- Page 2 ---\n\nbeta",
    );
  });

  it("adds no marker to a single-page document", () => {
    expect(joinPdfPages(["alpha"])).toBe("alpha");
  });

  it("keeps an empty page visible as a bare marker", () => {
    // A scanned page in an otherwise digital document has to leave a trace,
    // or the output silently pretends the page did not exist.
    expect(joinPdfPages(["", "beta", ""])).toBe(
      "--- Page 1 ---\n\n--- Page 2 ---\n\nbeta\n\n--- Page 3 ---",
    );
  });

  it("drops empty pages entirely when markers are off", () => {
    expect(joinPdfPages(["alpha", "", "beta"], false)).toBe("alpha\n\nbeta");
  });

  it("returns nothing but markers for a document with no text at all", () => {
    expect(joinPdfPages(["", "", ""], true)).toBe(
      "--- Page 1 ---\n\n--- Page 2 ---\n\n--- Page 3 ---",
    );
    expect(joinPdfPages(["", "", ""], false)).toBe("");
    expect(joinPdfPages([])).toBe("");
  });

  it("numbers markers from 1", () => {
    expect(pdfPageMarker(1)).toBe("--- Page 1 ---");
    expect(pdfPageMarker(42)).toBe("--- Page 42 ---");
  });
});
