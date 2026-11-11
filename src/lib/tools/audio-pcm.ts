/**
 * Pure PCM encoders — raw Float32 channels in, encoded Blob out. No
 * AudioBuffer, no DOM, and deliberately no static imports at all.
 *
 * This module is the audio pool worker's ONLY import
 * (workers/audio-encode.worker.ts). It must stay a leaf: the buffer-level
 * wrappers in audio-encode-mp3/wav.ts reach the worker through
 * workers/audio-client.ts, so an import from here back toward those modules
 * would put the worker's own URL inside the worker bundle — a chunking cycle
 * that hangs `next build` (Turbopack chases it; dev never compiled it because
 * nothing in the worker calls the wrappers).
 */

/**
 * The slice of the libmp3lame wasm module this file actually touches, declared
 * by hand.
 *
 * A dynamic `import()` whose specifier is not a string literal has no static
 * type — TypeScript hands back `Promise<any>` because it cannot know which file
 * will answer the request. Rather than let `any` leak into the encode loop, the
 * members we call are described here and the module promise is cast once, at
 * the single point where it is created.
 *
 * The pointer accessors return BYTE offsets into the wasm heap and are constant
 * for the module's lifetime: the bridge's buffers are file-scope arrays and the
 * build sets `ALLOW_MEMORY_GROWTH=0`, so neither the addresses nor the cached
 * `HEAPF32`/`HEAPU8` views can be invalidated mid-encode. See
 * vendor/libmp3lame/mp3-bridge.c, whose header explains why the buffers are
 * fixed rather than malloc'd per call.
 */
interface LameWasmModule {
  /** Float32 input scratch, `_mp3_frame_capacity()` samples per channel. */
  _mp3_in_left(): number;
  _mp3_in_right(): number;
  /** Where `_mp3_encode`/`_mp3_flush` leave their bytes. */
  _mp3_out(): number;
  _mp3_frame_capacity(): number;
  /** 0 on success; a negative bridge/LAME code on failure. */
  _mp3_open(channels: number, sampleRate: number, kbps: number): number;
  /** MP3 bytes now in `_mp3_out()`, or a negative LAME error code. */
  _mp3_encode(samples: number): number;
  /** The final partial frame plus the encoder's lookahead. */
  _mp3_flush(): number;
  _mp3_close(): void;
  HEAPF32: Float32Array;
  HEAPU8: Uint8Array;
}

/** The glue is an ES module whose default export builds the instance. */
type LameModuleFactory = {
  default: (options?: Record<string, unknown>) => Promise<LameWasmModule>;
};

/**
 * Same-origin URL of a vendored third-party library, prefixed the way every
 * other self-hosted asset in this app is (see workers/audio-client.ts and
 * workers/image-client.ts). The basepath is currently "" — the site deploys to
 * the apex domain — but reading it here keeps one idiom for all of them.
 *
 * THIS FUNCTION IS LOAD-BEARING. Do not inline it back into the `import()`
 * below, and do not turn the call site into a plain template literal. Both
 * bundlers that compile this file constant-fold hard: esbuild
 * (scripts/build-workers.mjs) `define`s `process.env.__NEXT_ROUTER_BASEPATH`
 * to `""`, so a bare template literal at the `import()` would collapse into
 * the string "/vendor/libmp3lame.js", which esbuild would then happily resolve
 * from disk and inline — putting the encoder straight back inside
 * public/workers/audio-encode.worker.js. Routing the specifier through a
 * function call keeps the argument non-analyzable, so both esbuild and
 * Turbopack leave it alone and emit a real runtime request.
 *
 * `attempt` exists because of how browsers remember failure: a module that
 * fails to fetch is recorded as failed in the realm's module map, and every
 * later `import()` of THAT SPECIFIER rejects from the map without touching the
 * network. Measured in Chromium and WebKit — a same-URL retry after a 503 made
 * no second request at all, while a query-string-distinguished URL fetched and
 * succeeded. So a retry has to ask for a URL the map has not already condemned.
 * The base path stays stable, which is what the licence's replaceability
 * condition is about: `/vendor/libmp3lame.js` — and the `.wasm` the glue
 * resolves beside it — is still what you overwrite.
 */
