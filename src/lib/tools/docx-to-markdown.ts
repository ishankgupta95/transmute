/**
 * Reading a Word .docx into Markdown, and counting what the trip costs.
 *
 * ── The chain ───────────────────────────────────────────────────────────────
 *
 *   .docx ──mammoth──▶ a small, deliberately plain HTML ──turndown──▶ Markdown
 *
 * `mammoth` (BSD-2-Clause) is the reader. It is not a general OOXML parser and
 * does not pretend to be: it maps a fixed, documented set of Word constructs to
 * semantic HTML and IGNORES the rest, which is the right shape for this job —
 * Markdown has nowhere to put a font, a colour or a text frame either. The
 * prebuilt `mammoth.browser.min.js` is used rather than the `lib/` entry point
 * because it is the bundle the package publishes for browsers — its own
 * `prepare` script builds it, and its `browser` field swaps the node unzip and
 * file-reading paths for jszip ones.
 *
 * `turndown` is the writer, and it is the SAME writer the html-to-markdown page
 * uses — `TURNDOWN_OPTIONS` below is character-for-character the options object
 * in `HtmlToMarkdownUI.tsx`, so a heading is `##` and a fenced block is ``` on
 * both pages.
 *
 * ── The rules added on top, and why each one is not optional ────────────────
 *
 * Plain turndown has no rule for `<table>`. Its fallback keeps a table's TEXT
 * and throws the grid away, so a three-column Word table lands in a .md file as
 * one paragraph per cell, in reading order, with nothing to say a table was
 * ever there. Word documents are full of tables. So this module adds a GFM
 * pipe-table rule (`mdTable*` below) — and, where a pipe table genuinely cannot
 * hold the table (a vertical merge, or a table nested in a cell), keeps the
 * original HTML instead of writing a wrong one. Every table that takes that
 * exit is COUNTED, and so is every horizontal merge that had to be padded out.
 *
 * The same argument covers footnotes (mammoth emits an anchor and a list of
 * back-links, which in a .md file are dead links to nowhere — GFM `[^1]` is the
 * same information that actually works) and strikethrough (`<s>`, which plain
 * turndown erases without trace). `<sup>` and `<sub>` are KEPT as HTML because
 * Markdown has no syntax for them and dropping the tag changes what the text
 * says — `x2` is not `x²`.
 *
 * These four additions are the whole difference from the html-to-markdown
 * page's writer. They are additive: nothing turndown already did changes.
 *
 * ── What this module does that mammoth does not ─────────────────────────────
 *
 * Mammoth's `messages` array names the styles it did not recognise, which is
 * useful and is surfaced verbatim. It says nothing about the parts of the
 * package it never opened — headers, footers, comments, tracked deletions,
 * macros, embedded objects — because from mammoth's point of view they do not
 * exist. Those are exactly the things a reader is surprised to find missing, so
 * `readDocxPackageFacts` opens the ZIP a second time and COUNTS them, and the
 * page reports the ones this document actually contains rather than reciting a
 * standing list of caveats.
 *
 * Nothing here is DOM-free: turndown needs a DOM and so does the fact scan over
 * mammoth's HTML. It cannot go in a worker.
 */

import TurndownService from "turndown";

/*
  No types ship for the prebuilt browser bundle (mammoth's own `lib/index.d.ts`
  describes the `lib/` entry point), so the surface used here is declared
  locally and the import is cast to it once, at the single call site below.
*/
interface MammothImage {
  contentType?: string | null;
  altText?: string | null;
  read(encoding: "base64"): Promise<string>;
}

interface MammothMessageIn {
  type?: string;
  message?: string;
}

interface MammothResult {
  value: string;
  messages: MammothMessageIn[];
}

interface MammothApi {
  convertToHtml(
    input: { arrayBuffer: ArrayBuffer },
    options?: {
      convertImage?: unknown;
    },
  ): Promise<MammothResult>;
  images: {
    imgElement(
      handler: (image: MammothImage) => Promise<{ src: string; alt?: string }>,
    ): unknown;
  };
}

/** One of mammoth's own diagnostics, normalised. */
export interface DocxMessage {
  type: "warning" | "error" | "info";
  message: string;
}

/** An image lifted out of the package, ready to be written beside the .md. */
export interface DocxImageFile {
  /** Path inside the download, e.g. `media/image-1.png`. */
  name: string;
  bytes: Uint8Array;
  contentType: string;
}

export type ImageMode = "reference" | "embed" | "drop";
export type TableMode = "pipe" | "html";

