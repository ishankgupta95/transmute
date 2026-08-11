import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import type { ProcessingContext } from "@/hooks/useFileProcessor";
import { abortError, throwIfAborted } from "@/lib/utils/abort";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * The core is served from our own origin, not a CDN.
 *
 * `@ffmpeg/core` is a devDependency; `npm run copy:wasm` copies
 * `ffmpeg-core.js` + `ffmpeg-core.wasm` into `public/` on dev and build (the
 * same treatment the mupdf WASM gets), and the copies are gitignored so the
 * ~31 MB binary never enters git history.
 *
 * Why not unpkg: the product promises "nothing leaves this tab", but a CDN
 * fetch hands a third party the user's IP and referrer the first time they
 * open a video or audio tool. Self-hosting also removes a hard runtime
 * dependency on unpkg being up for ~11 tools, and lets the app work offline.
 * (Browsers partition the HTTP cache by top-level site, so a public CDN buys
 * no cross-site cache hit to trade away.)
 *
 * Pin note: the copied files must stay in step with the installed version —
 * bump `@ffmpeg/core` in package.json, not a URL here.
 */
const CORE_BASE_URL = "";

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;
let currentOnProgress: ((progress: number) => void) | null = null;

/**
 * Bumped by `terminateFFmpeg`. A load that was in flight when the user
 * cancelled must not publish its instance over the fresh one that replaced it.
 */
let generation = 0;

/**
 * FFmpeg tasks run one at a time. The wasm build is single-threaded and every
 * caller writes to the same virtual FS under the same `input.*` name, so two
 * overlapping `exec` calls would clobber each other's files *and* interleave
 * their progress events. Serialising is what makes the scoped progress handler
 * below correct.
 */
let queue: Promise<void> = Promise.resolve();

/**
 * Validate a file is under the 100 MB size limit.
 */
export function validateVideoFileSize(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 100 MB.`,
    );
  }
}

/**
 * Lazy-load FFmpeg.wasm (single-threaded UMD core).
 * Returns the singleton instance.
 *
 * FFmpeg stays OUT of the Phase 3 worker pool — by owner decision
 * (plan.md, 2026-08-09), recorded here so nobody "optimises" this later:
 * - No `@ffmpeg/core-mt`: the multi-threaded build deadlocks in many
 *   browsers (emscripten pthreads), and it needs SharedArrayBuffer, which
 *   needs COOP/COEP headers GitHub Pages cannot send.
 * - No pool of single-threaded instances either: each is a ~31 MB WASM
 *   heap, and every caller shares one virtual FS under the same `input.*`
 *   names — parallel instances would multiply memory for tools that handle
 *   one video at a time.
 * So: one instance (it already runs in @ffmpeg/ffmpeg's own worker, off the
 * main thread), tasks serialised through the queue below, batch UX for
 * FFmpeg-backed tools is queue-with-progress, not parallelism.
 *
 * Progress is *not* wired here — see `runFFmpegTask`, which owns the callback
 * for the duration of one operation.
 */
export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;

  if (!loadPromise) {
    const instance = new FFmpeg();
    const gen = generation;

    instance.on("log", ({ message }) => {
      console.log("[ffmpeg]", message);
    });

    // One progress listener for the lifetime of the instance; routes to
    // whichever task currently holds the queue.
    instance.on("progress", ({ progress }) => {
      const cb = currentOnProgress;
      if (cb) cb(Math.min(Math.round(progress * 100), 100));
    });

    // Capture the in-flight load. On failure we null out state so the
    // *next* getFFmpeg() call can retry; concurrent awaiters see the same
    // rejection rather than accidentally retrying mid-flight.
    loadPromise = (async () => {
      try {
        await instance.load({
          coreURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
        });
        // A terminate() landed while we were loading: this instance is already
        // orphaned, so drop it rather than publishing it as the singleton.
        if (gen !== generation) {
          instance.terminate();
          throw abortError();
        }
        ffmpeg = instance;
      } catch (err) {
        if (gen === generation) {
          ffmpeg = null;
          loadPromise = null;
        }
        throw err;
      }
    })();
  }

  await loadPromise;
  if (!ffmpeg) throw new Error("FFmpeg failed to initialize");
  return ffmpeg;
}

/**
 * Destroy the worker, cancelling whatever it is running.
 *
 * This is the only way to actually stop an FFmpeg job: `exec`'s own `signal`
 * option merely rejects the JS promise while the wasm keeps grinding to
 * completion in the worker. The next task reloads the core, which is cheap now
 * that it comes from our own origin instead of a 31 MB CDN pull.
 */
export function terminateFFmpeg(): void {
  const instance = ffmpeg;
  generation++;
  ffmpeg = null;
  loadPromise = null;
  currentOnProgress = null;
  instance?.terminate();
}

/**
 * Run one FFmpeg operation with progress reporting and cancellation.
 *
 * Tasks are queued, so `onProgress` is unambiguous for its whole run, and an
 * abort tears the worker down rather than leaving it burning CPU on output
 * nobody is waiting for.
 */
export function runFFmpegTask<T>(
  task: (ffmpeg: FFmpeg) => Promise<T>,
  ctx: ProcessingContext = {},
): Promise<T> {
  const result = queue.then(() => executeFFmpegTask(task, ctx));
  // The chain must survive a failing task, or every later task inherits its
  // rejection and the tool dies until reload.
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function executeFFmpegTask<T>(
  task: (ffmpeg: FFmpeg) => Promise<T>,
  { onProgress, signal }: ProcessingContext,
): Promise<T> {
  // Cancelled while queued behind another task — never start.
  throwIfAborted(signal);

  const onAbort = () => terminateFFmpeg();
  signal?.addEventListener("abort", onAbort, { once: true });

  const handler = onProgress ?? null;

  try {
    const instance = await getFFmpeg();
    throwIfAborted(signal);
    currentOnProgress = handler;
    return await task(instance);
  } catch (err) {
    // terminate() rejects in-flight calls with its own error; report the
    // cancellation the caller actually asked for.
    if (signal?.aborted) throw abortError();
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (currentOnProgress === handler) currentOnProgress = null;
  }
}

/**
 * Read a File into a Uint8Array for writing to FFmpeg's virtual FS.
 */
export async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}
