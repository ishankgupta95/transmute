import { describe, it, expect } from "vitest";
import {
  ANIMATED_GIF_WARNING,
  ANIMATED_WEBP_WARNING,
  countGifFrames,
  fileFirstFrameWarning,
  firstFrameWarning,
  isAnimatedWebp,
  tiffPageWarning,
} from "@/lib/tools/image-frames";
// Byte vectors live in image-byte-fixtures.ts so the compress/resize/convert
// fallback suites can feed the very same animated bytes through their wiring.
import { fourcc, gifBytes, u32le, vp8x, webpBytes } from "./image-byte-fixtures";

// ── the tests ────────────────────────────────────────────────────

describe("firstFrameWarning — GIF", () => {
  it("warns for a two-frame GIF with graphic-control extensions", () => {
    expect(firstFrameWarning(gifBytes(2))).toBe(ANIMATED_GIF_WARNING);
  });

  it("stays quiet for a single-frame GIF, with or without a GCE", () => {
    expect(firstFrameWarning(gifBytes(1))).toBeNull();
    expect(firstFrameWarning(gifBytes(1, { gce: false }))).toBeNull();
  });

  it("counts descriptors with an early exit at the limit", () => {
    expect(countGifFrames(gifBytes(1))).toBe(1);
    expect(countGifFrames(gifBytes(5))).toBe(2); // default limit 2
    expect(countGifFrames(gifBytes(5), 10)).toBe(5);
  });

  it("treats a truncated GIF as still rather than throwing", () => {
    const truncated = gifBytes(2).slice(0, 16);
    expect(firstFrameWarning(truncated)).toBeNull();
  });

  it("stops at an unknown block instead of misparsing pixel data", () => {
    const bytes = gifBytes(1);
    // Overwrite the trailer with a byte that is no valid block introducer.
    bytes[bytes.length - 1] = 0x99;
    expect(firstFrameWarning(bytes)).toBeNull();
  });

  it("skips local color tables to find the second frame", () => {
    // Every descriptor declares a local table (packed 0x80|1 → 12 table
    // bytes). Miscounting that skip would land the parser inside the table
    // and lose the second descriptor — a real animation would go unwarned.
    const bytes = gifBytes(2, { localTableSizeBits: 1 });
    expect(countGifFrames(bytes)).toBe(2);
    expect(firstFrameWarning(bytes)).toBe(ANIMATED_GIF_WARNING);
  });

  it("skips the global color table to find the frames at all", () => {
    // LSD packed 0x80|2 → 24 table bytes between the header and frame 0.
    const bytes = gifBytes(2, { globalTableSizeBits: 2 });
    expect(countGifFrames(bytes)).toBe(2);
    expect(firstFrameWarning(bytes)).toBe(ANIMATED_GIF_WARNING);

    // And a single-frame GIF with the same table stays still.
    expect(firstFrameWarning(gifBytes(1, { globalTableSizeBits: 2 }))).toBeNull();
  });
});

describe("fileFirstFrameWarning — byte-based File sniff", () => {
  it("warns from magic bytes even when the name and MIME lie", async () => {
    // The fallback pipeline must match the worker: bytes decide, not the
    // extension. An animated GIF renamed photo.png still loses its frames.
    const renamed = new File([gifBytes(2)], "photo.png", { type: "image/png" });
    await expect(fileFirstFrameWarning(renamed)).resolves.toBe(ANIMATED_GIF_WARNING);
  });

  it("stays quiet for non-GIF/WebP bytes regardless of a .gif name", async () => {
    const noise = new Uint8Array(64).fill(0x7f);
    const impostor = new File([noise], "meme.gif", { type: "image/gif" });
    await expect(fileFirstFrameWarning(impostor)).resolves.toBeNull();
  });

  it("handles files shorter than the sniffed prefix", async () => {
    await expect(
      fileFirstFrameWarning(new File([new Uint8Array([0x47])], "g.gif")),
    ).resolves.toBeNull();
    await expect(fileFirstFrameWarning(new File([], "empty.webp"))).resolves.toBeNull();
  });
});

describe("firstFrameWarning — WebP", () => {
  it("warns when the VP8X animation flag is set", () => {
    const animated = webpBytes([{ tag: "VP8X", payload: vp8x(0x02) }]);
    expect(firstFrameWarning(animated)).toBe(ANIMATED_WEBP_WARNING);
  });

  it("stays quiet when the VP8X flags carry no animation bit", () => {
    // 0x04 = XMP flag — extended format, but still a still.
    const still = webpBytes([
      { tag: "VP8X", payload: vp8x(0x04) },
      { tag: "VP8L", payload: [0x2f, 0x00, 0x00, 0x00, 0x00] },
    ]);
    expect(firstFrameWarning(still)).toBeNull();
  });

  it("warns on ANIM/ANMF chunks even without a VP8X flag", () => {
    const anim = webpBytes([
      { tag: "ANIM", payload: [0, 0, 0, 0, 0, 0] },
      { tag: "ANMF", payload: new Array(16).fill(0) },
    ]);
    expect(firstFrameWarning(anim)).toBe(ANIMATED_WEBP_WARNING);
    expect(isAnimatedWebp(anim)).toBe(true);
  });

  it("stays quiet for a plain still VP8L file", () => {
    const still = webpBytes([{ tag: "VP8L", payload: [0x2f, 0x00, 0x00, 0x00, 0x00] }]);
    expect(firstFrameWarning(still)).toBeNull();
  });

  it("survives a corrupt chunk size without looping or throwing", () => {
    const corrupt = webpBytes([{ tag: "VP8X", payload: vp8x(0x00) }]);
    // Blow the declared VP8X size out past the file end.
    corrupt.set([0xff, 0xff, 0xff, 0xff], 16);
    expect(firstFrameWarning(corrupt)).toBeNull();
  });
});

describe("firstFrameWarning — non-image input", () => {
  it("returns null for garbage, empty, and too-short buffers", () => {
    expect(firstFrameWarning(new Uint8Array(0))).toBeNull();
    expect(firstFrameWarning(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    const noise = new Uint8Array(512);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 197 + 13) & 0xff;
    expect(firstFrameWarning(noise)).toBeNull();
  });

  it("returns null for a RIFF that is not WebP (e.g. WAV)", () => {
    const wav = new Uint8Array([
      ...fourcc("RIFF"), ...u32le(4), ...fourcc("WAVE"),
    ]);
    expect(firstFrameWarning(wav)).toBeNull();
  });
});

describe("tiffPageWarning", () => {
  it("is null for single-page and nonsense counts", () => {
    expect(tiffPageWarning(1)).toBeNull();
    expect(tiffPageWarning(0)).toBeNull();
    expect(tiffPageWarning(NaN)).toBeNull();
  });

  it("names the real page count", () => {
    expect(tiffPageWarning(3)).toBe("This TIFF has 3 pages — only the first page was kept.");
  });
});
