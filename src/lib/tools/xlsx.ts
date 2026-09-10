/**
 * Reading an .xlsx workbook into rows of strings, and writing those rows as CSV.
 *
 * ── Why there is no spreadsheet library here ────────────────────────────────
 *
 * The obvious dependency for this job is SheetJS, and it is not used: the npm
 * `xlsx` package has been frozen since 2022 with an unfixed advisory against
 * it, and pulling a stale parser into a page whose whole pitch is "your file
 * never leaves the tab" is the wrong trade. An .xlsx IS a ZIP of XML — that is
 * the entire format — and `jszip` is already a dependency for the multi-file
 * download path. So this reads the parts directly:
 *
 *   xl/workbook.xml            sheet names and their relationship ids, IN ORDER
 *   xl/_rels/workbook.xml.rels those ids → the worksheet part paths
 *   xl/sharedStrings.xml       the string table every text cell points into
 *   xl/styles.xml              cellXfs → number formats (see "Dates" below)
 *   xl/worksheets/sheetN.xml   the cells themselves
 *
 * ── What this deliberately does NOT do ──────────────────────────────────────
 *
 * Formulas are not evaluated. Excel caches the last computed result next to
 * every formula and that cached `<v>` is what gets read — which is right for a
 * file Excel saved and wrong for a file some library wrote without results.
 * `XlsxSheet.formulaCells` counts them so the UI can say so.
 *
 * **Dates are not formatted.** In XLSX a date is a plain number — days since
 * 1899-12-30, or since 1904-01-01 in a workbook that says so — and the only
 * thing that makes it a date is a number format pointed at by the cell's style
 * index. Rendering that number as a date correctly means implementing Excel's
 * format-code language (`d mmm yyyy`, `[$-409]h:mm AM/PM`), and half an
 * implementation is worse than none: a cell that comes back as the wrong day
 * is a silent error, while `45678` is an obvious one.
 *
 * So the raw serial is emitted — and, because "we quietly wrote 45678 where
 * you expected a date" is exactly the kind of loss this codebase refuses to
 * ship in silence, the styles table IS parsed, purely to COUNT how many cells
 * that affects. `XlsxSheet.dateFormattedCells` is that count and the UI prints
 * it. `XlsxWorkbook.styleTableRead` is false when the styles part was missing
 * or unreadable, so the UI can say the count is unknown rather than say zero.
 *
 * The same rule governs the string table: a `t="s"` cell whose index does not
 * resolve — the whole `sharedStrings.xml` missing, or an index past the end of
 * one that is there — comes out EMPTY, and `XlsxSheet.unresolvedSharedStrings`
 * counts every such cell so a sheet with its words removed cannot be presented
 * as a clean conversion.
 *
 * ── Sparseness, the trap that eats naive readers ────────────────────────────
 *
 * Cells and rows are both sparse. `<c r="C1">` directly after `<c r="A1">`
 * means B1 is empty and is simply not in the file; `<row r="5">` after
 * `<row r="1">` means rows 2–4 are empty. A reader that pushes cells onto an
 * array in document order silently shifts every value left. The `r` reference
 * is decoded (A, B, … Z, AA, AB, …) and the gaps are padded.
 */

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface XlsxSheet {
  /** The tab name as Excel shows it. */
  name: string;
  /** Excel lets a sheet be hidden; it is still fully readable here. */
  hidden: boolean;
  /** Used range, row-major, padded to a rectangle. Every cell is a string. */
  rows: string[][];
  rowCount: number;
  columnCount: number;
  /**
   * Numeric cells whose style points at a date or time number format.
   * Their raw serial numbers are what `rows` holds — see the header comment.
   */
  dateFormattedCells: number;
  /**
   * Cells holding a plain number. The population `dateFormattedCells` is a
   * subset of, and the only cells a missing style table leaves in doubt: a
   * sheet with no numbers in it has no dates in it either, whatever the
   * styles say.
   */
  numericCells: number;
  /** Cells carrying an `<f>` formula. Only Excel's cached result is read. */
  formulaCells: number;
  /** Cells holding an Excel error literal — `#REF!`, `#DIV/0!`, `#N/A`. */
  errorCells: number;
  /**
   * `t="s"` cells whose index pointed outside the shared-string table, and
   * which therefore come out EMPTY. This is the string counterpart of
   * `dateFormattedCells`: a text cell silently emptied is the worst loss this
   * reader can inflict, and it has two causes — a `sharedStrings.xml` missing
   * from the package (every text cell in the workbook), and an index past the
   * end of a table that is present (a truncated or partially repaired file).
   * Both land here so the UI can put a number on screen instead of showing a
   * clean conversion of a sheet with the words taken out of it.
   */
  unresolvedSharedStrings: number;
}

