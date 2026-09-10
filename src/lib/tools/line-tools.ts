/**
 * Line-level text operations, DOM-free: reading a file as text at all, sorting
 * and de-duplicating lines, and rewriting line endings.
 *
 * Three decisions in here are load-bearing and are stated on the pages that
 * use them, so changing one changes user-facing copy too:
 *
 * 1. **Reading is strict.** `readUtf8Text` decodes with `fatal: true` and
 *    refuses anything that is not valid UTF-8, instead of falling back to the
 *    forgiving decoder every browser uses by default. A Windows-1252 log read
 *    forgivingly comes back with U+FFFD where each accented character was, and
 *    the tool would then write that damage out as the "converted" file. Since
 *    these tools re-encode their output as UTF-8, a lenient read is silent
 *    corruption; a refusal is a sentence the user can act on.
 *
 * 2. **Ordering is Unicode collation, not code points.** `Intl.Collator` is
 *    what makes `a` sort next to `A` and `é` next to `e`, and with
 *    `numeric: true` it is what makes `file2` come before `file10`. A raw
 *    `<` comparison puts every capital letter before every lower-case one
 *    (`Zebra` < `apple`) and `file10` before `file2`. The pages say which one
 *    they use.
 *
 * 3. **Line endings are counted per kind, never normalised on the way in.**
 *    A file with 400 CRLF and 3 LF endings is the whole reason the line-ending
 *    page gets searched for, so `countLineEndings` reports the three kinds
 *    separately and nothing here quietly collapses them first.
 *
 * 4. **A byte-order mark is never content.** `readUtf8Text` hands the mark back
 *    as a leading U+FEFF so a page can report it, and every transform in here
 *    then detaches it before it touches lines and re-attaches it at the HEAD of
 *    the output. Left attached to line 1 it is invisible content that a sort
 *    relocates into the middle of the file — `Intl.Collator` ignores U+FEFF
 *    entirely, so nothing on screen would show it moving — and that makes the
 *    marked line unequal to its unmarked twin, so a duplicate survives and is
 *    reported as zero duplicates.
 */

/* ── Reading bytes as text ────────────────────────────────────────────── */

/**
 * Why a byte array could not be handed to these tools as text.
 *
 * - `utf-16`: a UTF-16 byte-order mark, or a stream riddled with NUL bytes at
 *   alternating positions. Every operation here is defined over characters and
 *   writes UTF-8 back out, so a UTF-16 file would come back re-encoded — a
 *   change to every byte in the file, which is not what any of these pages
 *   advertise.
 * - `binary`: NUL bytes, but not in the UTF-16 pattern. Almost certainly not a
 *   text file at all.
 * - `not-utf-8`: bytes that are not valid UTF-8. Usually a legacy single-byte
 *   codepage (Windows-1252, Latin-1, KOI8-R). Readable, but only once someone
 *   says which one — see the charset converter.
 */
export type TextReadFailure = "utf-16" | "binary" | "not-utf-8";

/**
 * What the user is told for each refusal. Kept beside the check rather than in
 * three components, so the three pages that share this reader cannot drift into
 * three different explanations of the same event.
 */
export const TEXT_READ_MESSAGE: Record<TextReadFailure, string> = {
  "utf-16":
    "This file is UTF-16, not UTF-8 — two bytes per character, half of them zero. Everything here writes UTF-8 back out, so opening it would re-encode every byte in the file rather than change only what you asked to change. Convert it to UTF-8 first with the charset converter, then come back.",
  binary:
    "This file contains NUL bytes, so it is not text. Nothing has been read past the first few kilobytes. If it really is a text file, it is in an encoding this page cannot identify.",
  "not-utf-8":
    "These bytes are not valid UTF-8 — almost certainly a legacy single-byte codepage such as Windows-1252, Latin-1 or KOI8-R. Reading it anyway would replace every accented character with a diamond and then write that damage out as your result, so it is refused instead. The charset converter names the codepage and gives you a UTF-8 copy.",
};