/**
 * What the ZIP contains that mammoth never reads. Every field is a count of
 * things found in THIS package — a zero means the document does not have any,
 * not that the scan skipped it.
 */
export interface DocxPackageFacts {
  /** `word/header*.xml` and `word/footer*.xml` parts. Never read by mammoth. */
  headers: number;
  footers: number;
  /** `<w:comment>` elements in `word/comments.xml`. */
  comments: number;
  /** Tracked insertions (kept, as if accepted) and deletions (dropped). */
  insertions: number;
  deletions: number;
  /** Files under `word/media/`, and their total size on disk. */
  mediaFiles: number;
  mediaBytes: number;
  /** OLE objects under `word/embeddings/`, and charts under `word/charts/`. */
  embeddedObjects: number;
  charts: number;
  /** Run properties mammoth's default style map has no output for. */
  underlinedRuns: number;
  highlightedRuns: number;
  colouredRuns: number;
  /** `<w:txbxContent>` — text frames. Mammoth DOES read these. */
  textBoxes: number;
  /** Field codes (`PAGE`, `TOC`, `REF`…) and how many runs carry one. */
  fields: string[];
  fieldRuns: number;
  /** `word/vbaProject.bin` — a .docm rather than a .docx. */
  macros: boolean;
}

/** What mammoth's HTML turned out to contain, counted before the rewrite. */
export interface DocxDocFacts {
  headings: number;
  paragraphs: number;
  links: number;
  /**
   * Pictures that reached the Markdown — a link in reference mode, a data URI
   * in embed mode. In "drop" mode no bytes are read at all, so this is every
   * picture the body held, which is what "N images were removed" has to count.
   * A picture mammoth placed but could NOT read is in `unreadableImages`, not
   * here: this number and `DocxConversion.images` have to agree, because one
   * writes the sentence and the other writes the download.
   */
  images: number;
  /**
   * Pictures mammoth put in the body and then could not read out of the
   * package — a linked (`TargetMode="External"`) picture, or a `word/media/`
   * part that is not in the ZIP. They reach neither the Markdown nor the
   * download. Always 0 in "drop" mode, where nothing is read.
   */
  unreadableImages: number;
  listItems: number;
  tables: number;
  tableRows: number;
  /** Cells with `colspan` > 1, anywhere in the document. */
  colspanCells: number;
  /** Cells with `rowspan` > 1: a pipe table cannot hold these at all. */
  rowspanCells: number;
  /** Tables inside a cell of another table. */
  nestedTables: number;
  /** Tables that came out as GFM pipe syntax. */
  pipeTables: number;
  /**
   * Tables that came out as HTML — the ones that took the exit themselves AND
   * the ones carried along inside an ancestor's `outerHTML`. `pipeTables +
   * htmlTables === tables`, always.
   */
  htmlTables: number;
  /**
   * Cells whose rendered content came out as more than one line — several
   * paragraphs, a list, or a `<br>` — and so had to be flattened into one.
   * Counted from what the writer actually produced rather than from the cell's
   * child elements, because a cell holding one `<ul>` has a single child and
   * still collapses. A cell holding a nested TABLE is excluded: the table
   * around it always takes the HTML exit, so that cell is never flattened and
   * its several lines are the inner table's markup rather than lost structure.
   */
  multilineCells: number;
  /*
    `colspanCells` and `multilineCells` restricted to the tables that ACTUALLY
    become pipe tables on this run. A merged cell inside a table that took the
    HTML exit is not padded out and not flattened — it survives intact — so
    reporting the whole-document figure as "cells we had to pad" would overstate
    the loss.
  */
  pipeColspanCells: number;
  pipeMultilineCells: number;
  /**
   * How many of those flattened pipe-table cells held a LIST. A list glued
   * into one cell with `<br>` loses more than its line breaks — the bullets
   * survive as literal characters and it stops being a list — so the page
   * says so, and only when it happened.
   */
  pipeListCells: number;
  footnotes: number;
  endnotes: number;
  strikethroughRuns: number;
  superscriptRuns: number;
  subscriptRuns: number;
}

export interface DocxConversion {
  markdown: string;
  /** Mammoth's HTML, before turndown. Kept for the preview's HTML view. */
  html: string;
  images: DocxImageFile[];
  messages: DocxMessage[];
  packageFacts: DocxPackageFacts;
  docFacts: DocxDocFacts;
  /** Whitespace-separated runs in the document's text. */
  words: number;
}

/**
 * A file this reader cannot open, with a sentence written for the person who
 * dropped it rather than for a stack trace.
 */
export class DocxReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocxReadError";
  }
}

/* ── Turndown ───────────────────────────────────────────────────────────── */

