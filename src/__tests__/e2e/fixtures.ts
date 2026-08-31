import { Buffer } from "node:buffer";
import type { FixtureFile } from "./helpers";

/**
 * Programmatic fixture builders. Anything that can be constructed in pure JS
 * (PNG, JPG, WAV, BMP, TIFF, plain text formats) lives here so tests don't
 * depend on checked-in binary blobs. Heavier formats (HEIC, AVIF, real MP3,
 * MP4) fall back to checked-in samples under `fixtures/samples/`; see helpers.
 *
 * TIFF used to be in that second list. It isn't: `utif2` is already a
 * dependency and ships an encoder, so a real TIFF costs nothing to build and
 * `tiff-to-jpg` gets a genuine conversion test instead of a page smoke.
 */

// ────────────────────────────────────────────────────────────────────────────
// Images
// ────────────────────────────────────────────────────────────────────────────

/**
 * Generate a minimal valid PNG of `size`x`size` pixels filled with a single
 * RGB color. Uses uncompressed IDAT (zlib level 0 with stored blocks) so the
 * generator stays dependency-free.
 */
export function tinyPng(size = 8, rgb: [number, number, number] = [86, 184, 230]): FixtureFile {
  const bytes = buildPng(size, size, rgb);
  return { name: `sample-${size}x${size}.png`, mimeType: "image/png", buffer: bytes };
}

/**
 * Non-square PNG variant. Required for tests where the aspect-ratio math
 * actually has to mean something — a square input makes width-locking a
 * tautology.
 */
export function tinyRectPng(
  width: number,
  height: number,
  rgb: [number, number, number] = [86, 184, 230],
): FixtureFile {
  const bytes = buildPng(width, height, rgb);
  return {
    name: `sample-${width}x${height}.png`,
    mimeType: "image/png",
    buffer: bytes,
  };
}

/**
 * Two-tone PNG: the left half is `left`, the right half is `right`. Used by
 * the color-palette extractor test so we can assert the palette captures more
 * than one bucket.
 */
export function twoColorPng(
  width = 32,
  height = 32,
  left: [number, number, number] = [220, 30, 40],
  right: [number, number, number] = [30, 60, 200],
): FixtureFile {
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * stride + 1 + x * 3;
      const c = x < width / 2 ? left : right;
      raw[o] = c[0];
      raw[o + 1] = c[1];
      raw[o + 2] = c[2];
    }
  }
  const bytes = wrapPng(width, height, raw);
  return {
    name: `sample-2color-${width}x${height}.png`,
    mimeType: "image/png",
    buffer: bytes,
  };
}

/**
 * 1x1 baseline JPEG (verified-good) — accepted by every browser decoder.
 * Source: smallest-valid-image testing lore (the same blob used widely as a
 * 1px tracking GIF's JPEG cousin).
 */
export function tinyJpg(): FixtureFile {
  const base64 =
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB" +
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEB" +
    "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB" +
    "AQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEA" +
    "AAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh" +
    "MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6" +
    "Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZ" +
    "mqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx" +
    "8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA" +
    "AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAV" +
    "YnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hp" +
    "anN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE" +
    "xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3" +
    "+iiigAooooAKKKKAP//Z";
  const buffer = Buffer.from(base64, "base64");
  return { name: "sample.jpg", mimeType: "image/jpeg", buffer };
}

/**
 * 1x1 still WebP (a bare "VP8 " lossy chunk). Verified-good; 42 bytes.
 */
export function tinyWebp(): FixtureFile {
  const base64 = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
  const buffer = Buffer.from(base64, "base64");
  return { name: "sample.webp", mimeType: "image/webp", buffer };
}

/** One RIFF chunk: FourCC + LE size + payload, padded to even length. */
function riffChunk(fourcc: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, "latin1");
  head.writeUInt32LE(payload.length, 4);
  const pad = payload.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([head, payload, pad]);
}

/** WebP's 24-bit little-endian field. */
function u24le(value: number): Buffer {
  return Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
}

