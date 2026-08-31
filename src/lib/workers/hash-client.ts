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
 * NOTE: `data` is TRANSFERRED to the worker, so the caller's ArrayBuffer is
 * detached. Every caller builds a fresh buffer per run, which is why that is
 * safe (and why it avoids copying a 100 MB file across the boundary).
 */
export async function computeHashesGuarded(
  data: ArrayBuffer,
  onProgress?: (percent: number) => void,
): Promise<Hashes> {
  if (hashRunsInline()) return computeHashes(data, onProgress);
  return getHashPool().run<Hashes>(
    { data },
    { transfer: [data], memoryBytes: data.byteLength, onProgress },
  );
}
