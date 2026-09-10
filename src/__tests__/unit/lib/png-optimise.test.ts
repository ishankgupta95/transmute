import { describe, it, expect } from "vitest";

import {
  alreadyOptimalNote,
  deinterlacedNote,
  describePngColour,
  estimateOptimiseMs,
  isPng,
  MAX_OXIPNG_LEVEL,
  megapixels,
  NOT_A_PNG_MESSAGE,
  OXIPNG_MS_PER_MEGAPIXEL,
  PNG_MEGAPIXEL_LIMIT,
  PNG_RASTER_BYTE_LIMIT,
  pngTooLargeMessage,
  rasterBytes,
  readPngHeader,
} from "@/lib/tools/png-optimise";

/**
 * Everything around the codec, which is everything that can go wrong before it
 * runs. The wasm itself is NOT exercised here and deliberately so: it needs a
 * real fetch of a real 164 KB binary, which jsdom cannot give it. What is
 * tested is the part that has to be right for the codec to be reachable at
 * all — the magic sniff (oxipng's own error for every bad input is the
 * identical, useless string "`unwrap_throw` failed", so this file is the only
 * thing standing between a user and that), the IHDR reader behind the
 * before/after colour report, and the megapixel guard that must fire BEFORE
 * a 300 MB wasm heap is allocated.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** CRC-32 as PNG defines it, so the fixtures below are real chunks. */
function crc32(bytes: number[]): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/**
 * A real PNG signature plus a real, CRC-correct IHDR chunk. `chunkType` is a
 * parameter so a file whose first chunk is NOT IHDR can be built too — that is
 * a genuine shape (a spec-violating writer), not a hypothetical.
 */
function pngWithHeader({
  width,
  height,
  bitDepth = 8,
  colourType = 6,
  interlace = 0,
  chunkType = "IHDR",
}: {
  width: number;
  height: number;
  bitDepth?: number;
  colourType?: number;
  /** IHDR byte 28: 0 = one pass, 1 = Adam7. A real GIMP/Photoshop option. */
  interlace?: number;
  chunkType?: string;
}): Uint8Array {
  const type = [...chunkType].map((c) => c.charCodeAt(0));
  // …bit depth, colour type, compression method, filter method, interlace.
  const payload = [...be32(width), ...be32(height), bitDepth, colourType, 0, 0, interlace];
  return new Uint8Array([
    ...PNG_MAGIC,
    ...be32(payload.length),
    ...type,
    ...payload,
    ...be32(crc32([...type, ...payload])),
  ]);
}

const JPEG_SOI = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("isPng", () => {
  it("accepts the signature and nothing else", () => {
    expect(isPng(pngWithHeader({ width: 4, height: 4 }))).toBe(true);
    expect(isPng(JPEG_SOI)).toBe(false);
    expect(isPng(new Uint8Array(0))).toBe(false);
    // A truncated signature is not a PNG, even though every byte present matches.
    expect(isPng(new Uint8Array(PNG_MAGIC.slice(0, 7)))).toBe(false);
  });

  it("rejects a single flipped byte anywhere in the signature", () => {
    for (let i = 0; i < PNG_MAGIC.length; i++) {
      const bytes = pngWithHeader({ width: 4, height: 4 });
      bytes[i] ^= 0xff;
      expect(isPng(bytes)).toBe(false);
    }
  });
});

describe("readPngHeader", () => {
  it("reads dimensions, bit depth and colour type out of IHDR", () => {
    expect(readPngHeader(pngWithHeader({ width: 1200, height: 630 }))).toEqual({
      width: 1200,
      height: 630,
      bitDepth: 8,
      colourType: 6,
      interlace: 0,
    });
    expect(
      readPngHeader(pngWithHeader({ width: 198, height: 198, bitDepth: 1, colourType: 0 })),
    ).toEqual({ width: 198, height: 198, bitDepth: 1, colourType: 0, interlace: 0 });
  });

  it("reads the interlace method, which no other field carries", () => {
    // The last byte of the IHDR payload, and the only place progressive
    // rendering is recorded: colour type and bit depth are identical either
    // way, so a de-interlaced output is invisible without this.
    expect(readPngHeader(pngWithHeader({ width: 1200, height: 630, interlace: 1 }))?.interlace)
      .toBe(1);
    expect(readPngHeader(pngWithHeader({ width: 1200, height: 630 }))?.interlace).toBe(0);
  });

  it("reads a width past 2^31 unsigned, not as a negative", () => {
    // PNG dimensions are 4-byte unsigned. Without the >>> 0 this comes back
    // negative and every guard downstream silently passes.
    const header = readPngHeader(pngWithHeader({ width: 0x80000000, height: 2 }));
    expect(header?.width).toBe(2147483648);
  });

  it("returns null rather than guessing", () => {
    expect(readPngHeader(JPEG_SOI)).toBeNull();
    expect(readPngHeader(new Uint8Array(0))).toBeNull();
    // A valid signature with the header chunk cut short.
    expect(readPngHeader(pngWithHeader({ width: 8, height: 8 }).slice(0, 28))).toBeNull();
    // First chunk is not IHDR — the spec says it must be.
    expect(readPngHeader(pngWithHeader({ width: 8, height: 8, chunkType: "pHYs" }))).toBeNull();
    // A zero dimension is not an image; reporting "0×512" as a success would
    // put a divide-by-zero into every ratio computed from it.
    expect(readPngHeader(pngWithHeader({ width: 0, height: 512 }))).toBeNull();
    expect(readPngHeader(pngWithHeader({ width: 512, height: 0 }))).toBeNull();
  });
});

