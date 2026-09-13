/**
 * Turn a pasted Base64 string back into image bytes.
 *
 * THE DECODER IS LIFTED, NOT REWRITTEN
 *
 * `decodeBase64ToBytes` is the decoder that was trapped inside
 * `Base64EncodeDecodeUI.tsx`, moved here so both tools share one
 * implementation. It carries a bug fix whose ORDERING IS LOAD-BEARING and
 * which its original comment records: whitespace is stripped BEFORE the `% 4`
 * padding arithmetic. `atob` tolerates newlines itself, but the padding maths
 * counted them and produced a wrong pad — which is every `base64(1)` output
 * (wrapped at 76 columns), every PEM body and every
 * `kubectl get secret -o yaml` value.
 *
 * WHAT `atob` DOES AND DOES NOT DO — measured, `scratchpad/base64-webp.mjs`
 *
 *   plain / no padding / spaces / newlines / CRLF / tabs   OK
 *   URL-safe alphabet (- _)                                THROWS
 *   length % 4 === 1                                       THROWS
 *   a whole data: URI                                      THROWS
 *   non-base64 junk                                        THROWS
 *
 * So whitespace and missing padding are free, and the three things this module
 * adds on top are the URL-safe translation, the data-URI prefix split, and a
 * refusal for a `data:` URI whose payload is percent-encoded rather than
 * Base64. `atob` throws the SAME `InvalidCharacterError` for all four of its
 * rejections, which is why the classification happens here: someone who pasted
 * a percent-encoded data URI and someone whose clipboard truncated need
 * opposite advice.
 *
 * THE MEDIA TYPE IN THE PREFIX IS NOT EVIDENCE
 *
 * `data:image/png;base64,` in front of JPEG bytes is a common paste, and the
 * person who wrote that prefix is the person asking us what the file is. The
 * format is decided by the decoded magic bytes — the same house rule
 * `image-frames.ts` states: the caller's MIME or extension can lie. The
 * declared type is reported alongside so the UI can say they disagree rather
 * than silently renaming someone's file.
 *
 * WHY THE FORMAT LIST STOPS WHERE IT DOES
 *
 * PNG, JPEG, GIF, WebP, BMP, AVIF, ICO and SVG — every one of which an `<img>`
 * element can draw, which is the only thing this tool does with the bytes.
 * HEIC and TIFF are images too, and are deliberately NOT sniffed: naming them
 * would promise a preview that no browser is going to produce (they are why
 * `libheif` and `utif2` exist in this app at all), and "we know what this is
 * and cannot show it" is a worse answer here than "these are not bytes this
 * tool can name".
 *
 * DOM-FREE and TOTAL: no `document`, no `Image`, no canvas. `atob` is the only
 * global, and it exists in browsers, workers and jsdom alike. Whether the bytes
 * are a *decodable* image is a separate question this module cannot answer — a
 * truncated PNG has a perfect magic number — so the UI still has to
 * distinguish "these are not image bytes" from "this browser could not draw
 * these image bytes".
 */

/** A format identified from the decoded bytes. */
export type ImageFormatId = "png" | "jpeg" | "gif" | "webp" | "bmp" | "avif" | "ico" | "svg";

export interface SniffedImageFormat {
  id: ImageFormatId;
  mime: string;
  /** Extension without the dot, for naming the download. */
  ext: string;
  /**
   * True for SVG, which is markup rather than a raster. It is safe only when
   * handed to an `<img>` — never inlined into the page — so a caller with no
   * `<img>` path must refuse it.
   */
  markup: boolean;
}

/** Which shape of input was recognised. */
export type Base64ImageSource = "raw" | "data-uri" | "img-tag";

export interface DecodedBase64Image {
  bytes: Uint8Array;
  /** Decided by the magic bytes, never by the pasted prefix. */
  format: ImageFormatId;
  mime: string;
  /** Extension without the dot, taken from `format`. */
  ext: string;
  /** The mediatype the input claimed, lower-cased, or null when it claimed none. */
  declaredMime: string | null;
  /** Which paste shape this came out of. `img-tag` is a silent unwrap worth showing. */
  source: Base64ImageSource;
  /** True when the payload used the URL-safe alphabet (`-` and `_`). */
  urlSafe: boolean;
  /** How many `=` this decoder had to add. 0 when the paste was already padded. */
  paddingAdded: number;
}

