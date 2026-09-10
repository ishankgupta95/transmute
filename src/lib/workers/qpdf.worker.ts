/// <reference lib="webworker" />
// LEAF imports only. `./pool` is type-only; `./qpdf-protocol` is a real value
// import and is safe under the leaf rule for the same reason
// jpeg-orientation.ts is in pdf-image.worker.ts — it has zero imports of its
// own. A worker entrypoint whose import chain reaches a module that names this
// worker's own URL hangs `next build` forever at 0% CPU.
import type { PoolWorkerRequest, PoolWorkerResponse } from "./pool";
import type { QpdfJob, QpdfJobResult } from "./qpdf-protocol";
import {
  buildQpdfArgv,
  isQpdfSuccess,
  protectionFromResult,
  qpdfErrorMessage,
  qpdfWarnings,
} from "./qpdf-protocol";

/**
 * Pool worker for the qpdf-backed security tools — protect, unlock, restrict
 * permissions, repair.
 *
 * qpdf is a CLI compiled to WASM: the job is written into an in-memory
 * filesystem, `main()` runs against an argv, and the result is read back out.
 * It runs off the main thread because `callMain` is one synchronous call that
 * rewrites an entire document — on a large PDF that is a frozen tab.
 *
 * Everything decidable without WASM (argv, exit classification, message
 * mapping) lives in qpdf-protocol.ts, which is where the unit tests can reach
 * it. What is left here is only what genuinely needs the engine.
 */

declare const self: DedicatedWorkerGlobalScope;

/**
 * The slice of the Emscripten module this worker touches, declared by hand.
 *
 * A dynamic `import()` whose specifier is not a string literal has no static
 * type — TypeScript hands back `Promise<any>` — so the surface is described
 * once here and the module promise is cast at the single point it is created,
 * exactly as audio-pcm.ts does for lamejs. Measured against the shipped glue:
 * `callMain` RETURNS the exit code (it does not throw, and `Module.exitStatus`
 * is `undefined` always), and `FS` stays usable after it returns.
 */
interface QpdfModule {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    analyzePath(path: string): { exists: boolean };
  };
  callMain(args: string[]): number;
}

interface QpdfModuleOptions {
  thisProgram: string;
  print(line: string): void;
  printErr(line: string): void;
  instantiateWasm(
    imports: WebAssembly.Imports,
    receive: (instance: WebAssembly.Instance) => void,
  ): void;
}

/** `qpdf.js` is a real ES module whose only export is `export default createQpdfModule`. */
interface QpdfGlue {
  default: (options: QpdfModuleOptions) => Promise<QpdfModule>;
}

/**
 * The fixed MEMFS names `buildQpdfArgv()` emits.
 *
 * Duplicated here rather than exported from the protocol module, whose API is
 * pinned and compiled against by the UIs and the E2E helpers. The unit test
 * pins the argv tail (…, "--", "in.pdf", "out.pdf") from the other side, so
 * changing one without the other fails the suite.
 */
const IN_FILE = "in.pdf";
const OUT_FILE = "out.pdf";

/**
 * Same-origin URL of a self-hosted engine file, prefixed the way every other
 * one is. `qpdf.js` and `qpdf.wasm` are copied to the origin ROOT by
 * `npm run copy:wasm`, beside `ffmpeg-core.*`.
 *
 * THIS FUNCTION IS LOAD-BEARING — the same trap audio-pcm.ts documents for
 * lamejs, and here it breaks two things rather than one. esbuild
 * (scripts/build-workers.mjs) `define`s `process.env.__NEXT_ROUTER_BASEPATH`
 * to `""`, so a bare template literal at the `import()` below would collapse
 * to the literal "/qpdf.js", which esbuild would resolve from disk and inline
 * into public/workers/qpdf.worker.js. That would also break the wasm lookup:
 * the glue finds its binary as `new URL("qpdf.wasm", import.meta.url)`, and
 * once inlined `import.meta.url` is the WORKER's URL, so the request becomes
 * /workers/qpdf.wasm — a 404. Routing the specifier through a function call
 * keeps the argument non-analyzable; the magic comments say so out loud too.
 *
 * `attempt` exists because a module that fails to fetch is recorded as failed
 * in the realm's module map, and every later `import()` of THAT SPECIFIER
 * rejects from the map without touching the network. A retry has to ask for a
 * URL the map has not already condemned. See the fuller note on the twin in
 * lib/tools/audio-pcm.ts.
 */
