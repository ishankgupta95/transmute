import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import type { ProcessingContext } from "@/hooks/useFileProcessor";
import { abortError, throwIfAborted } from "@/lib/utils/abort";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * How big a file the FFmpeg tools can take, and where the numbers come from
 * ───────────────────────────────────────────────────────────────────────────
 * The constant that used to sit here was `100 * 1024 * 1024` with no
 * derivation. It was ~18x too strict. Everything below was measured on
 * 2026-08-30 in desktop Chrome, driving the real tools at /mp4-to-mp3 and
 * /video-trimmer against real MP4s (the repo's `sample-video.mp4` looped with
 * `-stream_loop` to 125.4 / 150 / 400 / 800 / 1500 / 1530 / 2500 MiB, each run
 * through the tool's own UI and the download checked for size).
 *
 * WHERE THE BYTES ACTUALLY GO
 *   The input does not have to be copied at all. `mountInputFile` mounts the
 *   `File` itself into FFmpeg's virtual FS through WORKERFS, and the core
 *   reads slices out of it on demand — so the source never becomes an
 *   ArrayBuffer, on either thread. What we do have to hold is the OUTPUT:
 *   FFmpeg writes it into MEMFS, and MEMFS keeps each file in ONE JS
 *   `Uint8Array` on the worker's heap (not in the wasm heap).
 *
 * THE THREE CEILINGS, and which one binds
 *   1. The wasm heap. The shipped `ffmpeg-core.wasm` declares memory
 *      { initial: 512 pages = 32 MB, maximum: 32768 pages = 2048 MB }.
 *      Measured by growing a matching `WebAssembly.Memory` in-tab: it reaches
 *      2016 MB, then `RangeError: Maximum memory size exceeded`. NOT the
 *      binding limit for file size — file bytes live in MEMFS on the JS side;
 *      the wasm heap only carries codec working buffers, which for a stream
 *      copy and for audio-only decode are a few MB.
 *   2. One JS buffer. V8 will not hand out a single ArrayBuffer/Uint8Array of
 *      about 2 GiB. Measured in-tab, each size in its own allocation:
 *      2040 MiB succeeds, 2047 MiB throws
 *      `RangeError: Array buffer allocation failed`. This is the wall MEMFS
 *      runs into, and no device has more of it — it is a V8 limit, not a RAM
 *      limit.
 *   3. MEMFS growth. emscripten's `expandFileStorage` grows a file's array by
 *      `capacity * 1.125` and holds the old and the new array at the same time
 *      while it copies, so a file dies well below (2). Measured: trimming a
 *      2500 MiB source ran for 15 s, reached `size= 1838336kB` (1795 MiB) in
 *      the FFmpeg log, and then the worker died. 1500 MiB trimmed and
 *      downloaded fine (1500.1 MB out, 13 s).
 *
 * WHAT THAT MAKES THE LIMITS — they differ by job shape, because the shapes
 * hold different things:
 *   - Stream copy (video-trimmer): the trimmed clip is the same bitrate as the
 *     source, so a full-length selection produces an output the size of the
 *     input, and THAT is what has to survive MEMFS. 1795 MiB observed failure
 *     divided by the 1.125 growth factor is ~1595 MiB; rounded down to
 *     1536 MiB (1.5 GiB) for margin. Verified at the cap: a 1530.2 MiB source
 *     trimmed to a 1530.2 MiB download in 14 s.
 *   - Audio extraction (mp4-to-mp3): the input is mounted and never copied,
 *     and the MP3 is a small fraction of the source. There is no input cap.
 *     Verified: a 2500 MiB MP4 extracted to a 775 MiB MP3 in 251 s. The MP3
 *     is subject to the same MEMFS ceiling, which at 320 kbps is ~13 hours of
 *     audio; if a run ever reaches it, `describeFFmpegFailure` says so.
 *
 * WHAT IS DELIBERATELY *NOT* KEYED ON
 *   A phone's per-tab budget is far below a desktop's, and iOS kills the tab
 *   instead of throwing something catchable, so no in-page message can be
 *   shown at all there. We do not sniff the user agent to guess it: the caps
 *   here are the sizes that cannot work on ANY device, and anything under them
 *   is allowed to try and — if the device runs out — to fail with a real
 *   message rather than a silent stall. If a device-aware limit is ever wanted,
 *   the honest input is `navigator.deviceMemory` (Chromium-only, absent in
 *   Safari, quantised to 0.25/0.5/1/2/4/8), used to warn rather than to block.
 */

/**
 * The largest single file MEMFS was observed to finish writing before the JS
 * heap refused it (see the derivation above). Not a tuning knob: it is a
 * property of V8's max buffer size and emscripten's 1.125x growth factor.
 */
export const MEMFS_MAX_FILE_BYTES = 1795 * 1024 * 1024;

/**
 * Input cap for stream-copy jobs, whose output is the same size as their
 * input: `MEMFS_MAX_FILE_BYTES / 1.125` rounded down to 1.5 GiB.
 */
export const STREAM_COPY_MAX_INPUT_BYTES = 1536 * 1024 * 1024;

/**
 * What a job has to hold at once, which is what decides its input limit.
 * - `stream-copy`: input plus a same-sized output (video-trimmer).
 * - `audio-extract`: a mounted input plus a much smaller output (mp4-to-mp3).
 */
export type FFmpegJobShape = "stream-copy" | "audio-extract";

/** Input-size limit in bytes for a job shape; `null` where no cap is honest. */
export function ffmpegInputLimitBytes(shape: FFmpegJobShape): number | null {
  return shape === "stream-copy" ? STREAM_COPY_MAX_INPUT_BYTES : null;
}

const mib = (bytes: number) => Math.round(bytes / 1024 / 1024);

/**
 * Reject an input that provably cannot finish, with the actual reason.
 *
 * "Maximum is 100 MB" told the user a number and nothing else. A limit that
 * exists because a browser tab cannot hold the result should say that, so the
 * message names the ceiling and points at the tool that does not have it.
 */
export function validateFFmpegInput(file: File, shape: FFmpegJobShape): void {
  const limit = ffmpegInputLimitBytes(shape);
  if (limit === null || file.size <= limit) return;
  throw new Error(
    `This video is ${(file.size / 1024 / 1024).toFixed(1)} MB. Trimming keeps the original quality, so the trimmed copy is as large as the source and has to be held in the tab beside it — and a browser can hold at most about ${mib(MEMFS_MAX_FILE_BYTES)} MB in one file. The limit here is ${mib(limit)} MB. Extracting the audio (MP4 to MP3) has no size limit.`,
  );
}

/**
 * Signatures of a genuine out-of-memory, in the wording each layer uses:
 * V8 refusing a MEMFS array, the wasm heap hitting its declared maximum, and
 * emscripten's own aborts.
 */
const OOM_SIGNATURES = [
  "array buffer allocation failed",
  "allocation failed",
  "out of memory",
  "maximum memory size exceeded",
  "memory access out of bounds",
  "oom",
];

/**
 * Turn whatever the FFmpeg worker rejected with into an Error a user can act
 * on.
 *
 * Two reasons this has to exist. First, `@ffmpeg/ffmpeg`'s worker posts
 * `e.toString()` — a STRING, not an Error — so `useFileProcessor`'s
 * `err instanceof Error ? err.message : "Processing failed"` collapsed every
 * core-level failure into "Processing failed". A real out-of-memory (measured
 * above: a 2500 MiB trim) reached the user as exactly that. Second, an
 * out-of-memory deserves its own copy: it is the one failure the user can fix
 * by choosing a shorter selection.
 */
export function describeFFmpegFailure(err: unknown): Error {
  const text =
    typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
  const lower = text.toLowerCase();
  if (OOM_SIGNATURES.some((sig) => lower.includes(sig))) {
    return new Error(
      `Ran out of memory. A browser tab can hold about ${mib(MEMFS_MAX_FILE_BYTES)} MB in one file, and this job needed more. Try a shorter selection, or a smaller source file.`,
    );
  }
  if (err instanceof Error) return err;
  return new Error(text || "FFmpeg failed");
}

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

    // FFmpeg narrates every muxing decision — hundreds of lines per job. That
    // is useful while developing and pure noise in a shipped tab, so the
    // handler stays but the write is gated to development builds.
    instance.on("log", ({ message }) => {
      if (process.env.NODE_ENV !== "production") console.log("[ffmpeg]", message);
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
    // Everything else arrives from the worker as a bare string; hand the
    // caller a real Error, and name an out-of-memory as one.
    throw describeFFmpegFailure(err);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (currentOnProgress === handler) currentOnProgress = null;
  }
}

/**
 * Read a File into a Uint8Array for writing to FFmpeg's virtual FS.
 *
 * Prefer `mountInputFile` for anything video-sized: this materialises the
 * whole file as one ArrayBuffer, which is both a full copy and subject to the
 * ~2 GiB single-buffer ceiling documented at the top of this file. It stays
 * for callers whose input is small and whose source is not a `File` on disk
 * (the m4a/Ogg decode fallback in `audio-decode.ts`).
 */
export async function fileToUint8Array(file: File): Promise<Uint8Array> {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

/** Where `mountInputFile` attaches the source. One job runs at a time. */
const MOUNT_DIR = "/mnt-input";

/**
 * Make a `File` readable by FFmpeg WITHOUT copying its bytes anywhere.
 *
 * WORKERFS backs a virtual file with the `Blob` itself and reads slices out of
 * it with `FileReaderSync` as the core seeks. That removes both copies the old
 * path paid for: `file.arrayBuffer()` materialising the whole source in the
 * page's heap, and `writeFile` handing those bytes to MEMFS, which keeps them
 * in a second array for the length of the job. For a 1.5 GB video that is
 * ~3 GB of resident bytes this never allocates — and it is why audio
 * extraction no longer needs an input-size cap at all.
 *
 * Measured cost: none worth naming for audio extraction (400 MiB extract:
 * 39.3 s copying vs 41.3 s mounted) and a slower but still trivial trim
 * (1500 MiB trim: 7.1 s copying vs 13.1 s mounted), since a stream copy reads
 * the source straight through.
 *
 * `name` is the virtual filename, so it carries the extension FFmpeg uses as
 * its demuxer hint; the user's own filename never has to be legal here.
 */
export async function mountInputFile(ffmpeg: FFmpeg, file: File, name: string): Promise<string> {
  try {
    await ffmpeg.createDir(MOUNT_DIR);
  } catch {
    // Already there: the directory outlives a job, only the mount is per-job.
  }
  await ffmpeg.mount(FFFSType.WORKERFS, { blobs: [{ name, data: file }] }, MOUNT_DIR);
  return `${MOUNT_DIR}/${name}`;
}

/**
 * Release the mounted source. Call it from a `finally`: a mount left behind by
 * a failed job makes the NEXT job's `mount` fail on a busy mount point.
 */
export async function unmountInputFile(ffmpeg: FFmpeg): Promise<void> {
  try {
    await ffmpeg.unmount(MOUNT_DIR);
  } catch {
    // Nothing mounted, or the worker was terminated by a cancel.
  }
}