describe("describePngColour", () => {
  it("names every colour type the spec defines, with the bit depth", () => {
    const at = (colourType: number, bitDepth: number) =>
      describePngColour({ width: 1, height: 1, colourType, bitDepth, interlace: 0 });
    // The exact strings oxipng's measured rewrites are reported as:
    // RGBA/8 → Gray/1 on a QR code, RGB/8 → Palette/4 on a screenshot.
    expect(at(6, 8)).toBe("RGBA/8");
    expect(at(2, 8)).toBe("RGB/8");
    expect(at(3, 4)).toBe("Palette/4");
    expect(at(0, 1)).toBe("Gray/1");
    expect(at(4, 16)).toBe("Gray+Alpha/16");
  });

  it("does not invent a name for a colour type that is not in the spec", () => {
    expect(
      describePngColour({ width: 1, height: 1, colourType: 5, bitDepth: 8, interlace: 0 }),
    ).toBe("Type 5/8");
  });
});

describe("the megapixel guard", () => {
  const header = (width: number, height: number) => ({
    width,
    height,
    bitDepth: 8,
    colourType: 6,
    interlace: 0,
  });

  it("counts megapixels from the pixel count, not the byte count", () => {
    expect(megapixels(header(1000, 1000))).toBe(1);
    expect(megapixels(header(4000, 3000))).toBe(12);
  });

  it("lets exactly the limit through and refuses one pixel more", () => {
    // 4000×3000 is 12.0 MP — the cap is inclusive, so the commonest 12 MP
    // phone photo is not refused by a rounding accident.
    expect(pngTooLargeMessage(header(4000, 3000))).toBeNull();
    expect(pngTooLargeMessage(header(4000, 3001))).not.toBeNull();
    expect(pngTooLargeMessage(header(1, 1))).toBeNull();
  });

  it("says what was measured and why the limit exists", () => {
    const message = pngTooLargeMessage(header(6000, 4000));
    expect(message).toContain("6000×4000");
    expect(message).toContain("24.0 megapixels");
    expect(message).toContain(`${PNG_MEGAPIXEL_LIMIT}-megapixel`);
    // The reason is the wasm heap, which is the fact the user cannot see and
    // the only thing that makes a refusal reasonable rather than arbitrary.
    expect(message).toMatch(/memory/i);
  });
});