export interface XlsxWorkbook {
  sheets: XlsxSheet[];
  /**
   * False when `xl/styles.xml` was absent or would not parse. Every
   * `dateFormattedCells` count is then 0 because nothing could be counted —
   * which is not the same claim as "no dates", and the UI must not conflate
   * the two.
   */
  styleTableRead: boolean;
  /**
   * False when the shared-string part was absent from the package. Every
   * `t="s"` cell in the workbook is then unresolvable, which `XlsxSheet.
   * unresolvedSharedStrings` counts — this flag only says WHY, so the UI can
   * name the missing part rather than blame individual indexes. A part that
   * is present but not valid XML is a hard refusal instead: a broken string
   * table means most text cells would be wrong, not merely uncounted.
   */
  sharedStringsRead: boolean;
  /**
   * `<workbookPr date1904="1"/>` — serials in this workbook count from
   * 1904-01-01 rather than 1899-12-30. Classic Mac Excel wrote this by
   * default and files descended from one still carry it. Nothing here
   * converts serials for the CSV, but the disclosure quotes a worked example
   * and the two systems are 1462 days apart, so it has to know which.
   */
  date1904: boolean;
}

export type XlsxReadErrorKind =
  | "legacy-xls"
  | "ole-container"
  | "not-a-zip"
  | "not-a-workbook"
  | "corrupt";

/** A refusal with a reason the UI can print verbatim. */
export class XlsxReadError extends Error {
  readonly kind: XlsxReadErrorKind;
  constructor(kind: XlsxReadErrorKind, message: string) {
    super(message);
    this.name = "XlsxReadError";
    this.kind = kind;
  }
}

/* ── Container sniffing ───────────────────────────────────────────────────── */

/** `PK\x03\x04`, and the two other ZIP local-header spellings. */
const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
  [0x50, 0x4b, 0x07, 0x08],
];

/** The OLE2 / Compound File Binary header — `.xls`, and encrypted OOXML. */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const startsWith = (bytes: Uint8Array, sig: number[]): boolean =>
  bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

export type ContainerKind = "zip" | "ole2" | "unknown";

/**
 * What kind of container these bytes are, from the first eight of them.
 *
 * This matters because the two failure modes people actually hit — an old
 * binary `.xls`, and a password-protected `.xlsx` — are BOTH OLE2 and neither
 * is a ZIP. Handing them to jszip produces "End of central directory not
 * found", which tells the user nothing they can act on.
 */
export function sniffContainer(bytes: Uint8Array): ContainerKind {
  if (ZIP_SIGNATURES.some((sig) => startsWith(bytes, sig))) return "zip";
  if (startsWith(bytes, OLE2_SIGNATURE)) return "ole2";
  return "unknown";
}

/* ── Cell references ──────────────────────────────────────────────────────── */

/**
 * `"A1"` → 0, `"B1"` → 1, `"Z1"` → 25, `"AA1"` → 26, `"AB1"` → 27.
 * Returns -1 when the reference carries no column letters at all.
 */
export function columnIndexFromRef(ref: string): number {
  let n = 0;
  let seen = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    let letter = 0;
    if (code >= 65 && code <= 90) letter = code - 64;
    else if (code >= 97 && code <= 122) letter = code - 96;
    else break;
    n = n * 26 + letter;
    seen++;
  }
  return seen === 0 ? -1 : n - 1;
}

/** `"C12"` → 12 (1-based, as the file writes it). 0 when there are no digits. */
export function rowIndexFromRef(ref: string): number {
  const m = /(\d+)\s*$/.exec(ref);
  return m ? Number(m[1]) : 0;
}

/* ── Number formats: is this cell a date? ─────────────────────────────────── */