export interface TextReadResult {
  /**
   * The decoded text. A leading UTF-8 byte-order mark is KEPT as U+FEFF rather
   * than swallowed by the decoder, because whether the file has one is a
   * question these tools answer on screen.
   */
  text: string;
  hadBom: boolean;
  /** Length of the input in bytes, as read. */
  bytes: number;
}

/** How much of the head is examined for the NUL-byte tests. */
const SNIFF_BYTES = 4096;

/**
 * Decode bytes as UTF-8 or say why not. Never returns damaged text.
 *
 * The NUL heuristic: valid UTF-8 text can legally contain U+0000, but text
 * files essentially never do, while BOM-less UTF-16 is half NUL by
 * construction. So any NUL in the first 4 KB is a refusal, and the proportion
 * only decides which sentence the user is shown.
 */
export function readUtf8Text(
  bytes: Uint8Array,
): TextReadResult | { failure: TextReadFailure } {
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff)
  ) {
    return { failure: "utf-16" };
  }

  const sample = Math.min(bytes.length, SNIFF_BYTES);
  let nuls = 0;
  for (let i = 0; i < sample; i++) if (bytes[i] === 0) nuls++;
  if (nuls > 0) {
    return { failure: nuls / sample > 0.2 ? "utf-16" : "binary" };
  }

  try {
    // `ignoreBOM: true` means "do not strip it", so a byte-order mark survives
    // into the string as U+FEFF and the caller can report and remove it.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    return {
      text,
      hadBom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
      bytes: bytes.length,
    };
  } catch {
    return { failure: "not-utf-8" };
  }
}

/** Exact UTF-8 size of a string, which is what these tools download. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/* ── Line endings ─────────────────────────────────────────────────────── */

export type Eol = "crlf" | "lf" | "cr";

export const EOL_SEQUENCE: Record<Eol, string> = {
  crlf: "\r\n",
  lf: "\n",
  cr: "\r",
};

export const EOL_NAME: Record<Eol, string> = {
  crlf: "CRLF",
  lf: "LF",
  cr: "CR",
};

export const EOL_WHERE: Record<Eol, string> = {
  crlf: "Windows, DOS, most HTTP and email headers",
  lf: "Linux, macOS, Git, every POSIX tool",
  cr: "Mac OS 9 and earlier",
};

export interface EolCounts {
  crlf: number;
  lf: number;
  cr: number;
  /** crlf + lf + cr — the number of line breaks in the text. */
  total: number;
}

/**
 * Count the three kinds of line break separately.
 *
 * The single-pass scan is what keeps CRLF from being double-counted: a `\r`
 * followed by `\n` consumes both characters, so it can never also register as
 * a lone CR plus a lone LF. A regex split cannot report this at all, which is
 * why nothing here splits first and counts afterwards.
 */
export function countLineEndings(text: string): EolCounts {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\r") {
      if (text[i + 1] === "\n") {
        crlf++;
        i++;
      } else {
        cr++;
      }
    } else if (ch === "\n") {
      lf++;
    }
  }
  return { crlf, lf, cr, total: crlf + lf + cr };
}

/** True when more than one kind of break is present — the case people search for. */
export function isMixedEol(counts: EolCounts): boolean {
  return [counts.crlf, counts.lf, counts.cr].filter((n) => n > 0).length > 1;
}

/**
 * The kind used most often, or null when the text has no line breaks at all.
 * Ties go to the earlier entry in CRLF, LF, CR order.
 */
export function dominantEol(counts: EolCounts): Eol | null {
  if (counts.total === 0) return null;
  const ranked: [Eol, number][] = [
    ["crlf", counts.crlf],
    ["lf", counts.lf],
    ["cr", counts.cr],
  ];
  return ranked.reduce((best, row) => (row[1] > best[1] ? row : best))[0];
}

export interface LineEndingOptions {
  target: Eol;
  /** Append one target-sequence break when the text does not already end with one. */
  ensureTrailingNewline: boolean;
  /** Remove a leading U+FEFF. Does nothing when there is none. */
  stripBom: boolean;
}

