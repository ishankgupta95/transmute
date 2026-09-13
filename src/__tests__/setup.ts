import "@testing-library/jest-dom/vitest";

/*
 * jsdom has `ReadableStream` and `Blob.prototype.arrayBuffer` but NOT
 * `Blob.prototype.stream` (probed 2026-09-13). Every browser this app supports
 * has it, and `lib/tools/hash-digest.ts` depends on it — deliberately, because
 * streaming is what removed the ~2 GB ceiling from /hash-generator and
 * /file-checksum.
 *
 * ⚠ This shim belongs HERE and must never be pushed into the product as a
 * fallback: a `blob.arrayBuffer()` path inside `computeHashesStreaming` would
 * silently restore the single-allocation ceiling the streaming exists to
 * remove, and every test would still pass. The real streaming behaviour is
 * pinned separately in `unit/lib/hash-digest-streaming.test.ts`, which runs in
 * the node environment against real streams and refuses to let the
 * implementation call `arrayBuffer()` at all.
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