/**
 * A genuinely animated 1x1 WebP, hand-rolled per the container spec: VP8X
 * with the animation flag, ANIM, and two ANMF frames each embedding the same
 * known-good "VP8 " bitstream `tinyWebp()` ships. Hand-rolled because nothing
 * in Node encodes animated WebP — and the demuxer only reads the container,
 * which is exactly the layer the frame-0 warning sniffs.
 */
export function animatedWebp(): FixtureFile {
  const still = tinyWebp().buffer.subarray(12); // the full "VP8 " chunk
  const w = 1;
  const h = 1;

  const vp8x = Buffer.concat([
    Buffer.from([0x02, 0, 0, 0]), // feature flags: animation; 3 reserved bytes
    u24le(w - 1),
    u24le(h - 1),
  ]);
  const anim = Buffer.concat([
    Buffer.from([0, 0, 0, 0]), // background colour (BGRA)
    Buffer.from([0, 0]), // loop count: infinite
  ]);
  const anmf = Buffer.concat([
    u24le(0), // frame x / 2
    u24le(0), // frame y / 2
    u24le(w - 1),
    u24le(h - 1),
    u24le(120), // duration ms
    Buffer.from([0]), // blending/disposal flags
    still,
  ]);

  const body = Buffer.concat([
    Buffer.from("WEBP", "latin1"),
    riffChunk("VP8X", vp8x),
    riffChunk("ANIM", anim),
    riffChunk("ANMF", anmf),
    riffChunk("ANMF", anmf),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return {
    name: "sample-animated.webp",
    mimeType: "image/webp",
    buffer: Buffer.concat([riff, body]),
  };
}

/**
 * A real two-frame animated GIF, encoded with the same `gifenc` the video-to-
 * GIF tool ships. Distinct solid colours per frame and an explicit delay, so
 * a decoder that plays it shows an unmistakable flicker — and a converter
 * that keeps only frame 0 owes the user a warning.
 *
 * `opts.noise` swaps the solid fills for seeded per-pixel noise (opaque, and
 * deterministic via mulberry32). GIF's LZW cannot compress noise while a JPEG
 * re-encode still can, so a noisy 256×256 build is guaranteed to SHRINK under
 * compress-image's quality mode — exercising the re-encode warning path
 * instead of the never-grow original-return.
 */
export function animatedGif(
  width = 16,
  height = 16,
  opts: { noise?: boolean } = {},
): FixtureFile {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GIFEncoder, quantize, applyPalette } = require("gifenc") as typeof import("gifenc");
  const gif = GIFEncoder();
  const colors: [number, number, number][] = [
    [220, 40, 40],
    [40, 90, 220],
  ];
  colors.forEach((c, i) => {
    const rgba = new Uint8Array(width * height * 4);
    const rand = mulberry32(0x5eed + i);
    for (let p = 0; p < width * height; p++) {
      if (opts.noise) {
        rgba[p * 4] = Math.floor(rand() * 256);
        rgba[p * 4 + 1] = Math.floor(rand() * 256);
        rgba[p * 4 + 2] = Math.floor(rand() * 256);
      } else {
        rgba[p * 4] = c[0];
        rgba[p * 4 + 1] = c[1];
        rgba[p * 4 + 2] = c[2];
      }
      rgba[p * 4 + 3] = 255;
    }
    const palette = quantize(rgba, 256, { format: "rgb444" });
    const index = applyPalette(rgba, palette, "rgb444");
    gif.writeFrame(index, width, height, {
      palette,
      delay: 200,
      ...(i === 0 ? { first: true, repeat: 0 } : {}),
    });
  });
  gif.finish();
  return {
    name: opts.noise ? "sample-animated-noise.gif" : "sample-animated.gif",
    mimeType: "image/gif",
    buffer: Buffer.from(gif.bytes()),
  };
}

/** Tiny seeded PRNG — fixture builders must emit identical bytes every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a minimal BMP file. 4x4 24-bit, all blue.
 */
export function tinyBmp(): FixtureFile {
  const width = 4;
  const height = 4;
  const rowSize = Math.ceil((24 * width) / 32) * 4; // padded to 4 bytes
  const pixelArraySize = rowSize * height;
  const fileSize = 54 + pixelArraySize;
  const buf = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6); // reserved
  buf.writeUInt32LE(54, 10); // offset to pixel array

  // BITMAPINFOHEADER
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26); // color planes
  buf.writeUInt16LE(24, 28); // bits per pixel
  buf.writeUInt32LE(0, 30); // compression
  buf.writeUInt32LE(pixelArraySize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);

  // Pixel data (BGR), all blue
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = 54 + y * rowSize + x * 3;
      buf[offset] = 200; // B
      buf[offset + 1] = 100; // G
      buf[offset + 2] = 30; // R
    }
  }

  return { name: "sample.bmp", mimeType: "image/bmp", buffer: buf };
}