/**
 * The built-in `numFmtId`s that mean a date or a time.
 *
 * A BUILT-IN format writes no `<numFmt>` into the package at all — the id on
 * its own implies the code (ECMA-376 §18.8.30) — so this set IS the entire
 * format language for every id below 164, and an id missing from it is a date
 * this tool cannot see at all.
 *
 *   14–22   the date and time formats every locale gets
 *   27–36   the East-Asian locale block, which is date and time too: 30 is
 *   50–58   plainly `m/d/yy`, 31 is `yyyy"年"m"月"d"日"`, 32 is `h"時"mm"分"`,
 *           27 and 36 and 50 are `[$-404]e/m/d`. A workbook Excel saved in a
 *           Japanese, Chinese, Korean or Thai locale hangs its dates on THESE
 *           ids and on nothing else, so omitting them reported a whole date
 *           column as zero dates and suppressed the one warning this pass
 *           exists to raise.
 *   45–47   the elapsed-time formats (`mm:ss`, `[h]:mm:ss`, `mmss.0`)
 *
 * Everything else below 164 is not a date: 0–13 are numbers, currencies,
 * percentages and fractions, 23–26 and 41–44 are reserved or accounting,
 * 37–40 are accounting, 48 is scientific and 49 is text.
 */
const BUILTIN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

/**
 * Does a custom format code render a date or a time?
 *
 * The test is "does a y/m/d/h/s survive once the parts that are NOT format
 * codes are removed", and the parts that are not format codes are the ones
 * that trip a naive regex:
 *
 *   "..."   a literal string — `0.00" months"` is a number, not a date
 *   \x      a single escaped literal — `0\d` is a number with a "d" after it
 *   [...]   colours (`[Red]`), conditions (`[<100]`) and locale ids
 *           (`[$-409]`), EXCEPT the elapsed-time markers `[h]`, `[mm]`,
 *           `[ss]`, which are the whole point of formats 45–47
 */
export function isDateFormatCode(code: string): boolean {
  let rest = code;

  // Elapsed time is a bracket that IS a date code. Decide before stripping.
  if (/\[[hms]+\]/i.test(rest)) return true;

  rest = rest
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "");

  // AM/PM and A/P are clock markers whose letters would otherwise be lost
  // along with the rest of the alphabet, and a code can be `h AM/PM` alone.
  if (/AM\/PM|A\/P/i.test(rest)) return true;

  return /[ymdhs]/i.test(rest);
}

/* ── Date serials ─────────────────────────────────────────────────────────── */

const MS_PER_DAY = 86_400_000;

/** Serials 1–59 count from here — see the leap-day note below. */
const EPOCH_1900_BEFORE_LEAP = Date.UTC(1899, 11, 31);
/** Serials 61 and up count from here, the epoch everyone quotes. */
const EPOCH_1900_AFTER_LEAP = Date.UTC(1899, 11, 30);
/** The Mac-heritage system: serial 0 is 1904-01-01, with no fictional day. */
const EPOCH_1904 = Date.UTC(1904, 0, 1);

/**
 * The serial the on-screen disclosure uses as its worked example.
 *
 * Its partner date is DERIVED by `excelSerialToIsoDate` against the workbook
 * in hand rather than written into the sentence, because the pair depends on
 * which date system the file declares — and because a hand-written pair is
 * exactly the kind of thing that ships wrong and stays wrong.
 */
export const EXAMPLE_DATE_SERIAL = 45678;

/**
 * A date serial as an ISO calendar date, or `null` where it is not one.
 *
 * This is NOT the format-code implementation the header refuses to write: it
 * renders no cell and never touches the CSV. It exists so the warning can say
 * what a serial actually is instead of asserting a remembered pair, and it is
 * exact because the two things that move the answer are handled here:
 *
 *   The 1900 leap-day bug. Excel's serial 60 is 1900-02-29, a day that never
 *   existed — Lotus 1-2-3 had the bug and Excel kept it so old files still
 *   add up. So serials 1–59 count from 1899-12-31, serial 60 has no real
 *   date at all, and only from 61 onward does the familiar 1899-12-30 epoch
 *   line up. Reading every serial against 1899-12-30 is a day out for the
 *   first two months of 1900.
 *
 *   The 1904 date system. A workbook carrying `<workbookPr date1904="1"/>` —
 *   the default on classic Mac Excel, and still set in files descended from
 *   one — counts from 1904-01-01 with no fictional leap day, which puts every
 *   serial 1462 days away from the 1900 reading of the same number.
 *
 * The fractional part is the time of day and is dropped: this answers "which
 * day", and in the 1900 system a serial below 1 is a time with no day at all.
 */
export function excelSerialToIsoDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial)) return null;
  const day = Math.floor(serial);
  if (day < 0) return null;

  let ms: number;
  if (date1904) {
    ms = EPOCH_1904 + day * MS_PER_DAY;
  } else {
    // 0 is Excel's "1900-01-00" placeholder and 60 is the day that never
    // happened. Neither is a date anything true can be said about.
    if (day === 0 || day === 60) return null;
    ms = (day < 60 ? EPOCH_1900_BEFORE_LEAP : EPOCH_1900_AFTER_LEAP) + day * MS_PER_DAY;
  }

  const date = new Date(ms);
  const year = date.getUTCFullYear();
  // NaN catches an out-of-range Date; Excel itself stops at 9999-12-31, and
  // past that `toISOString` switches to its expanded ±YYYYYY form, which a
  // 10-character slice would turn into nonsense.
  if (!Number.isFinite(year) || year > 9999) return null;
  return date.toISOString().slice(0, 10);
}

