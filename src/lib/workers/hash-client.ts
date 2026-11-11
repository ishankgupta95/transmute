import { computeHashes, type Hashes } from "@/lib/tools/hash-digest";
import { WorkerPool } from "./pool";

/**
 * Hashing in a pool worker, modelled on regex-client.ts. One worker is enough:
 * the tool hashes one input at a time, and the point is only to get the pure-JS
 * MD5 off the main thread so the tab keeps painting.
 */

let pool: WorkerPool | null = null;

function getHashPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool({
      // Pre-bundled by scripts/build-workers.mjs — see image-client.ts.
      createWorker: () =>
        new Worker(`${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/workers/hash.worker.js`, {
          type: "module",
        }),
      maxWorkers: 1,
    });
  }
  return pool;
}

/** True when hashing happens on this thread (jsdom, ancient browsers). */
export function hashRunsInline(): boolean {
  return typeof Worker === "undefined";
}

/**
 * A BLOB crosses the worker boundary, not an ArrayBuffer — and that is the
 * whole point rather than a detail. A Blob is structured-cloned by REFERENCE
 * to bytes the browser already has on disk, so nothing is copied and nothing
 * has to be resident: the worker opens `blob.stream()` on the far side. The
 * previous shape transferred an ArrayBuffer, which meant every caller first
 * had to materialise the entire file in one allocation and so inherited the
 * renderer's ~2 GB single-buffer ceiling.
 *
 * `memoryBytes` is still the file's size for the pool's scheduling, but it is
 * now an upper bound on what the run is WORTH rather than what it COSTS.
 */
export async function computeHashesGuarded(
  blob: Blob,
  onProgress?: (percent: number) => void,
): Promise<Hashes> {
  if (hashRunsInline()) return computeHashes(blob, onProgress);
  return getHashPool().run<Hashes>({ blob }, { memoryBytes: blob.size, onProgress });
}