/**
 * The html-to-markdown page's options, verbatim. Both pages must produce the
 * same Markdown for the same HTML; a second, differently-tuned writer would be
 * a bug that only shows up when someone compares the two.
 */
export const TURNDOWN_OPTIONS = { headingStyle: "atx", codeBlockStyle: "fenced" } as const;

/** Element children only — `childNodes` counts the whitespace between tags. */
function elementChildren(node: Element | null): Element[] {
  return node ? Array.from(node.children) : [];
}

function attrNumber(node: Element, name: string): number {
  const raw = node.getAttribute(name);
  const n = raw === null ? 1 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** A footnote/endnote body item — mammoth stamps these ids and nothing else. */
function isNoteItem(node: Element): boolean {
  return node.nodeName === "LI" && /^(?:foot|end)note-\d+$/.test(node.id);
}

/** Mammoth's inline marker: a `<sup>` wrapping a link into the note list. */
function isNoteRef(node: Element): boolean {
  if (node.nodeName !== "SUP") return false;
  const link = node.querySelector("a");
  return link !== null && /^#(?:foot|end)note-\d+$/.test(link.getAttribute("href") ?? "");
}

function isNoteList(node: Element): boolean {
  if (node.nodeName !== "OL") return false;
  const items = elementChildren(node);
  return items.length > 0 && items.every(isNoteItem);
}

/**
 * True when a GFM pipe table would MISSTATE this table.
 *
 * A horizontal merge can be padded out with empty cells and still read
 * correctly. A vertical merge cannot: the rows underneath it are short, and
 * every value in them slides one column to the left. Same for a table nested
 * in a cell — a pipe table has no cell that can hold one.
 */
function tableNeedsHtml(table: Element): boolean {
  const cells = Array.from(table.querySelectorAll("td,th"));
  if (cells.some((cell) => attrNumber(cell, "rowspan") > 1)) return true;
  return cells.some((cell) => cell.querySelector("table") !== null);
}

/**
 * True when this table's own markup survives into the output — either because
 * it took the HTML exit itself, or because an ANCESTOR did and carried it along
 * inside `outerHTML`. A table in the second case is not a pipe table either,
 * and counting it as one is what makes the page claim a reshaping that never
 * happened.
 */
function tableStaysHtml(table: Element, tableMode: TableMode): boolean {
  if (tableMode === "html" || tableNeedsHtml(table)) return true;
  for (
    let ancestor = table.parentElement?.closest("table") ?? null;
    ancestor !== null;
    ancestor = ancestor.parentElement?.closest("table") ?? null
  ) {
    if (tableNeedsHtml(ancestor)) return true;
  }
  return false;
}

function tableRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll("tr")).filter(
    // A row belonging to a table nested inside this one is not this table's.
    (row) => row.closest("table") === table,
  );
}

/** The non-empty lines a cell's rendered content came out as. */
function cellLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** `|` is the column separator, so one inside a value has to be escaped. */
function cellText(lines: string[]): string {
  return lines.join("<br>").replace(/\|/g, "\\|");
}

/**
 * The cell counts that can only be known from what the writer produced.
 * `applyDocxRules` fills these in as turndown walks the tree.
 */
interface CellCounts {
  multiline: number;
  pipeMultiline: number;
  pipeList: number;
}

interface TurndownRule {
  filter: (node: Element) => boolean;
  replacement: (content: string, node: Element) => string;
}

interface TurndownLike {
  addRule(key: string, rule: TurndownRule): TurndownLike;
  keep(filter: string[]): TurndownLike;
  turndown(input: string | Node): string;
}

/**
 * The four additions described at the top of this file, applied to a turndown
 * instance the caller built with `TURNDOWN_OPTIONS`.
 *
 * Rules registered with `addRule` are matched before anything registered with
 * `keep`, which is what lets the footnote-reference rule win over the blanket
 * `keep(["sup", "sub"])` on the same element name.
 */