/* ── XML helpers ──────────────────────────────────────────────────────────── */

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function parseXml(source: string, part: string): Document {
  const doc = new DOMParser().parseFromString(source, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new XlsxReadError(
      "corrupt",
      `The ${part} part of this workbook is not valid XML, so the file is damaged.`,
    );
  }
  return doc;
}

/**
 * Elements by local name, ignoring the namespace prefix.
 *
 * ECMA-376 parts are namespaced, and while most writers use the default
 * namespace, some prefix it (`<x:worksheet><x:sheetData>`). `getElementsByTagName`
 * on an XML document matches the QUALIFIED name, so it silently returns
 * nothing for those files. `"*"` plus a localName check does not.
 */
function byLocalName(root: Element | Document, local: string): Element[] {
  const out: Element[] = [];
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === local) out.push(all[i]);
  }
  return out;
}

/** `r:id`, whether the writer declared the relationship namespace or not. */
function relationshipId(el: Element): string | null {
  return el.getAttributeNS(REL_NS, "id") ?? el.getAttribute("r:id");
}

/* ── Shared strings ───────────────────────────────────────────────────────── */

/**
 * The `<si>` table, flattened to plain strings.
 *
 * A single `<si>` can be several `<r>` runs — that is what Excel writes when
 * one cell has a bold word in the middle of it — and each run has its own
 * `<t>`. Taking only the first `<t>` truncates the cell to its first run,
 * which is the classic bug in a hand-rolled reader.
 *
 * `<rPh>` runs are excluded: they are the Japanese phonetic guide (furigana)
 * for the cell, not part of its text, and they contain `<t>` elements too.
 */
export function readSharedStrings(xml: string): string[] {
  const doc = parseXml(xml, "shared strings");
  return byLocalName(doc, "si").map(sharedStringText);
}