export interface LineEndingResult {
  text: string;
  /** What the input had, per kind. */
  before: EolCounts;
  /** What the output has, per kind. */
  after: EolCounts;
  /** Whether the INPUT mixed kinds. */
  mixed: boolean;
  /** Breaks that were already the target and were rewritten identically. */
  alreadyTarget: number;
  /** Breaks that changed from one kind to another. */
  converted: number;
  /**
   * Lines of text, where a trailing break terminates the last line rather than
   * opening an empty one: `a\nb` and `a\nb\n` are both 2 lines. Empty text is
   * 0 lines.
   */
  lines: number;
  hadBom: boolean;
  bomStripped: boolean;
  trailingNewlineAdded: boolean;
  bytesIn: number;
  bytesOut: number;
}

/** Split on any of the three kinds. A single trailing break does not add an empty line. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const parts = text.split(/\r\n|\r|\n/);
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/**
 * Rewrite every line ending to one kind, optionally dropping a byte-order mark
 * and guaranteeing a final newline.
 *
 * Only line endings and the optional BOM change. The characters between the
 * breaks are copied through untouched, so the byte delta is entirely
 * accounted for by `converted`, `bomStripped` and `trailingNewlineAdded` —
 * which is what lets the page print a real number instead of "smaller".
 */
export function convertLineEndings(
  text: string,
  options: LineEndingOptions,
): LineEndingResult {
  const before = countLineEndings(text);
  const hadBom = text.startsWith("\uFEFF");
  const bomStripped = hadBom && options.stripBom;
  const body = bomStripped ? text.slice(1) : text;

  const seq = EOL_SEQUENCE[options.target];
  const parts = body.split(/\r\n|\r|\n/);
  let out = parts.join(seq);

  const endedWithBreak = parts.length > 1 && parts[parts.length - 1] === "";
  const trailingNewlineAdded =
    options.ensureTrailingNewline && body.length > 0 && !endedWithBreak;
  if (trailingNewlineAdded) out += seq;

  const alreadyTarget = before[options.target];
  return {
    text: out,
    before,
    after: countLineEndings(out),
    mixed: isMixedEol(before),
    alreadyTarget,
    converted: before.total - alreadyTarget,
    lines: splitLines(body).length,
    hadBom,
    bomStripped,
    trailingNewlineAdded,
    bytesIn: utf8ByteLength(text),
    bytesOut: utf8ByteLength(out),
  };
}

/* ── Sort and de-duplicate ────────────────────────────────────────────── */

export type SortMode = "none" | "asc" | "desc" | "natural" | "length";

export type DedupeMode = "off" | "first" | "last";

export interface SortDedupeOptions {
  sort: SortMode;
  /** Applies to BOTH the comparison and the duplicate test. */
  caseSensitive: boolean;
  /** Strip leading and trailing whitespace from every line. */
  trim: boolean;
  /** Drop lines that are empty or whitespace only. */
  removeBlank: boolean;
  dedupe: DedupeMode;
  /** Flip the final order, whatever it is. Applied last. */
  reverse: boolean;
  /**
   * Drop a leading U+FEFF instead of writing it back at the head of the
   * output. Does nothing when there is none. Either way the mark is detached
   * from line 1 before anything is compared or sorted.
   */
  stripBom: boolean;
}

export interface SortDedupeResult {
  lines: string[];
  text: string;
  linesIn: number;
  linesOut: number;
  /** Lines whose content actually changed under trim, not the number trimmed. */
  trimmedLines: number;
  blanksRemoved: number;
  duplicatesRemoved: number;
  /** How many distinct values appeared more than once. */
  duplicateGroups: number;
  /** The ending the output was rejoined with — the input's own, where it had one. */
  eol: Eol;
  /** Whether the input mixed line endings, so the rejoin flattened them. */
  mixedEol: boolean;
  /** True when the input ended with a break, which the output then preserves. */
  trailingNewline: boolean;
  /** The input opened with a U+FEFF byte-order mark. */
  hadBom: boolean;
  /** There was one and it was dropped rather than written back at the head. */
  bomStripped: boolean;
}