function applyDocxRules(
  turndown: TurndownLike,
  tableMode: TableMode,
  cells: CellCounts,
): void {
  turndown.addRule("mdTableCell", {
    filter: (node) => node.nodeName === "TD" || node.nodeName === "TH",
    replacement: (content, node) => {
      const siblings = elementChildren(node.parentElement);
      const first = siblings.indexOf(node) === 0;
      const lines = cellLines(content);
      /*
        Counted here, from the lines the writer actually produced, because the
        cell's own markup does not say: a cell holding one `<ul>` has a single
        child element and still comes out as two lines glued with `<br>`, and
        the list stops being a list. This rule runs for every cell, including
        the ones in a table whose markup is kept — so the pipe-table figure is
        the one that has to ask where the cell ended up.

        A cell holding a TABLE is the one exception, and it is excluded rather
        than counted: a nested table makes `tableNeedsHtml` true for the table
        around it, so that table ALWAYS takes the HTML exit and this cell's
        lines are thrown away unused. Its content splits into several lines
        only because the inner table's markup is a block of its own — nothing
        was flattened, nothing was joined with a `<br>`, and calling it a
        multi-line cell describes damage that cannot happen here.
      */
      if (lines.length > 1 && node.querySelector("table") === null) {
        cells.multiline++;
        const table = node.closest("table");
        if (table && !tableStaysHtml(table, tableMode)) {
          cells.pipeMultiline++;
          if (node.querySelector("ol,ul") !== null) cells.pipeList++;
        }
      }
      // A cell spanning N columns occupies N columns of the pipe table; the
      // text goes in the first and the rest are empty, so everything to the
      // right of it still lines up under the right heading.
      const pad = " |".repeat(attrNumber(node, "colspan") - 1);
      return `${first ? "| " : " "}${cellText(lines)} |${pad}`;
    },
  });

  turndown.addRule("mdTableRow", {
    filter: (node) => node.nodeName === "TR",
    replacement: (content, node) => {
      const table = node.closest("table");
      const isFirst = table ? tableRows(table)[0] === node : false;
      if (!isFirst) return `\n${content}`;
      // GFM has no table without a header row. Word's tables frequently have
      // no header either, so the first row becomes one — stated on the page,
      // because it is a claim about the data rather than about the layout.
      const columns = elementChildren(node)
        .filter((cell) => cell.nodeName === "TD" || cell.nodeName === "TH")
        .reduce((n, cell) => n + attrNumber(cell, "colspan"), 0);
      return `\n${content}\n${"| --- ".repeat(Math.max(columns, 1))}|`;
    },
  });

  turndown.addRule("mdTableSection", {
    filter: (node) =>
      node.nodeName === "THEAD" || node.nodeName === "TBODY" || node.nodeName === "TFOOT",
    replacement: (content) => content,
  });

  turndown.addRule("mdTable", {
    filter: (node) => node.nodeName === "TABLE",
    replacement: (content, node) => {
      if (tableMode === "html" || tableNeedsHtml(node)) {
        // Rules are handed a clone, so tidying the markup here cannot touch
        // the caller's DOM or the counts already taken off it.
        return `\n\n${node.outerHTML}\n\n`;
      }
      return `\n\n${content.trim()}\n\n`;
    },
  });

  turndown.addRule("mdFootnoteRef", {
    filter: isNoteRef,
    replacement: (_content, node) => {
      // Mammoth numbers footnotes and endnotes in one sequence and prints the
      // number in the anchor's own text, so that is the number to carry over.
      const shown = /\[(\d+)\]/.exec(node.textContent ?? "");
      const href = node.querySelector("a")?.getAttribute("href") ?? "";
      const fallback = /-(\d+)$/.exec(href);
      return `[^${shown?.[1] ?? fallback?.[1] ?? "1"}]`;
    },
  });

  turndown.addRule("mdFootnoteBackLink", {
    filter: (node) =>
      node.nodeName === "A" &&
      /^#(?:foot|end)note-ref-\d+$/.test(node.getAttribute("href") ?? ""),
    replacement: () => "",
  });

  turndown.addRule("mdFootnoteItem", {
    filter: (node) => isNoteItem(node) && node.parentElement !== null && isNoteList(node.parentElement),
    replacement: (content, node) => {
      const index = elementChildren(node.parentElement).indexOf(node) + 1;
      const body = content.trim().replace(/\n/g, "\n    ");
      return `[^${index}]: ${body}\n`;
    },
  });

  turndown.addRule("mdFootnoteList", {
    filter: (node) => isNoteList(node),
    replacement: (content) => `\n\n${content.trim()}\n\n`,
  });

  turndown.addRule("mdStrikethrough", {
    filter: (node) => node.nodeName === "S" || node.nodeName === "STRIKE" || node.nodeName === "DEL",
    replacement: (content) => (content.trim() ? `~~${content}~~` : content),
  });

  // Markdown has no superscript. Erasing the tag would change what the text
  // says, so the HTML survives — every renderer that takes Markdown takes it.
  turndown.keep(["sup", "sub"]);
}

/* ── Counting ───────────────────────────────────────────────────────────── */