function engineUrl(name: string, attempt = 0): string {
  const base = `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/${name}`;
  return attempt === 0 ? base : `${base}?retry=${attempt}`;
}

/** The loaded glue module, memoised; see `loadWasm` for the binary itself. */
let glue: Promise<QpdfGlue> | null = null;
let glueAttempts = 0;

function loadGlue(): Promise<QpdfGlue> {
  if (!glue) {
    // Two things are needed for a retry to be a real retry, and neither alone
    // is enough: drop our own memo (a plain `??=` would replay the REJECTED
    // promise forever), AND ask for a URL the module map has not already
    // recorded as failed.
    glue = (
      import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ engineUrl("qpdf.js", glueAttempts++)
      ) as Promise<QpdfGlue>
    ).catch((err) => {
      glue = null;
      throw err;
    });
  }
  return glue;
}

/**
 * The compiled wasm, fetched and compiled ONCE per worker.
 *
 * Every operation needs its own module instance (see `runQpdf`), and letting
 * the glue locate the binary itself would mean a 2.3 MB fetch per instance.
 * Compiling once and handing each instance an `instantiateWasm` hook over the
 * cached `WebAssembly.Module` avoids that. MEASURED in a real module Worker
 * against this exact bundle: 12 sequential jobs, each with its own module
 * instance, produced exactly ONE `GET /qpdf.wasm` — in Chromium, Firefox and
 * WebKit alike (counted at the server, not in the page).
 *
 * `instantiateWasm` is the only supported way in. `wasmBinary` is NOT honoured
 * by this glue (grep count 0 — the identifier exists only as an unassigned
 * local), so passing pre-fetched bytes that way is silently ignored and the
 * glue fetches anyway.
 *
 * `WebAssembly.compile` over an ArrayBuffer rather than `compileStreaming`:
 * streaming requires the response to carry `Content-Type: application/wasm`,
 * which is a property of whatever host serves the export, and a MIME mismatch
 * there would be a hard failure for the sake of a few milliseconds.
 */
let wasm: Promise<WebAssembly.Module> | null = null;

function loadWasm(): Promise<WebAssembly.Module> {
  if (!wasm) {
    wasm = (async () => {
      // No ?retry cache-buster needed here: a failed `fetch` is not remembered
      // the way a failed module import is, so dropping the memo below is
      // enough to make the next attempt hit the network.
      const response = await fetch(engineUrl("qpdf.wasm"));
      if (!response.ok) {
        throw new Error(`The PDF security engine could not be loaded (HTTP ${response.status}).`);
      }
      return WebAssembly.compile(await response.arrayBuffer());
    })().catch((err) => {
      wasm = null;
      throw err;
    });
  }
  return wasm;
}

/**
 * Run one qpdf operation, in its own module instance.
 *
 * A FRESH `createQpdfModule()` PER `callMain`, always. The artifact is linked
 * with `-sEXIT_RUNTIME=1`, which makes each instance one-shot: a second
 * `callMain` throws a raw `WebAssembly.RuntimeError` with an unstable message
 * ("null function or function signature mismatch", "memory access out of
 * bounds" — both observed) and produces no stderr, no `onExit` and no
 * `onAbort`. That holds EVEN WHEN THE FIRST CALL FAILED.
 *
 * And the failure is worse than a lost exit code. Measured in a browser: after
 * that throw, `out.pdf` EXISTED in MEMFS at 5286 bytes — so a wrapper that
 * reused the instance and caught the throw would read back a file no exit code
 * ever vouched for. The pool reuses this Worker across jobs (pool.ts returns
 * the slot to idle after each message), so memoising the module is exactly the
 * bug. Instantiation costs ~4 ms once the wasm is compiled; there is nothing
 * to save by trying.
 */
