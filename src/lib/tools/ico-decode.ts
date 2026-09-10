/**
 * Parse an `.ico` directory and pull one entry out of it.
 *
 * WHY A PARSER AND NOT `createImageBitmap(icoBlob)`
 *
 * Browsers decode ICO, but they hand back exactly ONE image and do not say
 * which: Blink and WebKit share an `ICOImageDecoder` whose `compareEntries()`
 * prefers the largest size, then the greatest bit depth. A favicon.ico holding
 * 16, 32, 48 and 256 px versions decodes to one of them, silently. The whole
 * user need here is "give me the 256 × 256 one", and the directory that
 * answers it is 6 + 16·n bytes.
 *
 * The second reason is a claim only the parser earns. An entry may be stored
 * as a complete PNG *or* as a headerless BMP, and both can appear in the same
 * file (measured — `scratchpad/ico.mjs` built and re-parsed a 3-entry mixed
 * file: 16 px BMP, 32 px BMP, 256 px PNG). A PNG entry is a pure byte slice:
 * no decode, no re-encode, byte-identical to what is stored inside the `.ico`.
 * That is genuinely lossless, and it is exactly the round trip for an `.ico`
 * this site's own `png-to-ico` produced, which writes every entry as PNG.
 *
 * THE BMP TRAP
 *
 * A BMP entry's `BITMAPINFOHEADER.biHeight` is DOUBLE the real height — the
 * DIB stacks the XOR colour image and the AND transparency mask, and biHeight
 * counts both. Measured on the same file: a 16 px entry reports biHeight 32
 * and a 32 px entry reports 64. Rows are also bottom-up. A parser that trusts
 * biHeight produces a double-height image with garbage in the lower half, so
 * the real height is `biHeight / 2`.
 *
 * Rather than write a DIB decoder — 32bpp BI_RGB is easy, 1/4/8bpp palettes
 * and BI_BITFIELDS are not — `extractIcoEntry` rebuilds a one-entry `.ico`
 * around a BMP entry so the browser's own ICO decoder handles it, with no
 * ambiguity left about which image it will pick.
 *
 * DOM-FREE. Every read is bounds-checked, and an entry the file does not
 * actually contain is dropped from the listing rather than offered and then
 * failing — `IcoDirectory.unreadable` counts those, so the UI can say the
 * file claimed more than it held.
 */

export type IcoEntryEncoding = "png" | "bmp";

export interface IcoEntry {
  /** Position in the file's directory. Not an index into `entries`. */
  index: number;
  /**
   * Pixel width. The directory stores this in one byte where 0 means 256; a
   * PNG entry's IHDR and a BMP entry's DIB header both override it, because
   * they are what a decoder will actually produce and the directory byte is a
   * hint the writer could have got wrong (and cannot express 256 at all). A
   * DIB header that describes a picture its own payload does not hold
   * overrides nothing: the entry is dropped and counted in `unreadable`,
   * because that header is what the browser's decoder will read too.
   */
  width: number;
  height: number;
  /**
   * Bits per pixel, from the directory, or from the payload's own header when
   * the directory left it at 0 — which writers routinely do.
   */
  bitsPerPixel: number;
  /** Colours in the entry's palette; 0 means no palette, or 256 and up. */
  paletteColours: number;
  encoding: IcoEntryEncoding;
  /**
   * True only for a PNG entry, and it means one specific thing:
   * `extractIcoEntry` returns the stored bytes unchanged. A BMP entry has to
   * be decoded and written out again to become a PNG, so nothing anywhere may
   * call that lossless.
   */
  lossless: boolean;
  /** Byte length of the entry's payload. */
  byteLength: number;
  /** Payload offset from the start of the file. */
  offset: number;
}