function vendorUrl(name: string, attempt = 0): string {
  const base = `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/vendor/${name}`;
  return attempt === 0 ? base : `${base}?retry=${attempt}`;
}


/**
 * The instantiated encoder, memoised. Native dynamic import caches the module
 * anyway, but holding the promise means a burst of encodes shares one
 * in-flight request — and one wasm instance — instead of each racing its own.
 */
let lame: Promise<LameWasmModule> | null = null;
/** How many times loading has been attempted; see vendorUrl's `attempt`. */
let lameAttempts = 0;

/**
 * Fetch libmp3lame from `/vendor/libmp3lame.js` instead of bundling it.
 *
 * LAME is LGPL-2.0-or-later — the same licence class as the lamejs port this
 * replaced, so the posture is unchanged. A program that merely *uses* an LGPL
 * library may keep its own terms only while the library stays replaceable: the
 * user has to be able to substitute their own build and have this app pick it
 * up. A copy minified into our worker bundle and into a Next client chunk fails
 * that plainly, because swapping the encoder would mean editing our compiled
 * output. So `npm run copy:wasm` stages `vendor/libmp3lame/libmp3lame.{js,wasm}`
 * into `public/vendor/` and this loads it over the network at first encode.
 * Replacing the encoder is "overwrite two files in public/vendor/".
 *
 * The `.wasm` needs no URL handling here. The glue resolves it as
 * `new URL("libmp3lame.wasm", import.meta.url)`, and because this `import()`
 * fetches the glue from `/vendor/libmp3lame.js` that lands on
 * `/vendor/libmp3lame.wasm` — which is the other reason the pair must stay side
 * by side under one stable directory, and why neither may be inlined.
 *
 * The worker is created with `{ type: "module" }` from a same-origin
 * `/workers/*.js` URL (audio-client.ts), so this `import()` resolves inside the
 * worker exactly as it does on the main thread. It would NOT resolve from a
 * blob: worker — a blob URL is not a base a module specifier can be resolved
 * against — so do not move the workers onto blob URLs.
 *
 * The magic comments state the same requirement out loud rather than leaving it
 * to rest on a bundler's analysis limits: `webpackIgnore`/`turbopackIgnore`
 * both instruct Turbopack to leave a dynamic import exactly as written. Belt
 * and braces on purpose — the licensing posture depends on these bytes never
 * landing inside a bundle.
 */
function loadLame(): Promise<LameWasmModule> {
  if (!lame) {
    // Two things are needed for a retry to be a real retry, and neither alone
    // is enough: drop our own memo (a plain `??=` would replay the REJECTED
    // promise forever), AND ask for a URL the browser's module map has not
    // already recorded as failed (see vendorUrl — the map is why re-importing
    // the same specifier never even reaches the network).
    lame = (
      import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ vendorUrl("libmp3lame.js", lameAttempts++)
      ) as Promise<LameModuleFactory>
    )
      .then((mod) => mod.default())
      .catch((err) => {
        lame = null;
        throw err;
      });
  }
  return lame;
}

/**
 * Encodes run one at a time.
 *
 * NOT a performance choice — a correctness one. The bridge keeps LAME's state
 * in a single file-scope `lame_global_flags *gfp` and encodes through
 * file-scope scratch buffers, so one wasm instance can carry exactly one
 * encode. Two overlapping calls would interleave their samples through the same
 * buffers and reconfigure the same encoder mid-stream. Inside the audio pool
 * that cannot happen (one task per worker), but `encodePcmToMp3` is also
 * reachable on the main thread through audio-client.ts's no-worker fallback,
 * where nothing else serialises it.
 */
let encodeQueue: Promise<unknown> = Promise.resolve();

