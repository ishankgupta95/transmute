import { crc32 as zlibCrc32 } from "node:zlib";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  declaredResolution,
  MAX_DPI,
  MIN_DPI,
  readImageDpi,
  setImageDpi,
  UNSUPPORTED_MESSAGE,
  WEBP_MESSAGE,
  walkJpegSegments,
} from "@/lib/tools/image-dpi";

/**
 * DPI is a header rewrite, so everything here is byte-level and every fixture
 * is a real file assembled from the format spec — a PNG with and without
 * `pHYs`, a JPEG with JFIF only, with EXIF only, with both and with neither.
 *
 * Two rules keep this suite honest:
 *
 * 1. **CRC-32 is computed by `node:zlib`, never by the module under test.**
 *    Building a fixture with the module's own checksum and then checking it
 *    with the same function proves nothing; `zlibCrc32` is an independent
 *    implementation, and the golden vector below was captured from it.
 * 2. **Pixel and scan bytes are compared before and after.** The claim this
 *    tool makes — "not one pixel changes" — is the one a test can actually
 *    pin, so every rewrite case asserts the compressed image data is
 *    byte-identical.
 *
 * The two checked-in JPEG fixtures are used as-is at the end. They are the
 * shape that makes the JFIF-alone write a lie: an Exif APP1 carrying
 * XResolution, with the JFIF APP0 sitting AFTER it and declaring units 0.
 */

const SAMPLES = path.join(process.cwd(), "src/__tests__/fixtures/samples");
const sample = (name: string) => new Uint8Array(readFileSync(path.join(SAMPLES, name)));

const crc = (bytes: Uint8Array) => zlibCrc32(Buffer.from(bytes)) >>> 0;

// ── PNG fixtures ─────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** A real PNG chunk: length, type, payload, and an independently-computed CRC. */
function pngChunk(type: string, payload: number[]): number[] {
  const typed = [...type].map((c) => c.charCodeAt(0));
  const body = new Uint8Array([...typed, ...payload]);
  return [...be32(payload.length), ...body, ...be32(crc(body))];
}

function physPayload(dpiX: number, dpiY = dpiX, unit = 1): number[] {
  const ppm = (dpi: number) => Math.round(dpi / 0.0254);
  return [...be32(ppm(dpiX)), ...be32(ppm(dpiY)), unit];
}

/**
 * A TIFF block holding XResolution, YResolution and ResolutionUnit — the same
 * IFD layout a JPEG's Exif APP1 and a PNG's `eXIf` chunk both carry.
 *
 * The two RATIONALs are out of line (8 bytes each cannot fit a 4-byte value
 * field), which is the whole reason the writer has to follow an offset.
 */
function tiffResolutionBlock({
  dpiX = 72,
  dpiY = dpiX,
  unit = 2,
  littleEndian = true,
  withResolution = true,
  denominator = 1,
}: {
  dpiX?: number;
  dpiY?: number;
  unit?: number;
  littleEndian?: boolean;
  withResolution?: boolean;
  /**
   * The RATIONAL's second word. Zero is the case that matters: a real file
   * with `ResolutionUnit = 2` and `XResolution = 72/0` states inches and
   * cannot be read, and it is a different thing from a file that states no
   * unit at all.
   */
  denominator?: number;
} = {}): number[] {
  const u16 = (v: number) =>
    littleEndian ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff];
  const u32 = (v: number) =>
    littleEndian
      ? [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
      : be32(v);

  // Header 8 bytes, then the IFD at offset 8. Entry count + n×12 + 4 for the
  // "no next IFD" pointer tells us where the out-of-line values start.
  const entries: number[][] = [
    // Orientation, a SHORT stored inline — present so the walk has to skip it.
    [...u16(0x0112), ...u16(3), ...u32(1), ...u16(1), 0, 0],
  ];
  const ifdSize = 2 + (withResolution ? 4 : 1) * 12 + 4;
  const valuesAt = 8 + ifdSize;
  if (withResolution) {
    entries.push([...u16(0x011a), ...u16(5), ...u32(1), ...u32(valuesAt)]);
    entries.push([...u16(0x011b), ...u16(5), ...u32(1), ...u32(valuesAt + 8)]);
    entries.push([...u16(0x0128), ...u16(3), ...u32(1), ...u16(unit), 0, 0]);
  }
  const values = withResolution
    ? [...u32(dpiX), ...u32(denominator), ...u32(dpiY), ...u32(denominator)]
    : [];
  return [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(entries.length),
    ...entries.flat(),
    ...u32(0),
    ...values,
  ];
}