export interface IcoDirectory {
  /** Type 1 is an icon, type 2 a cursor. Both use this directory layout. */
  kind: "ico" | "cur";
  /** Every entry that is actually present and readable, in directory order. */
  entries: IcoEntry[];
  /**
   * Directory entries this file declared but that nothing here can hand a
   * decoder — the payload runs past the end of the file, its first bytes are
   * neither a PNG signature nor a DIB header, or the DIB describes a picture
   * its own payload does not hold. Every entry in `entries` is extractable, so
   * this is the only place a partly-broken file shows up.
   */
  unreadable: number;
  /** True when at least one entry is a byte-sliceable PNG. */
  hasPngEntries: boolean;
}

export const NOT_AN_ICO_MESSAGE =
  "These bytes are not an icon file — an .ico starts with a 6-byte directory header this file does not have.";

export const EMPTY_ICO_MESSAGE = "This icon file's directory is empty — it contains no images.";

export const TRUNCATED_ICO_MESSAGE =
  "This icon file's directory lists images that are not in the file — the download is incomplete.";

/** ICONDIR: reserved u16, type u16, count u16. */
const DIRECTORY_HEADER_BYTES = 6;
/** ICONDIRENTRY. */
const DIRECTORY_ENTRY_BYTES = 16;
/**
 * The smallest and largest DIB headers a BMP entry may open with:
 * BITMAPCOREHEADER is 12 bytes, BITMAPV5HEADER is 124. Anything outside that
 * is not a DIB, and the payload is not something to hand a decoder.
 */
const MIN_DIB_HEADER_BYTES = 12;
const MAX_DIB_HEADER_BYTES = 124;
/** Below this, biWidth/biHeight are int16s at different offsets. */
const BITMAPINFOHEADER_SIZE = 40;
/**
 * The largest edge an `.ico` can describe. Width and height are single bytes
 * in the directory where 0 stands for 256, so 256 is the container's own
 * ceiling and a DIB header claiming more disagrees with the file it sits in.
 */
const MAX_ICO_EDGE = 256;
/**
 * Bit depths a DIB may declare — every one of them a power-of-two fraction of
 * a byte, or a whole number of them. A browser does NOT refuse the others:
 * measured in Chrome, an entry declaring biBitCount 3 decodes to a fully
 * transparent bitmap of the directory's size instead of failing, and this tool
 * would write that out as a blank PNG and count it as an extraction.
 */
const DIB_BIT_COUNTS = new Set([1, 2, 4, 8, 16, 24, 32]);
/**
 * BI_RGB (0), BI_RLE8 (1), BI_RLE4 (2), BI_BITFIELDS (3). Above that are
 * BI_JPEG and BI_PNG, whose payload is not a DIB body at all — and which
 * Chrome likewise decodes to a blank rather than rejecting.
 */
const MAX_DIB_COMPRESSION = 3;
/** RLE bodies are compressed, so their length cannot be computed from the size. */
const RLE_COMPRESSIONS = new Set([1, 2]);
/** PNG's own limit: zero is invalid and neither dimension may reach 2^31. */
const MAX_PNG_DIMENSION = 0x7fffffff;

/**
 * Enumerate the directory.
 *
 * Throws with a message meant for the user, the way `jfif-to-jpg.ts` does for
 * a file that is not a JPEG underneath: the caller wants one sentence to put
 * on screen, and every failure here has a different one.
 *
 * Entries come back in directory order, not sorted — the order a writer chose
 * is information, and sorting is the UI's decision.
 */