async function runQpdf(job: QpdfJob): Promise<QpdfJobResult> {
  // Built first: an over-long password or a missing owner password should fail
  // before an engine is spun up, and its throw is already a user-facing
  // sentence.
  const argv = buildQpdfArgv(job);

  const [{ default: createQpdfModule }, compiled] = await Promise.all([loadGlue(), loadWasm()]);

  const stderr: string[] = [];
  /*
    The glue's hook is callback-in, nothing-out: it wraps `instantiateWasm` in
    `new Promise(resolve => instantiateWasm(info, inst => resolve(…)))`, which
    has no reject path and ignores the return value. So a failed instantiation
    — realistically an out-of-memory on a loaded mobile tab — would leave the
    factory pending FOREVER, and the pool has no timeout: the slot would sit
    busy and the UI would spin with nothing to report. Racing the factory
    against an explicit rejection turns that hang into an error message.
  */
  let failInstantiation: (reason: unknown) => void = () => {};
  const instantiationFailed = new Promise<never>((_, reject) => {
    failInstantiation = reject;
  });

  const mod = await Promise.race([
    createQpdfModule({
      // Without this, qpdf basenames its argv[0] to the glue's placeholder and
      // EVERY error line reads "this.program: …" (measured).
      thisProgram: "qpdf",
      // qpdf's stdout carries nothing these four operations need — the
      // classification query answers with its exit code alone — and the default
      // sink is console.log, which would spray a user's document structure into
      // the console. Swallow it.
      print: () => {},
      // Called once per LINE, newline already stripped, and "" for blank lines.
      printErr: (line) => stderr.push(line),
      instantiateWasm: (imports, receive) => {
        WebAssembly.instantiate(compiled, imports).then(receive, failInstantiation);
      },
    }),
    instantiationFailed,
  ]);

  // MEMFS cwd is "/", so bare names resolve to /in.pdf and /out.pdf.
  mod.FS.writeFile(IN_FILE, job.data);
  // `.slice()` is not optional: callMain does `args.unshift(thisProgram)` on
  // the array it is handed, which would corrupt the caller's argv.
  const exitCode = mod.callMain(argv.slice());
  const warnings = qpdfWarnings(stderr);

  if (job.op === "classify") {
    /*
      A query writes no output file, and its rc 2 is an ANSWER rather than a
      failure — which is why this returns above the isQpdfSuccess check instead
      of throwing. That only holds because the answer is honest about the case
      it cannot read: `--requires-password` returns rc 2 for an unreadable file
      exactly as it does for an unencrypted one (measured on an empty file, a
      JPEG, plain text and a truncated PDF), so stderr has to come along —
      passing the exit code alone reported every one of those as "no protection".
    */
    return { bytes: null, exitCode, warnings, protection: protectionFromResult(exitCode, stderr) };
  }

  if (!isQpdfSuccess(exitCode)) {
    // `job.op` is what turns qpdf's one ": invalid password" line into a
    // sentence the page the user is standing on can actually act on.
    throw new Error(qpdfErrorMessage(exitCode, stderr, job.op));
  }

  /*
    Success is TWO tests, in this order. rc 3 is "completed with warnings" and
    is a success — collapsing it into "non-zero failed" would break repair-pdf
    on the damaged files it exists to fix. But rc alone is not enough either:
    the weak-crypto refusal writes a ZERO-BYTE out.pdf (measured), so an
    existence check would hand the UI an empty document to download.
  */
  const bytes = mod.FS.analyzePath(OUT_FILE).exists ? mod.FS.readFile(OUT_FILE) : null;
  if (!bytes || bytes.length === 0) {
    throw new Error(qpdfErrorMessage(exitCode, stderr, job.op));
  }

  return { bytes, exitCode, warnings };
}

self.onmessage = async (event: MessageEvent<PoolWorkerRequest>) => {
  const { id, payload } = event.data;
  const job = payload as QpdfJob;

  try {
    const result = await runQpdf(job);
    /*
      The produced document is TRANSFERRED, not copied — structured-cloning a
      whole PDF would double peak memory at exactly the moment this worker is
      holding the most. FS.readFile allocates a fresh Uint8Array rather than a
      view onto the module's heap, so its buffer is ours to give away. The
      INPUT is deliberately not transferred: the UI keeps its bytes to re-run
      at other settings and to show the original alongside the result.
    */
    const transfer = result.bytes ? [result.bytes.buffer as ArrayBuffer] : [];
    self.postMessage({ id, type: "done", result } satisfies PoolWorkerResponse, transfer);
  } catch (err) {
    self.postMessage({
      id,
      type: "error",
      message: err instanceof Error ? err.message : "This PDF could not be processed.",
    } satisfies PoolWorkerResponse);
  }
};