function sharedStringText(si: Element): string {
  let out = "";
  for (const t of byLocalName(si, "t")) {
    let parent: Element | null = t.parentElement;
    let phonetic = false;
    while (parent && parent !== si) {
      if (parent.localName === "rPh") {
        phonetic = true;
        break;
      }
      parent = parent.parentElement;
    }
    // `xml:space="preserve"` is how a run keeps its leading or trailing
    // spaces; textContent already carries them, so honouring the attribute
    // means NOT trimming here. Trimming is the bug it exists to prevent.
    if (!phonetic) out += t.textContent ?? "";
  }
  return out;
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

/**
 * One flag per `cellXfs` entry: does that style render its number as a date?
 *
 * A cell's `s` attribute indexes this array. Custom formats (id ≥ 164) are
 * looked up in `<numFmts>`; everything else falls back to the built-in table.
 */
export function readDateStyleFlags(xml: string): boolean[] {
  const doc = parseXml(xml, "styles");

  const custom = new Map<number, string>();
  for (const fmt of byLocalName(doc, "numFmt")) {
    const id = Number(fmt.getAttribute("numFmtId"));
    const code = fmt.getAttribute("formatCode");
    if (Number.isFinite(id) && code !== null) custom.set(id, code);
  }

  const cellXfs = byLocalName(doc, "cellXfs")[0];
  if (!cellXfs) return [];

  return byLocalName(cellXfs, "xf").map((xf) => {
    const id = Number(xf.getAttribute("numFmtId") ?? "0");
    if (!Number.isFinite(id)) return false;
    const code = custom.get(id);
    if (code !== undefined) return isDateFormatCode(code);
    return BUILTIN_DATE_FORMAT_IDS.has(id);
  });
}

/* ── Worksheets ───────────────────────────────────────────────────────────── */

interface SheetParseResult {
  rows: string[][];
  dateFormattedCells: number;
  numericCells: number;
  formulaCells: number;
  errorCells: number;
  unresolvedSharedStrings: number;
}

/** The zero counts a sheet whose part is missing from the package reports. */
const EMPTY_SHEET: SheetParseResult = {
  rows: [],
  dateFormattedCells: 0,
  numericCells: 0,
  formulaCells: 0,
  errorCells: 0,
  unresolvedSharedStrings: 0,
};

/**
 * One worksheet part into a padded rectangle of strings.
 *
 * The used range is derived from the cells that actually carry a value, not
 * from the `<dimension>` hint — writers lie about that one, and a sheet whose
 * dimension claims A1:XFD1048576 would otherwise become a million empty rows.
 * A cell whose value is the empty string does not extend the range.
 */
export function parseWorksheet(
  xml: string,
  sharedStrings: string[],
  dateStyles: boolean[] = [],
): SheetParseResult {
  const doc = parseXml(xml, "worksheet");

  const cellsByRow = new Map<number, Map<number, string>>();
  let maxRow = 0;
  let maxCol = -1;
  let dateFormattedCells = 0;
  let numericCells = 0;
  let formulaCells = 0;
  let errorCells = 0;
  let unresolvedSharedStrings = 0;

  let autoRow = 0;
  for (const row of byLocalName(doc, "row")) {
    const declared = Number(row.getAttribute("r"));
    // A writer may omit `r` and mean "the next row"; honour both.
    const rowIndex = Number.isFinite(declared) && declared > 0 ? declared : autoRow + 1;
    autoRow = rowIndex;

    let autoCol = -1;
    for (const cell of byLocalName(row, "c")) {
      const ref = cell.getAttribute("r") ?? "";
      const fromRef = columnIndexFromRef(ref);
      const colIndex = fromRef >= 0 ? fromRef : autoCol + 1;
      autoCol = colIndex;

      const type = cell.getAttribute("t") ?? "n";
      if (byLocalName(cell, "f").length > 0) formulaCells++;

      const { text: value, unresolvedSharedString } = cellText(cell, type, sharedStrings);
      if (unresolvedSharedString) unresolvedSharedStrings++;
      if (type === "e" && value !== "") errorCells++;

      if (type === "n" && value !== "") {
        numericCells++;
        const styleIndex = Number(cell.getAttribute("s") ?? "");
        if (Number.isFinite(styleIndex) && dateStyles[styleIndex]) dateFormattedCells++;
      }

      if (value === "") continue;
      let bucket = cellsByRow.get(rowIndex);
      if (!bucket) {
        bucket = new Map<number, string>();
        cellsByRow.set(rowIndex, bucket);
      }
      bucket.set(colIndex, value);
      if (rowIndex > maxRow) maxRow = rowIndex;
      if (colIndex > maxCol) maxCol = colIndex;
    }
  }

  const width = maxCol + 1;
  const rows: string[][] = [];
  for (let r = 1; r <= maxRow; r++) {
    const bucket = cellsByRow.get(r);
    const line = new Array<string>(width).fill("");
    if (bucket) for (const [c, v] of bucket) line[c] = v;
    rows.push(line);
  }

  return {
    rows,
    dateFormattedCells,
    numericCells,
    formulaCells,
    errorCells,
    unresolvedSharedStrings,
  };
}

interface CellValue {
  text: string;
  /** True when this was a `t="s"` cell whose index resolved to nothing. */
  unresolvedSharedString: boolean;
}

const plainCell = (text: string): CellValue => ({ text, unresolvedSharedString: false });

/**
 * One cell's text, by type.
 *
 *   t="s"          `<v>` is an INDEX into the shared-string table
 *   t="str"        `<v>` is a formula's cached STRING result, stored inline
 *   t="inlineStr"  the text is in `<is>`, with the same run structure as `<si>`
 *   t="b"          `<v>` is 0 or 1 — written out as FALSE / TRUE, as Excel does
 *   t="e"          `<v>` is an error literal: `#REF!`, `#DIV/0!`, `#N/A`
 *   t="d"          an ISO-8601 date (ECMA-376 Strict; rare, passed through)
 *   t="n" / absent a number, verbatim — including a date's serial (see header)
 */
function cellText(cell: Element, type: string, sharedStrings: string[]): CellValue {
  if (type === "inlineStr") {
    const is = byLocalName(cell, "is")[0];
    return plainCell(is ? sharedStringText(is) : "");
  }

  const v = byLocalName(cell, "v")[0];
  const raw = v?.textContent ?? "";
  // An empty `<v>` is an empty cell, not a pointer that failed to resolve.
  if (raw === "") return plainCell("");

  if (type === "s") {
    const index = Number(raw);
    // An out-of-range index is a damaged file; an empty cell is a better
    // answer than the string "undefined" appearing in a spreadsheet column.
    // It is reported rather than swallowed — see `unresolvedSharedStrings`.
    const resolved =
      Number.isInteger(index) && index >= 0 && index < sharedStrings.length
        ? sharedStrings[index]
        : null;
    return { text: resolved ?? "", unresolvedSharedString: resolved === null };
  }
  if (type === "b") return plainCell(raw === "0" ? "FALSE" : "TRUE");
  return plainCell(raw);
}

/* ── Package plumbing ─────────────────────────────────────────────────────── */

/** Resolve a relationship target against the part that declared it. */
function resolveTarget(target: string, ownerDir: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const stack: string[] = ownerDir ? ownerDir.split("/").filter(Boolean) : [];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") stack.pop();
    else stack.push(segment);
  }
  return stack.join("/");
}