/**
 * Gain applied to every channel beyond front L/R when folding a surround mix
 * down to stereo — the conventional -3 dB, which keeps the summed result at
 * roughly the original loudness instead of clipping.
 */
const SURROUND_FOLD_GAIN = Math.SQRT1_2;

/**
 * MP3 itself tops out here, and LAME rejects a higher rate outright.
 *
 * Deliberately a plain const and not something behind the loader: callers
 * (audio-encode-mp3.ts's `resampleForMp3`) consult it to decide whether to
 * resample *before* any encode starts, and making that decision wait on a
 * network fetch of the encoder would be absurd.
 */
export const MAX_MP3_SAMPLE_RATE = 48000;

/**
 * PCM → MP3 via libmp3lame, compiled to single-threaded SIMD wasm.
 *
 * Async only because the encoder itself is fetched rather than bundled (see
 * `loadLame`); once it is in hand the encode is the same straight-line,
 * blocking loop it always was, which is why it runs in a worker.
 *
 * MP3 tops out at two channels, and LAME takes the channel count at face
 * value — it was previously handed the source channel count unclamped, so a
 * 5.1 source configured the encoder for six channels while only two were ever
 * fed to it, producing a file no decoder reads correctly. Anything above stereo
 * is folded down rather than truncated, so a film mix keeps its centre
 * channel (the dialogue) instead of losing it.
 *
 * TWO THINGS LEFT WITH lamejs and are worth naming, because both were O(n)
 * work this function no longer does. The Float32 → Int16 conversion is gone:
 * `lame_encode_buffer_ieee_float` takes the [-1,1] floats WebAudio already
 * hands us, so there is no second whole-signal allocation and no per-sample
 * loop before the encoder sees anything. The clamp that loop also performed
 * moved into the bridge's `clamp_into`, where it vectorises.
 *
 * MEASURED 2026-11-11, headless Chromium, importing the shipped
 * `/vendor/libmp3lame.js` over HTTP as the site does, 60 s stereo @ 192 kbps:
 * lamejs 1,124 ms (53.4x realtime), this path 264 ms (227.3x) — 4.3x, with
 * byte-identical 1,440,705-byte output. The lamejs figure includes the Int16
 * conversion it required, because that was real work per export.
 *
 * Samples are batched at the bridge's own `_mp3_frame_capacity()` (32 MP3
 * frames) rather than one 1152-sample frame at a time: at one frame per call
 * the JS→wasm boundary dominated. The output of each batch is COPIED out of
 * the heap with `slice`, not viewed with `subarray`, because the next call
 * overwrites that same scratch buffer.
 *
 * `onProgress` (0–100) ticks as batches encode.
 */
export async function encodePcmToMp3(
  channelData: Float32Array[],
  sampleRate: number,
  bitrate: number,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const mod = await loadLame();
  // One encode at a time per instance — see `encodeQueue`. The chain is
  // advanced with a swallowed copy so one failed encode cannot poison the
  // encodes queued behind it.
  const run = encodeQueue.then(() =>
    encodeOnLoadedModule(mod, channelData, sampleRate, bitrate, onProgress),
  );
  encodeQueue = run.then(
    () => {},
    () => {},
  );
  return run;
}

