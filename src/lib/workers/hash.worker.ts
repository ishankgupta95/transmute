/// <reference lib="webworker" />
import { computeHashes } from "@/lib/tools/hash-digest";
import type { PoolWorkerRequest, PoolWorkerResponse } from "./pool";

/**
 * Pool worker for the hash generator. Hashing was the last heavy path still on
 * the main thread — an 8 MB input blocked one frame for ~0.5s, an ISO or a DB
 * dump (the things people actually checksum) for seconds. Import only leaf
 * modules here (see audio-pcm.ts for the build hang this rule prevents).
 */

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<PoolWorkerRequest>) => {
  const { id, payload } = event.data;
  const { blob } = payload as { blob: Blob };
  try {
    const result = await computeHashes(blob, (value) => {
      self.postMessage({ id, type: "progress", value } satisfies PoolWorkerResponse);
    });
    self.postMessage({ id, type: "done", result } satisfies PoolWorkerResponse);
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      message: err instanceof Error ? err.message : "Hashing failed",
    } satisfies PoolWorkerResponse);
  }
};