interface PngOptions {
  phys?: { dpiX: number; dpiY?: number; unit?: number };
  exif?: Parameters<typeof tiffResolutionBlock>[0];
}

/** IHDR (1×1, 8-bit greyscale), the optional metadata chunks, IDAT, IEND. */
function pngBytes({ phys, exif }: PngOptions = {}): Uint8Array {
  const idat = [0x08, 0xd7, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01];
  return new Uint8Array([
    ...PNG_SIGNATURE,
    ...pngChunk("IHDR", [...be32(1), ...be32(1), 8, 0, 0, 0, 0]),
    ...(phys ? pngChunk("pHYs", physPayload(phys.dpiX, phys.dpiY, phys.unit)) : []),
    ...(exif ? pngChunk("eXIf", tiffResolutionBlock(exif)) : []),
    ...pngChunk("IDAT", idat),
    ...pngChunk("IEND", []),
  ]);
}

/** Chunk types in file order, plus a CRC check on every one of them. */
function pngChunkReport(bytes: Uint8Array): { types: string[]; badCrcs: string[] } {
  const types: string[] = [];
  const badCrcs: string[] = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length =
      (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    types.push(type);
    const end = at + 12 + length;
    const stored =
      ((bytes[end - 4] << 24) |
        (bytes[end - 3] << 16) |
        (bytes[end - 2] << 8) |
        bytes[end - 1]) >>>
      0;
    if (crc(bytes.subarray(at + 4, end - 4)) !== stored) badCrcs.push(type);
    if (type === "IEND") break;
    at = end;
  }
  return { types, badCrcs };
}

/** The IDAT payload — the bytes a DPI change must never touch. */
function idatBytes(bytes: Uint8Array): string {
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length =
      (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === "IDAT") return Buffer.from(bytes.subarray(at + 8, at + 8 + length)).toString("hex");
    at += 12 + length;
  }
  return "";
}

// ── JPEG fixtures ────────────────────────────────────────────────

function jpegSegment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2; // the length field counts itself
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function jfifPayload(dpiX: number, dpiY = dpiX, units = 1): number[] {
  return [
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    1, 2, // version 1.02
    units,
    (dpiX >> 8) & 0xff, dpiX & 0xff,
    (dpiY >> 8) & 0xff, dpiY & 0xff,
    0, 0, // no thumbnail
  ];
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

interface JpegOptions {
  jfif?: { dpiX: number; dpiY?: number; units?: number };
  exif?: Parameters<typeof tiffResolutionBlock>[0];
  /** Extra APP segments emitted before the JFIF, e.g. a JFXX or an XMP APP1. */
  decoys?: number[][];
}

/**
 * SOI, the requested metadata segments, then a token scan and EOI.
 *
 * The Exif APP1 is emitted BEFORE the JFIF APP0 on purpose: that is the order
 * in both repo fixtures, and a reader that assumes APP0 sits at offset 2 finds
 * nothing in either of them.
 */
function jpegBytes({ jfif, exif, decoys = [] }: JpegOptions = {}): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    ...(exif ? jpegSegment(0xe1, [...EXIF_HEADER, ...tiffResolutionBlock(exif)]) : []),
    ...decoys.flat(),
    ...(jfif ? jpegSegment(0xe0, jfifPayload(jfif.dpiX, jfif.dpiY, jfif.units)) : []),
    ...jpegSegment(0xdb, new Array(65).fill(0)), // a plausible DQT
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
    0x7f, 0x11, 0x22, 0x33, // "entropy-coded data"
    0xff, 0xd9, // EOI
  ]);
}

/** Everything from SOS onward — the compressed scan a rewrite must not touch. */
function scanBytes(bytes: Uint8Array): string {
  for (let at = 2; at + 1 < bytes.length; at++) {
    if (bytes[at] === 0xff && bytes[at + 1] === 0xda) {
      return Buffer.from(bytes.subarray(at)).toString("hex");
    }
  }
  return "";
}

function expectOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  return result as Extract<T, { ok: true }>;
}

// ── PNG ──────────────────────────────────────────────────────────

