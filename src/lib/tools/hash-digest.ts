import { createMD5, createSHA1, createSHA256, createSHA512 } from "hash-wasm";

/**
 * The four digests, computed off a stream.
 *
 * A leaf module on purpose: `lib/workers/hash.worker.ts` imports it and must
 * not pull in anything that names the worker's own URL (plan.md records the
 * build hang that causes). Nothing here touches the DOM, so it runs unchanged
 * on the main thread (jsdom, no-Worker fallback) and inside a worker.
 */

export interface Hashes {
  md5: string;
  sha1: string;
  sha256: string;
  sha512: string;
}

/**
 * The four digests of `blob`.
 *
 * Routes by size: `computeHashesBuffered` where the file is small enough to
 * hold, `computeHashesChunked` where it is not. It was called
 * `computeHashesStreaming` until 2026-11-11, which stopped being true of the
 * small-file case when the buffered path landed.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * This replaced a `computeHashes(ArrayBuffer)` on 2026-09-13. That one made
 * /hash-generator and /file-checksum read the whole file into one allocation
 * before the first digest started. That is a hard ceiling at the ~2 GB a renderer will
 * hand out in a single piece (the derivation is at the top of
 * ffmpeg-loader.ts), and both tools' copy said so. Hashing is the one job on
 * this site where that ceiling is pure accident: hash functions are
 * incremental by construction, so the file never needed to be resident.
 *
 * ── TWO PATHS, AND THE OBJECTION THIS FILE USED TO RECORD ────────────────────
 * This file argued for ONE code path: "a fits-in-memory fast path and a
 * streaming slow path would be two implementations of the same digest that
 * have to agree, and a checksum tool that can disagree with itself is worse
 * than a slow one." That is the right worry and it is why the split below is
 * shaped the way it is — but it is answerable, and the cost of not answering
 * it turned out to be large.
 *
 * `SubtleCrypto` has exactly one digest entry point and it takes the whole
 * buffer; there is no `update()`. So streaming genuinely requires a JS SHA,
 * and for a file too big to hold that is still the only shape available.
 * MEASURED in headless Chromium on 64 MiB, 2026-11-11, by bundling THIS
 * module and driving both of its exported paths over the same Blob — so these
 * are the shipped figures, hasher construction and the Blob read included:
 *
 *   computeHashesBuffered .... 227 ms   282 MB/s   (<=128 MiB)
 *   computeHashesChunked ..... 512 ms   125 MB/s   ( >128 MiB)
 *
 *   --- what each replaced, same input, same machine ---
 *   subtle SHA x3 + js-md5 ... 283 ms   226 MB/s
 *   js-md5 + @noble, all four  1562 ms    41 MB/s
 *
 * So against the original all-JS path this is 6.9x under the threshold and
 * 3.1x over it. Declining that to keep one code path is a worse trade than
 * proving the two agree.
 *
 * (A prototype measured 199 and 487 ms by reusing hashers across runs and
 * hashing an already-materialised buffer. The numbers above are lower because
 * they are the real thing; the prototype's are not quotable.)
 *
 * ── WHERE THE TIME GOES, AND WHY MD5 STOPPED BEING THE PROBLEM ───────────────
 * Measured per stage on the same 64 MiB, which is the only way the next
 * decision is obvious rather than guessed:
 *
 *   blob.arrayBuffer() ..... 12 ms   (5333 MB/s — free, and not worth avoiding)
 *   js-md5 ................ 188 ms   ( 340 MB/s — was 63% of the buffered path)
 *   subtle SHA-1 / 256 .. 27 / 27 ms (~2370 MB/s each)
 *   subtle SHA-512 ......... 42 ms   (1524 MB/s)
 *   the three in parallel .. 94 ms   ( 681 MB/s)
 *
 * MD5 was the whole bottleneck of the buffered path, because WebCrypto has no
 * MD5 — it is absent from the registry on the reasonable grounds that it is
 * broken for anything security-bearing. hash-wasm's MD5 runs it at roughly
 * 610 MB/s instead of 340, which is what takes 283 ms down to 199.
 *
 * Two things were tried here and do NOT work, recorded so they are not tried
 * again. `@noble/hashes` exports an md5 and it is 82 MB/s against js-md5's 733
 * (Node, 64 MiB) — nine times SLOWER, and js-md5 is within 6% of native, so it
 * was never a bad implementation. And starting the `subtle` digests before
 * running MD5, to overlap native work with JS, measured 279 ms against 282:
 * the synchronous MD5 blocks the loop, so there is no concurrency to win.
 *
 * For a file over the threshold the slowest digest is not MD5 at all — it is
 * SHA-512, which the old JS path ran at 103 MB/s. That is why the streaming
 * path moved to wasm too, and it is the 3.2x above.
 *
 * So they are proved to agree. The two paths are exported separately and
 * `hash-digest-webcrypto.test.ts` runs BOTH over the same inputs — including
 * sizes either side of the threshold, and the empty input — and compares them
 * digest by digest, against `node:crypto` as a third opinion. That is the same
 * method this file's streaming test already used; it is not a new kind of
 * trust. What would be unsafe is two paths that nothing compares.
 *
 * WHY THE THRESHOLD IS SMALL. The fast path has to materialise the file, which
 * is the ceiling the streaming path exists to escape, so it is deliberately
 * not used anywhere near that ceiling. 128 MiB covers what people actually
 * checksum — installers, archives, release downloads — and one allocation that
 * size is unremarkable on any device that can open this site. It also keeps
 * the fast path under about a second, which matters because `subtle.digest`
 * is one opaque call and reports no progress: above this size the progress bar
 * is worth more than the speed. ISOs and database dumps keep today's exact
 * behaviour, streaming and unbuffered.
 *
 * ⚠ A chunk-boundary bug here returns a WRONG DIGEST rather than an error,
 * which on a checksum tool is the one failure worse than refusing the file.
 * `hash-digest-streaming.test.ts` feeds it chunk sizes that do NOT divide the
 * input and compares against the one-shot digest.
 */