async function encodeOnLoadedModule(
  mod: LameWasmModule,
  channelData: Float32Array[],
  sampleRate: number,
  bitrate: number,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const channels = Math.min(channelData.length, 2);
  const opened = mod._mp3_open(channels, sampleRate, bitrate);
  if (opened !== 0) {
    throw new Error(
      `The MP3 encoder refused these settings (${channels}ch, ${sampleRate} Hz, ${bitrate} kbps; code ${opened}).`,
    );
  }

  try {
    const [left, right] = toStereoFloats(channelData);
    const total = left.length;
    const capacity = mod._mp3_frame_capacity();
    // Byte pointers; HEAPF32 is indexed in floats, so those two shift by 2.
    const leftIndex = mod._mp3_in_left() >>> 2;
    const rightIndex = mod._mp3_in_right() >>> 2;
    const outOffset = mod._mp3_out();

    // Collected and handed to one Blob at the end rather than concatenated as
    // they arrive, so the encode loop never copies the growing output.
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < total; i += capacity) {
      const n = Math.min(capacity, total - i);
      mod.HEAPF32.set(left.subarray(i, i + n), leftIndex);
      // Mono deliberately leaves the right buffer alone: the bridge passes
      // `in_left` twice for a single channel (LAME wants both pointers
      // non-null even then), so `in_right` is never read and writing it would
      // be wasted copying. `toStereoFloats` is what guarantees `right` exists
      // whenever the encoder was opened with two channels.
      if (right) mod.HEAPF32.set(right.subarray(i, i + n), rightIndex);

      const written = mod._mp3_encode(n);
      if (written < 0) throw new Error(`The MP3 encoder failed (code ${written}).`);
      if (written > 0) chunks.push(mod.HEAPU8.slice(outOffset, outOffset + written));

      // One tick per batch is already ~0.8 s of audio at 44.1 kHz, so this
      // needs no further rate limiting to stay cheap.
      onProgress?.(Math.min(99, Math.round(((i + n) / total) * 100)));
    }

    const tail = mod._mp3_flush();
    if (tail < 0) throw new Error(`The MP3 encoder failed to finish (code ${tail}).`);
    if (tail > 0) chunks.push(mod.HEAPU8.slice(outOffset, outOffset + tail));

    return new Blob(chunks as unknown as BlobPart[], { type: "audio/mpeg" });
  } finally {
    // Always: the instance is reused by every later encode, and a half-open
    // encoder would carry this run's state into the next one.
    mod._mp3_close();
  }
}

/**
 * Reduce any channel layout to what MP3 can carry: mono stays mono, stereo
 * passes through untouched, and anything wider is folded into L/R with the
 * extra channels summed in at -3 dB.
 */
function toStereoFloats(channelData: Float32Array[]): [Float32Array, Float32Array | undefined] {
  const count = channelData.length;
  if (count === 1) return [channelData[0], undefined];
  if (count === 2) return [channelData[0], channelData[1]];

  const left = Float32Array.from(channelData[0]);
  const right = Float32Array.from(channelData[1]);
  for (let ch = 2; ch < count; ch++) {
    const extra = channelData[ch];
    for (let i = 0; i < left.length; i++) {
      const folded = extra[i] * SURROUND_FOLD_GAIN;
      left[i] += folded;
      right[i] += folded;
    }
  }
  // The sum can exceed unity; the bridge's `clamp_into` would catch it, but
  // normalising here keeps the stereo image intact instead of flat-topping the
  // loudest passages.
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak > 1) {
    for (let i = 0; i < left.length; i++) {
      left[i] /= peak;
      right[i] /= peak;
    }
  }
  return [left, right];
}

// ── WAV ───────────────────────────────────────────────────────────

const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const HEADER_BYTES = 44;

/**
 * PCM → 16-bit WAV, interleaving every channel.
 *
 * Hand-rolled rather than delegating to `audiobuffer-to-wav`, which interleaves
 * only when there are exactly two channels and otherwise writes **channel 0's
 * samples alone** beneath a header still declaring the source channel count.
 * A 5.1 source came back as a file promising six channels and carrying one, so
 * players read it at a sixth of the real duration with the audio smeared across
 * the speakers. Interleaving properly here keeps every channel and, more
 * importantly, keeps the header and the payload agreeing with each other.
 */
export function encodePcmToWav(channels: Float32Array[], sampleRate: number): Blob {
  const numberOfChannels = channels.length;
  const length = channels[0]?.length ?? 0;
  const blockAlign = numberOfChannels * BYTES_PER_SAMPLE;
  const dataBytes = length * blockAlign;

  const out = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(out);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk length
  view.setUint16(20, 1, true); // format: uncompressed PCM
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true); // bits per sample

  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = HEADER_BYTES;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return new Blob([out], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