function relationshipMap(xml: string, ownerDir: string): Map<string, { target: string; type: string }> {
  const doc = parseXml(xml, "relationships");
  const map = new Map<string, { target: string; type: string }>();
  for (const rel of byLocalName(doc, "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (!id || !target) continue;
    // An external relationship points outside the package; there is nothing
    // in the ZIP to read for it.
    if (rel.getAttribute("TargetMode") === "External") continue;
    map.set(id, {
      target: resolveTarget(target, ownerDir),
      type: rel.getAttribute("Type") ?? "",
    });
  }
  return map;
}

const dirOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
};

/**
 * The refusal for a package whose main part is a real Office document of the
 * wrong kind.
 *
 * This is the case the old "there is no workbook part inside it" message
 * described and could never actually reach. A .docx and a .pptx BOTH carry a
 * root relationship pointing at their own main part, so that part loads
 * perfectly well — it is simply a `<document>` or a `<presentation>`, and
 * hunting it for `<sheet>` elements finds none. The user then got "this
 * workbook declares no sheets", which sent them back to Excel to look for
 * missing tabs when what they had actually picked was a Word file.
 */
function wrongMainPartMessage(rootLocalName: string): string {
  if (rootLocalName === "document") {
    return "This is a Word document (.docx) that has been renamed to .xlsx — the main part inside it is a Word document body, not a workbook. Pick the spreadsheet you meant, or open this in Word and export the table you want as .csv.";
  }
  if (rootLocalName === "presentation") {
    return "This is a PowerPoint presentation (.pptx) that has been renamed to .xlsx — the main part inside it is a slide deck, not a workbook. Pick the spreadsheet you meant instead.";
  }
  return `This is a valid ZIP of Office XML, but its main part is a <${rootLocalName}> rather than a <workbook>, so it is not a spreadsheet. Check that you picked the right file.`;
}

/** `<workbookPr date1904="1"/>`, in either of xsd:boolean's two spellings. */
function readsDate1904(workbookDoc: Document): boolean {
  const raw = byLocalName(workbookDoc, "workbookPr")[0]?.getAttribute("date1904");
  return raw === "1" || raw?.toLowerCase() === "true";
}

/* ── The entry point ──────────────────────────────────────────────────────── */

/**
 * Read an .xlsx workbook out of raw bytes.
 *
 * `fileName` is used only to word a refusal — an OLE2 container named `.xls`
 * gets the "re-save it" message, one named `.xlsx` gets the password one.
 *
 * Throws `XlsxReadError` for anything a user can act on, and lets a genuinely
 * unexpected error through unchanged.
 */