export type Base64ImageFailure =
  /** Nothing was pasted. */
  | "empty"
  /** A `data:` URI with no `;base64` marker: the payload is percent-encoded. */
  | "percent-encoded"
  /** The wrong alphabet, or characters outside Base64 entirely. */
  | "not-base64"
  /**
   * A length no complete Base64 string can have: `% 4 === 1`. Four characters
   * carry three bytes and a final group of 2 or 3 characters carries 1 or 2,
   * so a group of exactly 1 leftover character cannot come from any input.
   * The paste was cut short.
   */
  | "truncated"
  /** It decoded, but the bytes match no format this tool names. */
  | "not-an-image";

export type DecodeBase64ImageResult =
  | { ok: true; image: DecodedBase64Image }
  | { ok: false; reason: Base64ImageFailure; byteLength?: number };

/**
 * Base64 → bytes, accepting every shape `atob` does plus URL-safe and unpadded
 * input. Returns null when the string is not Base64 at all.
 *
 * Total by design: both callers want to show their own message, and neither
 * wants a raw `DOMException: InvalidCharacterError` reaching a user.
 */
export function decodeBase64ToBytes(text: string): Uint8Array | null {
  const decoded = decodeBase64Detail(text);
  return decoded.ok ? decoded.bytes : null;
}

/**
 * Accept a raw Base64 string, a `data:` URI, or an `<img src="…">` fragment,
 * and hand back the image bytes with the format read out of them.
 */
export function decodeBase64Image(input: string): DecodeBase64ImageResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "empty" };

  const extracted = extractPayload(trimmed);
  if (!extracted.ok) return extracted;

  const decoded = decodeBase64Detail(extracted.payload);
  if (!decoded.ok) return { ok: false, reason: decoded.reason };

  const format = sniffImageFormat(decoded.bytes);
  if (!format) {
    return { ok: false, reason: "not-an-image", byteLength: decoded.bytes.length };
  }

  return {
    ok: true,
    image: {
      bytes: decoded.bytes,
      format: format.id,
      mime: format.mime,
      ext: format.ext,
      declaredMime: extracted.declaredMime,
      source: extracted.source,
      urlSafe: decoded.urlSafe,
      paddingAdded: decoded.paddingAdded,
    },
  };
}

// ── the Base64 half ──────────────────────────────────────────────

type Base64DecodeDetail =
  | { ok: true; bytes: Uint8Array; urlSafe: boolean; paddingAdded: number }
  | { ok: false; reason: "not-base64" | "truncated" };

function decodeBase64Detail(text: string): Base64DecodeDetail {
  // Strip whitespace FIRST — see the module header. Then translate the
  // URL-safe alphabet, then pad. Reordering any of these breaks a real input.
  const compact = text.replace(/\s+/g, "");
  const urlSafe = /[-_]/.test(compact);
  const translated = compact.replace(/-/g, "+").replace(/_/g, "/");
  // Re-derive the padding rather than trusting whatever came in: a paste can
  // arrive over-padded, under-padded, or padded and then truncated.
  const core = translated.replace(/=+$/, "");
  /*
    The alphabet is checked BEFORE the length, and the order matters: without
    it, "this is not base64!!" compacts to 17 characters and gets reported as
    a truncated paste, sending someone to look for the rest of a string that
    was never Base64 in the first place.
  */
  if (!/^[A-Za-z0-9+/]*$/.test(core)) return { ok: false, reason: "not-base64" };
  const remainder = core.length % 4;
  // A trailing group of one character decodes to zero bytes and is therefore
  // impossible in a whole string — `atob` throws on it too, but with the same
  // message it gives genuine junk, so it is classified before we get there.
  if (remainder === 1) return { ok: false, reason: "truncated" };
  const padded = core + "=".repeat(remainder === 0 ? 0 : 4 - remainder);
  // Characters this decoder ADDED, which is 0 for a paste that arrived
  // correctly padded and 0 again for one that arrived over-padded. Reporting
  // the pad it re-derived would show "2 added" for a string that needed none.
  const paddingAdded = Math.max(0, padded.length - translated.length);
  try {
    const binary = atob(padded);
    return {
      ok: true,
      bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0)),
      urlSafe,
      paddingAdded,
    };
  } catch {
    return { ok: false, reason: "not-base64" };
  }
}

