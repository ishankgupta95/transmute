// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  computeHashesBuffered,
  computeHashesChunked,
  computeHashes,
  WEBCRYPTO_MAX_BYTES,
  type Hashes,
} from "@/lib/tools/hash-digest";

/*
 * ── THE OBJECTION THIS FILE EXISTS TO ANSWER ─────────────────────────────────
 *
 * hash-digest.ts used to argue for a single code path, in as many words: "a
 * fits-in-memory fast path and a streaming slow path would be two
 * implementations of the same digest that have to agree, and a checksum tool
 * that can disagree with itself is worse than a slow one."
 *
 * It now has both, because `crypto.subtle` is ~13x faster and declining that
 * to keep one path was the worse trade. The objection does not go away by
 * being outvoted, so it is discharged here instead: every case below runs BOTH
 * paths over the same bytes and compares them to each other AND to
 * `node:crypto`, a third independent implementation. A disagreement of any
 * kind — one digest, one size, one empty file — fails.
 *
 * The sizes are chosen around the block sizes the two families use (64 bytes
 * for MD5/SHA-1/SHA-256, 128 for SHA-512), because an implementation that only
 * ever sees block-aligned input is the one that works by accident.
 *
 * `@vitest-environment node` for `Blob.prototype.stream`, as in the streaming
 * suite beside this one.
 */

// `Uint8Array<ArrayBuffer>`, not the default `ArrayBufferLike`: `BlobPart`
// refuses a view that might sit on a SharedArrayBuffer, and these go into real
// Blobs rather than the fake one the streaming suite uses.
function payload(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  // Deterministic and not compressible into a pattern a hasher could flatter.
  for (let i = 0; i < n; i++) out[i] = (i * 31 + ((i >> 3) ^ 0xa5)) & 0xff;
  return out;
}

/** `node:crypto`, the third opinion. */
function reference(bytes: Uint8Array): Hashes {
  const of = (alg: string) => createHash(alg).update(bytes).digest("hex");
  return { md5: of("md5"), sha1: of("sha1"), sha256: of("sha256"), sha512: of("sha512") };
}

const SIZES: [string, number][] = [
  ["empty", 0],
  ["1 byte", 1],
  ["63 — one short of the MD5/SHA-1/SHA-256 block", 63],
  ["64 — exactly that block", 64],
  ["65 — one past it", 65],
  ["127 — one short of the SHA-512 block", 127],
  ["128 — exactly that block", 128],
  ["129 — one past it", 129],
  ["1000 — not a power of two", 1000],
  ["100003 — prime", 100_003],
];

describe("the buffered and streaming paths agree, and both agree with node:crypto", () => {
  it.each(SIZES)("%s", async (_label, size) => {
    const bytes = payload(size);
    const expected = reference(bytes);

    const buffered = await computeHashesBuffered(new Blob([bytes]));
    const chunked = await computeHashesChunked(new Blob([bytes]));

    expect(buffered, "buffered path disagrees with node:crypto").toEqual(expected);
    expect(chunked, "streaming path disagrees with node:crypto").toEqual(expected);
    // Stated separately on purpose: the two agreeing with each other is the
    // property the single-path argument was protecting.
    expect(buffered, "the two paths disagree with each other").toEqual(chunked);
  });
});

describe("the buffered path really is the native one", () => {
  it("puts all three SHA digests through crypto.subtle", async () => {
    // Otherwise "the fast path" could silently be the slow path and every
    // agreement test above would still pass.
    const spy = vi.spyOn(crypto.subtle, "digest");
    try {
      await computeHashesBuffered(new Blob([payload(4096)]));
      expect(spy.mock.calls.map((c) => c[0])).toEqual(["SHA-1", "SHA-256", "SHA-512"]);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not ask crypto.subtle for MD5, which it does not have", async () => {
    // MD5 is absent from the WebCrypto registry, so asking would reject. It
    // runs through hash-wasm over the same buffer instead.
    const spy = vi.spyOn(crypto.subtle, "digest");
    try {
      await computeHashesBuffered(new Blob([payload(1024)]));
      expect(spy.mock.calls.map((c) => c[0])).not.toContain("MD5");
    } finally {
      spy.mockRestore();
    }
  });

  it("reports progress that ends at 100", async () => {
    const seen: number[] = [];
    await computeHashesBuffered(new Blob([payload(2048)]), (p) => seen.push(p));
    expect(seen.at(-1)).toBe(100);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1])).toBe(true);
  });
});

describe("routing", () => {
  it("sends a file at the threshold to the buffered path", async () => {
    const bytes = payload(2048);
    const blob = new Blob([bytes]);
    Object.defineProperty(blob, "size", { value: WEBCRYPTO_MAX_BYTES });
    const spy = vi.spyOn(crypto.subtle, "digest");
    try {
      expect(await computeHashes(blob)).toEqual(reference(bytes));
      expect(spy, "at the threshold the fast path should run").toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to streaming when crypto.subtle is unavailable", async () => {
    /*
      `SubtleCrypto` is gated on a secure context, so over plain http on a
      non-localhost origin `crypto.subtle` is undefined. The tool must still
      hash — slower, but correct — rather than throwing on a missing API.
    */
    const bytes = payload(5000);
    const real = crypto.subtle;
    try {
      Object.defineProperty(crypto, "subtle", { value: undefined, configurable: true });
      expect(await computeHashes(new Blob([bytes]))).toEqual(reference(bytes));
    } finally {
      Object.defineProperty(crypto, "subtle", { value: real, configurable: true });
    }
  });
});