describe("setImageDpi — PNG", () => {
  it("builds the pHYs chunk byte-for-byte, CRC included", () => {
    /*
      A golden vector, captured from Node's own zlib on 2026-09-06:
        node -e '...crc32(pHYs payload)...'  ->  300 dpi = 11811 ppm, crc 78a53f76
      Pinning the whole 21-byte chunk means a wrong length field, a wrong unit
      byte or a CRC computed over the wrong range all fail here rather than
      surviving as a file some readers happen to tolerate.
    */
    const out = expectOk(setImageDpi(pngBytes(), 300));
    const inserted = Buffer.from(out.bytes.subarray(33, 54)).toString("hex");
    expect(inserted).toBe("000000097048597300002e2300002e230178a53f76");
  });

  it("inserts pHYs straight after IHDR when the file has none", () => {
    const input = pngBytes();
    expect(pngChunkReport(input).types).toEqual(["IHDR", "IDAT", "IEND"]);

    const out = expectOk(setImageDpi(input, 300));
    expect(out.wrote).toEqual([{ segment: "pHYs", action: "inserted" }]);
    // IHDR is always 25 bytes on the wire, so the insertion point is byte 33.
    expect(out.sizeDelta).toBe(21);
    expect(out.bytes.length).toBe(input.length + 21);
    const report = pngChunkReport(out.bytes);
    expect(report.types).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    expect(report.badCrcs).toEqual([]);
    expect(out.before.effective).toBeNull();
    expect(out.after.effective).toEqual({
      segment: "pHYs",
      dpiX: 300,
      dpiY: 300,
      aspectRatioOnly: false,
    });
  });

  it("updates an existing pHYs in place, with no size change at all", () => {
    const input = pngBytes({ phys: { dpiX: 72 } });
    const out = expectOk(setImageDpi(input, 600));
    expect(out.wrote).toEqual([{ segment: "pHYs", action: "updated" }]);
    expect(out.sizeDelta).toBe(0);
    expect(out.before.effective?.dpiX).toBe(72);
    expect(out.after.effective?.dpiX).toBe(600);
    expect(pngChunkReport(out.bytes).badCrcs).toEqual([]);
  });

  it("leaves the compressed image data byte-identical", () => {
    const input = pngBytes({ phys: { dpiX: 72 }, exif: { dpiX: 72 } });
    const out = expectOk(setImageDpi(input, 300));
    expect(idatBytes(out.bytes)).toBe(idatBytes(input));
    expect(idatBytes(out.bytes)).not.toBe(""); // the comparison must have compared something
  });

  it("rewrites the eXIf resolution too, and redoes that chunk's CRC", () => {
    /*
      Measured 2026-09-06 (`scratchpad/png-exif-probe.mjs`): on a PNG carrying
      both, libvips believes the eXIf. Writing pHYs alone left the reader
      reporting the OLD density — the same silent no-op as writing a JPEG's
      JFIF and leaving its Exif alone.
    */
    const input = pngBytes({ phys: { dpiX: 96 }, exif: { dpiX: 96 } });
    expect(readImageDpi(input)).toMatchObject({ ok: true, effective: { segment: "EXIF", dpiX: 96 } });

    const out = expectOk(setImageDpi(input, 300));
    expect(out.wrote).toEqual([
      { segment: "EXIF", action: "updated" },
      { segment: "pHYs", action: "updated" },
    ]);
    expect(out.sizeDelta).toBe(0);
    // Both fields now agree, so no reader can disagree with the other.
    expect(out.after.fields).toEqual([
      { segment: "pHYs", dpiX: 300, dpiY: 300, aspectRatioOnly: false },
      { segment: "EXIF", dpiX: 300, dpiY: 300, aspectRatioOnly: false },
    ]);
    expect(pngChunkReport(out.bytes).badCrcs).toEqual([]);
  });

  it("reports an eXIf chunk that carries no resolution tags instead of writing one", () => {
    const input = pngBytes({ exif: { withResolution: false } });
    const out = expectOk(setImageDpi(input, 300));
    expect(out.exifWithoutResolution).toBe(true);
    // The pHYs is still written — the partial result is real, and named.
    expect(out.wrote).toEqual([{ segment: "pHYs", action: "inserted" }]);
    expect(out.after.effective?.dpiX).toBe(300);
  });

  it("treats pHYs unit 0 as an aspect ratio, not as a resolution", () => {
    const input = pngBytes({ phys: { dpiX: 300, unit: 0 } });
    const before = expectOk(readImageDpi(input));
    expect(before.fields).toEqual([
      { segment: "pHYs", dpiX: null, dpiY: null, aspectRatioOnly: true },
    ]);
    expect(before.effective).toBeNull();

    const out = expectOk(setImageDpi(input, 150));
    expect(out.after.effective?.dpiX).toBe(150);
  });

  it("round-trips every DPI the presets offer", () => {
    // ppm is an integer, so the value stored is never exactly the value asked
    // for — 300 dpi is 11811 ppm, which is 299.9994 dpi. Each of these rounds
    // back to itself, which is what makes the rounded readout honest.
    for (const dpi of [72, 96, 150, 300, 600, MIN_DPI, MAX_DPI]) {
      const out = expectOk(setImageDpi(pngBytes(), dpi));
      expect(out.after.effective?.dpiX, `${dpi} dpi`).toBe(dpi);
    }
  });

  it("keeps X and Y separate", () => {
    const out = expectOk(setImageDpi(pngBytes(), 300, 150));
    expect(out.after.effective).toMatchObject({ dpiX: 300, dpiY: 150 });
  });
});