function countDocFacts(
  body: Element,
  tableMode: TableMode,
  cellCounts: CellCounts,
): DocxDocFacts {
  const tables = Array.from(body.querySelectorAll("table"));
  const cells = Array.from(body.querySelectorAll("td,th"));
  const noteItems = Array.from(body.querySelectorAll("li[id]")).filter(isNoteItem);
  const pipeTables = tables.filter((table) => !tableStaysHtml(table, tableMode));
  // A cell of a table nested inside a pipe table cannot exist — the ancestor
  // would have taken the HTML exit — so this is the pipe tables' own cells.
  const pipeCells = pipeTables.flatMap((t) => Array.from(t.querySelectorAll("td,th")));
  return {
    headings: body.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
    // Body paragraphs only. Mammoth wraps every table cell's and every list
    // item's text in its own `<p>`, and counting those makes a two-paragraph
    // document with one big table read as thirty.
    paragraphs: Array.from(body.querySelectorAll("p")).filter(
      (p) => p.closest("td,th,li") === null,
    ).length,
    links: body.querySelectorAll("a[href]:not([href^='#'])").length,
    listItems: body.querySelectorAll("li").length - noteItems.length,
    images: body.querySelectorAll("img").length,
    // Only `convertDocxToMarkdown` can know this: it is the one that tried.
    unreadableImages: 0,
    tables: tables.length,
    tableRows: body.querySelectorAll("tr").length,
    colspanCells: cells.filter((cell) => attrNumber(cell, "colspan") > 1).length,
    rowspanCells: cells.filter((cell) => attrNumber(cell, "rowspan") > 1).length,
    nestedTables: tables.filter((table) => table.parentElement?.closest("table") != null).length,
    pipeTables: pipeTables.length,
    htmlTables: tables.length - pipeTables.length,
    multilineCells: cellCounts.multiline,
    pipeColspanCells: pipeCells.filter((cell) => attrNumber(cell, "colspan") > 1).length,
    pipeMultilineCells: cellCounts.pipeMultiline,
    pipeListCells: cellCounts.pipeList,
    footnotes: noteItems.filter((item) => item.id.startsWith("footnote-")).length,
    endnotes: noteItems.filter((item) => item.id.startsWith("endnote-")).length,
    strikethroughRuns: body.querySelectorAll("s,strike,del").length,
    superscriptRuns: Array.from(body.querySelectorAll("sup")).filter((n) => !isNoteRef(n))
      .length,
    subscriptRuns: body.querySelectorAll("sub").length,
  };
}

/** Whitespace-separated runs. The same thing Word's status bar counts. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Block elements that end a word. HTML puts no whitespace between one
 * paragraph's last word and the next one's first, so `body.textContent` glues
 * them together and undercounts — "…Report" + "Plain…" reads as one word.
 * Inline elements are deliberately NOT in this set: a run boundary inside a
 * word (`<strong>Micro</strong>soft`) must not split it.
 */
const BLOCK_ELEMENTS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DIV", "DL", "DT",
  "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER",
  "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE", "TBODY",
  "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

/** The document's prose, with a break wherever a block boundary falls. */
export function documentText(body: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        parts.push(child.nodeValue ?? "");
      } else if (child.nodeType === 1) {
        const element = child as Element;
        if (BLOCK_ELEMENTS.has(element.nodeName)) parts.push("\n");
        walk(element);
        if (BLOCK_ELEMENTS.has(element.nodeName)) parts.push("\n");
      }
    }
  };
  walk(body);
  return parts.join("");
}

/**
 * Mammoth's HTML → Markdown, with the counts taken off the HTML on the way.
 *
 * Exported on its own so the writer half can be tested without building a
 * .docx, and so a caller that already has the HTML does not pay for mammoth.
 */
export function htmlToMarkdown(
  html: string,
  options: { tableMode?: TableMode } = {},
): { markdown: string; docFacts: DocxDocFacts; words: number } {
  const tableMode = options.tableMode ?? "pipe";
  const cellCounts: CellCounts = { multiline: 0, pipeMultiline: 0, pipeList: 0 };
  const turndown = new TurndownService({ ...TURNDOWN_OPTIONS }) as unknown as TurndownLike;
  applyDocxRules(turndown, tableMode, cellCounts);

  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  const words = countWords(documentText(body));

  // The writer runs FIRST: what a cell came out as is a fact about the output,
  // not about the markup, and `cellCounts` is only filled in on the way past.
  // Turndown clones what it is given, so the counted DOM is untouched.
  const markdown = body.childNodes.length === 0 ? "" : turndown.turndown(body).trim();
  const docFacts = countDocFacts(body, tableMode, cellCounts);
  return { markdown, docFacts, words };
}

