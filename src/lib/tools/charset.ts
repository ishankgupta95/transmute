/**
 * Legacy text encodings → UTF-8.
 *
 * Pure functions over bytes and strings. No DOM, no WASM, no dependency:
 * `TextDecoder` is the whole engine, and every interesting decision here is
 * about which label to hand it and how sure we are.
 *
 * ── The direction is one-way, and it is the browser's limit, not a shortcut ──
 *
 * `TextDecoder` reads the entire WHATWG encoding set — Shift_JIS, KOI8-R,
 * Windows-1251, Big5, all of it. `TextEncoder` writes **UTF-8 and nothing
 * else**: its `encoding` property is the string "utf-8" and the constructor
 * takes no argument. There is no browser API that produces Shift_JIS bytes.
 * So this module converts legacy → UTF-8 and never claims the reverse; the
 * only output choice it offers is whether to prefix a byte-order mark.
 *
 * ── Detection ───────────────────────────────────────────────────────────────
 *
 * `decodeBytes` implements the same policy as `decodeSubtitleBytes` in
 * `src/lib/tools/subtitles.ts` — believe a BOM, spot BOM-less UTF-16 by its
 * NUL parity, otherwise test the bytes STRICTLY against UTF-8 and fall back to
 * Windows-1252 flagged as a guess. That file is the sibling implementation and
 * predates this one; the two are deliberately kept in step by hand rather than
 * shared, because merging them would mean editing a shipped module that a
 * different tool's tests pin. See the note in `CHARSET_ENCODINGS` for what
 * this one adds: strictness and replacement-character counting, which the
 * subtitle tool has no surface for.
 *
 * ── Why the U+FFFD count is the whole point ─────────────────────────────────
 *
 * The default (non-fatal) `TextDecoder` never fails. Hand it Windows-1251
 * bytes labelled UTF-8 and it returns a string with U+FFFD where every
 * Cyrillic letter was, and reports success. That is the shape of failure that
 * looks like success, so `decodeBytes` counts those characters and separately
 * records whether a STRICT decode of the same bytes with the same label would
 * have succeeded. A non-zero count with `strict: false` means the label is
 * wrong. A non-zero count with `strict: true` means the file genuinely
 * contains the replacement character, which is rare but real.
 */

/* ── The offered list ─────────────────────────────────────────────────────── */

export interface CharsetOption {
  /** The WHATWG label handed to `TextDecoder`. */
  label: string;
  /** What the picker shows. */
  name: string;
  /** Grouping for the `<optgroup>`. */
  group: "Unicode" | "Windows" | "ISO" | "East Asian" | "Other";
}

/**
 * The encodings the picker offers.
 *
 * Not the full WHATWG set: that is ~40 labels, most of which are aliases of
 * each other (`latin1`, `iso-8859-1`, `cp1252` and `ascii` are ALL Windows-1252
 * in the browser's own tables), and a picker of aliases teaches the user
 * nothing. These are the ones a file in the wild is actually written in.
 *
 * `iso-8859-1` is deliberately absent for exactly that reason — the WHATWG
 * encoding standard maps it to windows-1252, so offering both would be two
 * entries that cannot produce different text.
 */
export const CHARSET_ENCODINGS: readonly CharsetOption[] = [
  { label: "utf-8", name: "UTF-8", group: "Unicode" },
  { label: "utf-16le", name: "UTF-16 LE", group: "Unicode" },
  { label: "utf-16be", name: "UTF-16 BE", group: "Unicode" },

  { label: "windows-1252", name: "Windows-1252 · Western European", group: "Windows" },
  { label: "windows-1250", name: "Windows-1250 · Central European", group: "Windows" },
  { label: "windows-1251", name: "Windows-1251 · Cyrillic", group: "Windows" },
  { label: "windows-1253", name: "Windows-1253 · Greek", group: "Windows" },
  { label: "windows-1254", name: "Windows-1254 · Turkish", group: "Windows" },
  { label: "windows-1255", name: "Windows-1255 · Hebrew", group: "Windows" },
  { label: "windows-1256", name: "Windows-1256 · Arabic", group: "Windows" },
  { label: "windows-1257", name: "Windows-1257 · Baltic", group: "Windows" },

  { label: "iso-8859-2", name: "ISO-8859-2 · Latin-2", group: "ISO" },
  { label: "iso-8859-5", name: "ISO-8859-5 · Cyrillic", group: "ISO" },
  { label: "iso-8859-7", name: "ISO-8859-7 · Greek", group: "ISO" },
  { label: "iso-8859-9", name: "ISO-8859-9 · Turkish", group: "ISO" },
  { label: "iso-8859-15", name: "ISO-8859-15 · Latin-9", group: "ISO" },

  { label: "shift_jis", name: "Shift_JIS · Japanese", group: "East Asian" },
  { label: "euc-jp", name: "EUC-JP · Japanese", group: "East Asian" },
  { label: "euc-kr", name: "EUC-KR · Korean", group: "East Asian" },
  { label: "gbk", name: "GBK · Simplified Chinese", group: "East Asian" },
  { label: "gb18030", name: "GB18030 · Simplified Chinese", group: "East Asian" },
  { label: "big5", name: "Big5 · Traditional Chinese", group: "East Asian" },

  { label: "koi8-r", name: "KOI8-R · Russian", group: "Other" },
  { label: "koi8-u", name: "KOI8-U · Ukrainian", group: "Other" },
  { label: "macintosh", name: "Mac OS Roman", group: "Other" },
] as const;