/**
 * Tiny SVG — perfectly valid, parses everywhere.
 */
/**
 * A real, decodable TIFF built with the same `utif2` the app decodes with.
 *
 * Deliberately non-square and two-toned: a square fixture makes an
 * aspect-ratio bug invisible, and a single flat colour makes "we decoded the
 * pixels" indistinguishable from "we emitted an empty canvas".
 */
export function tinyTiff(width = 40, height = 30): FixtureFile {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const UTIF = require("utif2") as typeof import("utif2");
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const left = x < width / 2;
      rgba[i] = left ? 210 : 40;
      rgba[i + 1] = left ? 60 : 90;
      rgba[i + 2] = left ? 40 : 200;
      rgba[i + 3] = 255;
    }
  }
  const encoded = UTIF.encodeImage(rgba, width, height);
  return {
    name: `sample-${width}x${height}.tiff`,
    mimeType: "image/tiff",
    buffer: Buffer.from(encoded),
  };
}

/**
 * A multi-page TIFF, pages in shrinking sizes and distinct colours — page 0
 * is 40×30, so a converter that reads the right page is byte-distinguishable
 * from one that grabbed a later IFD.
 *
 * `UTIF.encode` writes only the IFD directory, not pixel data, so the strips
 * are spliced in by hand: encode once with placeholder offsets to measure the
 * directory (strip offsets are fixed-width LONGs, so real values don't change
 * its size), then re-encode with offsets pointing past it and append each
 * page's raw RGBA at its offset. Round-trip through `UTIF.decode` is pinned
 * by the sanity test in frames.spec.ts.
 */
export function multiPageTiff(pages = 3): FixtureFile {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const UTIF = require("utif2") as typeof import("utif2");

  const dims = Array.from({ length: pages }, (_, i) => ({
    w: Math.max(8, 40 - i * 8),
    h: Math.max(6, 30 - i * 6),
  }));

  // Uncompressed 8-bit RGBA, one strip per page: PhotometricInterpretation 2
  // (RGB), 4 samples of 8 bits, RowsPerStrip = full height.
  const makeIfds = (offsets: number[]) =>
    dims.map(({ w, h }, i) => ({
      t256: [w],
      t257: [h],
      t258: [8, 8, 8, 8],
      t259: [1],
      t262: [2],
      t273: [offsets[i]],
      t277: [4],
      t278: [h],
      t279: [w * h * 4],
    })) as unknown as import("utif2").IFD[];

  const dirSize = UTIF.encode(makeIfds(dims.map(() => 0))).byteLength;
  const offsets: number[] = [];
  let cursor = dirSize;
  for (const { w, h } of dims) {
    offsets.push(cursor);
    cursor += w * h * 4;
  }

  const out = Buffer.alloc(cursor);
  out.set(new Uint8Array(UTIF.encode(makeIfds(offsets))), 0);
  const colors: [number, number, number][] = [
    [210, 60, 40],
    [40, 180, 90],
    [40, 90, 210],
  ];
  dims.forEach(({ w, h }, i) => {
    const c = colors[i % colors.length];
    const rgba = Buffer.alloc(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      rgba[p * 4] = c[0];
      rgba[p * 4 + 1] = c[1];
      rgba[p * 4 + 2] = c[2];
      rgba[p * 4 + 3] = 255;
    }
    out.set(rgba, offsets[i]);
  });

  return { name: `sample-${pages}page.tiff`, mimeType: "image/tiff", buffer: out };
}

