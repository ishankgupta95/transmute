import "@testing-library/jest-dom/vitest";

/*
 * jsdom has `ReadableStream` and `Blob.prototype.arrayBuffer` but NOT
 * `Blob.prototype.stream` (probed 2026-09-13). Every browser this app supports
 * has it, and `lib/tools/hash-digest.ts` depends on it — deliberately, because
 * streaming is what removed the ~2 GB ceiling from /hash-generator and
 * /file-checksum.
 *
 * ⚠ This shim belongs HERE and must never be pushed into the product as a
 * fallback for LARGE files: a `blob.arrayBuffer()` path taken at any size
 * would silently restore the single-allocation ceiling that streaming exists
 * to remove, and every test here would still pass.
 *
 * Since 2026-11-11 `hash-digest.ts` does buffer deliberately, but only at or
 * under `WEBCRYPTO_MAX_BYTES` (128 MiB), where `crypto.subtle` is 5.2x faster
 * and one allocation that size is unremarkable. The bound is what keeps the
 * tools' "NO SIZE CAP" claim true, and it is pinned in
 * `unit/data/size-claims.test.ts`. The streaming behaviour itself —
 * chunk-boundary correctness, and that an over-threshold file really reaches
 * the chunked path — is pinned in `unit/lib/hash-digest-streaming.test.ts`,
 * which runs in the node environment against real streams.
 */
if (typeof Blob !== "undefined" && typeof Blob.prototype.stream !== "function") {
  Object.defineProperty(Blob.prototype, "stream", {
    configurable: true,
    writable: true,
    value(this: Blob): ReadableStream<Uint8Array> {
      const read = this.arrayBuffer();
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          controller.enqueue(new Uint8Array(await read));
          controller.close();
        },
      });
    },
  });
}