/** The picker's groups, in the order they are drawn. */
export const CHARSET_GROUPS = ["Unicode", "Windows", "ISO", "East Asian", "Other"] as const;

/** What the guesser falls back to when the bytes are not valid UTF-8. */
export const FALLBACK_ENCODING = "windows-1252";

/** What the drop zone takes. Mirrors the registry's `acceptFormats`. */
export const CHARSET_ACCEPT = ".txt,.csv,.log,.srt,.md";

/** The Unicode replacement character — one per byte the decoder could not use. */
export const REPLACEMENT_CHAR = "�";

/* ── Report ───────────────────────────────────────────────────────────────── */

/** How the encoding label was arrived at. Only `guess` is uncertain. */
export type DecodeBasis = "forced" | "bom" | "utf-8" | "guess";

export interface CharsetReport {
  /** The decoded text. Always the whole file — the UI truncates the preview. */
  text: string;
  /** The WHATWG label actually decoded with. */
  encoding: string;
  basis: DecodeBasis;
  /** Which byte-order mark opened the file, or `null` for none. */
  bom: "utf-8" | "utf-16le" | "utf-16be" | null;
  /** Every byte below 0x80 — every encoding here agrees, so nothing can be wrong. */
  ascii: boolean;
  /**
   * Would a STRICT decode of these bytes with this label have succeeded?
   *
   * False means at least one byte sequence is not valid in the chosen
   * encoding, and every U+FFFD in `text` is damage. True with a non-zero
   * `replacements` means the file really does contain the character.
   *
   * Always true for a single-byte codepage: those map all 256 byte values, so
   * there is no such thing as an invalid byte in Windows-1252.
   */
  strict: boolean;
  /** U+FFFD characters in `text`. Non-zero with `strict: false` is a wrong label. */
  replacements: number;
  /** Bytes read from disk. */
  bytesIn: number;
}

export interface EncodeResult {
  bytes: Uint8Array;
  /** Bytes written, BOM included when one was added. */
  bytesOut: number;
  bomAdded: boolean;
}

/* ── Detection ────────────────────────────────────────────────────────────── */

const startsWith = (bytes: Uint8Array, sig: readonly number[]) =>
  bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);

/**
 * Is this UTF-16 with no BOM? Latin text in UTF-16 is half NUL bytes, and
 * which half says which endianness.
 *
 * Runs BEFORE the UTF-8 attempt, and must: NUL is a perfectly valid UTF-8
 * byte, so a strict UTF-8 decode ACCEPTS BOM-less UTF-16LE and hands back text
 * with a NUL between every letter — which looks, on screen, like a file that
 * decoded fine and is full of gaps.
 */
export function sniffUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const window = Math.min(bytes.length, 2048);
  if (window < 16) return null;
  let evenNuls = 0;
  let oddNuls = 0;
  for (let i = 0; i < window; i++) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) evenNuls++;
    else oddNuls++;
  }
  const half = window / 2;
  // At least 60% of one parity is NUL and almost none of the other.
  if (oddNuls > half * 0.6 && evenNuls < half * 0.1) return "utf-16le";
  if (evenNuls > half * 0.6 && oddNuls < half * 0.1) return "utf-16be";
  return null;
}

/** Which BOM opens these bytes, if any. */
export function detectBom(bytes: Uint8Array): "utf-8" | "utf-16le" | "utf-16be" | null {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return "utf-8";
  // FF FE 00 00 is UTF-32LE, which also starts FF FE. UTF-32 is not supported
  // here, and reading it as UTF-16 yields NUL-riddled text, so it is not
  // claimed as a UTF-16 BOM and falls through to the sniffer.
  if (startsWith(bytes, [0xff, 0xfe]) && !startsWith(bytes, [0xff, 0xfe, 0x00, 0x00])) {
    return "utf-16le";
  }
  if (startsWith(bytes, [0xfe, 0xff])) return "utf-16be";
  return null;
}

/** `true` when the label is one this browser's `TextDecoder` knows. */
export function isSupportedEncoding(label: string): boolean {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    // An unknown or unimplemented label throws `RangeError` from the
    // constructor. Rare in a browser, routine in a minimal JS engine.
    return false;
  }
}

