import { expect } from "@playwright/test";
import type { Buffer } from "node:buffer";

/**
 * Container-level validators for conversion output.
 *
 * These parse structure rather than sniffing the first four bytes: a truncated
 * or half-muxed file usually keeps a valid magic number, which is exactly the
 * failure mode a "did a button appear" test misses.
 */

// ────────────────────────────────────────────────────────────────────────────
// ISO-BMFF (MP4 / M4A)
// ────────────────────────────────────────────────────────────────────────────

interface Mp4Info {
  boxes: Set<string>;
  /** `stsz` sample counts, one per track. */
  sampleCounts: number[];
}

/** Walk the box tree, descending into containers and sample entries. */
export function parseMp4(buf: Buffer): Mp4Info {
  const boxes = new Set<string>();
  const sampleCounts: number[] = [];
  const CONTAINERS = ["moov", "trak", "mdia", "minf", "stbl", "dinf", "udta", "edts", "moof", "traf"];

  const walk = (start: number, end: number, depth: number) => {
    if (depth > 12) return;
    let o = start;
    while (o + 8 <= end) {
      let size = buf.readUInt32BE(o);
      const type = buf.toString("latin1", o + 4, o + 8);
      let header = 8;
      if (size === 1) {
        if (o + 16 > end) break;
        size = Number(buf.readBigUInt64BE(o + 8));
        header = 16;
      }
      if (size === 0) size = end - o;
      if (size < header || o + size > end) break;
      boxes.add(type);
      if (type === "stsz" && o + header + 12 <= end) {
        sampleCounts.push(buf.readUInt32BE(o + header + 8));
      }
      if (CONTAINERS.includes(type)) walk(o + header, o + size, depth + 1);
      // `stsd` is a full box with a 4-byte version/flags + 4-byte entry count.
      if (type === "stsd") walk(o + header + 8, o + size, depth + 1);
      // Sample entries carry a fixed header before their child config boxes.
      if (type === "avc1" || type === "hvc1") walk(o + header + 78, o + size, depth + 1);
      if (type === "mp4a") walk(o + header + 28, o + size, depth + 1);
      o += size;
    }
  };
  walk(0, buf.length, 0);
  return { boxes, sampleCounts };
}

export function assertMp4(
  buf: Buffer,
  opts: { video?: boolean; audio?: boolean } = { video: true },
): Mp4Info {
  expect(buf.length, "MP4 should not be empty").toBeGreaterThan(1024);
  expect(buf.toString("latin1", 4, 8), "MP4 must start with an ftyp box").toBe("ftyp");
  const info = parseMp4(buf);
  expect([...info.boxes], "MP4 must carry a moov box (unfinalized mux otherwise)")
    .toContain("moov");
  expect([...info.boxes]).toContain("mdat");
  if (opts.video) {
    expect([...info.boxes], "MP4 should carry an H.264 track").toContain("avc1");
    expect([...info.boxes], "H.264 track needs its avcC decoder config").toContain("avcC");
  }
  if (opts.audio) {
    expect([...info.boxes], "MP4 should carry an AAC track").toContain("mp4a");
  }
  expect(info.sampleCounts.length, "MP4 must declare at least one track").toBeGreaterThan(0);
  for (const count of info.sampleCounts) {
    expect(count, "every track must contain samples").toBeGreaterThan(0);
  }
  return info;
}

// ────────────────────────────────────────────────────────────────────────────
// MP3
// ────────────────────────────────────────────────────────────────────────────