// ── JPEG ─────────────────────────────────────────────────────────

describe("setImageDpi — JPEG", () => {
  it("updates a JFIF-only file in place and switches units to inches", () => {
    // units 0 means the densities are an aspect ratio: both repo fixtures.
    const input = jpegBytes({ jfif: { dpiX: 1, units: 0 } });
    const before = expectOk(readImageDpi(input));
    expect(before.effective).toBeNull();
    expect(before.fields[0].aspectRatioOnly).toBe(true);

    const out = expectOk(setImageDpi(input, 300));
    expect(out.wrote).toEqual([{ segment: "JFIF", action: "updated" }]);
    expect(out.sizeDelta).toBe(0);
    expect(out.after.effective).toEqual({
      segment: "JFIF",
      dpiX: 300,
      dpiY: 300,
      aspectRatioOnly: false,
    });
    expect(scanBytes(out.bytes)).toBe(scanBytes(input));
  });

  it("writes BOTH the EXIF and an inserted JFIF when the file is EXIF-only", () => {
    /*
      The finding the whole JPEG path exists for: a reader prefers the EXIF, so
      writing the JFIF alone here is silently ignored (measured — a sharp JPEG
      with density 150 and no JFIF still read 150 after the JFIF was set to
      600). Both must be written, and the JFIF has to be created from nothing.
    */
    const input = jpegBytes({ exif: { dpiX: 150 } });
    expect(expectOk(readImageDpi(input)).effective).toEqual({
      segment: "EXIF",
      dpiX: 150,
      dpiY: 150,
      aspectRatioOnly: false,
    });

    const out = expectOk(setImageDpi(input, 300));
    expect(out.wrote).toEqual([
      { segment: "EXIF", action: "updated" },
      { segment: "JFIF", action: "inserted" },
    ]);
    expect(out.sizeDelta).toBe(18);
    expect(out.after.fields).toEqual([
      { segment: "EXIF", dpiX: 300, dpiY: 300, aspectRatioOnly: false },
      { segment: "JFIF", dpiX: 300, dpiY: 300, aspectRatioOnly: false },
    ]);
    expect(scanBytes(out.bytes)).toBe(scanBytes(input));
  });

  it("writes both fields in place when the file carries both", () => {
    const input = jpegBytes({ exif: { dpiX: 72 }, jfif: { dpiX: 1, units: 0 } });
    const out = expectOk(setImageDpi(input, 300));
    expect(out.wrote).toEqual([
      { segment: "EXIF", action: "updated" },
      { segment: "JFIF", action: "updated" },
    ]);
    expect(out.sizeDelta).toBe(0);
    expect(out.after.effective?.segment).toBe("EXIF");
    expect(out.after.fields.every((f) => f.dpiX === 300)).toBe(true);
  });

  it("inserts a JFIF right after SOI when the file has neither field", () => {
    const input = jpegBytes();
    expect(expectOk(readImageDpi(input)).fields).toEqual([]);

    const out = expectOk(setImageDpi(input, 300));
    expect(out.wrote).toEqual([{ segment: "JFIF", action: "inserted" }]);
    expect(out.sizeDelta).toBe(18);
    // JFIF requires APP0 to be the FIRST segment, so it has to land at byte 2.
    const segments = walkJpegSegments(out.bytes)!;
    expect(segments[0]).toMatchObject({ marker: 0xffe0, at: 2, length: 16 });
    expect(out.exifWithoutResolution).toBe(false);
  });

  it("reports an Exif block that carries no resolution tags", () => {
    /*
      The one case v1 refuses: adding an IFD entry grows IFD0 by 12 bytes and
      relocates every out-of-line value offset in the block. The JFIF is
      written and the shortfall is named — writing only the JFIF and reporting
      an unqualified success is the option that is not on the table.
    */
    const input = jpegBytes({ exif: { withResolution: false } });
    const out = expectOk(setImageDpi(input, 300));
    expect(out.exifWithoutResolution).toBe(true);
    expect(out.wrote).toEqual([{ segment: "JFIF", action: "inserted" }]);
    expect(out.after.effective?.segment).toBe("JFIF");
  });

  it("reads and writes a big-endian (MM) Exif block", () => {
    const input = jpegBytes({ exif: { dpiX: 72, littleEndian: false } });
    expect(expectOk(readImageDpi(input)).effective?.dpiX).toBe(72);
    const out = expectOk(setImageDpi(input, 600));
    expect(out.after.effective).toMatchObject({ segment: "EXIF", dpiX: 600 });
  });

  it("converts a centimetre ResolutionUnit on read and normalises it on write", () => {
    // ResolutionUnit 3 is dots per centimetre: 118 dpcm ≈ 300 dpi.
    const input = jpegBytes({ exif: { dpiX: 118, unit: 3 } });
    expect(expectOk(readImageDpi(input)).effective?.dpiX).toBe(300);

    const out = expectOk(setImageDpi(input, 150));
    // Left saying "centimetres", a value of 150 would read back as 381 dpi.
    expect(out.after.effective).toMatchObject({ segment: "EXIF", dpiX: 150 });
  });

  it("converts JFIF units 2 (dots per cm) on read", () => {
    const input = jpegBytes({ jfif: { dpiX: 118, units: 2 } });
    expect(expectOk(readImageDpi(input)).effective?.dpiX).toBe(300);
  });

  it("ignores a JFXX APP0, which is a thumbnail extension and not the density", () => {
    const jfxx = jpegSegment(0xe0, [0x4a, 0x46, 0x58, 0x58, 0x00, 0x10]); // "JFXX\0"
    const input = jpegBytes({ decoys: [jfxx] });
    const out = expectOk(setImageDpi(input, 300));
    // A real JFIF APP0 gets inserted; the JFXX is left exactly where it was.
    expect(out.wrote).toEqual([{ segment: "JFIF", action: "inserted" }]);
    const markers = walkJpegSegments(out.bytes)!.filter((s) => s.marker === 0xffe0);
    expect(markers).toHaveLength(2);
    expect(out.after.effective?.dpiX).toBe(300);
  });

  it("ignores an XMP APP1, which is not an Exif block", () => {
    const xmp = jpegSegment(0xe1, [...Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1")]);
    const input = jpegBytes({ decoys: [xmp], jfif: { dpiX: 72 } });
    const out = expectOk(setImageDpi(input, 300));
    expect(out.wrote).toEqual([{ segment: "JFIF", action: "updated" }]);
    expect(out.exifWithoutResolution).toBe(false);
  });

  it("finds the JFIF even though APP0 comes after APP1", () => {
    // Not hypothetical: this is the layout of both checked-in fixtures.
    const input = jpegBytes({ exif: { dpiX: 72 }, jfif: { dpiX: 1, units: 0 } });
    const segments = walkJpegSegments(input)!;
    expect(segments[0].marker).toBe(0xffe1);
    expect(segments[1].marker).toBe(0xffe0);
    expect(expectOk(setImageDpi(input, 300)).sizeDelta).toBe(0);
  });
});

// ── the real fixtures ────────────────────────────────────────────

describe("setImageDpi — the checked-in JPEG fixtures", () => {
  for (const name of ["sample-photo.jpg", "sample-photo-portrait.jpg"]) {
    it(`rewrites both fields of ${name} without moving a scan byte`, () => {
      const input = sample(name);
      const before = expectOk(readImageDpi(input));
      // Measured with exifreader and libvips: EXIF says 72, the JFIF says
      // units 0 (aspect only), and the EXIF is the one a reader believes.
      expect(before.effective).toEqual({
        segment: "EXIF",
        dpiX: 72,
        dpiY: 72,
        aspectRatioOnly: false,
      });
      expect(before.fields.map((f) => f.segment)).toEqual(["EXIF", "JFIF"]);
      expect(before.fields[1].aspectRatioOnly).toBe(true);

      const out = expectOk(setImageDpi(input, 300));
      expect(out.wrote).toEqual([
        { segment: "EXIF", action: "updated" },
        { segment: "JFIF", action: "updated" },
      ]);
      expect(out.sizeDelta).toBe(0);
      expect(out.after.fields).toEqual([
        { segment: "EXIF", dpiX: 300, dpiY: 300, aspectRatioOnly: false },
        { segment: "JFIF", dpiX: 300, dpiY: 300, aspectRatioOnly: false },
      ]);
      expect(scanBytes(out.bytes)).toBe(scanBytes(input));
      expect(scanBytes(out.bytes).length).toBeGreaterThan(1000);
    });
  }

  it("never mutates the caller's array", () => {
    const input = sample("sample-photo.jpg");
    const copy = new Uint8Array(input);
    expectOk(setImageDpi(input, 600));
    expect(Buffer.compare(Buffer.from(input), Buffer.from(copy))).toBe(0);
  });
});

// ── refusals ─────────────────────────────────────────────────────

describe("refusals", () => {
  it("refuses WebP by name, because the format has no field to set", () => {
    const webp = new Uint8Array([
      ...Buffer.from("RIFF", "latin1"), 0x3c, 0, 0, 0,
      ...Buffer.from("WEBPVP8 ", "latin1"),
    ]);
    for (const result of [readImageDpi(webp), setImageDpi(webp, 300)]) {
      expect(result).toEqual({ ok: false, reason: "webp", message: WEBP_MESSAGE });
    }
    expect(WEBP_MESSAGE).toMatch(/no DPI field/);
  });

  it("refuses anything that is not PNG or JPEG", () => {
    const gif = new Uint8Array([...Buffer.from("GIF89a", "latin1"), 1, 0, 1, 0, 0, 0, 0]);
    expect(setImageDpi(gif, 300)).toEqual({
      ok: false,
      reason: "unsupported",
      message: UNSUPPORTED_MESSAGE,
    });
  });

  it("refuses a file whose magic matches but whose structure does not parse", () => {
    // A PNG signature and an IHDR whose declared length runs past the file.
    const broken = new Uint8Array([...PNG_SIGNATURE, 0xff, 0xff, 0xff, 0xff, 0x49, 0x48, 0x44, 0x52]);
    expect(setImageDpi(broken, 300)).toMatchObject({ ok: false, reason: "malformed" });
    expect(readImageDpi(broken)).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("refuses a DPI the header cannot store", () => {
    for (const dpi of [0, -300, 0.5, 300.5, MAX_DPI + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(setImageDpi(pngBytes(), dpi), `${dpi}`).toMatchObject({
        ok: false,
        reason: "dpi-out-of-range",
      });
    }
  });

  it("never throws on random bytes", () => {
    // Total by contract: this runs over whatever a user dropped.
    for (let seed = 0; seed < 200; seed++) {
      const bytes = new Uint8Array(64);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (seed * 31 + i * 17) & 0xff;
      // Force the two magic prefixes so the walkers are actually entered.
      bytes.set(seed % 2 === 0 ? PNG_SIGNATURE : [0xff, 0xd8, 0xff], 0);
      expect(() => readImageDpi(bytes)).not.toThrow();
      expect(() => setImageDpi(bytes, 300)).not.toThrow();
    }
  });
});

// ── what a header AMOUNTS to, which is what the page says out loud ──

/*
  THE DEFECT.

  /change-image-dpi prints one of four sentences about the file it just read,
  and it chose between them with `effective === null && fields.length > 0`.
  That expression is true of two different files:

    a file whose density carries NO unit — the numbers are an aspect ratio and
    never were a resolution;
    a file that declares INCHES and whose RATIONAL cannot be read — 72/0 is
    the shape that occurs.

  Both got "This file carries density numbers with no unit attached — an
  aspect ratio, not a resolution", which for the second file is a statement
  about a byte the file sets to 2. The engine was not wrong: `exifFieldReading`
  takes `aspectRatioOnly` from the ResolutionUnit tag alone and reported
  `false` for it. There was simply no single value to switch on, so the caller
  guessed from a shape — and `declaredResolution` is that value.
*/

describe("declaredResolution", () => {
  const jpegExif = (over: Parameters<typeof tiffResolutionBlock>[0]) =>
    expectOk(readImageDpi(jpegBytes({ exif: over })));

  it("names a file a reader can actually print from", () => {
    expect(declaredResolution(jpegExif({ dpiX: 300, unit: 2 }))).toBe("usable");
  });

  it("names a genuine aspect ratio — ResolutionUnit 1, pHYs unit 0, JFIF units 0", () => {
    expect(declaredResolution(jpegExif({ dpiX: 4, dpiY: 3, unit: 1 }))).toBe("aspect-ratio");
    expect(
      declaredResolution(expectOk(readImageDpi(pngBytes({ phys: { dpiX: 72, unit: 0 } })))),
    ).toBe("aspect-ratio");
    expect(
      declaredResolution(expectOk(readImageDpi(jpegBytes({ jfif: { dpiX: 4, dpiY: 3, units: 0 } })))),
    ).toBe("aspect-ratio");
  });

  it("does NOT call a broken RATIONAL an aspect ratio, on a file that declares inches", () => {
    /*
      The case the sentence was wrong about. ResolutionUnit is 2 — the file
      says inches in as many words — and the denominator is zero, so there is
      no number behind it. "No unit attached" is the one thing this file does
      not say.
    */
    const reading = jpegExif({ dpiX: 72, unit: 2, denominator: 0 });
    expect(reading.fields).toEqual([
      { segment: "EXIF", dpiX: null, dpiY: null, aspectRatioOnly: false },
    ]);
    expect(declaredResolution(reading)).toBe("unreadable");

    // A PNG's eXIf chunk is the same IFD and takes the same answer.
    const png = expectOk(readImageDpi(pngBytes({ exif: { unit: 2, denominator: 0 } })));
    expect(declaredResolution(png)).toBe("unreadable");
  });

  it("is the distinction the page's structural test could not make", () => {
    /*
      `ChangeImageDpiUI.tsx` derives `aspectOnly` as the expression below.
      Reproduced verbatim here, over both files, so the gap is a measurement
      rather than an assertion about the past: the two readings are
      indistinguishable to it and distinguishable to `declaredResolution`.
    */
    const structural = (r: { effective: unknown; fields: unknown[] }) =>
      r.effective === null && r.fields.length > 0;

    const aspect = jpegExif({ dpiX: 4, dpiY: 3, unit: 1 });
    const broken = jpegExif({ dpiX: 72, unit: 2, denominator: 0 });

    expect([structural(aspect), structural(broken)]).toEqual([true, true]);
    expect([declaredResolution(aspect), declaredResolution(broken)]).toEqual([
      "aspect-ratio",
      "unreadable",
    ]);
  });

  it("answers 'unreadable' for a mixed header, because that is the specific fault", () => {
    // EXIF states inches unreadably; the JFIF beside it states no unit. The
    // aspect-ratio sentence would describe the half that is not the problem.
    const reading = expectOk(
      readImageDpi(
        jpegBytes({ exif: { unit: 2, denominator: 0 }, jfif: { dpiX: 4, dpiY: 3, units: 0 } }),
      ),
    );
    expect(reading.fields.map((f) => f.aspectRatioOnly)).toEqual([false, true]);
    expect(declaredResolution(reading)).toBe("unreadable");
  });

  it("names a file with no resolution field at all", () => {
    expect(declaredResolution(expectOk(readImageDpi(pngBytes())))).toBe("none");
    expect(declaredResolution(expectOk(readImageDpi(jpegBytes())))).toBe("none");
  });

  it("and 'unreadable' says nothing about the WRITE, which still works", () => {
    /*
      The reason this is a copy bug and not a data bug. The tags are there and
      the writer follows their offsets; only the value was unreadable, and it
      gets a valid RATIONAL written over it. A file that read as "unreadable"
      reads back "usable" at the DPI that was asked for.
    */
    const input = jpegBytes({ exif: { unit: 2, denominator: 0 } });
    const out = expectOk(setImageDpi(input, 300));
    expect(out.wrote.map((w) => w.segment)).toContain("EXIF");
    expect(declaredResolution(out.after)).toBe("usable");
    expect(out.after.effective).toMatchObject({ segment: "EXIF", dpiX: 300, dpiY: 300 });
    expect(scanBytes(out.bytes)).toBe(scanBytes(input));
  });
});