export function parseIco(bytes: Uint8Array): IcoDirectory {
  if (bytes.length < DIRECTORY_HEADER_BYTES) throw new Error(NOT_AN_ICO_MESSAGE);
  const reserved = read16le(bytes, 0);
  const type = read16le(bytes, 2);
  if (reserved !== 0 || (type !== 1 && type !== 2)) throw new Error(NOT_AN_ICO_MESSAGE);

  const count = read16le(bytes, 4);
  if (count === 0) throw new Error(EMPTY_ICO_MESSAGE);
  if (DIRECTORY_HEADER_BYTES + count * DIRECTORY_ENTRY_BYTES > bytes.length) {
    throw new Error(TRUNCATED_ICO_MESSAGE);
  }

  const entries: IcoEntry[] = [];
  let unreadable = 0;
  for (let index = 0; index < count; index++) {
    const entry = readEntry(bytes, index, type === 2);
    if (entry) entries.push(entry);
    else unreadable++;
  }
  // Every entry was a broken pointer: there is nothing to offer, and saying
  // "0 images" about a file that lists four is worse than refusing.
  if (entries.length === 0) throw new Error(TRUNCATED_ICO_MESSAGE);

  return {
    kind: type === 1 ? "ico" : "cur",
    entries,
    unreadable,
    hasPngEntries: entries.some((entry) => entry.encoding === "png"),
  };
}

/**
 * null for a directory entry whose payload is absent or unrecognisable.
 *
 * `isCursor` is not a detail. In an ICONDIRENTRY the two bytes at +4 and +6 are
 * colour planes and bit count; in a CURSORDIRENTRY — the identical 16-byte
 * layout, told apart only by the ICONDIR type field — the SAME two bytes are
 * the cursor's hotspot X and Y. Reading them as a bit depth for a .cur reports
 * a hotspot coordinate as a colour depth, which is how a 32x32 cursor comes to
 * claim it is "16-bit" because its hotspot happens to sit at y=16. For a
 * cursor the only real answer is the DIB's own biBitCount.
 */
function readEntry(bytes: Uint8Array, index: number, isCursor: boolean): IcoEntry | null {
  const at = DIRECTORY_HEADER_BYTES + index * DIRECTORY_ENTRY_BYTES;
  // Width and height are single bytes, so 256 cannot be expressed and 0 is the
  // agreed stand-in. This is why every 256 px entry reads as 0 on the wire.
  const declaredWidth = bytes[at] === 0 ? 256 : bytes[at];
  const declaredHeight = bytes[at + 1] === 0 ? 256 : bytes[at + 1];
  const paletteColours = bytes[at + 2];
  const declaredBpp = isCursor ? 0 : read16le(bytes, at + 6);
  const byteLength = read32le(bytes, at + 8);
  const offset = read32le(bytes, at + 12);

  if (byteLength <= 0) return null;
  if (offset < DIRECTORY_HEADER_BYTES) return null;
  if (offset + byteLength > bytes.length) return null;

  const payload = bytes.subarray(offset, offset + byteLength);
  const base = {
    index,
    paletteColours,
    byteLength,
    offset,
  };

  if (isPng(payload)) {
    const size = readPngSize(payload);
    return {
      ...base,
      width: size?.width ?? declaredWidth,
      height: size?.height ?? declaredHeight,
      // A PNG in an .ico is 32-bit RGBA in every writer this repo has seen,
      // including its own `ico-encode.ts`, which hardcodes 32 in the directory.
      bitsPerPixel: declaredBpp || 32,
      encoding: "png",
      lossless: true,
    };
  }

  const dibHeaderSize = read32le(payload, 0);
  if (dibHeaderSize < MIN_DIB_HEADER_BYTES || dibHeaderSize > MAX_DIB_HEADER_BYTES) return null;
  if (dibHeaderSize > payload.length) return null;
  if (dibHeaderSize < BITMAPINFOHEADER_SIZE) {
    /*
      A BITMAPCOREHEADER puts int16 dimensions at different offsets, so none of
      the reads below apply to it, and the directory byte it would otherwise be
      believed on cannot express 256. Measured in Chrome, an entry opening with
      a 12-byte header decodes to a fully transparent bitmap rather than
      failing — so listing it would offer a blank PNG under a size nothing
      checked. It is vanishingly rare in an .ico; `unreadable` says it went.
    */
    return null;
  }
  /*
    biWidth and biHeight are SIGNED int32 in every DIB header, and a negative
    biHeight is the standard top-down-rows convention. Read unsigned, -16 comes
    back as 4294967280 — a number this module would hand the UI to print as the
    icon's size, put in a file name, and assign to `canvas.width`.
  */
  const biWidth = readInt32le(payload, 4);
  /*
    biHeight counts the XOR image AND the AND mask stacked, so the picture is
    half of it. See the module header — this is the trap. Its sign carries the
    row order, which nothing here needs and the browser's decoder honours.
  */
  const stackedHeight = Math.abs(readInt32le(payload, 8));
  const biBitCount = read16le(payload, 14);
  const biCompression = read32le(payload, 16);
  const width = biWidth;
  const height = Math.floor(stackedHeight / 2);
  /*
    The DIB is not a hint here: it is what the browser's own ICO decoder reads
    out of the one-entry .ico `extractIcoEntry` rebuilds, so an entry whose
    header does not describe a picture the payload holds cannot be extracted no
    matter what the directory says about it. Falling back to the declared size
    would only put an honest-looking label on a blank image; `unreadable`
    counts it instead, and the UI discloses that count.
  */
  if (width < 1 || width > MAX_ICO_EDGE) return null;
  if (height < 1 || height > MAX_ICO_EDGE) return null;
  if (!DIB_BIT_COUNTS.has(biBitCount)) return null;
  if (biCompression > MAX_DIB_COMPRESSION) return null;
  if (!dibBodyFits(payload, dibHeaderSize, width, height, biBitCount, biCompression)) return null;
  return {
    ...base,
    width,
    height,
    bitsPerPixel: declaredBpp || biBitCount,
    encoding: "bmp",
    lossless: false,
  };
}