export function assertMp3(buf: Buffer): {
  frames: number;
  stereo: boolean;
  /**
   * The rate DECLARED in the MPEG frame header — deliberately not the rate a
   * browser reports after decoding, which is always the AudioContext's rate
   * and therefore tells you nothing about the file. Reading the header is the
   * only way to see what the encoder was actually configured with.
   */
  sampleRate: number;
} {
  expect(buf.length, "MP3 should not be empty").toBeGreaterThan(512);

  let o = 0;
  if (buf.toString("latin1", 0, 3) === "ID3") {
    // Syncsafe 28-bit size, excluding the 10-byte header.
    o = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
  }
  expect(buf[o], "MP3 frame sync byte").toBe(0xff);
  expect(buf[o + 1] & 0xe0, "MP3 frame sync bits").toBe(0xe0);

  const layer = (buf[o + 1] >> 1) & 0x03;
  expect(layer, "expected Layer III").toBe(1);
  const stereo = ((buf[o + 3] >> 6) & 0x03) !== 3;

  // Version-aware rate table: MPEG1 / MPEG2 / MPEG2.5 each have their own.
  const VERSION_RATES: Record<number, number[]> = {
    3: [44100, 48000, 32000], // MPEG1
    2: [22050, 24000, 16000], // MPEG2
    0: [11025, 12000, 8000], // MPEG2.5
  };
  const version = (buf[o + 1] >> 3) & 0x03;
  const rateIdx = (buf[o + 2] >> 2) & 0x03;
  const sampleRate = VERSION_RATES[version]?.[rateIdx] ?? 0;
  expect(sampleRate, "MP3 header must declare a legal sample rate").toBeGreaterThan(0);

  // Walk frames to prove the stream is more than one lucky header.
  const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const RATES = [44100, 48000, 32000, 0];
  let frames = 0;
  while (o + 4 <= buf.length && frames < 10_000) {
    if (buf[o] !== 0xff || (buf[o + 1] & 0xe0) !== 0xe0) break;
    const bitrate = BITRATES[(buf[o + 2] >> 4) & 0x0f];
    const rate = RATES[(buf[o + 2] >> 2) & 0x03];
    if (!bitrate || !rate) break;
    const padding = (buf[o + 2] >> 1) & 0x01;
    const len = Math.floor((144 * bitrate * 1000) / rate) + padding;
    if (len <= 4) break;
    o += len;
    frames++;
  }
  expect(frames, "MP3 should contain a run of decodable frames").toBeGreaterThan(10);
  return { frames, stereo, sampleRate };
}

// ────────────────────────────────────────────────────────────────────────────
// WAV
// ────────────────────────────────────────────────────────────────────────────

export function assertWav(buf: Buffer): {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  peak: number;
} {
  expect(buf.length).toBeGreaterThan(44);
  expect(buf.toString("latin1", 0, 4)).toBe("RIFF");
  expect(buf.toString("latin1", 8, 12)).toBe("WAVE");
  // RIFF size field must agree with the real length (catches truncation).
  expect(buf.readUInt32LE(4), "RIFF size should match payload length").toBe(buf.length - 8);

  // Walk chunks rather than assuming `fmt ` sits at 12 — encoders insert LIST.
  let o = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  let dataStart = -1;
  let dataLen = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString("latin1", o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    if (id === "fmt ") {
      fmt = {
        channels: buf.readUInt16LE(o + 10),
        sampleRate: buf.readUInt32LE(o + 12),
        bits: buf.readUInt16LE(o + 22),
      };
    } else if (id === "data") {
      dataStart = o + 8;
      dataLen = size;
    }
    o += 8 + size + (size % 2);
  }
  expect(fmt, "WAV must declare a fmt chunk").not.toBeNull();
  expect(dataStart, "WAV must declare a data chunk").toBeGreaterThan(0);
  expect(dataLen, "WAV data chunk must be non-empty").toBeGreaterThan(0);

  let peak = 0;
  if (fmt!.bits === 16) {
    const end = Math.min(dataStart + dataLen, buf.length - 1);
    for (let i = dataStart; i + 1 < end; i += 2) {
      peak = Math.max(peak, Math.abs(buf.readInt16LE(i)) / 32768);
    }
  }
  return {
    channels: fmt!.channels,
    sampleRate: fmt!.sampleRate,
    bitsPerSample: fmt!.bits,
    peak,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// GIF
// ────────────────────────────────────────────────────────────────────────────

export function assertGif(buf: Buffer): {
  width: number;
  height: number;
  frames: number;
  durationMs: number;
  /**
   * Per-frame delays in ms, in file order. Exposed because the total alone
   * cannot tell a real capture from the constant-delay bug: at 10 fps both
   * land near 1000 ms. Only the spread distinguishes them.
   */
  delaysMs: number[];
} {
  expect(buf.length).toBeGreaterThan(64);
  const sig = buf.toString("latin1", 0, 6);
  expect(["GIF87a", "GIF89a"], "GIF signature").toContain(sig);
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);

  /*
    A REAL block walk. The old version counted every 0x2C byte in the file —
    LZW pixel data is full of them, so "frames" was off by orders of
    magnitude and only survived because callers asserted `> 1`.
  */
  const packed = buf[10];
  let o = 13; // header(6) + logical screen descriptor(7)
  if (packed & 0x80) o += 3 * 2 ** ((packed & 0x07) + 1); // global color table

  const skipSubBlocks = () => {
    while (o < buf.length && buf[o] !== 0) o += 1 + buf[o];
    o++; // block terminator
  };

  let frames = 0;
  let durationMs = 0;
  const delaysMs: number[] = [];
  while (o < buf.length) {
    const b = buf[o];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      // Extension: label, then sub-blocks. GCE carries the frame delay.
      const label = buf[o + 1];
      if (label === 0xf9 && buf[o + 2] === 4) {
        const delay = buf.readUInt16LE(o + 4) * 10;
        durationMs += delay;
        delaysMs.push(delay);
      }
      o += 2;
      skipSubBlocks();
    } else if (b === 0x2c) {
      frames++;
      const localPacked = buf[o + 9];
      o += 10; // image descriptor
      if (localPacked & 0x80) o += 3 * 2 ** ((localPacked & 0x07) + 1); // local color table
      o += 1; // LZW minimum code size
      skipSubBlocks();
    } else {
      throw new Error(`Unexpected GIF block 0x${b.toString(16)} at offset ${o}`);
    }
  }

  expect(frames, "GIF should contain at least one frame").toBeGreaterThan(0);
  expect(buf[buf.length - 1], "GIF must end with its trailer byte").toBe(0x3b);
  return { width, height, frames, durationMs, delaysMs };
}