export function tinySvg(): FixtureFile {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" fill="#56b8e6"/></svg>`;
  return { name: "sample.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg, "utf8") };
}

// ────────────────────────────────────────────────────────────────────────────
// PDFs (programmatic via pdf-lib)
// ────────────────────────────────────────────────────────────────────────────

export async function tinyPdf(pages = 1, name = "sample.pdf"): Promise<FixtureFile> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 300]);
    page.drawText(`Page ${i + 1}`, { x: 30, y: 250, size: 24, font });
  }
  const bytes = await doc.save();
  return { name, mimeType: "application/pdf", buffer: Buffer.from(bytes) };
}

// ────────────────────────────────────────────────────────────────────────────
// Audio
// ────────────────────────────────────────────────────────────────────────────

/**
 * Minimal valid WAV: 16-bit PCM, mono, 44100 Hz, `seconds` of silence.
 * 16-bit @ 44.1kHz is the universally-supported format for AudioContext
 * decoders — 8-bit PCM is rejected by some browser decoders, so even though
 * a smaller fixture would be cheaper to ship, the trade-off isn't worth the
 * decoder reliability cost.
 */
export function tinyWav(seconds = 0.5): FixtureFile {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * seconds);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const buf = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");

  // fmt subchunk (PCM)
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // channels = mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byteRate = sampleRate * blockAlign
  buf.writeUInt16LE(2, 32); // blockAlign = channels * bitsPerSample/8
  buf.writeUInt16LE(16, 34); // bitsPerSample

  // data subchunk
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  // 16-bit silence is zero — Buffer.alloc already gives us zeroed bytes.

  return { name: "sample.wav", mimeType: "audio/wav", buffer: buf };
}

// ────────────────────────────────────────────────────────────────────────────
// Plain-text formats
// ────────────────────────────────────────────────────────────────────────────

export const sampleJson: FixtureFile = {
  name: "sample.json",
  mimeType: "application/json",
  buffer: Buffer.from(
    JSON.stringify([{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }]),
    "utf8",
  ),
};

export const sampleCsv: FixtureFile = {
  name: "sample.csv",
  mimeType: "text/csv",
  buffer: Buffer.from("name,age,city\nAlice,30,NYC\nBob,25,LA\n", "utf8"),
};

// ────────────────────────────────────────────────────────────────────────────
// PNG generator — minimal, dependency-free, uncompressed IDAT
// ────────────────────────────────────────────────────────────────────────────

function buildPng(width: number, height: number, rgb: [number, number, number]): Buffer {
  // 8-bit RGB scanlines; each row prefixed with filter byte 0.
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter type none
    for (let x = 0; x < width; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = rgb[0];
      raw[o + 1] = rgb[1];
      raw[o + 2] = rgb[2];
    }
  }
  return wrapPng(width, height, raw);
}

function wrapPng(width: number, height: number, raw: Buffer): Buffer {
  // Wrap in zlib stored-blocks (no compression). Avoids depending on a
  // compressor while still being a valid PNG.
  const zlibData = zlibStored(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = pngChunk("IHDR", ihdr);
  const idatChunk = pngChunk("IDAT", zlibData);
  const iendChunk = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function zlibStored(data: Buffer): Buffer {
  // CMF byte: deflate, 32K window
  const cmf = 0x78;
  // FLG: no preset dict, default level. Adler base for FCHECK = 0x9c.
  const flg = 0x9c;

  // Stored blocks: at most 65535 bytes per block.
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < data.length) {
    const chunkSize = Math.min(65535, data.length - offset);
    const isLast = offset + chunkSize >= data.length;
    const header = Buffer.alloc(5);
    header[0] = isLast ? 0x01 : 0x00; // BFINAL bit + BTYPE=00 (stored)
    header.writeUInt16LE(chunkSize, 1);
    header.writeUInt16LE(~chunkSize & 0xffff, 3);
    chunks.push(header);
    chunks.push(data.subarray(offset, offset + chunkSize));
    offset += chunkSize;
  }

  const adlerBuf = Buffer.alloc(4);
  adlerBuf.writeUInt32BE(adler32(data), 0);
  return Buffer.concat([Buffer.from([cmf, flg]), ...chunks, adlerBuf]);
}

// CRC32 table cached on first use.
let crcTable: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Buffer): number {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
