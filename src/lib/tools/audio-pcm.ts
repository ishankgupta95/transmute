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
 * The slice of lamejs this module actually touches, declared by hand.
 *
 * A dynamic `import()` whose specifier is not a string literal has no static
 * type — TypeScript hands back `Promise<any>` because it cannot know which
 * file will answer the request. Rather than let `any` leak into the encode
 * loop, the two members we call are described here and the module promise is
 * cast once, at the single point where it is created. `encodeBuffer`/`flush`
 * return `Uint8Array` in @breezystack/lamejs (upstream zhuker/lamejs typed
 * them as `Int8Array`); either is fine inside a Blob, the on-wire bytes are
 * identical, but the declaration has to match the build we actually ship.
 */
interface LameMp3Encoder {
  encodeBuffer(left: Int16Array, right?: Int16Array): Uint8Array;
  flush(): Uint8Array;
}

interface LameModule {
  Mp3Encoder: new (channels: number, sampleRate: number, kbps: number) => LameMp3Encoder;
}

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
 * the string "/vendor/lamejs.js", which esbuild would then happily resolve
 * from disk and inline — putting lamejs straight back inside
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
 * condition is about: `/vendor/lamejs.js` is still the file you overwrite.
 */
function vendorUrl(name: string, attempt = 0): string {
  const base = `${process.env.__NEXT_ROUTER_BASEPATH ?? ""}/vendor/${name}`;
  return attempt === 0 ? base : `${base}?retry=${attempt}`;
}


/**
 * The loaded lamejs module, memoised. Native dynamic import caches modules
 * anyway, but holding the promise means a burst of encodes shares one
 * in-flight request instead of each racing its own.
 */
let lamejs: Promise<LameModule> | null = null;
/** How many times loading has been attempted; see vendorUrl's `attempt`. */
let lamejsAttempts = 0;

/**
 * Fetch lamejs from `/vendor/lamejs.js` instead of bundling it.
 *
 * lamejs is LGPL-3.0. A program that merely *uses* an LGPL library may keep
 * its own terms only while the library stays replaceable — the user has to be
 * able to substitute their own build of it and have this app pick that build
 * up. A copy minified into our worker bundle and into a Next client chunk
 * fails that plainly: swapping lamejs would mean editing our compiled output.
 * So `npm run copy:wasm` copies upstream's `dist/lamejs.js` byte-for-byte into
 * `public/vendor/`, and this loads it over the network at first encode.
 * Replacing the encoder is now "overwrite one file in public/vendor/".
 *
 * The worker is created with `{ type: "module" }` from a same-origin
 * `/workers/*.js` URL (audio-client.ts), so this `import()` resolves inside
 * the worker exactly as it does on the main thread. It would NOT resolve from
 * a blob: worker — a blob URL is not a base a module specifier can be
 * resolved against — so do not move the workers onto blob URLs.
 *
 * The magic comments state the same requirement out loud rather than leaving
 * it to rest on a bundler's analysis limits: `webpackIgnore`/`turbopackIgnore`
 * both instruct Turbopack to leave a dynamic import exactly as written. Belt
 * and braces on purpose — the licensing posture depends on these bytes never
 * landing inside a bundle.
 */
function loadLamejs(): Promise<LameModule> {
  if (!lamejs) {
    // Two things are needed for a retry to be a real retry, and neither alone
    // is enough: drop our own memo (a plain `??=` would replay the REJECTED
    // promise forever), AND ask for a URL the browser's module map has not
    // already recorded as failed (see vendorUrl — the map is why re-importing
    // the same specifier never even reaches the network).
    lamejs = (
      import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ vendorUrl("lamejs.js", lamejsAttempts++)
      ) as Promise<LameModule>
    ).catch((err) => {
      lamejs = null;
      throw err;
    });
  }
  return lamejs;
}

/**
 * Gain applied to every channel beyond front L/R when folding a surround mix
 * down to stereo — the conventional -3 dB, which keeps the summed result at
 * roughly the original loudness instead of clipping.
 */
const SURROUND_FOLD_GAIN = Math.SQRT1_2;

/**
 * MP3 itself tops out here — lamejs silently mangles anything above it.
 *
 * Deliberately a plain const and not something behind the loader: callers
 * (audio-encode-mp3.ts's `resampleForMp3`) consult it to decide whether to
 * resample *before* any encode starts, and making that decision wait on a
 * network fetch of the encoder would be absurd.
 */
export const MAX_MP3_SAMPLE_RATE = 48000;

/**
 * PCM → MP3 via lamejs.
 *
 * Async only because the encoder itself is fetched rather than bundled (see
 * `loadLamejs`); once it is in hand the encode is the same straight-line,
 * blocking loop it always was, which is why it runs in a worker.
 *
 * MP3 tops out at two channels, and lamejs takes the channel count at face
 * value — it was previously handed the source channel count unclamped, so a
 * 5.1 source configured the encoder for six channels while only two were ever
 * fed to it, producing a file no decoder reads correctly. Anything above stereo
 * is folded down rather than truncated, so a film mix keeps its centre
 * channel (the dialogue) instead of losing it.
 *
 * `onProgress` (0–100) ticks as frames encode.
 */
export async function encodePcmToMp3(
  channelData: Float32Array[],
  sampleRate: number,
  bitrate: number,
  onProgress?: (progress: number) => void,
): Promise<Blob> {
  const { Mp3Encoder } = await loadLamejs();
  const channels = Math.min(channelData.length, 2);
  const encoder = new Mp3Encoder(channels, sampleRate, bitrate);

  const [leftFloats, rightFloats] = toStereoFloats(channelData);
  const left = floatTo16Bit(leftFloats);
  const right = rightFloats ? floatTo16Bit(rightFloats) : undefined;

  const chunkSize = 1152; // MP3 frame size
  // Uint8Array, per the LameMp3Encoder declaration above — the frames are
  // collected and handed to one Blob at the end rather than concatenated as
  // they arrive, so the encode loop never copies the growing output.
  const chunks: Uint8Array[] = [];

  // Progress every ~256 frames — enough resolution for a bar, cheap enough
  // to be free when nobody listens.
  const progressEvery = chunkSize * 256;
  for (let i = 0; i < left.length; i += chunkSize) {
    const leftChunk = left.subarray(i, i + chunkSize);
    const rightChunk = right?.subarray(i, i + chunkSize);
    const encoded = channels > 1
      ? encoder.encodeBuffer(leftChunk, rightChunk)
      : encoder.encodeBuffer(leftChunk);
    if (encoded.length > 0) chunks.push(encoded);
    if (onProgress && i % progressEvery === 0 && i > 0) {
      onProgress(Math.round((i / left.length) * 100));
    }
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(flushed);

  return new Blob(chunks as unknown as BlobPart[], { type: "audio/mpeg" });
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
  // The sum can exceed unity; floatTo16Bit clamps, but doing it here keeps the
  // stereo image intact instead of flat-topping the loudest passages.
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

function floatTo16Bit(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
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