// ────────────────────────────────────────────────────────────────────────────
// PDF
// ────────────────────────────────────────────────────────────────────────────

export async function assertPdf(
  buf: Buffer,
  opts: { pages?: number } = {},
): Promise<{
  pages: number;
  sizes: { width: number; height: number }[];
  rotations: number[];
  text: string;
}> {
  expect(buf.length).toBeGreaterThan(256);
  expect(buf.toString("latin1", 0, 5), "PDF header").toBe("%PDF-");
  expect(buf.toString("latin1", Math.max(0, buf.length - 2048)), "PDF must be terminated")
    .toContain("%%EOF");

  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(new Uint8Array(buf), { ignoreEncryption: true });
  const pages = doc.getPageCount();
  expect(pages, "PDF must contain pages").toBeGreaterThan(0);
  if (opts.pages !== undefined) {
    expect(pages, `expected ${opts.pages} page(s)`).toBe(opts.pages);
  }
  const sizes = doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() }));
  const rotations = doc.getPages().map((p) => p.getRotation().angle);
  // Raw latin1 of the file is enough to spot uncompressed literal strings such
  // as the page numbers stamped by add-page-numbers.
  return { pages, sizes, rotations, text: buf.toString("latin1") };
}

// ────────────────────────────────────────────────────────────────────────────
// Images
// ────────────────────────────────────────────────────────────────────────────

export function assertJpeg(buf: Buffer): void {
  expect(buf.length).toBeGreaterThan(128);
  expect(buf.readUInt16BE(0), "JPEG SOI marker").toBe(0xffd8);
  expect(buf.readUInt16BE(buf.length - 2), "JPEG EOI marker").toBe(0xffd9);
}

export function assertPng(buf: Buffer): { width: number; height: number } {
  expect(buf.length).toBeGreaterThan(64);
  expect(buf.subarray(0, 8).toString("hex"), "PNG signature").toBe("89504e470d0a1a0a");
  expect(buf.toString("latin1", 12, 16), "first chunk must be IHDR").toBe("IHDR");
  expect(buf.subarray(buf.length - 8).toString("latin1")).toContain("IEND");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function assertWebp(buf: Buffer): void {
  expect(buf.toString("latin1", 0, 4)).toBe("RIFF");
  expect(buf.toString("latin1", 8, 12)).toBe("WEBP");
}

/** True when the JPEG carries an APP1 `Exif\0\0` segment. */
export function hasExifSegment(buf: Buffer): boolean {
  let o = 2;
  while (o + 4 <= buf.length && buf[o] === 0xff) {
    const marker = buf.readUInt16BE(o);
    if (marker === 0xffda) break; // start of scan — metadata is behind us
    const len = buf.readUInt16BE(o + 2);
    if (marker === 0xffe1 && buf.toString("latin1", o + 4, o + 10) === "Exif\0\0") return true;
    o += 2 + len;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// ZIP
// ────────────────────────────────────────────────────────────────────────────

export async function assertZip(
  buf: Buffer,
  opts: { minEntries?: number } = {},
): Promise<string[]> {
  expect(buf.toString("latin1", 0, 2), "ZIP local file header").toBe("PK");
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  expect(names.length, "ZIP should contain files").toBeGreaterThanOrEqual(
    opts.minEntries ?? 1,
  );
  // A ZIP of empty files would still parse — check the payloads too.
  for (const name of names) {
    const content = await zip.files[name].async("uint8array");
    expect(content.length, `ZIP entry ${name} should not be empty`).toBeGreaterThan(0);
  }
  return names;
}
