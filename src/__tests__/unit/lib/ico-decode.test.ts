import { crc32 as zlibCrc32 } from "node:zlib";

import { describe, it, expect } from "vitest";

import {
  EMPTY_ICO_MESSAGE,
  extractIcoEntry,
  NOT_AN_ICO_MESSAGE,
  parseIco,
  singleEntryIco,
  TRUNCATED_ICO_MESSAGE,
} from "@/lib/tools/ico-decode";

/**
 * Every fixture here is a real `.ico` assembled from the spec, and the central
 * one carries a PNG entry and a BMP entry IN THE SAME FILE — which is legal,
 * common, and the reason the tool needs a parser rather than one
 * `createImageBitmap` call.
 *
 * The two facts worth breaking a build over:
 *
 * 1. A PNG entry extracts as a byte slice. The test asserts the extracted
 *    bytes are IDENTICAL to the bytes that went in, because that identity is
 *    the entire "genuinely lossless" claim the UI makes.
 * 2. A BMP entry's `biHeight` is DOUBLE the real height. The fixture writes
 *    32 for a 16 px icon exactly the way a real encoder does, so a parser that
 *    trusted biHeight would report 32 here and be caught.
 */

const crc = (bytes: Uint8Array) => zlibCrc32(Buffer.from(bytes)) >>> 0;

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function le16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function le32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

/** A real, standalone PNG at the requested size — the payload of a PNG entry. */
function pngPayload(width: number, height: number): number[] {
  const chunk = (type: string, payload: number[]): number[] => {
    const body = new Uint8Array([...[...type].map((c) => c.charCodeAt(0)), ...payload]);
    return [...be32(payload.length), ...body, ...be32(crc(body))];
  };
  return [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...be32(width), ...be32(height), 8, 6, 0, 0, 0]),
    ...chunk("IDAT", [0x08, 0xd7, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]),
    ...chunk("IEND", []),
  ];
}

/**
 * A headerless BMP entry: BITMAPINFOHEADER, the XOR image, then the AND mask.
 *
 * `biHeight` is written as `size * 2` because the DIB stacks both planes and
 * the field counts them together — the trap this module exists to sidestep.
 * The AND mask rows are padded to a 4-byte boundary.
 */
function bmpPayload(size: number, bitCount = 32): number[] {
  const rowBytes = size * 4;
  const maskRow = Math.ceil(size / 32) * 4;
  return [
    ...le32(40), // biSize
    ...le32(size), // biWidth
    ...le32(size * 2), // biHeight — DOUBLE
    ...le16(1), // biPlanes
    ...le16(bitCount),
    ...le32(0), // BI_RGB
    ...le32(rowBytes * size),
    ...le32(0), ...le32(0), ...le32(0), ...le32(0),
    ...new Array(rowBytes * size).fill(0x40), // XOR image
    ...new Array(maskRow * size).fill(0x00), // AND mask
  ];
}

/**
 * The same headerless BMP with individual header fields overridden — the
 * shapes a corrupt or hostile writer produces. `bodyBytes` is the pixel data
 * that actually FOLLOWS the header, so a header can be made to describe a
 * picture the payload does not hold, which is the case a browser answers with
 * a fully transparent bitmap instead of an error.
 */
function bmpHeader({
  biSize = 40,
  biWidth = 32,
  biHeight = 64,
  bitCount = 32,
  compression = 0,
  bodyBytes = 32 * 4 * 32,
}: {
  biSize?: number;
  biWidth?: number;
  biHeight?: number;
  bitCount?: number;
  compression?: number;
  bodyBytes?: number;
} = {}): number[] {
  return [
    ...le32(biSize),
    // `le32` writes two's complement, so a negative width or height lands on
    // the wire exactly as a real encoder would write it.
    ...le32(biWidth),
    ...le32(biHeight),
    ...le16(1), // biPlanes
    ...le16(bitCount),
    ...le32(compression),
    ...le32(bodyBytes),
    ...le32(0), ...le32(0), ...le32(0), ...le32(0),
    ...new Array(bodyBytes).fill(0x40),
  ];
}