/* ── The package scan ───────────────────────────────────────────────────── */

/*
  Straight occurrence counts. `<w:ins` and `<w:del` are anchored with `[\s/>]`
  so that `<w:insideH>` (a table border) and `<w:delText>` (the deleted words
  themselves, one per deleted run) cannot be mistaken for revision marks.
*/
const COUNTERS: { key: keyof DocxPackageFacts; pattern: RegExp }[] = [
  { key: "insertions", pattern: /<w:ins[\s/>]/g },
  { key: "deletions", pattern: /<w:del[\s/>]/g },
  { key: "highlightedRuns", pattern: /<w:highlight[\s/>]/g },
  { key: "textBoxes", pattern: /<w:txbxContent[\s/>]/g },
];

function countMatches(xml: string, pattern: RegExp): number {
  // `pattern` is a module-level literal with /g; matchAll does not mutate it
  // the way exec-in-a-loop would, so the counters cannot leak state.
  return Array.from(xml.matchAll(pattern)).length;
}

/**
 * Count `<w:tag …>` elements whose `w:val` is not one of `off`.
 *
 * `<w:u w:val="none"/>` switches underline OFF and `<w:color w:val="auto"/>`
 * means "whatever the theme says" — counting either would report formatting the
 * document does not have. A bare `<w:u/>` DOES mean underline: the attribute's
 * default is `single`. Attribute values are matched with both quote characters
 * because XML permits either, and Word is not the only thing that writes .docx.
 */
function countRunProperty(xml: string, tag: string, off: string[]): number {
  const pattern = new RegExp(`<w:${tag}(?:\\s[^>]*)?/?>`, "g");
  const value = /w:val=["']([^"']*)["']/;
  return Array.from(xml.matchAll(pattern)).filter((match) => {
    const val = value.exec(match[0])?.[1];
    return val === undefined || !off.includes(val.toLowerCase());
  }).length;
}

/**
 * `<mc:AlternateContent>` carries the SAME content twice — a `<mc:Choice>` for
 * readers that understand the newer markup and an `<mc:Fallback>` for those
 * that do not. Word writes every text box that way, so counting the raw XML
 * reports two text boxes where the document has one. Mammoth reads the Choice,
 * so the Fallback is what has to go before anything is counted.
 */
function withoutFallbacks(xml: string): string {
  return xml.replace(/<mc:Fallback[\s>][\s\S]*?<\/mc:Fallback>/g, "");
}