describe("the decoded-raster guard", () => {
  const header = (
    width: number,
    height: number,
    colourType: number,
    bitDepth: number,
  ) => ({ width, height, colourType, bitDepth, interlace: 0 });

  it("sizes the raster from channels and bit depth, not from the pixel count", () => {
    // The spec's samples-per-pixel: grey 1, RGB 3, palette 1 index, grey+alpha
    // 2, RGBA 4 — the numbers the megapixel count throws away.
    expect(rasterBytes(header(1000, 1000, 2, 8))).toBe(3_000_000);
    expect(rasterBytes(header(1000, 1000, 6, 8))).toBe(4_000_000);
    expect(rasterBytes(header(1000, 1000, 6, 16))).toBe(8_000_000);
    expect(rasterBytes(header(1000, 1000, 0, 8))).toBe(1_000_000);
    expect(rasterBytes(header(1000, 1000, 3, 8))).toBe(1_000_000);
    // A colour type the spec does not define is charged the worst case rather
    // than dropped out of the arithmetic as NaN or 0.
    expect(rasterBytes(header(1000, 1000, 5, 8))).toBe(4_000_000);
  });

  it("refuses a 16-bit RGBA file the megapixel cap admits", () => {
    /*
      4000×3000 is EXACTLY 12.00 MP, so the pixel cap passes it — and as
      16-bit RGBA that is 96 MB of raster, MEASURED at 372 MB and 751 MB of
      wasm heap on two real exports (the cap exists to hold ~300 MB). This is
      the case a pixel-only guard cannot see, because 8-bit RGB at the same
      dimensions is a quarter of the bytes and is admitted.
    */
    expect(megapixels(header(4000, 3000, 6, 16))).toBe(12);
    expect(pngTooLargeMessage(header(4000, 3000, 2, 8))).toBeNull();

    const message = pngTooLargeMessage(header(4000, 3000, 6, 16));
    expect(message).not.toBeNull();
    // It has to name the pixel format, or the reader is told a 12 MP file is
    // over a 12 MP limit.
    expect(message).toContain("RGBA/16");
    expect(message).toContain("96 MB");
    expect(message).toMatch(/8 bits per channel/);
    // And it must not be the megapixel sentence wearing a different number.
    expect(message).not.toMatch(/megapixel/);
  });

  it("admits exactly the ceiling and refuses one channel more", () => {
    // 12 MP of 8-bit RGBA is 48,000,000 B — the largest raster the pixel cap
    // ever let through, so nothing that worked before is refused now.
    expect(rasterBytes(header(4000, 3000, 6, 8))).toBe(PNG_RASTER_BYTE_LIMIT);
    expect(pngTooLargeMessage(header(4000, 3000, 6, 8))).toBeNull();
    // Half the pixels at twice the depth is the same raster, and also fits.
    expect(pngTooLargeMessage(header(2000, 3000, 6, 16))).toBeNull();
    expect(pngTooLargeMessage(header(2001, 3000, 6, 16))).not.toBeNull();
  });
});

describe("the honest strings", () => {
  it("never surfaces oxipng's own error text", () => {
    // Every oxipng failure — JPEG bytes, empty input, a truncated PNG, random
    // garbage — throws the identical string "`unwrap_throw` failed". It tells
    // a user nothing, so ours has to say what is actually wrong.
    expect(NOT_A_PNG_MESSAGE).not.toContain("unwrap_throw");
    expect(NOT_A_PNG_MESSAGE).toMatch(/PNG/);
  });

  it("reports an unchanged file as a result, not a failure", () => {
    const note = alreadyOptimalNote(2);
    expect(note).toContain("level 2");
    expect(note).toMatch(/byte-for-byte/);
    // "Already optimal" is a successful run. It must not read as an error, and
    // it must not claim anything was lost.
    expect(note).not.toMatch(/error|fail|could not/i);
    expect(note).toContain("Nothing was lost");
  });

  it("discloses the de-interlace as a change, without claiming a pixel was lost", () => {
    // MEASURED: an Adam7-interlaced PNG comes back non-interlaced at levels
    // 2-4. Nothing else on the page can see it — the before/after report reads
    // colour type and bit depth, and interlacing moves neither — so this note
    // is the only disclosure, and it has to be honest in both directions.
    const note = deinterlacedNote();
    expect(note).toMatch(/interlac/i);
    expect(note).toMatch(/identical/i);
    expect(note).not.toMatch(/error|fail|lost/i);
  });
});

describe("the measured constants", () => {
  it("stops at level 4, because 5 and 6 return identical bytes", () => {
    // MEASURED: og-image.png is 110,876 B at levels 4, 5 and 6, at 1x, 1.9x
    // and 2.3x the time. Offering 5 or 6 would be selling a wait for nothing.
    expect(MAX_OXIPNG_LEVEL).toBe(4);
  });

  it("estimates the wait from the measured throughput", () => {
    expect(OXIPNG_MS_PER_MEGAPIXEL).toBeGreaterThan(0);
    expect(
      estimateOptimiseMs({ width: 4000, height: 3000, bitDepth: 8, colourType: 6, interlace: 0 }),
    ).toBe(
      12 * OXIPNG_MS_PER_MEGAPIXEL,
    );
    // A 12 MP PNG is a multi-second operation, and the copy has to say so
    // rather than animate a bar the codec cannot feed.
    expect(
      estimateOptimiseMs({
        width: 4000,
        height: 3000,
        bitDepth: 8,
        colourType: 6,
        interlace: 0,
      }),
    ).toBeGreaterThan(3000);
  });
});