export async function readXlsx(buffer: ArrayBuffer, fileName = ""): Promise<XlsxWorkbook> {
  const head = new Uint8Array(buffer.slice(0, 8));
  const container = sniffContainer(head);
  const looksLikeXls = /\.xls$/i.test(fileName.trim());

  if (container === "ole2") {
    throw new XlsxReadError(
      looksLikeXls ? "legacy-xls" : "ole-container",
      looksLikeXls
        ? "This is a .xls file — the old binary Excel format from before 2007. It is not a ZIP of XML and nothing here can open it. Open it in Excel, LibreOffice or Numbers and use Save As to write a .xlsx, then bring that back."
        : "This file is an OLE2 container, not a ZIP. A password-protected workbook looks exactly like this from the outside — Excel encrypts the whole package and wraps it — and so does an old binary .xls that has been renamed to .xlsx. Open it in Excel, remove the password if it has one, and save it again as .xlsx.",
    );
  }
  if (container === "unknown") {
    throw new XlsxReadError(
      "not-a-zip",
      "This file does not start with the ZIP signature that every .xlsx has, so it is not a workbook at all. Check that you picked the right file.",
    );
  }

  // Same specifier form the multi-file download path uses, and for the same
  // reason: this keeps jszip in the tool's own code-split chunk instead of the
  // shared bundle every page loads.
  const JSZip = (await import("jszip")).default;

  const zip = await JSZip.loadAsync(buffer).catch((): never => {
    throw new XlsxReadError(
      "corrupt",
      "This file begins like a ZIP but could not be unpacked, which means it is truncated or damaged. Try downloading or exporting it again.",
    );
  });

  const read = async (path: string): Promise<string | null> => {
    const entry = zip.file(path);
    return entry ? entry.async("string") : null;
  };

  // The package root relationships name the main document part. Most writers
  // put it at xl/workbook.xml; the spec does not require that.
  let workbookPath = "xl/workbook.xml";
  const rootRels = await read("_rels/.rels");
  if (rootRels) {
    for (const rel of relationshipMap(rootRels, "").values()) {
      if (rel.type.endsWith("/officeDocument")) {
        workbookPath = rel.target;
        break;
      }
    }
  }

  /** A candidate main part, parsed, with the local name of its root element. */
  const loadMainPart = async (path: string) => {
    const xml = await read(path);
    if (xml === null) return null;
    const doc = parseXml(xml, "workbook");
    return { path, doc, root: doc.documentElement?.localName ?? "" };
  };

  let mainPart = await loadMainPart(workbookPath);
  if (mainPart?.root !== "workbook" && workbookPath !== "xl/workbook.xml") {
    // The root relationship pointed at something that is not a workbook.
    // Before refusing, look where every real .xlsx keeps one anyway — a
    // package can carry both, and a workbook that IS there must not be
    // refused over a relationship that points elsewhere.
    const conventional = await loadMainPart("xl/workbook.xml");
    if (conventional?.root === "workbook") mainPart = conventional;
  }

  if (!mainPart) {
    throw new XlsxReadError(
      "not-a-workbook",
      "This is a valid ZIP, but there is no workbook part inside it, so it is not a spreadsheet — an ordinary .zip of files renamed to .xlsx looks like this. Check that you picked the right file.",
    );
  }
  if (mainPart.root !== "workbook") {
    throw new XlsxReadError("not-a-workbook", wrongMainPartMessage(mainPart.root));
  }

  workbookPath = mainPart.path;
  const workbookDoc = mainPart.doc;
  const workbookDir = dirOf(workbookPath);
  const relsPath = `${workbookDir ? `${workbookDir}/` : ""}_rels/${workbookPath.split("/").pop()}.rels`;
  const relsXml = await read(relsPath);
  const rels = relsXml ? relationshipMap(relsXml, workbookDir) : new Map();

  const byType = (suffix: string): string | null => {
    for (const rel of rels.values()) if (rel.type.endsWith(suffix)) return rel.target;
    return null;
  };

  const sharedPath = byType("/sharedStrings") ?? `${workbookDir}/sharedStrings.xml`;
  const sharedXml = await read(sharedPath);
  // Absent is survivable and counted (`unresolvedSharedStrings`); unparseable
  // is not, and `readSharedStrings` throws "corrupt" for it.
  const sharedStringsRead = sharedXml !== null;
  const sharedStrings = sharedXml ? readSharedStrings(sharedXml) : [];

  const stylesPath = byType("/styles") ?? `${workbookDir}/styles.xml`;
  const stylesXml = await read(stylesPath);
  let dateStyles: boolean[] = [];
  let styleTableRead = false;
  if (stylesXml) {
    try {
      dateStyles = readDateStyleFlags(stylesXml);
      styleTableRead = true;
    } catch {
      // A damaged styles part must not take the data down with it — the cells
      // are still perfectly readable. What is lost is the ability to say how
      // many of them are dates, and `styleTableRead: false` says exactly that.
      styleTableRead = false;
    }
  }

  const sheets: XlsxSheet[] = [];

  for (const sheet of byLocalName(workbookDoc, "sheet")) {
    const name = sheet.getAttribute("name") ?? `Sheet${sheets.length + 1}`;
    const id = relationshipId(sheet);
    const target = id ? rels.get(id)?.target : undefined;
    const path = target ?? `${workbookDir}/worksheets/sheet${sheets.length + 1}.xml`;
    const sheetXml = await read(path);

    const parsed = sheetXml ? parseWorksheet(sheetXml, sharedStrings, dateStyles) : EMPTY_SHEET;

    sheets.push({
      name,
      hidden: (sheet.getAttribute("state") ?? "visible") !== "visible",
      rows: parsed.rows,
      rowCount: parsed.rows.length,
      columnCount: parsed.rows[0]?.length ?? 0,
      dateFormattedCells: parsed.dateFormattedCells,
      numericCells: parsed.numericCells,
      formulaCells: parsed.formulaCells,
      errorCells: parsed.errorCells,
      unresolvedSharedStrings: parsed.unresolvedSharedStrings,
    });
  }

  if (sheets.length === 0) {
    throw new XlsxReadError(
      "not-a-workbook",
      "This workbook declares no sheets, so there is nothing to convert.",
    );
  }

  return {
    sheets,
    styleTableRead,
    sharedStringsRead,
    date1904: readsDate1904(workbookDoc),
  };
}