/**
 * Trim, drop blanks, de-duplicate, sort, reverse — in that order, always.
 *
 * The order is not arbitrary and the page states it: trimming first is what
 * makes `"  api  "` and `"api"` the same line, and de-duplicating before
 * sorting is what keeps "keep the first occurrence" meaning first in YOUR
 * file rather than first after a re-order.
 *
 * A leading byte-order mark is detached before any of that and written back at
 * the head afterwards (or dropped, on request) — see note 4 in the file header
 * for why leaving it on line 1 is silent corruption.
 */
export function sortDedupeLines(
  text: string,
  options: SortDedupeOptions,
): SortDedupeResult {
  const hadBom = text.startsWith("\uFEFF");
  const bomStripped = hadBom && options.stripBom;
  const body = hadBom ? text.slice(1) : text;

  const counts = countLineEndings(body);
  const eol = dominantEol(counts) ?? "lf";
  const trailingNewline = /(\r\n|\r|\n)$/.test(body);

  let lines = splitLines(body);
  const linesIn = lines.length;

  let trimmedLines = 0;
  if (options.trim) {
    lines = lines.map((line) => {
      const next = line.trim();
      if (next !== line) trimmedLines++;
      return next;
    });
  }

  let blanksRemoved = 0;
  if (options.removeBlank) {
    const kept = lines.filter((line) => line.trim() !== "");
    blanksRemoved = lines.length - kept.length;
    lines = kept;
  }

  const key = (line: string) => (options.caseSensitive ? line : line.toLowerCase());

  let duplicatesRemoved = 0;
  let duplicateGroups = 0;
  if (options.dedupe !== "off") {
    const seen = new Map<string, number>();
    lines.forEach((line, i) => seen.set(key(line), i));
    const tally = new Map<string, number>();
    for (const line of lines) {
      const k = key(line);
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    duplicateGroups = [...tally.values()].filter((n) => n > 1).length;

    const before = lines.length;
    if (options.dedupe === "first") {
      const kept = new Set<string>();
      lines = lines.filter((line) => {
        const k = key(line);
        if (kept.has(k)) return false;
        kept.add(k);
        return true;
      });
    } else {
      // Keep the LAST occurrence, in the position it already occupies — not
      // the first slot with the last value, which would silently move a line.
      lines = lines.filter((line, i) => seen.get(key(line)) === i);
    }
    duplicatesRemoved = before - lines.length;
  }

  if (options.sort !== "none") {
    const collator = new Intl.Collator(undefined, {
      sensitivity: options.caseSensitive ? "variant" : "accent",
    });
    const natural = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: options.caseSensitive ? "variant" : "accent",
    });
    const compare: Record<Exclude<SortMode, "none">, (a: string, b: string) => number> = {
      asc: (a, b) => collator.compare(a, b),
      desc: (a, b) => collator.compare(b, a),
      natural: (a, b) => natural.compare(a, b),
      // Ties inside one length fall back to collation, so the result is
      // deterministic rather than "whatever order they arrived in".
      length: (a, b) => a.length - b.length || collator.compare(a, b),
    };
    // Array.prototype.sort has been required to be stable since ES2019, so
    // equal lines keep their input order.
    lines = [...lines].sort(compare[options.sort]);
  }

  if (options.reverse) lines = [...lines].reverse();

  const joined = lines.join(EOL_SEQUENCE[eol]);
  const rejoined =
    trailingNewline && lines.length > 0 ? joined + EOL_SEQUENCE[eol] : joined;
  return {
    lines,
    // The mark goes back where a mark belongs: in front of everything, so a
    // file that opened with one still does. Never on whichever line happens to
    // have sorted first.
    text: hadBom && !bomStripped ? `\uFEFF${rejoined}` : rejoined,
    linesIn,
    linesOut: lines.length,
    trimmedLines,
    blanksRemoved,
    duplicatesRemoved,
    duplicateGroups,
    eol,
    mixedEol: isMixedEol(counts),
    trailingNewline,
    hadBom,
    bomStripped,
  };
}