function decodeWith(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return null;
  }
}

/** Would a fatal decode with this label have thrown? */
function decodesStrictly(bytes: Uint8Array, label: string): boolean {
  try {
    new TextDecoder(label, { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** How many U+FFFD are in this string. */
export function countReplacements(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) n++;
  }
  return n;
}

/**
 * Strip the byte-order mark the decoder leaves at the front.
 *
 * `TextDecoder` consumes a UTF-8/UTF-16 BOM only when the label matches the
 * mark; a UTF-8 BOM decoded as Windows-1252 comes through as the three
 * characters `ï»¿`, and a forced mismatch is exactly the case a user is
 * debugging here. So this removes only a real U+FEFF, which is what the
 * matching case produces.
 */
function stripBomChar(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Bytes to text, with the label used and how sure it is.
 *
 * Detection order, each step there because the one before it is not enough:
 *  1. A forced label from the picker wins outright — including when it is
 *     WRONG, because seeing it be wrong on screen is how a user resolves an
 *     ambiguous file.
 *  2. A BOM is a statement by whoever wrote the file. Believe it.
 *  3. BOM-less UTF-16, by NUL parity. Must precede the UTF-8 test.
 *  4. A STRICT UTF-8 decode. `fatal: true` is the point: the forgiving decoder
 *     replaces every bad byte with U+FFFD and reports success.
 *  5. Windows-1252, flagged as a guess. It is the commonest legacy codepage in
 *     the Latin world and a superset of Latin-1 in the browser's own tables —
 *     but a Cyrillic, Greek or Turkish file is equally valid non-UTF-8 and
 *     comes out with the wrong letters. This function will not pretend to know.
 */
export function decodeBytes(bytes: Uint8Array, forced?: string): CharsetReport {
  const ascii = bytes.every((b) => b < 0x80);
  const bom = detectBom(bytes);
  const bytesIn = bytes.length;

  const finish = (raw: string, encoding: string, basis: DecodeBasis): CharsetReport => {
    const text = stripBomChar(raw);
    return {
      text,
      encoding,
      basis,
      bom,
      ascii,
      strict: decodesStrictly(bytes, encoding),
      replacements: countReplacements(text),
      bytesIn,
    };
  };

  if (forced) {
    const text = decodeWith(bytes, forced);
    if (text !== null) return finish(text, forced, "forced");
  }

  if (bom) {
    const text = decodeWith(bytes, bom);
    if (text !== null) return finish(text, bom, "bom");
  }

  const sniffed = sniffUtf16(bytes);
  if (sniffed) {
    const text = decodeWith(bytes, sniffed);
    if (text !== null) return finish(text, sniffed, "guess");
  }

  if (decodesStrictly(bytes, "utf-8")) {
    return finish(new TextDecoder("utf-8").decode(bytes), "utf-8", "utf-8");
  }

  const fallback = decodeWith(bytes, FALLBACK_ENCODING);
  if (fallback !== null) return finish(fallback, FALLBACK_ENCODING, "guess");

  // No legacy codec at all: decode leniently so the words survive even though
  // the accents will not, and say it was a guess.
  return finish(new TextDecoder().decode(bytes), "utf-8", "guess");
}

/* ── Bytes out ────────────────────────────────────────────────────────────── */

/** The three bytes of a UTF-8 byte-order mark. */
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

/**
 * Text to UTF-8 bytes, optionally prefixed with a BOM.
 *
 * `TextEncoder` takes no encoding argument in any browser: UTF-8 is the only
 * thing it writes. That is the reason this whole module is one-directional,
 * and the reason `addBom` is the only output option.
 */
export function encodeUtf8(text: string, addBom = false): EncodeResult {
  const body = new TextEncoder().encode(text);
  if (!addBom) return { bytes: body, bytesOut: body.length, bomAdded: false };
  const out = new Uint8Array(UTF8_BOM.length + body.length);
  out.set(UTF8_BOM, 0);
  out.set(body, UTF8_BOM.length);
  return { bytes: out, bytesOut: out.length, bomAdded: true };
}

/* ── Naming ───────────────────────────────────────────────────────────────── */

/**
 * `notes.txt` → `notes.utf8.txt`. The extension is kept, because the file is
 * still a .txt/.csv/.srt — only its bytes changed.
 */
export function utf8FileName(sourceName: string): string {
  const trimmed = sourceName.trim() || "converted.txt";
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return `${trimmed}.utf8`;
  return `${trimmed.slice(0, dot)}.utf8${trimmed.slice(dot)}`;
}

/** The display name for a label, or the label itself when it is not offered. */
export function encodingName(label: string): string {
  return CHARSET_ENCODINGS.find((e) => e.label === label)?.name ?? label.toUpperCase();
}
