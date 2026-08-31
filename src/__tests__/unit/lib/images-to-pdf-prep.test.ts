import { describe, expect, it } from "vitest";
import {
  PDF_JPEG_QUALITY,
  pngBitDepth,
  prepareForPdf,
  rgbaHasTransparency,
  sniffImageKind,
} from "@/lib/tools/images-to-pdf-prep";

/**
 * jsdom covers the logic that never touches a decoder: the byte sniff, the
 * alpha scan, and the JPEG/PNG passthrough (which must hand back the exact
 * input bytes — the tool's "embedded byte-for-byte" claim IS this test).
 * The decode-and-re-encode paths (TIFF pages, WebP, HEIC) need a real canvas
 * and run in the conversion E2E suite (images-to-pdf-children.spec.ts).
 */

const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9,
]);
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const TIFF_LE = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
const TIFF_BE = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08]);

describe("sniffImageKind", () => {
  it("recognises JPEG by its SOI marker", () => {
    expect(sniffImageKind(JPEG_BYTES)).toBe("jpeg");
  });

  it("recognises the 8-byte PNG signature", () => {
    expect(sniffImageKind(PNG_BYTES)).toBe("png");
  });

  it("recognises both TIFF byte orders", () => {
    expect(sniffImageKind(TIFF_LE)).toBe("tiff");
    expect(sniffImageKind(TIFF_BE)).toBe("tiff");
  });

  it("returns other for unknown or truncated bytes", () => {
    expect(sniffImageKind(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe("other"); // RIFF
    expect(sniffImageKind(new Uint8Array([0x89]))).toBe("other"); // truncated PNG sig
    expect(sniffImageKind(new Uint8Array())).toBe("other");
  });

  it("is not fooled by a PNG signature that stops one byte short", () => {
    expect(sniffImageKind(PNG_BYTES.slice(0, 7))).toBe("other");
  });
});

describe("pngBitDepth", () => {
  it("reads the IHDR bit depth at byte 24", () => {
    const png = new Uint8Array(30);
    png.set(PNG_BYTES.slice(0, 8));
    png[24] = 8;
    expect(pngBitDepth(png)).toBe(8);
    png[24] = 16;
    expect(pngBitDepth(png)).toBe(16);
  });

  it("returns null for bytes too short to hold an IHDR", () => {
    expect(pngBitDepth(PNG_BYTES.slice(0, 8))).toBeNull();
    expect(pngBitDepth(new Uint8Array())).toBeNull();
  });
});

describe("rgbaHasTransparency", () => {
  it("returns false for fully opaque pixels", () => {
    expect(rgbaHasTransparency(new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]))).toBe(false);
  });

  it("returns true when any single pixel is not fully opaque", () => {
    expect(rgbaHasTransparency(new Uint8Array([10, 20, 30, 255, 40, 50, 60, 254]))).toBe(true);
    expect(rgbaHasTransparency(new Uint8Array([10, 20, 30, 0]))).toBe(true);
  });

  it("accepts the Uint8ClampedArray a canvas getImageData returns", () => {
    expect(rgbaHasTransparency(new Uint8ClampedArray([1, 2, 3, 200]))).toBe(true);
    expect(rgbaHasTransparency(new Uint8ClampedArray([1, 2, 3, 255]))).toBe(false);
  });

  it("returns false for an empty buffer", () => {
    expect(rgbaHasTransparency(new Uint8Array())).toBe(false);
  });
});

describe("prepareForPdf — JPEG/PNG passthrough", () => {
  it("passes JPEG bytes through untouched as a single image/jpeg page", async () => {
    const file = new File([JPEG_BYTES], "photo.jpg", { type: "image/jpeg" });
    const prepared = await prepareForPdf(file);

    expect(prepared.warnings).toEqual([]);
    expect(prepared.pages).toHaveLength(1);
    expect(prepared.pages[0].type).toBe("image/jpeg");
    // Byte-for-byte: the FAQ's "embedded without re-encoding" claim.
    expect(Array.from(prepared.pages[0].bytes)).toEqual(Array.from(JPEG_BYTES));
  });

  it("passes PNG bytes through untouched as a single image/png page", async () => {
    const file = new File([PNG_BYTES], "diagram.png", { type: "image/png" });
    const prepared = await prepareForPdf(file);

    expect(prepared.warnings).toEqual([]);
    expect(prepared.pages).toHaveLength(1);
    expect(prepared.pages[0].type).toBe("image/png");
    expect(Array.from(prepared.pages[0].bytes)).toEqual(Array.from(PNG_BYTES));
  });

  it("routes on magic bytes, not the filename — a PNG wearing .jpg stays PNG", async () => {
    // pdf-lib's embedJpg would reject PNG bytes; the sniff is what makes a
    // misnamed file land in the right embedder.
    const file = new File([PNG_BYTES], "actually-a-png.jpg", { type: "image/jpeg" });
    const prepared = await prepareForPdf(file);
    expect(prepared.pages[0].type).toBe("image/png");
  });
});

describe("prepareForPdf — undecodable input", () => {
  it("rejects garbage bytes with a message naming the file", async () => {
    const noise = new Uint8Array(256);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 197 + 13) & 0xff;
    const file = new File([noise], "broken.webp", { type: "image/webp" });

    await expect(prepareForPdf(file)).rejects.toThrow(/Could not read broken\.webp/);
  });

  it("rejects a TIFF that is only a magic number", async () => {
    const file = new File([TIFF_LE], "corrupt.tiff", { type: "image/tiff" });
    await expect(prepareForPdf(file)).rejects.toThrow(/Could not read corrupt\.tiff/);
  });
});

describe("re-encode policy constants", () => {
  it("encodes opaque pages at the quality the page copy states", () => {
    // tools.ts / faqs.ts say "JPEG at quality 0.92" — this pin keeps the
    // copy honest if the encoder setting ever drifts.
    expect(PDF_JPEG_QUALITY).toBe(0.92);
  });
});