// ── the paste-shape half ─────────────────────────────────────────

interface ExtractedPayload {
  ok: true;
  payload: string;
  source: Base64ImageSource;
  declaredMime: string | null;
}

/**
 * Peel a data URI or an `<img>` tag down to the Base64 payload.
 *
 * The data-URI split is on the FIRST comma, not on a `;base64,` regex: the
 * prefix legitimately carries other parameters
 * (`data:image/svg+xml;charset=utf-8;base64,…`) and matching only the marker
 * would leave them attached to the payload.
 */
function extractPayload(
  input: string,
): ExtractedPayload | { ok: false; reason: Base64ImageFailure } {
  const fromTag = extractImgSrc(input);
  if (fromTag !== null) {
    const inner = extractPayload(fromTag.trim());
    if (!inner.ok) return inner;
    return { ...inner, source: "img-tag" };
  }

  if (!/^data:/i.test(input)) {
    return { ok: true, payload: input, source: "raw", declaredMime: null };
  }

  const comma = input.indexOf(",");
  // A `data:` URI with no comma has no payload at all, and the characters
  // after `data:` are a mediatype — not Base64 that merely failed to decode.
  if (comma === -1) return { ok: false, reason: "percent-encoded" };

  // "data:image/png;base64" → "image/png;base64"
  const prefix = input.slice(5, comma);
  if (!/(^|;)\s*base64\s*$/i.test(prefix)) {
    return { ok: false, reason: "percent-encoded" };
  }
  const declared = prefix.split(";")[0].trim().toLowerCase();
  return {
    ok: true,
    payload: input.slice(comma + 1),
    source: "data-uri",
    declaredMime: declared || null,
  };
}

/**
 * The `src` of the first `<img>` tag, or null when the input is not one.
 * People paste the whole tag out of a page's HTML far more often than they
 * paste the bare attribute value.
 */
