// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  computeHashesChunked,
  computeHashes,
  WEBCRYPTO_MAX_BYTES,
} from "@/lib/tools/hash-digest";

/*
 * ⚠ THE FAILURE MODE THIS GUARDS IS A WRONG ANSWER, NOT A CRASH.
 *
 * `computeHashes` feeds four hashers whatever slices the stream hands
 * it. Get a boundary wrong — drop a byte, double-count one, mis-handle a chunk
 * that lands mid-block — and it returns a well-formed hex digest that is
 * simply not the file's digest. On a checksum tool that is the one outcome
 * worse than refusing the file, because the user's whole reason for being
 * there is to trust the number.
 *
 * So every case below compares against `node:crypto`, an independent
 * implementation, and the chunk sizes are chosen NOT to divide the input: a
 * hasher that only ever sees block-aligned chunks is the case that works by
 * accident.
 *
 * `@vitest-environment node` because jsdom has no `Blob.prototype.stream`.
 * That is also why this file exists separately from the jsdom hash tests.
 *
 * ⚠ THESE CASES CALL `computeHashesChunked` DIRECTLY, not the public
 * `computeHashes`, and that is load-bearing. Since 2026-11-11 the
 * public function ROUTES by size: at or under `WEBCRYPTO_MAX_BYTES` it hands
 * the file to `crypto.subtle`, which is ~13x faster and does no chunking at
 * all. Every input below is far smaller than that, so calling the public
 * function here would exercise the buffered path and silently stop testing
 * chunk boundaries altogether — the tests would still pass and guard nothing.
 * Routing itself is pinned at the bottom of this file, and the two paths are
 * proved to agree in hash-digest-webcrypto.test.ts.
 */

/** A Blob whose stream emits fixed-size chunks, so boundaries are controlled. */
function chunkedBlob(bytes: Uint8Array, chunkSize: number): Blob {
  return {
    size: bytes.byteLength,
    stream(): ReadableStream<Uint8Array> {
      let offset = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.byteLength) {
            controller.close();
            return;
          }
          const end = Math.min(offset + chunkSize, bytes.byteLength);
          controller.enqueue(bytes.subarray(offset, end));
          offset = end;
        },
      });
    },
  } as unknown as Blob;
}

function reference(bytes: Uint8Array) {
  const hex = (algo: string) => createHash(algo).update(bytes).digest("hex");
  return { md5: hex("md5"), sha1: hex("sha1"), sha256: hex("sha256"), sha512: hex("sha512") };
}

/** Deterministic, non-repeating content: a repeated byte hides ordering bugs. */
function payload(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 31 + (i >> 8) * 17) & 0xff;
  return out;
}

describe("computeHashes agrees with a one-shot digest", () => {
  /*
   * SHA-1/256 work on 64-byte blocks and SHA-512 on 128-byte blocks, so the
   * interesting chunk sizes are the ones coprime to both. 1 byte at a time is
   * the pathological case; 100,003 is prime and lands mid-block every time.
   */
  it.each([
    ["1 byte at a time", 1],
    ["3 bytes — below every block size", 3],
    ["63 — one short of the SHA-256 block", 63],
    ["65 — one past it", 65],
    ["127 — one short of the SHA-512 block", 127],
    ["1000 — not a power of two", 1000],
    ["100003 — prime, larger than the input", 100_003],
  ])("matches node:crypto with chunks of %s", async (_label, chunkSize) => {
    const bytes = payload(50_000);
    const got = await computeHashesChunked(chunkedBlob(bytes, chunkSize));
    expect(got).toEqual(reference(bytes));
  });

  it("matches on an input that is exactly one block", async () => {
    const bytes = payload(64);
    expect(await computeHashesChunked(chunkedBlob(bytes, 64))).toEqual(reference(bytes));
  });

  it("handles an empty file without reporting NaN progress", async () => {
    const seen: number[] = [];
    const got = await computeHashesChunked(chunkedBlob(new Uint8Array(0), 16), (p) =>
      seen.push(p),
    );
    expect(got).toEqual(reference(new Uint8Array(0)));
    // 0/0 is NaN, and a NaN would reach the progress bar as a broken width.
    expect(seen.every((p) => Number.isFinite(p))).toBe(true);
  });

  it("reports monotonic progress that ends at 100", async () => {
    const seen: number[] = [];
    await computeHashesChunked(chunkedBlob(payload(10_000), 997), (p) => seen.push(p));
    expect(seen.at(-1)).toBe(100);
    expect(seen.every((p, i) => i === 0 || p >= seen[i - 1])).toBe(true);
  });

  it("never materialises the whole file — it reads the stream in slices", async () => {
    /*
     * The point of the streaming path. If someone "simplifies" it back to
     * `new Uint8Array(await blob.arrayBuffer())` every test above still passes
     * and the ~2 GB ceiling silently returns, so the slicing itself is pinned:
     * a Blob whose `arrayBuffer` throws must still hash.
     */
    const bytes = payload(5_000);
    const blob = chunkedBlob(bytes, 512);
    (blob as unknown as { arrayBuffer: () => never }).arrayBuffer = () => {
      throw new Error("the whole file was read into one buffer");
    };
    expect(await computeHashesChunked(blob)).toEqual(reference(bytes));
  });

  it("routes a file too big to buffer to the streaming path", async () => {
    /*
     * THIS is what now protects the ~2 GB ceiling, and it is the test the
     * buffered fast path had to earn. The guard above proves the chunked
     * implementation does not buffer; this proves the PUBLIC entry point
     * actually reaches it for a file that must not be buffered.
     *
     * The blob reports a size over the threshold while its stream emits only a
     * few KB, so the routing decision is exercised without allocating 128 MiB
     * to prove a branch. `arrayBuffer` throws, so taking the fast path here
     * fails loudly instead of quietly reintroducing the ceiling.
     */
    const bytes = payload(5_000);
    const blob = chunkedBlob(bytes, 512);
    Object.defineProperty(blob, "size", { value: WEBCRYPTO_MAX_BYTES + 1 });
    (blob as unknown as { arrayBuffer: () => never }).arrayBuffer = () => {
      throw new Error("an over-threshold file was read into one buffer");
    };
    expect(await computeHashes(blob)).toEqual(reference(bytes));
  });
});
