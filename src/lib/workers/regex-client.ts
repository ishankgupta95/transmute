import { evalRegexSync, type RegexEvalResult } from "@/lib/tools/regex-eval";
import { WorkerPool } from "./pool";

/**
 * Guarded regex evaluation: the pattern runs in a single pool worker with a
 * hard timeout. `(a+)+$` against half a page of text used to freeze the tab
 * on every keystroke — now it costs one worker, which the pool terminates
 * and replaces.
 */

export const REGEX_TIMEOUT_MS = 2000;

export const REGEX_TIMEOUT_MESSAGE =
  "Pattern took too long — likely catastrophic backtracking. Evaluation was stopped.";

let pool: WorkerPool | null = null;

function getRegexPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool({
      // Pre-bundled by scripts/build-workers.mjs — see image-client.ts.
      createWorker: () =>
        new Worker(`${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/workers/regex.worker.js`, {
          type: "module",
        }),
      maxWorkers: 1,
    });
  }
  return pool;
}

/** True when evaluation happens synchronously (jsdom, ancient browsers). */
export function regexRunsInline(): boolean {
  return typeof Worker === "undefined";
}

export async function evalRegexGuarded(
  pattern: string,
  flags: string,
  testStr: string,
  timeoutMs: number = REGEX_TIMEOUT_MS,
): Promise<RegexEvalResult> {
  if (regexRunsInline()) return evalRegexSync(pattern, flags, testStr);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await getRegexPool().run<RegexEvalResult>(
      { pattern, flags, testStr },
      { signal: controller.signal },
    );
  } catch (err) {
    if (controller.signal.aborted) return { matches: [], error: REGEX_TIMEOUT_MESSAGE };
    return {
      matches: [],
      error: err instanceof Error ? err.message : "Evaluation failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