export async function computeHashes(
  blob: Blob,
  onProgress?: (percent: number) => void,
): Promise<Hashes> {
  if (blob.size <= WEBCRYPTO_MAX_BYTES && hasSubtleDigest()) {
    return computeHashesBuffered(blob, onProgress);
  }
  return computeHashesChunked(blob, onProgress);
}

/**
 * Largest input the buffered path will take. See the header for the derivation;
 * it is a memory and progress-reporting decision, not a correctness one.
 */
export const WEBCRYPTO_MAX_BYTES = 128 * 1024 * 1024;

/**
 * Whether `crypto.subtle.digest` can be called at all.
 *
 * `SubtleCrypto` is gated on a SECURE CONTEXT, so `crypto.subtle` is
 * `undefined` over plain http on anything but localhost — measured, by getting
 * `Cannot read properties of undefined` from an `about:blank` page. The site
 * is https so this is true in production, but a check beats an assumption, and
 * a false answer here costs speed rather than correctness.
 */
function hasSubtleDigest(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle?.digest === "function";
}

/**
 * The fast path: hold the file once, hand it to the platform.
 *
 * The three SHA digests go through `crypto.subtle`, which is native and
 * hardware-accelerated. MD5 cannot — it is not in the WebCrypto algorithm
 * registry at all, on the reasonable grounds that it is broken for anything
 * security-bearing — so it runs through hash-wasm's MD5 over the same buffer.
 * Exported for the agreement test, not for callers.
 */
export async function computeHashesBuffered(
  blob: Blob,
  onProgress?: (percent: number) => void,
): Promise<Hashes> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Reading the file is a small part of the wall time here (12 ms for 64 MiB)
  // and `subtle.digest` cannot report progress, so the bar jumps rather than
  // climbs. At this size that is under a second; above it,
  // `computeHashesChunked` runs instead and reports per chunk.
  onProgress?.(50);

  const md5Hasher = await createMD5();
  md5Hasher.init();
  md5Hasher.update(bytes);

  const [sha1Bytes, sha256Bytes, sha512Bytes] = await Promise.all([
    crypto.subtle.digest("SHA-1", bytes),
    crypto.subtle.digest("SHA-256", bytes),
    crypto.subtle.digest("SHA-512", bytes),
  ]);

  onProgress?.(100);
  return {
    // hash-wasm's `digest()` is hex already; only the ArrayBuffers from
    // `subtle` need converting.
    md5: md5Hasher.digest(),
    sha1: toHex(new Uint8Array(sha1Bytes)),
    sha256: toHex(new Uint8Array(sha256Bytes)),
    sha512: toHex(new Uint8Array(sha512Bytes)),
  };
}

/**
 * The streaming path, unchanged: four JS hashers fed chunk by chunk, so the
 * file is never resident and the only ceiling is patience. This is what runs
 * for anything over `WEBCRYPTO_MAX_BYTES`, and anywhere `crypto.subtle` is
 * missing. Exported for the agreement test, not for callers.
 */
export async function computeHashesChunked(
  blob: Blob,
  onProgress?: (percent: number) => void,
): Promise<Hashes> {
  /*
    A FRESH set of hashers per call, not a memoised one. hash-wasm's hashers
    hold their state in a wasm instance, so a shared one could not serve two
    overlapping calls — and `computeHashes` is reachable from the hash pool
    worker AND, through hash-client's no-worker fallback, from the main thread.
    Creating them is free enough that no sharing is warranted: MEASURED at
    1.3 ms for the first (the wasm compile) and 0.0-0.1 ms for every one after,
    because hash-wasm caches the compiled module and only instantiates.
  */
  const [md5Hasher, sha1Hasher, sha256Hasher, sha512Hasher] = await Promise.all([
    createMD5(),
    createSHA1(),
    createSHA256(),
    createSHA512(),
  ]);
  const hashers = [md5Hasher, sha1Hasher, sha256Hasher, sha512Hasher];
  // `init()` is what makes a hasher usable; a fresh one is not implicitly
  // reset, and reusing one without it would prepend the previous input.
  for (const h of hashers) h.init();

  const total = blob.size;
  let read = 0;
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const h of hashers) h.update(value);
      read += value.byteLength;
      // `total` is 0 for an empty blob, and a 0/0 progress report is NaN.
      if (total > 0) onProgress?.(Math.round((read / total) * 100));
    }
  } finally {
    reader.releaseLock();
  }

  onProgress?.(100);
  return {
    md5: md5Hasher.digest(),
    sha1: sha1Hasher.digest(),
    sha256: sha256Hasher.digest(),
    sha512: sha512Hasher.digest(),
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