/** The bytes a file starts with, which is the only reliable format signal. */
function sniffContainer(buffer: ArrayBuffer): "zip" | "ole" | "rtf" | "unknown" {
  const head = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (starts(0x50, 0x4b)) return "zip";
  if (starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return "ole";
  if (starts(0x7b, 0x5c, 0x72, 0x74, 0x66)) return "rtf";
  return "unknown";
}

function containerError(buffer: ArrayBuffer): DocxReadError {
  switch (sniffContainer(buffer)) {
    case "ole":
      return new DocxReadError(
        "This file is an OLE compound document, not a .docx package. That means one of two things: it is a Word 97–2003 .doc, or it is a .docx with a password on it — encrypting an Office file wraps the whole ZIP inside an OLE container. Either way there is nothing here to unzip. Open it in Word or LibreOffice and save it again as .docx, removing the password first if there is one.",
      );
    case "rtf":
      return new DocxReadError(
        "This file is RTF. The .docx extension may have been renamed, or Word may have saved it as Rich Text. RTF is not a ZIP and holds none of the parts this reader looks for; re-save it as .docx and try again.",
      );
    default:
      return new DocxReadError(
        "This file is not a ZIP, and every .docx is a ZIP. It has no end-of-central-directory record, so either it is some other format under a .docx name or the download was truncated.",
      );
  }
}

/**
 * Everything the package holds that mammoth's reader never opens.
 *
 * Regex over the raw XML rather than a DOM parse: these are occurrence counts
 * of element names, `document.xml` can be tens of megabytes, and XML has no
 * string literal that could hide a `<w:del` from a scan of the markup.
 */
export async function readDocxPackageFacts(buffer: ArrayBuffer): Promise<DocxPackageFacts> {
  const facts: DocxPackageFacts = {
    headers: 0,
    footers: 0,
    comments: 0,
    insertions: 0,
    deletions: 0,
    mediaFiles: 0,
    mediaBytes: 0,
    embeddedObjects: 0,
    charts: 0,
    underlinedRuns: 0,
    highlightedRuns: 0,
    colouredRuns: 0,
    textBoxes: 0,
    fields: [],
    fieldRuns: 0,
    macros: false,
  };

  // Same specifier form as `lib/utils/download.ts`, which is what keeps jszip
  // in this tool's code-split chunk rather than the shared bundle.
  const JSZip = (await import("jszip")).default;
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw containerError(buffer);
  }

  const paths = Object.keys(zip.files);
  if (!paths.some((path) => /^word\/document\d*\.xml$/.test(path))) {
    throw new DocxReadError(
      "This is a ZIP, but not a Word document: it has no word/document.xml inside it. An .xlsx, a .pptx and an ordinary .zip all look identical from the outside.",
    );
  }

  for (const path of paths) {
    const entry = zip.files[path];
    if (entry.dir) continue;
    if (/^word\/header\d*\.xml$/.test(path)) facts.headers++;
    else if (/^word\/footer\d*\.xml$/.test(path)) facts.footers++;
    else if (path.startsWith("word/media/")) {
      facts.mediaFiles++;
      // `_data.uncompressedSize` is jszip's own bookkeeping and is not part of
      // its public types, so the size is read defensively and a miss simply
      // leaves the total where it was rather than throwing.
      const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize;
      if (typeof size === "number") facts.mediaBytes += size;
    } else if (path.startsWith("word/embeddings/")) facts.embeddedObjects++;
    else if (/^word\/charts\/chart\d*\.xml$/.test(path)) facts.charts++;
    else if (path === "word/vbaProject.bin") facts.macros = true;
  }

  const commentsPart = zip.file("word/comments.xml");
  if (commentsPart) {
    const xml = await commentsPart.async("string");
    // `<w:commentRangeStart>` and `<w:commentReference>` live in document.xml,
    // not here, so `[\s/>]` is enough to isolate the comments themselves.
    facts.comments = countMatches(xml, /<w:comment[\s/>]/g);
  }

  const mainPath = paths.find((p) => /^word\/document\d*\.xml$/.test(p));
  const documentPart = zip.file("word/document.xml") ?? (mainPath ? zip.file(mainPath) : null);
  if (documentPart) {
    const xml = withoutFallbacks(await documentPart.async("string"));
    facts.underlinedRuns = countRunProperty(xml, "u", ["none", "0"]);
    facts.colouredRuns = countRunProperty(xml, "color", ["auto"]);
    for (const { key, pattern } of COUNTERS) {
      (facts[key] as number) = countMatches(xml, pattern);
    }
    const instructions = Array.from(xml.matchAll(/<w:instrText[^>]*>([^<]*)<\/w:instrText>/g));
    facts.fieldRuns = instructions.length;
    const names = new Set<string>();
    for (const match of instructions) {
      const name = /^\s*([A-Z][A-Z0-9]*)\b/.exec(match[1] ?? "");
      if (name) names.add(name[1]);
    }
    facts.fields = Array.from(names).sort();
  }

  return facts;
}

/* ── Images ─────────────────────────────────────────────────────────────── */

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-emf": "emf",
  "image/x-wmf": "wmf",
  "image/emf": "emf",
  "image/wmf": "wmf",
};

export function imageExtension(contentType: string | null | undefined): string {
  if (!contentType) return "bin";
  return IMAGE_EXTENSIONS[contentType.toLowerCase().split(";")[0].trim()] ?? "bin";
}

/** The folder image references point into, relative to the .md file. */
export const IMAGE_DIR = "media";

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ── Names ──────────────────────────────────────────────────────────────── */

const stripExtension = (name: string): string => name.replace(/\.[^./\\]+$/, "");

export function markdownFileName(sourceName: string): string {
  return `${stripExtension(sourceName).trim() || "document"}.md`;
}

/** The ZIP a document with referenced images comes down as. */
export function markdownZipName(sourceName: string): string {
  return `${stripExtension(sourceName).trim() || "document"}-markdown.zip`;
}

/* ── The conversion ─────────────────────────────────────────────────────── */

function normaliseMessages(messages: MammothMessageIn[]): DocxMessage[] {
  return messages.map((m) => ({
    type: m.type === "error" ? "error" : m.type === "info" ? "info" : "warning",
    message: String(m.message ?? "").trim(),
  }));
}