/**
 * Can this payload hold the picture its own header describes?
 *
 * Chrome does not refuse a DIB whose body is missing. Measured: a 40-byte
 * BITMAPINFOHEADER declaring 32 × 32 at 32bpp followed by 12 bytes of pixels
 * decodes to a fully transparent 32 × 32, indistinguishable on screen from a
 * legitimately transparent icon. Byte arithmetic is the only thing that
 * separates the two, and it has to happen here.
 *
 * The AND mask is deliberately NOT required. Its rows are the slack at the end
 * of the payload, and an encoder that omits it still wrote every pixel of the
 * picture; demanding it would drop files that decode perfectly well.
 */
function dibBodyFits(
  payload: Uint8Array,
  headerSize: number,
  width: number,
  height: number,
  bitCount: number,
  compression: number,
): boolean {
  // A palette of `biClrUsed` entries, or the full 2^bpp one when the writer
  // left that at 0, sits between the header and the pixels.
  const declaredPalette = read32le(payload, 32);
  const paletteEntries = declaredPalette || (bitCount <= 8 ? 1 << bitCount : 0);
  const paletteBytes = paletteEntries * 4;
  if (headerSize + paletteBytes > payload.length) return false;
  // An RLE body is compressed, so its length is not width × height × depth and
  // there is nothing to check beyond the header and palette fitting.
  if (RLE_COMPRESSIONS.has(compression)) return true;
  // DIB rows are padded to a 4-byte boundary.
  const rowBytes = Math.ceil((width * bitCount) / 32) * 4;
  return headerSize + paletteBytes + rowBytes * height <= payload.length;
}

export interface IcoEntryBytes {
  bytes: Uint8Array;
  /** What to label a Blob of `bytes` — not what the entry will become. */
  mime: string;
  /** Mirrors `entry.lossless`: true when `bytes` is the stored slice, untouched. */
  lossless: boolean;
}

/**
 * The bytes to hand a decoder for one entry.
 *
 * A PNG entry comes back as the stored slice, unchanged — that is the whole
 * lossless claim, and `entry.lossless` says which entries earn it. A BMP entry
 * comes back wrapped in a fresh one-entry `.ico`, because a headerless DIB is
 * not a file any decoder accepts on its own, and a one-entry directory leaves
 * no question about which image the browser will pick.
 *
 * Total for any entry `parseIco` returned: those are bounds-checked on the way
 * out, which is why an unreadable one never appears in `entries` at all.
 */
