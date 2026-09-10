import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect } from "vitest";

import { neutraliseJpegOrientation, readJpegOrientation } from "@/lib/tools/jpeg-orientation";

/**
 * EXIF Orientation neutralisation for the PDF image recompressor.
 *
 * The bug this guards is silent page corruption, not a crash: `createImageBitmap`
 * honours EXIF Orientation, a PDF reader does not, so re-encoding a decoder's
 * output writes rotated samples — and for orientations 5–8 TRANSPOSED
 * dimensions — into a dictionary whose CTM still describes the original grid.
 *
 * The browser half of that was measured directly (Chromium, this repo's dev
 * server, 2026-09-02): a 400×200 JPEG carrying Orientation 6 decodes to a
 * 200×400 bitmap with the corner marker displaced; after this module rewrites
 * the tag it decodes to 400×200 with the marker back in place. Passing
 * `imageOrientation: "none"` still returned 200×400 — it is not a valid value
 * in the current spec and is ignored, which is why the fix patches bytes.
 *
 * This file pins the byte-level half, which is where the parsing can go wrong.
 */

const SAMPLES = path.join(process.cwd(), "src/__tests__/fixtures/samples");
const sample = (name: string) => new Uint8Array(readFileSync(path.join(SAMPLES, name)));

/** A minimal but real JPEG: SOI, an APP1 Exif segment, then EOI. */
function jpegWithOrientation(orientation: number, littleEndian = true): Uint8Array {
  const tiff = littleEndian
    ? [
        0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II", 42, IFD0 @ 8
        0x01, 0x00, // one entry
        0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, // no next IFD
      ]
    : [
        0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 @ 8
        0x00, 0x01,
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0"
  const len = payload.length + 2;
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload,
    0xff, 0xd9, // EOI
  ]);
}

describe("readJpegOrientation", () => {
  it("reads the tag out of the checked-in fixtures", () => {
    // These two are the reason the bug is reachable in production at all: a
    // phone photo routinely carries a non-1 orientation, and "JPG to PDF"
    // tools embed the original bytes verbatim.
    expect(readJpegOrientation(sample("sample-photo.jpg"))).toBe(1);
    expect(readJpegOrientation(sample("sample-photo-portrait.jpg"))).toBe(6);
  });

  it("reads every orientation, in both TIFF byte orders", () => {
    for (let o = 1; o <= 8; o++) {
      expect(readJpegOrientation(jpegWithOrientation(o, true)), `LE ${o}`).toBe(o);
      expect(readJpegOrientation(jpegWithOrientation(o, false)), `BE ${o}`).toBe(o);
    }
  });

  it("defaults to 1 when there is no Exif segment at all", () => {
    expect(readJpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBe(1);
  });

  it("never throws on malformed bytes — a bad image must not fail the document", () => {
    const nasty: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([0xff]),
      new Uint8Array([0xff, 0xd8]),
      new Uint8Array([0x00, 0x00, 0x00, 0x00]), // not a JPEG
      new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x02]), // APP1 with no payload
      new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00]), // length < 2: would loop forever
      new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45, 0x78]), // length past the end
    ];
    for (const bytes of nasty) {
      expect(() => readJpegOrientation(bytes)).not.toThrow();
      expect(readJpegOrientation(bytes)).toBe(1);
    }
  });
});

describe("neutraliseJpegOrientation", () => {
  it("rewrites a rotating orientation to 1 without changing the file's length", () => {
    for (let o = 2; o <= 8; o++) {
      for (const littleEndian of [true, false]) {
        const bytes = jpegWithOrientation(o, littleEndian);
        const before = bytes.length;
        const out = neutraliseJpegOrientation(bytes);
        expect(out, `orientation ${o}`).not.toBeNull();
        // Length must not move: every offset in a TIFF IFD is relative to the
        // segment, so resizing it would invalidate the other tags.
        expect(out!.length).toBe(before);
        expect(readJpegOrientation(out!)).toBe(1);
      }
    }
  });

  it("neutralises the real orientation-6 fixture", () => {
    const bytes = sample("sample-photo-portrait.jpg");
    const length = bytes.length;
    expect(readJpegOrientation(bytes)).toBe(6);
    const out = neutraliseJpegOrientation(bytes);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(length);
    expect(readJpegOrientation(out!)).toBe(1);
  });

  it("leaves an already-upright file completely untouched", () => {
    const bytes = sample("sample-photo.jpg");
    const copy = new Uint8Array(bytes);
    const out = neutraliseJpegOrientation(bytes);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(Array.from(copy));
  });

  it("passes through a JPEG with no Exif rather than refusing it", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(neutraliseJpegOrientation(bytes)).toBe(bytes);
  });

  it("REFUSES an out-of-range orientation instead of guessing", () => {
    // The caller turns null into a skip, so the image is left exactly as
    // found. Silently re-encoding a file we cannot reason about is the one
    // outcome that would corrupt a page without telling anyone.
    for (const bad of [0, 9, 255]) {
      expect(neutraliseJpegOrientation(jpegWithOrientation(bad)), `orientation ${bad}`).toBeNull();
    }
  });

  it("only touches the two value bytes", () => {
    const bytes = jpegWithOrientation(6);
    const before = Array.from(bytes);
    const out = neutraliseJpegOrientation(bytes)!;
    const changed = before.map((b, i) => (b === out[i] ? null : i)).filter((i) => i !== null);
    expect(changed).toHaveLength(1); // only the low byte moves, 6 -> 1
  });
});
