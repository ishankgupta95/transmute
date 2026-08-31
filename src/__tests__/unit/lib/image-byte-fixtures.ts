/**
 * Hand-built animated-image byte vectors, assembled from the file-format
 * specs rather than from encoders — the frame sniffer walks container
 * structure only, so the "pixel" payloads here are deliberately meaningless
 * bytes with correct framing.
 *
 * Shared by the image-frames sniffer suite AND the compress/resize/convert
 * fallback suites: the same vectors that prove the sniffer works also prove
 * the fallback wiring actually calls it on raw bytes.
 */

// ── GIF construction ─────────────────────────────────────────────

export function u16le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}

/** 3 × 2^(bits+1) filler bytes — the size a GIF color table declares. */
function colorTable(sizeBits: number, fill: number): number[] {
  return new Array(3 * 2 ** (sizeBits + 1)).fill(fill);
}

export interface GifOptions {
  /** Prefix each frame with a graphic control extension. */
  gce?: boolean;
  /** Declare a global color table in the LSD packed byte (0x80 | bits). */
  globalTableSizeBits?: number | null;
  /** Give every image descriptor a local color table (0x80 | bits). */
  localTableSizeBits?: number | null;
}

/** GCE (delay ext) + image descriptor + stub LZW data for one frame. */
export function gifFrame(withGce: boolean, localTableSizeBits: number | null = null): number[] {
  const packed = localTableSizeBits === null ? 0x00 : 0x80 | localTableSizeBits;
  return [
    // Graphic control extension: introducer, label, block size 4, flags,
    // delay 20cs, transparent index, terminator.
    ...(withGce ? [0x21, 0xf9, 0x04, 0x00, ...u16le(20), 0x00, 0x00] : []),
    // Image descriptor: separator, x, y, w=1, h=1, packed.
    0x2c, ...u16le(0), ...u16le(0), ...u16le(1), ...u16le(1), packed,
    ...(localTableSizeBits === null ? [] : colorTable(localTableSizeBits, 0xaa)),
    // LZW minimum code size + one 2-byte data sub-block + terminator.
    0x02, 0x02, 0x4c, 0x01, 0x00,
  ];
}

export function gifBytes(
  frames: number,
  { gce = true, globalTableSizeBits = null, localTableSizeBits = null }: GifOptions = {},
): Uint8Array<ArrayBuffer> {
  const packed = globalTableSizeBits === null ? 0x00 : 0x80 | globalTableSizeBits;
  const bytes: number[] = [
    // "GIF89a" + logical screen descriptor (1×1), packed byte at offset 10.
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    ...u16le(1), ...u16le(1), packed, 0x00, 0x00,
    ...(globalTableSizeBits === null ? [] : colorTable(globalTableSizeBits, 0x55)),
  ];
  for (let i = 0; i < frames; i++) bytes.push(...gifFrame(gce, localTableSizeBits));
  bytes.push(0x3b); // trailer
  return new Uint8Array(bytes);
}

// ── WebP construction ────────────────────────────────────────────

export function fourcc(tag: string): number[] {
  return [...tag].map((c) => c.charCodeAt(0));
}

export function u32le(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
}

export function webpBytes(chunks: { tag: string; payload: number[] }[]): Uint8Array<ArrayBuffer> {
  const body: number[] = fourcc("WEBP");
  for (const { tag, payload } of chunks) {
    body.push(...fourcc(tag), ...u32le(payload.length), ...payload);
    if (payload.length % 2 === 1) body.push(0);
  }
  return new Uint8Array([...fourcc("RIFF"), ...u32le(body.length), ...body]);
}

/** VP8X payload: flags byte, 3 reserved, 24-bit w-1 / h-1. */
export function vp8x(flags: number): number[] {
  return [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/** A WebP container declaring animation via the VP8X flag — sniffably animated. */
export function animatedWebpBytes(): Uint8Array<ArrayBuffer> {
  return webpBytes([
    { tag: "VP8X", payload: vp8x(0x02) },
    { tag: "ANIM", payload: [0, 0, 0, 0, 0, 0] },
    { tag: "ANMF", payload: new Array(16).fill(0) },
    { tag: "ANMF", payload: new Array(16).fill(0) },
  ]);
}