export function extractIcoEntry(bytes: Uint8Array, entry: IcoEntry): IcoEntryBytes {
  if (entry.encoding === "png") {
    return {
      bytes: bytes.slice(entry.offset, entry.offset + entry.byteLength),
      mime: "image/png",
      lossless: true,
    };
  }
  return { bytes: singleEntryIco(bytes, entry), mime: "image/x-icon", lossless: false };
}

/**
 * Rebuild a one-entry `.ico` around a single directory entry, payload copied
 * verbatim. The directory fields are carried over so the entry keeps its
 * declared size and bit depth; only the payload offset changes, to sit
 * immediately after the 22-byte header this new file has.
 */
export function singleEntryIco(bytes: Uint8Array, entry: IcoEntry): Uint8Array {
  const headerBytes = DIRECTORY_HEADER_BYTES + DIRECTORY_ENTRY_BYTES;
  const out = new Uint8Array(headerBytes + entry.byteLength);
  write16le(out, 0, 0); // reserved
  write16le(out, 2, 1); // type 1 = icon
  write16le(out, 4, 1); // one image
  // 256 goes back on the wire as 0, the same way it was read.
  out[6] = entry.width >= 256 ? 0 : entry.width;
  out[7] = entry.height >= 256 ? 0 : entry.height;
  out[8] = entry.paletteColours;
  out[9] = 0; // reserved
  write16le(out, 10, 1); // colour planes
  write16le(out, 12, entry.bitsPerPixel);
  write32le(out, 14, entry.byteLength);
  write32le(out, 18, headerBytes);
  out.set(bytes.subarray(entry.offset, entry.offset + entry.byteLength), headerBytes);
  return out;
}

function isPng(payload: Uint8Array): boolean {
  return (
    payload.length >= 8 &&
    payload[0] === 0x89 &&
    payload[1] === 0x50 &&
    payload[2] === 0x4e &&
    payload[3] === 0x47 &&
    payload[4] === 0x0d &&
    payload[5] === 0x0a &&
    payload[6] === 0x1a &&
    payload[7] === 0x0a
  );
}

/** IHDR is always the first chunk, so width and height sit at fixed offsets. */
function readPngSize(payload: Uint8Array): { width: number; height: number } | null {
  if (payload.length < 24) return null;
  if (
    payload[12] !== 0x49 || // I
    payload[13] !== 0x48 || // H
    payload[14] !== 0x44 || // D
    payload[15] !== 0x52 // R
  ) {
    return null;
  }
  const width = read32be(payload, 16);
  const height = read32be(payload, 20);
  // PNG's own limits. `read32be` is unsigned, so without the ceiling a corrupt
  // IHDR states a multi-billion-pixel size that the page would print as fact —
  // the same fabrication the DIB arm above guards against. Out of range, the
  // caller falls back to the directory's declared size.
  if (width < 1 || height < 1) return null;
  if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION) return null;
  return { width, height };
}

function read16le(bytes: Uint8Array, at: number): number {
  if (at + 2 > bytes.length) return 0;
  return bytes[at] | (bytes[at + 1] << 8);
}

function read32le(bytes: Uint8Array, at: number): number {
  if (at + 4 > bytes.length) return 0;
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

/**
 * The signed twin of `read32le`, for the two DIB fields that really are int32:
 * biWidth and biHeight. No `>>> 0` — dropping the sign is what turns a legal
 * top-down biHeight of -32 into 4294967264.
 */
function readInt32le(bytes: Uint8Array, at: number): number {
  if (at + 4 > bytes.length) return 0;
  return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
}

function read32be(bytes: Uint8Array, at: number): number {
  if (at + 4 > bytes.length) return 0;
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function write16le(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
}

function write32le(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = value & 0xff;
  bytes[at + 1] = (value >>> 8) & 0xff;
  bytes[at + 2] = (value >>> 16) & 0xff;
  bytes[at + 3] = (value >>> 24) & 0xff;
}
