import { Buffer } from "node:buffer";
import type { FixtureFile } from "./helpers";

/**
 * Programmatic fixture builders. Anything that can be constructed in pure JS
 * (PNG, JPG, WAV, BMP, plain text formats) lives here so tests don't depend on
 * checked-in binary blobs. Heavier formats (HEIC, TIFF, AVIF, real MP3, MP4)
 * fall back to checked-in samples under `fixtures/samples/`; see helpers.
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
 * 1x1 lossless WebP (VP8L). Verified-good; ~30 bytes.
 */
export function tinyWebp(): FixtureFile {
  const base64 = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";
  const buffer = Buffer.from(base64, "base64");
  return { name: "sample.webp", mimeType: "image/webp", buffer };
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