interface Part {
  /** The width/height byte the directory carries; 0 stands for 256. */
  declared: number;
  /**
   * The two bytes at +6 of the directory row. In an ICONDIRENTRY that is the
   * bit depth; in a CURSORDIRENTRY — the identical 16-byte layout, told apart
   * only by the ICONDIR type — the SAME bytes are the hotspot's Y coordinate.
   * That collision is why `{ type: 2 }` fixtures set this to a hotspot.
   */
  bpp: number;
  data: number[];
}

function icoBytes(parts: Part[], { type = 1, count = parts.length } = {}): Uint8Array {
  const headerBytes = 6 + 16 * parts.length;
  let dataOffset = headerBytes;
  const directory: number[] = [...le16(0), ...le16(type), ...le16(count)];
  for (const part of parts) {
    directory.push(
      part.declared >= 256 ? 0 : part.declared,
      part.declared >= 256 ? 0 : part.declared,
      0, // palette colours
      0, // reserved
      ...le16(1), // colour planes
      ...le16(part.bpp),
      ...le32(part.data.length),
      ...le32(dataOffset),
    );
    dataOffset += part.data.length;
  }
  return new Uint8Array([...directory, ...parts.flatMap((p) => p.data)]);
}

/** The mixed file the whole suite turns on: a BMP entry and a PNG entry. */
const BMP_16 = bmpPayload(16);
const PNG_256 = pngPayload(256, 256);
const MIXED = icoBytes([
  { declared: 16, bpp: 32, data: BMP_16 },
  { declared: 256, bpp: 32, data: PNG_256 },
]);

const hex = (bytes: Uint8Array | number[]) => Buffer.from(bytes).toString("hex");

