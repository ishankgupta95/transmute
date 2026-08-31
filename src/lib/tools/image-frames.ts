/**
 * Multi-frame / multi-page sniffers behind the "only the first frame was kept"
 * warnings. Every canvas pipeline in this app decodes exactly one raster —
 * `createImageBitmap` and `<img>` both hand back frame 0 of an animated
 * GIF/WebP, and the TIFF pre-decode reads page 0 — so the sniff is what turns
 * that silent loss into an honest notice.
 *
 * LEAF MODULE — no runtime imports. The image worker bundles this file, and a
 * worker entrypoint whose import chain reaches back to a module that names the
 * worker's own URL hangs the production build.
 */

export const ANIMATED_GIF_WARNING = "This GIF is animated — only its first frame was kept.";
export const ANIMATED_WEBP_WARNING = "This WebP is animated — only its first frame was kept.";

/** The TIFF counterpart, built where the page count is known (utif2 decode). */
export function tiffPageWarning(pageCount: number): string | null {
  if (!Number.isFinite(pageCount) || pageCount <= 1) return null;
  return `This TIFF has ${pageCount} pages — only the first page was kept.`;
}

/**
 * Warning for encoded image bytes that carry more frames than the pipeline
 * keeps, or null for still images. Magic numbers decide the format — the
 * caller's MIME/extension can lie. Malformed input is reported as "still":
 * a truncated animation should fail (or not) in the decoder, not here.
 */
export function firstFrameWarning(bytes: Uint8Array): string | null {
  if (isAnimatedWebp(bytes)) return ANIMATED_WEBP_WARNING;
  if (countGifFrames(bytes, 2) >= 2) return ANIMATED_GIF_WARNING;
  return null;
}

/**
 * Fallback-pipeline helper: sniff a File's first 16 bytes for the GIF and
 * RIFF/WEBP magics, and only when one matches pull the full buffer for the
 * real frame walk. Magic bytes decide, exactly as in the worker pipeline —
 * the name/MIME can lie, and an animated GIF renamed photo.png must still
 * warn. A large still JPEG is never read past its prefix.
 */
export async function fileFirstFrameWarning(file: File): Promise<string | null> {
  const prefix = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const gif = tagAt(prefix, 0, "GIF87a") || tagAt(prefix, 0, "GIF89a");
  const webp = tagAt(prefix, 0, "RIFF") && tagAt(prefix, 8, "WEBP");
  if (!gif && !webp) return null;
  return firstFrameWarning(new Uint8Array(await file.arrayBuffer()));
}

/** Guarded little-endian u32 — returns null instead of reading past the end. */
function u32le(b: Uint8Array, off: number): number | null {
  if (off < 0 || off + 4 > b.length) return null;
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

function tagAt(b: Uint8Array, off: number, tag: string): boolean {
  for (let i = 0; i < tag.length; i++) {
    if (b[off + i] !== tag.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * True when the bytes are a WebP whose container declares animation: a VP8X
 * chunk with the animation flag (0x02), or an ANIM/ANMF chunk. RIFF chunk
 * walk, sizes padded to even, every step bounds-checked.
 */
export function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (!tagAt(bytes, 0, "RIFF") || !tagAt(bytes, 8, "WEBP")) return false;

  let off = 12;
  while (off + 8 <= bytes.length) {
    const size = u32le(bytes, off + 4);
    if (size === null) return false;
    if (tagAt(bytes, off, "VP8X")) {
      // First payload byte is the feature flags; bit 0x02 = animation.
      if (off + 8 < bytes.length && (bytes[off + 8] & 0x02) !== 0) return true;
    }
    if (tagAt(bytes, off, "ANIM") || tagAt(bytes, off, "ANMF")) return true;
    const next = off + 8 + size + (size & 1);
    if (next <= off) return false; // corrupt size — refuse to loop forever
    off = next;
  }
  return false;
}

/**
 * Count GIF image descriptors, stopping at `limit` — the caller only needs to
 * know "more than one", not the exact frame count of a 500-frame meme.
 * Returns 0 for non-GIF or malformed input.
 */
export function countGifFrames(bytes: Uint8Array, limit = 2): number {
  if (bytes.length < 14) return 0;
  if (!tagAt(bytes, 0, "GIF87a") && !tagAt(bytes, 0, "GIF89a")) return 0;

  // Logical screen descriptor: 7 bytes after the 6-byte header. Its packed
  // byte declares the optional global color table (3 × 2^(N+1) bytes).
  const packed = bytes[10];
  let off = 13;
  if (packed & 0x80) off += 3 * 2 ** ((packed & 0x07) + 1);

  // Length-prefixed sub-block chain ends at a 0x00 terminator.
  const skipSubBlocks = (): boolean => {
    while (off < bytes.length && bytes[off] !== 0) off += 1 + bytes[off];
    if (off >= bytes.length) return false;
    off++; // terminator
    return true;
  };

  let frames = 0;
  while (off < bytes.length) {
    const b = bytes[off];
    if (b === 0x3b) break; // trailer
    if (b === 0x21) {
      // Extension: label byte, then sub-blocks (a GCE is just one of these).
      off += 2;
      if (!skipSubBlocks()) return frames;
    } else if (b === 0x2c) {
      frames++;
      if (frames >= limit) return frames;
      const localPacked = bytes[off + 9];
      off += 10; // image descriptor
      if (localPacked & 0x80) off += 3 * 2 ** ((localPacked & 0x07) + 1);
      off += 1; // LZW minimum code size
      if (!skipSubBlocks()) return frames;
    } else {
      return frames; // unknown block — stop rather than misparse pixel data
    }
  }
  return frames;
}
