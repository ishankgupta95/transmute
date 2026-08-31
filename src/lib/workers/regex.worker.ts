/// <reference lib="webworker" />
import { evalRegexSync } from "@/lib/tools/regex-eval";
import type { PoolWorkerRequest, PoolWorkerResponse } from "./pool";

/**
 * Pool worker for regex evaluation. A runaway pattern pins THIS thread; the
 * client's timeout aborts the task, the pool terminates the worker, and the
 * tab never notices. Import only leaf modules here (see audio-pcm.ts for the
 * build-hang this rule prevents).
 */

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (event: MessageEvent<PoolWorkerRequest>) => {
  const { id, payload } = event.data;
  const { pattern, flags, testStr } = payload as {
    pattern: string;
    flags: string;
    testStr: string;
  };
  const result = evalRegexSync(pattern, flags, testStr);
  self.postMessage({ id, type: "done", result } satisfies PoolWorkerResponse);
};