describe("parseIco", () => {
  it("enumerates a file holding a BMP entry and a PNG entry together", () => {
    const directory = parseIco(MIXED);
    expect(directory.kind).toBe("ico");
    expect(directory.unreadable).toBe(0);
    expect(directory.hasPngEntries).toBe(true);
    expect(directory.entries).toHaveLength(2);

    expect(directory.entries[0]).toMatchObject({
      index: 0,
      width: 16,
      // If this reads 32, the parser trusted biHeight and every BMP entry it
      // ever produces is a double-height image with garbage in the lower half.
      height: 16,
      bitsPerPixel: 32,
      encoding: "bmp",
      lossless: false,
    });

    expect(directory.entries[1]).toMatchObject({
      index: 1,
      width: 256,
      height: 256,
      encoding: "png",
      lossless: true,
    });
  });

  it("reads 256 out of a directory byte of 0", () => {
    // One byte cannot hold 256, so 0 is the agreed stand-in. A 256 px entry
    // whose IHDR could not be read would otherwise come back as 0 × 0.
    expect(MIXED[6 + 16]).toBe(0);
    expect(MIXED[6 + 17]).toBe(0);
    expect(parseIco(MIXED).entries[1]).toMatchObject({ width: 256, height: 256 });
  });

  it("prefers the payload's own dimensions over the directory byte", () => {
    // A writer that filled the directory in wrong: it says 32, the PNG says 48.
    const wrong = icoBytes([{ declared: 32, bpp: 32, data: pngPayload(48, 48) }]);
    expect(parseIco(wrong).entries[0]).toMatchObject({ width: 48, height: 48 });
  });

  it("does not believe a PNG IHDR outside PNG's own limits", () => {
    // PNG caps each dimension at 2^31-1 and forbids 0. `read32be` is unsigned,
    // so without the ceiling this IHDR states 2147483648 px and the page
    // prints it, puts it in a file name, and calls it the largest size found.
    const png = pngPayload(16, 16);
    png.splice(16, 4, 0x80, 0x00, 0x00, 0x00);
    const directory = parseIco(icoBytes([{ declared: 48, bpp: 32, data: png }]));
    expect(directory.entries[0]).toMatchObject({ width: 48, height: 48, encoding: "png" });
  });

  it("falls back to the directory bit depth when the writer left it at 0", () => {
    const noBpp = icoBytes([{ declared: 16, bpp: 0, data: bmpPayload(16, 24) }]);
    expect(parseIco(noBpp).entries[0].bitsPerPixel).toBe(24);
  });

  it("recognises a cursor", () => {
    expect(parseIco(icoBytes([{ declared: 32, bpp: 32, data: PNG_256 }], { type: 2 })).kind).toBe(
      "cur",
    );
  });

  it("does not read a cursor's hotspot as a bit depth", () => {
    // A CURSORDIRENTRY puts the hotspot in the two bytes an ICONDIRENTRY uses
    // for the bit count. This cursor's hotspot Y is 16 and its DIB says 32bpp,
    // so a parser that read the directory field would report a 32-bit cursor
    // as "16-bit" purely because of where its hotspot sits.
    const cursor = icoBytes([{ declared: 32, bpp: 16, data: bmpPayload(32, 32) }], { type: 2 });
    expect(cursor[6 + 6]).toBe(16); // the hotspot Y really is on the wire
    const directory = parseIco(cursor);
    expect(directory.kind).toBe("cur");
    expect(directory.entries[0].bitsPerPixel).toBe(32);
  });

  it("drops an entry whose payload is not in the file, and counts it", () => {
    const bytes = icoBytes([
      { declared: 16, bpp: 32, data: BMP_16 },
      { declared: 32, bpp: 32, data: pngPayload(32, 32) },
    ]);
    // Point the second entry's length past the end of the file.
    bytes.set(le32(0xffff), 6 + 16 + 8);
    const directory = parseIco(bytes);
    expect(directory.entries).toHaveLength(1);
    expect(directory.entries[0].index).toBe(0);
    expect(directory.unreadable).toBe(1);
  });

  it("drops an entry whose payload is neither a PNG nor a DIB", () => {
    const junk = icoBytes([
      { declared: 16, bpp: 32, data: BMP_16 },
      { declared: 16, bpp: 32, data: new Array(64).fill(0xab) },
    ]);
    const directory = parseIco(junk);
    expect(directory.entries.map((e) => e.index)).toEqual([0]);
    expect(directory.unreadable).toBe(1);
  });

  it("refuses bytes that are not an icon file", () => {
    expect(() => parseIco(new Uint8Array([0x89, 0x50]))).toThrow(NOT_AN_ICO_MESSAGE);
    // A non-zero reserved field, and a type that is neither icon nor cursor.
    expect(() => parseIco(new Uint8Array([1, 0, 1, 0, 1, 0]))).toThrow(NOT_AN_ICO_MESSAGE);
    expect(() => parseIco(new Uint8Array([0, 0, 3, 0, 1, 0]))).toThrow(NOT_AN_ICO_MESSAGE);
  });

  it("refuses an empty directory", () => {
    expect(() => parseIco(new Uint8Array([0, 0, 1, 0, 0, 0]))).toThrow(EMPTY_ICO_MESSAGE);
  });

  it("refuses a directory that runs past the end of the file", () => {
    // The header claims four entries; the file stops after one of them, so
    // there is not even a directory to walk.
    const short = new Uint8Array([0, 0, 1, 0, 4, 0, ...new Array(16).fill(0)]);
    expect(() => parseIco(short)).toThrow(TRUNCATED_ICO_MESSAGE);
  });

  it("keeps the entries it can read when the header over-claims", () => {
    // The directory fits, but three of its four rows point at nothing. One
    // good icon is still worth handing over — with the shortfall counted.
    const overclaimed = icoBytes([{ declared: 16, bpp: 32, data: BMP_16 }], { count: 4 });
    const directory = parseIco(overclaimed);
    expect(directory.entries).toHaveLength(1);
    expect(directory.unreadable).toBe(3);
  });

  it("refuses a file in which every entry is a broken pointer", () => {
    const bytes = icoBytes([{ declared: 16, bpp: 32, data: BMP_16 }]);
    bytes.set(le32(0xffff), 6 + 12); // offset past the end
    expect(() => parseIco(bytes)).toThrow(TRUNCATED_ICO_MESSAGE);
  });

  it("never throws anything but its own messages on random bytes", () => {
    const known = [NOT_AN_ICO_MESSAGE, EMPTY_ICO_MESSAGE, TRUNCATED_ICO_MESSAGE];
    for (let seed = 0; seed < 300; seed++) {
      const bytes = new Uint8Array(48);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 37 + i * 13) & 0xff;
      // Force a valid ICONDIR header so the entry walk is actually entered.
      bytes.set([0, 0, 1, 0, (seed % 5) + 1, 0], 0);
      try {
        parseIco(bytes);
      } catch (err) {
        expect(known, `seed ${seed}`).toContain((err as Error).message);
      }
    }
  });
});