function extractImgSrc(input: string): string | null {
  const match = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(input);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

// ── the magic-byte half ──────────────────────────────────────────

const FORMATS: Record<ImageFormatId, SniffedImageFormat> = {
  png: { id: "png", mime: "image/png", ext: "png", markup: false },
  jpeg: { id: "jpeg", mime: "image/jpeg", ext: "jpg", markup: false },
  gif: { id: "gif", mime: "image/gif", ext: "gif", markup: false },
  webp: { id: "webp", mime: "image/webp", ext: "webp", markup: false },
  bmp: { id: "bmp", mime: "image/bmp", ext: "bmp", markup: false },
  avif: { id: "avif", mime: "image/avif", ext: "avif", markup: false },
  ico: { id: "ico", mime: "image/vnd.microsoft.icon", ext: "ico", markup: false },
  svg: { id: "svg", mime: "image/svg+xml", ext: "svg", markup: true },
};

/**
 * Identify the format from the leading bytes, or null for anything else.
 *
 * This says what the bytes ARE — not whether the browser can decode them,
 * which is a separate and later question a magic number cannot answer.
 *
 * EVERY TEST HERE IS STRUCTURAL, AND THAT IS WHAT MAKES THE UI HONEST
 *
 * `Base64ToImageUI` has two failure messages and picks between them on this
 * function's answer: "the first bytes match no image format this tool can
 * name" when it returns null, and "these bytes start with a valid image
 * signature, but this browser could not draw them — a paste that was cut short
 * does exactly that" when it returns a format and the `<img>` then fails. The
 * second sentence is only true if what let the bytes through was a signature.
 * Three of these tests were not, and every one of them accepted plain text:
 *
 *   `BM` is TWO bytes, so `BMW parts list` was a bitmap.
 *   `GIF8` is four of the six bytes of the GIF signature.
 *   `<svg` anywhere in the first 256 bytes made an HTML page an SVG — see
 *   `looksLikeSvg`, which is the one worth reading.
 *
 * In each case the tool named a format, offered `image.bmp` / `image.gif` /
 * `image.svg` as the download, and then blamed the user's clipboard for a
 * preview that was never going to appear.
 *
 * ORDER IS LOAD-BEARING between the ISO-BMFF brands and ICO. `00 00 01 00` is
 * an ICONDIR header AND a legal 256-byte box length in front of `ftyp`, so the
 * container is tested first and takes the file either way: an ISO-BMFF file is
 * not an icon directory, whatever its box length happens to spell.
 */
export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | null {
  if (bytes.length < 4) return null;
  if (starts(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return FORMATS.png;
  if (starts(bytes, 0, [0xff, 0xd8, 0xff])) return FORMATS.jpeg;
  // The GIF signature is six bytes and the spec defines exactly two of them —
  // "GIF87a" and "GIF89a". Matching "GIF8" alone accepted its own prose.
  if (
    starts(bytes, 0, [0x47, 0x49, 0x46, 0x38]) &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return FORMATS.gif;
  }
  if (looksLikeBmp(bytes)) return FORMATS.bmp;
  // RIFF....WEBP — the four bytes between are the file size, so they are skipped.
  if (starts(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return FORMATS.webp;
  }
  // ISO-BMFF: a box length, "ftyp", then the brand. AVIF shares this container
  // with HEIC and MP4 — the brand is the only thing that separates them, and
  // the two we do not name are refused HERE rather than falling through to a
  // later test that a box length could satisfy by accident.
  if (starts(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = ascii(bytes, 8, 4);
    return brand === "avif" || brand === "avis" ? FORMATS.avif : null;
  }
  if (looksLikeIco(bytes)) return FORMATS.ico;
  if (looksLikeSvg(bytes)) return FORMATS.svg;
  return null;
}

/**
 * The DIB header sizes the format defines: BITMAPCOREHEADER 12, OS/2 16 and
 * 64, BITMAPINFOHEADER 40, V2 52, V3 56, V4 108, V5 124.
 */
const BMP_DIB_SIZES = new Set([12, 16, 40, 52, 56, 64, 108, 124]);

/**
 * A BMP is `BM`, a 14-byte file header, and then a DIB header whose first
 * four bytes are its own length — one of eight defined values.
 *
 * The two letters alone are not a signature. Any text beginning `BM` matched
 * (measured: `BMW parts list…` decoded as a 54-byte bitmap named image.bmp),
 * and the DIB length is what separates a bitmap from a word. It is read rather
 * than the file-size field at offset 2 because encoders do write a zero there,
 * whereas nothing writes a DIB header that lies about its own length —
 * verified against the BMP `sips` produces on this machine, whose DIB size is
 * 40 (`424d 5a00 0000 0000 0000 3600 0000 2800 0000`).
 */
function looksLikeBmp(bytes: Uint8Array): boolean {
  if (!starts(bytes, 0, [0x42, 0x4d])) return false;
  // 14-byte file header + the 4-byte DIB length. The smallest legal BMP is
  // larger still (26 bytes), so nothing real is lost by needing 18.
  if (bytes.length < 18) return false;
  return BMP_DIB_SIZES.has(u32le(bytes, 14));
}

/**
 * ICONDIR: reserved 0, type 1 (icon) or 2 (cursor), then the entry count, all
 * little-endian.
 *
 * Those first four bytes are mostly zeroes and are a pattern arbitrary binary
 * hits — including, as the header above says, a 256-byte ISO-BMFF box length.
 * So the count is checked too: a directory of N entries occupies 16N bytes
 * after the 6-byte header and has to actually be there. Every real .ico
 * satisfies that; a run of zeroes with a 1 in it does not.
 */
function looksLikeIco(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0 || bytes[1] !== 0 || bytes[3] !== 0) return false;
  if (bytes[2] !== 1 && bytes[2] !== 2) return false;
  if (bytes.length < 6) return false;
  const count = u16le(bytes, 4);
  return count >= 1 && bytes.length >= 6 + count * 16;
}

/** How far in the SVG root element is allowed to be. See `looksLikeSvg`. */
const SVG_HEAD_BYTES = 1024;

/**
 * SVG has no magic number, so the root ELEMENT is the signature — and this
 * walks to it instead of searching for it.
 *
 * The search it replaces (`ascii(bytes, 0, 256).includes("<svg")`) was not a
 * format test at all. An HTML invoice with an inline icon, a JS module with an
 * icon in a string literal and a README that mentions `<svg>` all passed it,
 * and each one was then named SVG, offered as `image.svg`, and — when the
 * `<img>` refused to draw markup that is not an image — reported to the user
 * as image bytes whose paste had been cut short. None of that was true, and
 * "these are not bytes this tool can name" was the answer the whole time.
 *
 * XML allows exactly four things in front of the root element, so exactly
 * those four are skipped: a BOM, whitespace, processing instructions
 * (`<?xml …?>` and `<?xml-stylesheet …?>`) and comments, plus the DOCTYPE.
 * Anything else — `<!doctype html>` followed by `<html`, an `export const`,
 * a `#` heading — ends the walk, and only `<svg` closes it.
 *
 * The window grew from 256 bytes to 1 KB in the same change, which the search
 * could not have afforded: an Illustrator export opens with an XML
 * declaration, the 110-character SVG 1.1 DOCTYPE and a generator comment, and
 * its root element can sit past byte 256. A substring search widened that far
 * would swallow a kilobyte of arbitrary text; an anchored walk cannot, because
 * everything it steps over has to be XML prolog.
 *
 * Two things it deliberately does not do: it does not accept UTF-16 (an `<img>`
 * will not draw it either, and the bytes read as `<\0s\0v\0g` here), and it
 * does not decompress .svgz — a gzipped SVG is refused as not-an-image, which
 * is what it is until something gunzips it.
 */
function looksLikeSvg(bytes: Uint8Array): boolean {
  let head = ascii(bytes, 0, Math.min(bytes.length, SVG_HEAD_BYTES));
  // A UTF-8 BOM arrives here as three latin-1 characters, not as U+FEFF.
  if (head.startsWith("\u00ef\u00bb\u00bf")) head = head.slice(3);

  let at = 0;
  for (;;) {
    while (at < head.length && /\s/.test(head[at])) at++;
    if (head.startsWith("<?", at)) {
      // A processing instruction, which is where the XML declaration lives.
      const end = head.indexOf("?>", at + 2);
      if (end === -1) return false;
      at = end + 2;
    } else if (head.startsWith("<!--", at)) {
      const end = head.indexOf("-->", at + 4);
      if (end === -1) return false;
      at = end + 3;
    } else if (/^<!doctype/i.test(head.slice(at, at + 9))) {
      const end = doctypeEnd(head, at);
      if (end === -1) return false;
      at = end;
    } else {
      break;
    }
  }
  // The character after the name matters: `<svgfoo>` is a different element,
  // and `<svg/>` is the whole valid document.
  return /^<svg[\s/>]/i.test(head.slice(at, at + 5));
}

/**
 * One past the `>` that closes a DOCTYPE, or -1 when it does not close inside
 * the window. An internal subset (`… [ <!ENTITY …> ]>`) carries `>` of its
 * own, so the `]` is found first when there is one.
 */
function doctypeEnd(head: string, at: number): number {
  const close = head.indexOf(">", at);
  if (close === -1) return -1;
  const bracket = head.indexOf("[", at);
  if (bracket === -1 || bracket > close) return close + 1;
  const subsetEnd = head.indexOf("]", bracket);
  if (subsetEnd === -1) return -1;
  const after = head.indexOf(">", subsetEnd);
  return after === -1 ? -1 : after + 1;
}

function starts(bytes: Uint8Array, at: number, magic: number[]): boolean {
  if (at + magic.length > bytes.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[at + i] !== magic[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = at; i < at + length && i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function u16le(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32le(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
  );
}