export async function convertDocxToMarkdown(
  buffer: ArrayBuffer,
  options: { imageMode?: ImageMode; tableMode?: TableMode } = {},
): Promise<DocxConversion> {
  const imageMode = options.imageMode ?? "reference";
  const tableMode = options.tableMode ?? "pipe";

  // First, because it gives the better error: mammoth's own failure for a
  // non-ZIP is jszip's, and jszip's ends in a documentation URL.
  const packageFacts = await readDocxPackageFacts(buffer);

  /*
    The specifier is a literal so the bundler can see it and split the 636 KB
    browser build into its own chunk, fetched the first time someone drops a
    file rather than when the page opens.

    mammoth ships types for its `lib/` entry point only, and a `declare module`
    for a path resolving to an untyped JS file is rejected as an augmentation of
    an untyped module (TS2665) — so the suppression below is the only way to
    name this build from TypeScript. The shape actually used is `MammothApi`
    above and it is asserted once, here. A `src/types/mammoth.d.ts` owned by
    whoever owns the global type files would retire the directive.
  */
  // @ts-expect-error untyped browser build; see the comment above
  const imported: unknown = await import("mammoth/mammoth.browser.min.js");
  const loaded = imported as { default?: MammothApi } & Partial<MammothApi>;
  // Bundlers hand a CommonJS module back under `default`; a plain `require`
  // hands the exports object straight over. Both shapes reach this page.
  const api = (
    typeof loaded.convertToHtml === "function" ? loaded : loaded.default
  ) as MammothApi | undefined;
  if (!api) {
    throw new DocxReadError("The .docx reader could not be loaded. Reload the page and retry.");
  }

  const images: DocxImageFile[] = [];
  /*
    Counted here rather than off the HTML, because "drop" strips the elements
    before anything gets to count them. Every image mammoth actually placed in
    the body passes through this callback exactly once — which is NOT the same
    number as `packageFacts.mediaFiles`, since `word/media/` also holds the
    pictures used by headers, footers and numbering bullets.
  */
  let placedImages = 0;
  /*
    …and passing through the callback is not the same as coming out the other
    side. `image.read` throws for a picture Word LINKED rather than embedded
    (`TargetMode="External"` — "cannot open linked files from a web browser")
    and for one whose `word/media/` part is not in the ZIP. Mammoth catches
    that, records an error message and emits no `<img>` at all, so the picture
    reaches neither the Markdown nor the download: counting it as placed is
    what made the page promise a media folder and a ZIP it had not produced.
  */
  let unreadableImages = 0;
  /*
    "embed" is mammoth's own default behaviour, but it is written out here
    rather than left to the default so that all three modes go through one
    callback — which is what lets the page say how many BYTES of picture are
    involved in embed mode as well as in link mode. "drop" deliberately does
    NOT read the bytes: they are about to be thrown away, and decoding them
    would cost the base64 of the whole document for nothing.
  */
  const convertImage = api.images.imgElement(async (image) => {
    if (imageMode === "drop") {
      // Nothing is read, so nothing can fail: every picture the body held is
      // a picture this mode removed, and that is the number to report.
      placedImages++;
      return { src: "" };
    }
    let base64: string;
    try {
      base64 = await image.read("base64");
    } catch (err) {
      unreadableImages++;
      // Rethrown on purpose: mammoth's own handler turns this into an error
      // message and drops the element, which is better than a link to a file
      // that will not be in the download.
      throw err;
    }
    const contentType = image.contentType ?? "application/octet-stream";
    const bytes = base64ToBytes(base64);
    const name = `${IMAGE_DIR}/image-${images.length + 1}.${imageExtension(contentType)}`;
    images.push({ name, bytes, contentType });
    placedImages++;
    return {
      src: imageMode === "embed" ? `data:${contentType};base64,${base64}` : name,
      alt: image.altText ?? "",
    };
  });

  let result: MammothResult;
  try {
    result = await api.convertToHtml({ arrayBuffer: buffer }, { convertImage });
  } catch (err) {
    // The package scan above already proved this is a ZIP with a main document
    // part, so anything landing here is a malformed part rather than a wrong
    // file, and saying which is more use than repeating "invalid .docx".
    throw new DocxReadError(
      `The package opened, but Word's main document part could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  let html = result.value;
  if (imageMode === "drop") {
    // `imgElement` has to return a src, so the images are emptied above and the
    // now-pointless elements are taken out here.
    html = html.replace(/<img[^>]*>/g, "");
  }

  const { markdown, docFacts, words } = htmlToMarkdown(html, { tableMode });
  // In "drop" mode there is no `<img>` left to count, and in the other two the
  // callback and the HTML agree — so the counter is the number, always.
  docFacts.images = placedImages;
  docFacts.unreadableImages = unreadableImages;

  return {
    markdown,
    html,
    images,
    messages: normaliseMessages(result.messages ?? []),
    packageFacts,
    docFacts,
    words,
  };
}