/**
 * A DIB header is not a hint. It is what the browser's own ICO decoder reads
 * out of the one-entry `.ico` `extractIcoEntry` rebuilds, and — measured in
 * Chrome — a broken one is answered with a fully transparent bitmap rather
 * than an error. So every one of these would otherwise come out of the tool as
 * a blank PNG counted as a successful extraction, or, worse, as a fabricated
 * size printed on the page and assigned to `canvas.width`.
 *
 * Each fixture pairs the hostile entry with one good one, so the assertions
 * can say "this entry was dropped" rather than "the file was refused".
 */
describe("parseIco — a BMP entry must be a picture its own payload holds", () => {
  const withBad = (bad: number[]) =>
    parseIco(
      icoBytes([
        { declared: 16, bpp: 32, data: BMP_16 },
        { declared: 32, bpp: 32, data: bad },
      ]),
    );

  const dropped = (bad: number[]) => {
    const directory = withBad(bad);
    expect(directory.entries.map((e) => e.index)).toEqual([0]);
    expect(directory.unreadable).toBe(1);
  };

  it("reads biWidth and biHeight as signed, so a top-down entry keeps its size", () => {
    // A negative biHeight is the standard top-down-rows convention and says
    // nothing about the size. Read unsigned, -64 is 4294967232 and this 32x32
    // entry is thrown away as a 2147483616 px one.
    const directory = withBad(bmpHeader({ biWidth: 32, biHeight: -64 }));
    expect(directory.unreadable).toBe(0);
    expect(directory.entries[1]).toMatchObject({ width: 32, height: 32, encoding: "bmp" });
  });

  it("never reports a dimension no payload backs", () => {
    // The two headers that fabricated a size: biWidth -16, which reads as
    // 4294967280 unsigned, and biWidth 2147483647, which is a legal signed
    // int32 and still not an icon. Neither may reach the page as a size.
    dropped(bmpHeader({ biWidth: -16, biHeight: -32 }));
    dropped(bmpHeader({ biWidth: 0x7fffffff, biHeight: -32 }));
    for (const entry of withBad(BMP_16).entries) {
      expect(Math.max(entry.width, entry.height)).toBeLessThanOrEqual(256);
    }
  });

  it("drops a bitmap bigger than an .ico can describe, even when the payload holds it", () => {
    // 100000 x 1 at 1bpp is only 12.5 KB of pixels, so the payload check waves
    // it through — and `entry.width` is what the page assigns to `canvas.width`,
    // where a six-figure width silently leaves the canvas unwritable and takes
    // the run down with it. 256 is the container's own ceiling: the directory
    // holds width in ONE byte, where 0 stands for 256.
    const rowBytes = Math.ceil(100000 / 32) * 4;
    const paletteBytes = 2 * 4; // 1bpp carries a two-colour palette
    dropped(
      bmpHeader({
        biWidth: 100000,
        biHeight: 2,
        bitCount: 1,
        bodyBytes: paletteBytes + rowBytes,
      }),
    );
  });

  it("drops an entry whose payload cannot hold the pixels its header describes", () => {
    // 32x32 at 32bpp needs 4096 bytes of pixels. This one carries 12, and
    // Chrome decodes it to a fully transparent 32x32 instead of failing.
    dropped(bmpHeader({ bodyBytes: 12 }));
    // The same header with no body at all.
    dropped(bmpHeader({ bodyBytes: 0 }));
  });

  it("keeps an entry whose payload holds the pixels but omits the AND mask", () => {
    // The mask is the slack at the end, and an encoder that leaves it out
    // still wrote every pixel of the picture. Requiring it would drop files
    // that decode perfectly well.
    const directory = withBad(bmpHeader({ bodyBytes: 32 * 4 * 32 }));
    expect(directory.unreadable).toBe(0);
    expect(directory.entries[1]).toMatchObject({ width: 32, height: 32 });
  });

  it("drops a bit depth no bitmap has and a compression that is not a bitmap body", () => {
    dropped(bmpHeader({ bitCount: 3 }));
    // 4 and 5 are BI_JPEG and BI_PNG: the payload is not a DIB body at all.
    dropped(bmpHeader({ compression: 5 }));
  });

  it("counts a palette a low-depth entry has to carry", () => {
    // 4bpp means a 16-colour palette between the header and the pixels. An
    // entry sized as if it had none is short by exactly that palette.
    const rowBytes = Math.ceil((32 * 4) / 32) * 4;
    dropped(bmpHeader({ bitCount: 4, bodyBytes: rowBytes * 32 - 1 }));
    const withPalette = withBad(bmpHeader({ bitCount: 4, bodyBytes: 16 * 4 + rowBytes * 32 }));
    expect(withPalette.unreadable).toBe(0);
  });

  it("drops a DIB smaller than a BITMAPINFOHEADER rather than guessing at it", () => {
    // A BITMAPCOREHEADER puts int16 dimensions at different offsets, so none
    // of the reads above apply to it — and measured in Chrome, an entry
    // opening with a 12-byte header decodes to a fully transparent bitmap.
    dropped([...le32(12), ...new Array(64).fill(0x40)]);
  });
});