/* ── CSV ──────────────────────────────────────────────────────────────────── */

export interface CsvDelimiter {
  id: "comma" | "semicolon" | "tab";
  label: string;
  char: string;
  /** One honest line about when this is the one you want. */
  note: string;
}

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [
  {
    id: "comma",
    label: "Comma",
    char: ",",
    note: "The RFC 4180 default, and what every scripting language expects.",
  },
  {
    id: "semicolon",
    label: "Semicolon",
    char: ";",
    note: "What Excel expects wherever the decimal separator is a comma — most of Europe and Latin America. A comma file opens there as one column per row.",
  },
  {
    id: "tab",
    label: "Tab",
    char: "\t",
    note: "Tab-separated. Pastes straight into a spreadsheet or a terminal without a quoting argument.",
  },
];

/** RFC 4180 line ending. Excel writes CRLF, and so does this. */
export const CSV_EOL = "\r\n";

/**
 * One field, quoted only where RFC 4180 requires it.
 *
 * The rule is: wrap in double quotes if the field contains the delimiter, a
 * double quote, a carriage return or a line feed, and double every quote
 * inside. Quoting more than that is legal but noisy; quoting less silently
 * splits a field in two when the reader hits the comma inside it.
 */
export function csvEscape(value: string, delimiter: string): string {
  if (value === "") return "";
  const mustQuote =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  return mustQuote ? `"${value.replace(/"/g, '""')}"` : value;
}

export interface CsvOptions {
  delimiter?: string;
  /**
   * Prefix U+FEFF. Excel on Windows reads a CSV in the system codepage unless
   * the file opens with this, so an accented name arrives mangled without it —
   * and many command-line readers hand the mark back as part of the first
   * column name. There is no setting that is right for both.
   */
  bom?: boolean;
  eol?: string;
}

export function rowsToCsv(rows: readonly (readonly string[])[], options: CsvOptions = {}): string {
  const { delimiter = ",", bom = false, eol = CSV_EOL } = options;
  const body = rows.map((row) => row.map((cell) => csvEscape(cell, delimiter)).join(delimiter)).join(eol);
  return bom ? `\uFEFF${body}` : body;
}

/* ── Naming the output ────────────────────────────────────────────────────── */

const stripExtension = (name: string): string => name.replace(/\.[^./\\]+$/, "");

/**
 * `book.xlsx` + `Q1 Actuals` → `book-Q1-Actuals.csv`.
 *
 * Sheet names may contain characters no filesystem wants (Excel allows spaces
 * and most punctuation), so they are folded to a safe set rather than passed
 * through into a download filename.
 */
export function csvFileName(sourceName: string, sheetName: string): string {
  const base = stripExtension(sourceName).trim() || "workbook";
  const sheet =
    sheetName
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "sheet";
  return `${base}-${sheet}.csv`;
}

/**
 * One filename per sheet, guaranteed distinct.
 *
 * Two entries under one name in a ZIP means one sheet silently vanishing.
 * Excel will not let two tabs share a name, but a workbook written by
 * something else can, and two names that differ only in the characters
 * `csvFileName` folds away — "Q1 / Q2" and "Q1-Q2" — collide even in a file
 * Excel wrote. The second and later collisions take a numeric suffix.
 */
export function csvFileNames(sourceName: string, sheetNames: readonly string[]): string[] {
  const used = new Set<string>();
  return sheetNames.map((sheetName) => {
    let name = csvFileName(sourceName, sheetName);
    if (used.has(name)) {
      const base = name.slice(0, -".csv".length);
      let n = 2;
      while (used.has(`${base}-${n}.csv`)) n++;
      name = `${base}-${n}.csv`;
    }
    used.add(name);
    return name;
  });
}

/** The ZIP a multi-sheet export comes down as. */
export function csvZipName(sourceName: string): string {
  return `${stripExtension(sourceName).trim() || "workbook"}-csv.zip`;
}
