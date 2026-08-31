import { md5 } from "js-md5";

/**
 * The four digests, computed off one buffer.
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
 * MD5 is pure JS and blocks whoever runs it: measured 506 ms for 8 MB in one
 * unbroken frame. Streaming it in 4 MB slices, yielding between them, keeps
 * any single task under the project's 200 ms main-thread gate even when the
 * fallback path has to run inline.
 */
const CHUNK_BYTES = 4 * 1024 * 1024;

/** SubtleCrypto is available in workers too, so this needs no branch. */
async function sha(algo: string, data: BufferSource): Promise<string> {
  const hash = await crypto.subtle.digest(algo, data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeHashes(
  data: ArrayBuffer,
  onProgress?: (percent: number) => void,
): Promise<Hashes> {
  const bytes = new Uint8Array(data);
  const total = bytes.length;

  const hasher = md5.create();
  for (let offset = 0; offset < total; offset += CHUNK_BYTES) {
    const end = Math.min(offset + CHUNK_BYTES, total);
    hasher.update(bytes.subarray(offset, end));
    // MD5 is ~90% of the wall time; the SubtleCrypto digests below are native.
    onProgress?.(Math.round((end / total) * 90));
    if (end < total) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const [sha1, sha256, sha512] = await Promise.all([
    sha("SHA-1", bytes),
    sha("SHA-256", bytes),
    sha("SHA-512", bytes),
  ]);

  onProgress?.(100);
  return { md5: hasher.hex(), sha1, sha256, sha512 };
}