describe("extractIcoEntry", () => {
  it("hands back a PNG entry's stored bytes, unchanged", () => {
    // The lossless claim, and the only test that can prove it: identity.
    const directory = parseIco(MIXED);
    const out = extractIcoEntry(MIXED, directory.entries[1]);
    expect(out.lossless).toBe(true);
    expect(out.mime).toBe("image/png");
    expect(hex(out.bytes)).toBe(hex(PNG_256));
  });

  it("wraps a BMP entry in a one-entry .ico, payload untouched", () => {
    const directory = parseIco(MIXED);
    const out = extractIcoEntry(MIXED, directory.entries[0]);
    expect(out.lossless).toBe(false);
    expect(out.mime).toBe("image/x-icon");
    // 22 bytes of header, then the original DIB byte for byte.
    expect(out.bytes.length).toBe(22 + BMP_16.length);
    expect(hex(out.bytes.subarray(22))).toBe(hex(BMP_16));

    // And it is a real .ico: parse it back and the entry survives intact.
    const rebuilt = parseIco(out.bytes);
    expect(rebuilt.entries).toHaveLength(1);
    expect(rebuilt.entries[0]).toMatchObject({
      width: 16,
      height: 16,
      bitsPerPixel: 32,
      encoding: "bmp",
      offset: 22,
    });
  });

  it("writes 0 back into the directory for a 256 px entry", () => {
    // The wrapper has to re-encode 256 the way it read it, or the rebuilt file
    // declares a width of 0 and the browser's decoder disagrees with us.
    const directory = parseIco(MIXED);
    const wrapped = singleEntryIco(MIXED, { ...directory.entries[1], encoding: "bmp" });
    expect(wrapped[6]).toBe(0);
    expect(wrapped[7]).toBe(0);
    expect(parseIco(wrapped).entries[0]).toMatchObject({ width: 256, height: 256 });
  });

  it("round-trips every entry of the mixed file", () => {
    for (const entry of parseIco(MIXED).entries) {
      const out = extractIcoEntry(MIXED, entry);
      expect(out.bytes.length).toBeGreaterThan(0);
      expect(out.lossless).toBe(entry.lossless);
    }
  });
});
