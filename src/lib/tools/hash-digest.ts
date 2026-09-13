import { sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { md5 } from "js-md5";

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
 * The four digests, computed WITHOUT ever holding the file.
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
 * ── WHY NOT SubtleCrypto ─────────────────────────────────────────────────────
 * It has exactly ONE digest entry point and it takes the whole buffer. There is
 * no `update()`. So streaming means a JS implementation of SHA — that is not a
 * preference, it is the only shape available.
 *
 * ── WHAT THAT COSTS, MEASURED RATHER THAN ASSUMED ────────────────────────────
 * Per digest, 64 MiB in 4 MiB chunks under Node: md5 305 MB/s, sha1 333,
 * sha256 239, sha512 103 — ~50 MB/s for all four together. IN THE BROWSER,
 * which is the number that matters and the one the copy quotes, the same four
 * run at ~39 MB/s (32 MiB through the real page in 0.83 s, Chromium
 * 2026-09-13). So a 2 GB file lands in under a minute with a progress bar,
 * where today it cannot be opened at all. Native SubtleCrypto is
 * several times faster on the files that DO fit, and that is the real trade
 * this makes. It is one code path rather than two on purpose: a
 * fits-in-memory fast path and a streaming slow path would be two
 * implementations of the same digest that have to agree, and a checksum tool
 * that can disagree with itself is worse than a slow one.
 *
 * ⚠ A chunk-boundary bug here returns a WRONG DIGEST rather than an error,
 * which on a checksum tool is the one failure worse than refusing the file.
 * `hash-digest-streaming.test.ts` feeds it chunk sizes that do NOT divide the
 * input and compares against the one-shot digest.
 */
export async function computeHashesStreaming(
  blob: Blob,
  onProgress?: (percent: number) => void,
): Promise<Hashes> {
  const hashers = {
    md5: md5.create(),
    sha1: sha1.create(),
    sha256: sha256.create(),
    sha512: sha512.create(),
  };

  const total = blob.size;
  let read = 0;
  const reader = blob.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hashers.md5.update(value);
      hashers.sha1.update(value);
      hashers.sha256.update(value);
      hashers.sha512.update(value);
      read += value.byteLength;
      // `total` is 0 for an empty blob, and a 0/0 progress report is NaN.
      if (total > 0) onProgress?.(Math.round((read / total) * 100));
    }
  } finally {
    reader.releaseLock();
  }

  onProgress?.(100);
  return {
    md5: hashers.md5.hex(),
    sha1: toHex(hashers.sha1.digest()),
    sha256: toHex(hashers.sha256.digest()),
    sha512: toHex(hashers.sha512.digest()),
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
